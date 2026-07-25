//! Bridge from a `.dida` project to trainable sample tables.
//!
//! Per annotated frame: decode the image, rasterise its labels into a dense
//! class map, build the feature stack (local basis ⊕ optional encoder ⊕
//! scribble distances), and sample pixels.
//!
//! # Augmentation, and what is deliberately absent
//!
//! The head is a per-pixel MLP and the local basis is isotropic — Gaussian,
//! LoG, gradient magnitude and local sigma are all rotation-invariant, and the
//! Hessian eigenvalues are magnitude-ordered scalars, so they are too.
//! Consequently a flip or a 90-degree rotation only permutes *which pixel*
//! carries a given feature vector. Because training samples pixels and the head
//! has no spatial extent, the resulting sample table is identical. Geometric
//! augmentation here would cost real time and change nothing, so it is omitted
//! on purpose rather than by oversight.
//!
//! What does augment this architecture:
//!
//! * **Appearance jitter** (gamma / gain / bias) — genuinely moves feature
//!   values, and is the realistic nuisance across scanners and acquisitions.
//! * **Scribble resampling** — every repeat re-simulates strokes, so the head
//!   sees many conditionings of the same anatomy instead of memorising one.
//!
//! Encoder features are computed once per frame and reused across repeats: the
//! encoder forward pass dominates runtime, and modest photometric jitter
//! perturbs ViT features far less than it perturbs the local basis. This is an
//! approximation, and the one to revisit if augmentation looks ineffective.

use ndarray::{Array3, Axis};

use crate::commands::annotation::decode_to_uint8;
use crate::storage::{queries, DbState};

use super::encoder::{resize_bilinear, EncoderSession};
use super::filters::{self, FilterBankConfig};
use super::scribble::{self, Rng, SCRIBBLE_CHANNELS};
use super::train::Samples;

#[derive(Debug, Clone)]
pub struct DatasetConfig {
    /// Longest side the frame is resampled to before feature extraction.
    /// Bounds cost per frame independently of acquisition size.
    pub working_size: u32,
    /// Pixels sampled per frame per repeat.
    pub pixels_per_frame: usize,
    /// Number of augmented passes over each frame (1 = no augmentation).
    pub repeats: usize,
    pub scribble_strokes: usize,
    pub stroke_len: usize,
    pub seed: u64,
}

impl Default for DatasetConfig {
    fn default() -> Self {
        Self {
            working_size: 384,
            pixels_per_frame: 4000,
            repeats: 3,
            scribble_strokes: 3,
            stroke_len: 40,
            seed: 0,
        }
    }
}

/// Frames that carry at least one annotation.
pub fn annotated_frame_ids(db: &DbState) -> Result<Vec<i64>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT frame_id FROM annotations ORDER BY frame_id",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        let ids = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(ids)
    })
    .map_err(|e| format!("failed to list annotated frames: {e}"))
}

/// Project label ids in display order. Class index is `position + 1`; class 0
/// is background.
pub fn label_order(db: &DbState) -> Result<Vec<i64>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id FROM labels ORDER BY sort_order")?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        let ids = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(ids)
    })
    .map_err(|e| format!("failed to list labels: {e}"))
}

