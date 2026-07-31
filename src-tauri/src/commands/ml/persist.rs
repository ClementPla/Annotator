//! Save and restore a fitted head inside the project file.
//!
//! # Why the `.dida` and not app data
//!
//! A head's output channels mean nothing on their own — class `i + 1` is
//! `label_order[i]`, a list of ids that only exist in one project. Storing the
//! weights next to the labels that give them meaning keeps the two from drifting
//! apart, and means a project that is copied or shared arrives with the model
//! trained on it. The feature cache made the opposite call for the opposite
//! reason: it is bulk derived image data, disposable, and carries information
//! about images the project deliberately never embedded. A few hundred KB of
//! weights fitted to the user's own annotations is a different thing.
//!
//! # Portability across backends
//!
//! Weights are recorded at full precision and reloaded onto whichever backend
//! this machine selects *now*. A head fitted on CUDA therefore still opens on a
//! machine with no GPU, which matters because the same project travels between
//! them.

use burn::module::Module;
use burn::record::{BinBytesRecorder, FullPrecisionSettings, Recorder};
use serde::{Deserialize, Serialize};

use super::backend::{CpuInfer, Selection};
#[cfg(feature = "gpu")]
use super::backend::GpuInfer;
use super::train::{EvalMetrics, Head, SegHead};

/// Everything needed to rebuild a head, minus the weights themselves.
///
/// Stored as JSON beside the weight blob rather than as columns: it is read and
/// written whole, and a shape that can grow without a migration is worth more
/// here than queryability.
///
/// Deliberately **not** `rename_all = "camelCase"`, unlike the types that cross
/// the Tauri boundary: these names are the keys in `ml_models.meta` inside every
/// `.dida`, so renaming them orphans every model already trained. This type does
/// not reach the frontend — `TrainSummary` does — so there is nothing to unify.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMeta {
    pub feature_dim: usize,
    pub classes: usize,
    pub label_order: Vec<i64>,
    pub encoder_id: Option<String>,
    pub working_size: u32,
    /// Head geometry — needed to allocate the module before loading weights
    /// into it, since the record carries tensors but not the architecture.
    pub hidden: usize,
    pub depth: usize,
    pub accuracy: f32,
    pub mean_dice: f32,
    #[serde(default)]
    pub per_class_dice: Vec<f32>,
    pub train_frames: usize,
    /// Where it was fitted. Informational — it reloads wherever it lands.
    #[serde(default)]
    pub trained_on: String,
}

impl ModelMeta {
    pub fn metrics(&self) -> EvalMetrics {
        EvalMetrics {
            accuracy: self.accuracy,
            mean_dice: self.mean_dice,
            per_class_dice: self.per_class_dice.clone(),
        }
    }
}

fn recorder() -> BinBytesRecorder<FullPrecisionSettings> {
    BinBytesRecorder::<FullPrecisionSettings>::default()
}

/// Serialise a head's weights.
pub fn encode_head(head: &Head) -> Result<Vec<u8>, String> {
    let r = recorder();
    match head {
        Head::Cpu(m) => r.record(m.clone().into_record(), ()),
        #[cfg(feature = "gpu")]
        Head::Cuda(m) => r.record(m.clone().into_record(), ()),
    }
    .map_err(|e| format!("cannot serialise the head: {e}"))
}

