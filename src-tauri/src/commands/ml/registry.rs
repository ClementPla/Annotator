//! Catalog of pretrained encoders that can back the trainable segmentation
//! head, plus their download / cache management.
//!
//! Didascalie is modality-agnostic, so the catalog deliberately favours
//! *general* backbones over organ- or modality-specific ones: the same project
//! may hold CT slices, ultrasound, pathology tiles or colour photographs, and a
//! backbone tuned to one of those is a liability on the rest. Specialisation is
//! the head's job, not the encoder's.
//!
//! Selection criteria (see `docs/literature-review-fewshot-scribble.md`):
//!
//! * **Must ship ONNX.** The app runs encoders through `ort`; a PyTorch-only
//!   checkpoint would need a one-time Python export, which breaks the
//!   self-contained story. Every built-in entry below was verified to expose a
//!   `.onnx` file on the Hub.
//! * **Frozen.** The encoder is never fine-tuned here — only the head trains —
//!   so no gradient ever crosses back into these weights.
//! * **Dense features.** We need patch tokens, not a pooled class vector.
//!
//! Many domain-specific foundation models (retinal, pathology, chest) are
//! *gated* on the Hub and publish safetensors only, so they can be neither
//! click-downloaded nor loaded by `ort`. Rather than special-casing them, the
//! registry accepts a user-supplied local `.onnx` path: export once, point the
//! app at the file, and it participates like any built-in entry.

use serde::{Deserialize, Serialize};

use crate::dl::model_manager::ModelConfig;

/// How pixel values must be scaled before entering a given graph. Getting this
/// wrong does not error — it silently degrades the features — so it is recorded
/// per encoder rather than assumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Normalization {
    /// Plain `[0, 1]`, as the bundled SAM-style encoder expects.
    Unit,
    /// `[0, 1]` then ImageNet mean/std — what the `transformers` image
    /// processors apply for DINOv2 and most Hub ViTs.
    ImageNet,
}

impl Normalization {
    /// Per-channel `(mean, std)` to apply after scaling into `[0, 1]`.
    pub fn mean_std(self) -> ([f32; 3], [f32; 3]) {
        match self {
            Normalization::Unit => ([0.0; 3], [1.0; 3]),
            Normalization::ImageNet => ([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        }
    }
}

/// A pretrained encoder the user can download and use as a frozen backbone.
///
/// The numeric fields are *hints* used for display and for sizing buffers
/// before the graph is opened. The real input/output shapes are read from the
/// ONNX graph itself at load time (see `encoder.rs`), so a wrong hint here
/// degrades a label in the UI rather than corrupting inference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncoderSpec {
    /// Stable identifier used by the frontend and persisted in run metadata.
    pub id: String,
    pub name: String,
    pub description: String,
    /// Hugging Face repo, e.g. `onnx-community/dinov2-small-ONNX`.
    pub repo_id: String,
    /// Path of the ONNX file *within* the repo (may contain `/`).
    pub filename: String,
    /// Sub-directory under the app cache where the file is stored.
    pub cache_subdir: String,
    /// ViT patch stride: the token grid is `input_size / patch` per side.
    /// This is the resolution ceiling that motivates mixing in the
    /// full-resolution classical filter bank.
    pub patch: u32,
    /// Channel count of the patch-token embedding (hint; verified at load).
    pub embed_dim: usize,
    /// Square input the graph expects (hint; verified at load).
    pub input_size: u32,
    /// Approximate download size, for the UI.
    pub approx_mb: u32,
    /// Short provenance tag shown in the picker ("general", "medical", …).
    pub domain: String,
    /// Pixel scaling this graph was trained with.
    pub normalize: Normalization,
}

impl EncoderSpec {
    fn new(
        id: &str,
        name: &str,
        description: &str,
        repo_id: &str,
        filename: &str,
        cache_subdir: &str,
        patch: u32,
        embed_dim: usize,
        input_size: u32,
        approx_mb: u32,
        domain: &str,
        normalize: Normalization,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: description.into(),
            repo_id: repo_id.into(),
            filename: filename.into(),
            cache_subdir: cache_subdir.into(),
            patch,
            embed_dim,
            input_size,
            approx_mb,
            domain: domain.into(),
            normalize,
        }
    }

    /// The download descriptor understood by `dl::model_manager`.
    pub fn to_model_config(&self) -> ModelConfig {
        ModelConfig {
            repo_id: self.repo_id.clone(),
            filename: self.filename.clone(),
            cache_subdir: self.cache_subdir.clone(),
            // Sizes/hashes are not pinned: these are third-party mirrors that
            // may be re-exported upstream. The download is still verified for
            // completeness against Content-Length.
            expected_size: None,
            expected_sha256: None,
        }
    }
}

/// The built-in encoder catalog, best default first.
pub fn catalog() -> Vec<EncoderSpec> {
    vec![
        EncoderSpec::new(
            "dinov2-small",
            "DINOv2 ViT-S/14",
            "Self-supervised general-purpose features that transfer broadly \
             across modalities. The fastest option and a good default. Patch \
             stride 14 caps its spatial detail, so sub-patch structure is \
             carried by the local feature basis instead.",
            "onnx-community/dinov2-small-ONNX",
            "onnx/model.onnx",
            "dinov2-small",
            14,
            384,
            224,
            88,
            "general",
            Normalization::ImageNet,
        ),
        EncoderSpec::new(
            "dinov2-base",
            "DINOv2 ViT-B/14",
            "Larger DINOv2. Richer semantics than ViT-S at roughly 4x the \
             compute; worth testing once the small model's curve is known.",
            "onnx-community/dinov2-base-ONNX",
            "onnx/model.onnx",
            "dinov2-base",
            14,
            768,
            224,
            330,
            "general",
            Normalization::ImageNet,
        ),
        EncoderSpec::new(
            "doodlemask-sam",
            "DoodleMask SAM encoder",
            "The SAM-style encoder this app already ships for doodle-to-mask. \
             Medical-tuned and produces a denser 64x64 grid, but is the \
             heaviest of the three.",
            "ClementP/DoodleMaskSAM",
            "encoder.onnx",
            "maskedMedSAM",
            16,
            256,
            1024,
            368,
            "medical",
            Normalization::Unit,
        ),
    ]
}

/// Look up a spec by its stable id.
pub fn find(id: &str) -> Option<EncoderSpec> {
    catalog().into_iter().find(|s| s.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique_and_findable() {
        let all = catalog();
        assert!(!all.is_empty());
        let mut ids: Vec<_> = all.iter().map(|s| s.id.clone()).collect();
        ids.sort();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "duplicate encoder ids in catalog");

        for spec in &all {
            assert!(find(&spec.id).is_some());
            assert!(spec.patch > 0, "{} has zero patch stride", spec.id);
            assert!(spec.embed_dim > 0, "{} has zero embed dim", spec.id);
            assert!(
                spec.input_size % spec.patch == 0,
                "{}: input {} is not a multiple of patch {}",
                spec.id,
                spec.input_size,
                spec.patch
            );
        }
        assert!(find("nope").is_none());
    }

    #[test]
    fn model_config_round_trips_repo_and_file() {
        let spec = find("dinov2-small").unwrap();
        let cfg = spec.to_model_config();
        assert_eq!(cfg.repo_id, "onnx-community/dinov2-small-ONNX");
        // Nested path within the repo — the downloader must create parent dirs.
        assert!(cfg.filename.contains('/'));
    }
}
