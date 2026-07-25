//! Frozen ONNX encoder inference: image in, dense patch tokens out.
//!
//! # Robustness over hard-coding
//!
//! Every backbone names its tensors differently (`pixel_values` /
//! `last_hidden_state` for Hub ViTs, `image` / `features` for the bundled
//! SAM-style encoder) and lays its output out differently (`[B, T, D]` tokens
//! vs `[B, D, gh, gw]` maps). Rather than encode a table of per-model quirks,
//! this module:
//!
//! 1. takes the graph's *declared* input name, and
//! 2. binds every declared output, runs once, and picks the result that
//!    actually looks like a dense feature map.
//!
//! The registry's `embed_dim` / `input_size` stay hints for the UI; the numbers
//! used for real come from the graph. A new encoder can usually be added by
//! appending one catalog row.

use ndarray::{Array3, Array4};
use ort::{
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};
use std::path::Path;

use super::registry::EncoderSpec;

/// A loaded, frozen encoder.
pub struct EncoderSession {
    session: Session,
    input_name: String,
    output_names: Vec<String>,
    /// Square input side the graph is fed (from the spec; graphs with dynamic
    /// axes accept it, fixed-axis graphs were authored for it).
    input_size: u32,
    spec: EncoderSpec,
}

/// Dense features from one image: `[D, grid_h, grid_w]`.
pub struct PatchFeatures {
    pub data: Array3<f32>,
}

impl EncoderSession {
    /// Open a cached `.onnx` file. Execution providers mirror `dl::model` so
    /// the GPU is used when present and CPU is the fallback.
    pub fn load(path: &Path, spec: EncoderSpec) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("session builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("optimization level: {e}"))?
            .with_intra_threads(4)
            .map_err(|e| format!("intra threads: {e}"))?
            .commit_from_file(path)
            .map_err(|e| format!("failed to open {}: {e}", path.display()))?;

        let input_name = session
            .inputs
            .first()
            .map(|i| i.name.clone())
            .ok_or_else(|| "encoder graph declares no inputs".to_string())?;
        let output_names: Vec<String> = session.outputs.iter().map(|o| o.name.clone()).collect();
        if output_names.is_empty() {
            return Err("encoder graph declares no outputs".into());
        }

        let input_size = spec.input_size;
        Ok(Self {
            session,
            input_name,
            output_names,
            input_size,
            spec,
        })
    }

    /// Scale `[C, H, W]` in `[0, 1]` into the tensor the graph expects.
    ///
    /// Single-channel input (CT, MR, ultrasound, X-ray) is replicated across
    /// RGB, since these backbones are all three-channel.
    fn preprocess(&self, image: &Array3<f32>) -> Result<Tensor<f32>, String> {
        let s = self.input_size as usize;
        let resized = resize_bilinear(image, s, s);
        let c_in = resized.shape()[0];
        let (mean, std) = self.spec.normalize.mean_std();

        let mut data = vec![0.0f32; 3 * s * s];
        for c in 0..3 {
            let src_c = if c_in == 1 { 0 } else { c.min(c_in - 1) };
            for y in 0..s {
                for x in 0..s {
                    let v = resized[[src_c, y, x]];
                    data[c * s * s + y * s + x] = (v - mean[c]) / std[c];
                }
            }
        }

        let arr = Array4::from_shape_vec([1, 3, s, s], data)
            .map_err(|e| format!("failed to shape encoder input: {e}"))?;
        Tensor::from_array(arr).map_err(|e| format!("failed to build encoder tensor: {e}"))
    }

    /// Run the encoder and return dense patch features `[D, grid_h, grid_w]`.
    pub fn embed(&mut self, image: &Array3<f32>) -> Result<PatchFeatures, String> {
        let input = self.preprocess(image)?;

        let mut binding = self
            .session
            .create_binding()
            .map_err(|e| format!("failed to create binding: {e}"))?;
        binding
            .bind_input(&self.input_name, &input)
            .map_err(|e| format!("failed to bind '{}': {e}", self.input_name))?;
        let mem = self.session.allocator().memory_info();
        for name in &self.output_names {
            binding
                .bind_output_to_device(name, &mem)
                .map_err(|e| format!("failed to bind output '{name}': {e}"))?;
        }

        let outputs = self
            .session
            .run_binding(&binding)
            .map_err(|e| format!("encoder inference failed: {e}"))?;

        // Pick whichever declared output actually came back as a dense map.
        let mut best: Option<(Vec<usize>, Vec<f32>)> = None;
        for name in &self.output_names {
            let Some(value) = outputs.get(name.as_str()) else {
                continue;
            };
            let Ok((shape, data)) = value.try_extract_tensor::<f32>() else {
                continue;
            };
            let shape: Vec<usize> = shape.iter().map(|d| *d as usize).collect();
            if shape.len() < 3 {
                continue; // pooled/class vector — not a dense map
            }
            let elems: usize = shape.iter().product();
            if best.as_ref().map(|(_, d)| elems > d.len()).unwrap_or(true) {
                best = Some((shape, data.to_vec()));
            }
        }

        let (shape, data) =
            best.ok_or_else(|| "encoder produced no dense (rank>=3) output".to_string())?;
        let grid = decode_tokens(&shape, data)?;
        Ok(PatchFeatures { data: grid })
    }

    pub fn spec(&self) -> &EncoderSpec {
        &self.spec
    }
}