/// Rebuild a head from weights, on whichever backend this machine selects now.
///
/// The recorder happily loads a record whose tensors are the wrong shape for the
/// module it is loading into — the stored weights simply win. That would give a
/// head whose real geometry disagrees with the `feature_dim` the predictor
/// validates incoming features against, so the parameter count is compared
/// before and after loading and a disagreement is refused.
pub fn decode_head(bytes: Vec<u8>, meta: &ModelMeta) -> Result<Head, String> {
    let r = recorder();
    match Selection::detect() {
        #[cfg(feature = "gpu")]
        Selection::Cuda => {
            let device = Default::default();
            let fresh = SegHead::<GpuInfer>::with_depth(
                meta.feature_dim,
                meta.hidden,
                meta.depth,
                meta.classes,
                &device,
            );
            let expected = fresh.num_params();
            let rec = r.load(bytes, &device).map_err(load_err)?;
            let loaded = fresh.load_record(rec);
            check_params(expected, loaded.num_params())?;
            Ok(Head::Cuda(loaded))
        }
        Selection::Cpu => {
            let device = Default::default();
            let fresh = SegHead::<CpuInfer>::with_depth(
                meta.feature_dim,
                meta.hidden,
                meta.depth,
                meta.classes,
                &device,
            );
            let expected = fresh.num_params();
            let rec = r.load(bytes, &device).map_err(load_err)?;
            let loaded = fresh.load_record(rec);
            check_params(expected, loaded.num_params())?;
            Ok(Head::Cpu(loaded))
        }
    }
}

fn load_err(e: impl std::fmt::Display) -> String {
    format!("saved model does not match this build: {e}")
}

fn check_params(expected: usize, got: usize) -> Result<(), String> {
    if expected == got {
        return Ok(());
    }
    Err(format!(
        "saved model does not match its description \
         ({got} parameters where {expected} were expected); retrain to replace it"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(feature_dim: usize, classes: usize) -> ModelMeta {
        ModelMeta {
            feature_dim,
            classes,
            label_order: (1..=classes as i64).collect(),
            encoder_id: Some("dinov3-vits16".into()),
            working_size: 384,
            hidden: 8,
            depth: 2,
            accuracy: 0.9,
            mean_dice: 0.8,
            per_class_dice: vec![0.9, 0.7],
            train_frames: 12,
            trained_on: "CPU (burn ndarray)".into(),
        }
    }

    /// The point of persistence: the reloaded head must predict what the saved
    /// one predicted, not merely load without error.
    #[test]
    fn a_saved_head_predicts_identically_after_reload() {
        let m = meta(6, 3);
        let device = Default::default();
        let head = Head::Cpu(SegHead::<CpuInfer>::with_depth(
            m.feature_dim,
            m.hidden,
            m.depth,
            m.classes,
            &device,
        ));

        let (h, w) = (8usize, 8usize);
        let x: Vec<f32> = (0..m.feature_dim * h * w)
            .map(|i| ((i % 17) as f32 / 17.0) - 0.5)
            .collect();

        let before = super::super::train::predict_map(&head, &x, m.feature_dim, h, w, m.classes);
        let bytes = encode_head(&head).expect("a head must serialise");
        let restored = decode_head(bytes, &m).expect("a head must deserialise");
        let after =
            super::super::train::predict_map(&restored, &x, m.feature_dim, h, w, m.classes);

        assert_eq!(before, after, "a reloaded head must predict identically");
    }

    #[test]
    fn metadata_round_trips_through_json() {
        let m = meta(475, 4);
        let text = serde_json::to_string(&m).unwrap();
        let back: ModelMeta = serde_json::from_str(&text).unwrap();
        assert_eq!(back.label_order, m.label_order);
        assert_eq!(back.feature_dim, m.feature_dim);
        assert_eq!(back.hidden, m.hidden);
        assert_eq!(back.depth, m.depth);
    }

    #[test]
    fn weights_from_a_different_shape_are_refused() {
        let m = meta(6, 3);
        let device = Default::default();
        let head = Head::Cpu(SegHead::<CpuInfer>::with_depth(6, 8, 2, 3, &device));
        let bytes = encode_head(&head).unwrap();

        // Same blob, metadata claiming a wider feature stack: loading must fail
        // rather than produce a head that silently predicts nonsense.
        let mut wrong = m.clone();
        wrong.feature_dim = 32;
        assert!(
            decode_head(bytes, &wrong).is_err(),
            "a shape mismatch must be an error, not a bad model"
        );
    }
}