/// Nearest-neighbour downscale of a label mask.
///
/// Nearest, not averaged: interpolating class ids would invent labels that
/// never existed (the mean of class 1 and 3 is class 2).
pub fn downscale_nearest(src: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<u8> {
    let mut out = vec![0u8; dw * dh];
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 {
        return out;
    }
    for y in 0..dh {
        let sy = ((y as f32 + 0.5) * sh as f32 / dh as f32).floor() as usize;
        let sy = sy.min(sh - 1);
        for x in 0..dw {
            let sx = ((x as f32 + 0.5) * sw as f32 / dw as f32).floor() as usize;
            let sx = sx.min(sw - 1);
            out[y * dw + x] = src[sy * sw + sx];
        }
    }
    out
}

/// Flatten per-label masks into one dense class map (0 = background).
///
/// Overlaps resolve to the earliest label in project order, matching the
/// painter's order the editor shows, so the training target agrees with what
/// the annotator sees.
pub fn combine_masks(masks: &[(i64, Vec<u8>)], order: &[i64], n_px: usize) -> Vec<i32> {
    let mut out = vec![0i32; n_px];
    for (pos, label_id) in order.iter().enumerate() {
        let Some((_, mask)) = masks.iter().find(|(id, _)| id == label_id) else {
            continue;
        };
        let class = (pos + 1) as i32;
        for i in 0..n_px.min(mask.len()) {
            if mask[i] > 0 && out[i] == 0 {
                out[i] = class;
            }
        }
    }
    out
}

/// Photometric jitter: gamma, gain and bias, applied in `[0, 1]`.
pub fn jitter(image: &Array3<f32>, rng: &mut Rng) -> Array3<f32> {
    let gamma = 0.7 + rng.unit() * 0.6; // [0.7, 1.3]
    let gain = 0.85 + rng.unit() * 0.3; // [0.85, 1.15]
    let bias = (rng.unit() - 0.5) * 0.1; // [-0.05, 0.05]
    image.mapv(|v| (v.clamp(0.0, 1.0).powf(gamma) * gain + bias).clamp(0.0, 1.0))
}

/// Draw `k` random pixels into a sample table.
///
/// Uniform over pixels, with no class rebalancing: the curve should reflect the
/// class prior the annotator actually produced. Rebalancing here would make
/// sparse structures look easier than they are.
pub fn sample_pixels(
    features: &Array3<f32>,
    labels: &[i32],
    k: usize,
    rng: &mut Rng,
    out: &mut Samples,
) {
    let (d, h, w) = (features.shape()[0], features.shape()[1], features.shape()[2]);
    let n_px = h * w;
    if n_px == 0 || labels.len() < n_px {
        return;
    }
    let mut buf = vec![0.0f32; d];
    for _ in 0..k {
        let i = rng.below(n_px);
        let (y, x) = (i / w, i % w);
        for c in 0..d {
            buf[c] = features[[c, y, x]];
        }
        out.push(&buf, labels[i]);
    }
}

/// Decode raw frame bytes into `[C, H, W]` in `[0, 1]`, preserving whether the
/// source was single-channel.
fn decode_image(bytes: &[u8]) -> Result<Array3<f32>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("decode failed: {e}"))?;
    let is_gray = matches!(
        img.color(),
        image::ColorType::L8 | image::ColorType::L16 | image::ColorType::La8 | image::ColorType::La16
    );
    let (w, h) = (img.width() as usize, img.height() as usize);
    if is_gray {
        let g = img.to_luma8();
        let mut out = Array3::<f32>::zeros((1, h, w));
        for y in 0..h {
            for x in 0..w {
                out[[0, y, x]] = g.get_pixel(x as u32, y as u32)[0] as f32 / 255.0;
            }
        }
        Ok(out)
    } else {
        let c = img.to_rgb8();
        let mut out = Array3::<f32>::zeros((3, h, w));
        for y in 0..h {
            for x in 0..w {
                let p = c.get_pixel(x as u32, y as u32);
                for ch in 0..3 {
                    out[[ch, y, x]] = p[ch] as f32 / 255.0;
                }
            }
        }
        Ok(out)
    }
}

/// Working-resolution size preserving aspect ratio.
fn working_dims(w: usize, h: usize, longest: u32) -> (usize, usize) {
    let longest = longest.max(16) as usize;
    if w >= h {
        let nw = longest.min(w.max(1));
        let nh = ((h as f32 * nw as f32 / w.max(1) as f32).round() as usize).max(1);
        (nw, nh)
    } else {
        let nh = longest.min(h.max(1));
        let nw = ((w as f32 * nh as f32 / h.max(1) as f32).round() as usize).max(1);
        (nw, nh)
    }
}

/// Stack feature sources into one `[D, H, W]` volume.
fn stack(parts: Vec<Array3<f32>>, h: usize, w: usize) -> Array3<f32> {
    let d: usize = parts.iter().map(|p| p.shape()[0]).sum();
    let mut out = Array3::<f32>::zeros((d, h, w));
    let mut o = 0;
    for p in parts {
        for c in 0..p.shape()[0] {
            out.index_axis_mut(Axis(0), o)
                .assign(&p.index_axis(Axis(0), c));
            o += 1;
        }
    }
    out
}