/// Reshape a raw encoder output into `[D, grid_h, grid_w]`.
///
/// Handles the two layouts in the wild:
/// * `[B, D, gh, gw]` — already a map (SAM-style).
/// * `[B, T, D]` — a token sequence. Any leading non-patch tokens (CLS, and the
///   register tokens some DINOv2 variants add) are dropped by taking the
///   largest trailing perfect square, which avoids hard-coding a count.
fn decode_tokens(shape: &[usize], data: Vec<f32>) -> Result<Array3<f32>, String> {
    match shape.len() {
        4 => {
            let (d, gh, gw) = (shape[1], shape[2], shape[3]);
            Array3::from_shape_vec((d, gh, gw), data)
                .map_err(|e| format!("failed to shape [D,gh,gw] features: {e}"))
        }
        3 => {
            let (t, d) = (shape[1], shape[2]);
            let side = (t as f64).sqrt().floor() as usize;
            if side == 0 {
                return Err(format!("encoder returned {t} tokens; cannot form a grid"));
            }
            let n_patch = side * side;
            let prefix = t - n_patch;
            let mut out = Array3::<f32>::zeros((d, side, side));
            for i in 0..n_patch {
                let (y, x) = (i / side, i % side);
                for c in 0..d {
                    out[[c, y, x]] = data[(prefix + i) * d + c];
                }
            }
            Ok(out)
        }
        n => Err(format!("unsupported encoder output rank {n}")),
    }
}

/// Bilinear resample of a `[C, H, W]` volume. Used both to fit images to the
/// encoder input and to lift patch tokens back to working resolution.
pub fn resize_bilinear(src: &Array3<f32>, out_h: usize, out_w: usize) -> Array3<f32> {
    let (c, h, w) = (src.shape()[0], src.shape()[1], src.shape()[2]);
    let mut out = Array3::<f32>::zeros((c, out_h, out_w));
    if h == 0 || w == 0 || out_h == 0 || out_w == 0 {
        return out;
    }
    // Half-pixel centres keep the sampling grid symmetric.
    let sy = h as f32 / out_h as f32;
    let sx = w as f32 / out_w as f32;
    for oy in 0..out_h {
        let fy = ((oy as f32 + 0.5) * sy - 0.5).clamp(0.0, (h - 1) as f32);
        let y0 = fy.floor() as usize;
        let y1 = (y0 + 1).min(h - 1);
        let wy = fy - y0 as f32;
        for ox in 0..out_w {
            let fx = ((ox as f32 + 0.5) * sx - 0.5).clamp(0.0, (w - 1) as f32);
            let x0 = fx.floor() as usize;
            let x1 = (x0 + 1).min(w - 1);
            let wx = fx - x0 as f32;
            for ch in 0..c {
                let top = src[[ch, y0, x0]] * (1.0 - wx) + src[[ch, y0, x1]] * wx;
                let bot = src[[ch, y1, x0]] * (1.0 - wx) + src[[ch, y1, x1]] * wx;
                out[[ch, oy, ox]] = top * (1.0 - wy) + bot * wy;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_map_layout() {
        // [B, D, gh, gw]
        let data: Vec<f32> = (0..(2 * 2 * 3)).map(|v| v as f32).collect();
        let out = decode_tokens(&[1, 2, 2, 3], data).unwrap();
        assert_eq!(out.shape(), &[2, 2, 3]);
        assert_eq!(out[[0, 0, 0]], 0.0);
        assert_eq!(out[[1, 0, 0]], 6.0);
    }

    #[test]
    fn decodes_token_layout_dropping_prefix_tokens() {
        // 1 CLS + 4 patches, D=2 -> 2x2 grid, CLS dropped.
        let d = 2;
        let mut data = vec![-1.0f32; d]; // CLS token, must be discarded
        for i in 0..4 {
            data.push(i as f32); // channel 0
            data.push(10.0 + i as f32); // channel 1
        }
        let out = decode_tokens(&[1, 5, d], data).unwrap();
        assert_eq!(out.shape(), &[2, 2, 2]);
        assert_eq!(out[[0, 0, 0]], 0.0);
        assert_eq!(out[[0, 1, 1]], 3.0);
        assert_eq!(out[[1, 0, 0]], 10.0);
        assert!(out.iter().all(|&v| v >= 0.0), "CLS token leaked into grid");
    }

    #[test]
    fn decodes_token_layout_with_register_tokens() {
        // DINOv2-with-registers style: 1 CLS + 4 registers + 9 patches -> 3x3.
        let (d, t) = (3usize, 14usize);
        let data = vec![1.0f32; t * d];
        let out = decode_tokens(&[1, t, d], data).unwrap();
        assert_eq!(out.shape(), &[3, 3, 3]);
    }

    #[test]
    fn rejects_pooled_output() {
        assert!(decode_tokens(&[1, 384], vec![0.0; 384]).is_err());
    }

    #[test]
    fn bilinear_resize_preserves_constants_and_shape() {
        let src = Array3::from_elem((2, 4, 4), 0.25);
        let up = resize_bilinear(&src, 8, 8);
        assert_eq!(up.shape(), &[2, 8, 8]);
        assert!(up.iter().all(|v| (v - 0.25).abs() < 1e-5));

        let down = resize_bilinear(&src, 2, 2);
        assert_eq!(down.shape(), &[2, 2, 2]);
        assert!(down.iter().all(|v| (v - 0.25).abs() < 1e-5));
    }

    #[test]
    fn bilinear_resize_interpolates_a_ramp_monotonically() {
        let src = Array3::from_shape_fn((1, 1, 4), |(_, _, x)| x as f32);
        let up = resize_bilinear(&src, 1, 8);
        for x in 1..8 {
            assert!(
                up[[0, 0, x]] >= up[[0, 0, x - 1]],
                "not monotonic at {x}: {:?}",
                up
            );
        }
    }
}