/// Build the sample table for one annotated frame.
pub fn build_frame_samples(
    db: &DbState,
    frame_id: i64,
    order: &[i64],
    cfg: &DatasetConfig,
    encoder: Option<&mut EncoderSession>,
    rng: &mut Rng,
) -> Result<Samples, String> {
    let (_meta, bytes) = crate::commands::frame::read_frame_bytes(db, frame_id)
        .map_err(|e| format!("frame {frame_id}: {e}"))?;
    let image = decode_image(&bytes)?;
    let (src_w, src_h) = (image.shape()[2], image.shape()[1]);
    let (w, h) = working_dims(src_w, src_h, cfg.working_size);
    let image = resize_bilinear(&image, h, w);

    // Rasterise labels at native size, then downscale with nearest.
    let (native_w, native_h) = db
        .with_conn(|conn| queries::get_frame_dimensions(conn, frame_id))
        .map_err(|e| format!("frame {frame_id} dimensions: {e}"))?;
    let raw = db
        .with_conn(|conn| queries::load_annotations(conn, frame_id))
        .map_err(|e| format!("frame {frame_id} annotations: {e}"))?;
    let masks: Vec<(i64, Vec<u8>)> = raw
        .into_iter()
        .map(|a| {
            let full = decode_to_uint8(&a.mask_data, &a.encoding, native_w, native_h);
            let small = downscale_nearest(
                &full,
                native_w as usize,
                native_h as usize,
                w,
                h,
            );
            (a.label_id, small)
        })
        .collect();
    let labels = combine_masks(&masks, order, w * h);

    // Encoder features once per frame (see module note on reuse).
    let encoder_part = match encoder {
        Some(enc) => {
            let tokens = enc.embed(&image)?;
            Some(resize_bilinear(&tokens.data, h, w))
        }
        None => None,
    };

    let n_classes_present = labels.iter().filter(|&&c| c > 0).count();
    if n_classes_present == 0 {
        // Nothing annotated at working resolution — a tiny structure can vanish
        // under downscaling. Skip rather than train on an all-background frame.
        return Ok(Samples::new(0));
    }

    let fb = FilterBankConfig::default();
    let mut out: Option<Samples> = None;
    let binary: Vec<u8> = labels.iter().map(|&c| (c > 0) as u8).collect();

    for repeat in 0..cfg.repeats.max(1) {
        let view = if repeat == 0 {
            image.clone()
        } else {
            jitter(&image, rng)
        };
        let (local, _names) = filters::compute(&view, &fb);

        let s = scribble::simulate(
            &binary,
            w,
            h,
            cfg.scribble_strokes,
            cfg.stroke_len,
            rng,
        );
        let ch = scribble::channels(&s);
        let mut scr = Array3::<f32>::zeros((SCRIBBLE_CHANNELS, h, w));
        for (c, plane) in ch.iter().enumerate() {
            for y in 0..h {
                for x in 0..w {
                    scr[[c, y, x]] = plane[y * w + x];
                }
            }
        }

        let mut parts = vec![local];
        if let Some(e) = &encoder_part {
            parts.push(e.clone());
        }
        parts.push(scr);
        let feats = stack(parts, h, w);

        let acc = out.get_or_insert_with(|| Samples::new(feats.shape()[0]));
        sample_pixels(&feats, &labels, cfg.pixels_per_frame, rng, acc);
    }

    Ok(out.unwrap_or_else(|| Samples::new(0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combine_respects_label_order_on_overlap() {
        // Two labels overlapping on pixel 0; the earlier one in project order
        // must win, matching what the editor renders.
        let masks = vec![(7i64, vec![1u8, 0, 1]), (9i64, vec![1u8, 1, 0])];
        let order = vec![7i64, 9];
        let out = combine_masks(&masks, &order, 3);
        assert_eq!(out, vec![1, 2, 1]);

        // Reversing project order flips the winner.
        let out = combine_masks(&masks, &vec![9i64, 7], 3);
        assert_eq!(out, vec![1, 1, 2]);
    }

    #[test]
    fn combine_ignores_labels_without_masks() {
        let masks = vec![(1i64, vec![0u8, 1])];
        let out = combine_masks(&masks, &[1, 2, 3], 2);
        assert_eq!(out, vec![0, 1]);
    }

    #[test]
    fn downscale_uses_nearest_and_never_invents_classes() {
        // Ids 1 and 3 adjacent: averaging would produce a nonexistent 2.
        let src = vec![1u8, 1, 3, 3];
        let out = downscale_nearest(&src, 4, 1, 2, 1);
        assert!(out.iter().all(|&v| v == 1 || v == 3), "got {out:?}");
        assert_eq!(downscale_nearest(&[], 0, 0, 2, 2), vec![0, 0, 0, 0]);
    }

    #[test]
    fn working_dims_preserve_aspect_and_clamp() {
        assert_eq!(working_dims(1000, 500, 100), (100, 50));
        assert_eq!(working_dims(500, 1000, 100), (50, 100));
        // Never upscales past the source on the long side.
        assert_eq!(working_dims(50, 25, 100), (50, 25));
        let (w, h) = working_dims(1, 1, 100);
        assert!(w >= 1 && h >= 1);
    }

    #[test]
    fn jitter_changes_values_but_stays_in_range() {
        let img = Array3::from_elem((3, 4, 4), 0.5);
        let mut rng = Rng::new(11);
        let j = jitter(&img, &mut rng);
        assert!(j.iter().all(|&v| (0.0..=1.0).contains(&v)));
        assert!(
            j.iter().any(|&v| (v - 0.5).abs() > 1e-4),
            "jitter had no effect"
        );
    }

    #[test]
    fn sampling_produces_matching_features_and_labels() {
        let (d, h, w) = (3usize, 5usize, 4usize);
        // Channel 0 encodes the flat pixel index so we can verify alignment.
        let feats = Array3::from_shape_fn((d, h, w), |(c, y, x)| {
            if c == 0 { (y * w + x) as f32 } else { 0.0 }
        });
        let labels: Vec<i32> = (0..h * w).map(|i| (i % 3) as i32).collect();
        let mut out = Samples::new(d);
        let mut rng = Rng::new(3);
        sample_pixels(&feats, &labels, 25, &mut rng, &mut out);

        assert_eq!(out.n, 25);
        assert_eq!(out.x.len(), 25 * d);
        for k in 0..out.n {
            let idx = out.x[k * d] as usize;
            assert_eq!(
                out.y[k], labels[idx],
                "sample {k} pairs pixel {idx} with the wrong label"
            );
        }
    }

    #[test]
    fn sampling_rejects_short_label_buffers() {
        let feats = Array3::<f32>::zeros((2, 3, 3));
        let mut out = Samples::new(2);
        sample_pixels(&feats, &[0, 1], 5, &mut Rng::new(1), &mut out);
        assert_eq!(out.n, 0, "must not sample against a truncated label map");
    }
}
