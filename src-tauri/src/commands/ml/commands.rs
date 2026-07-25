//! Tauri surface for the segmentation-head lab.
//!
//! Long-running work (feature extraction, the budget sweep) lives in
//! *synchronous* commands: Tauri runs those off the main thread, which matches
//! how the existing heavy commands (`superpixel_refine`, `crf_refine`) behave
//! and keeps `State<DbState>` usable without fighting `Send` across awaits.
//! Only the download is `async`, because the HTTP client is.
//!
//! Progress is streamed as `ml-progress` events rather than returned, so a
//! sweep over dozens of frames shows movement instead of appearing hung.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::dl::model_manager::ensure_model_cached;
use crate::storage::DbState;

use super::dataset::{self, DatasetConfig};
use super::encoder::EncoderSession;
use super::registry;
use super::scribble::Rng;
use super::train::{self, CurvePoint, Samples, TrainConfig};

/// A catalog entry plus whether its weights are already on disk.
#[derive(Debug, Clone, Serialize)]
pub struct EncoderStatus {
    #[serde(flatten)]
    pub spec: registry::EncoderSpec,
    pub cached: bool,
}

#[tauri::command]
pub fn ml_list_encoders(app: AppHandle) -> Vec<EncoderStatus> {
    registry::catalog()
        .into_iter()
        .map(|spec| {
            let cached = registry::is_cached(&app, &spec);
            EncoderStatus { spec, cached }
        })
        .collect()
}

/// Fetch an encoder's weights. Progress arrives on the existing
/// `download-progress` event emitted by the shared model downloader.
#[tauri::command]
pub async fn ml_download_encoder(app: AppHandle, encoder_id: String) -> Result<String, String> {
    let spec = registry::find(&encoder_id)
        .ok_or_else(|| format!("unknown encoder '{encoder_id}'"))?;
    let path = ensure_model_cached(&app, &spec.to_model_config()).await?;
    Ok(path.to_string_lossy().to_string())
}

/// What the project currently offers the trainer.
#[derive(Debug, Clone, Serialize)]
pub struct DatasetSummary {
    pub annotated_frames: usize,
    pub labels: usize,
    /// Classes the head predicts: every label plus background.
    pub classes: usize,
}

#[tauri::command]
pub fn ml_dataset_summary(db: State<DbState>) -> Result<DatasetSummary, String> {
    let frames = dataset::annotated_frame_ids(&db)?;
    let labels = dataset::label_order(&db)?;
    Ok(DatasetSummary {
        annotated_frames: frames.len(),
        labels: labels.len(),
        classes: labels.len() + 1,
    })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurveOptions {
    /// Omit to train on the local feature basis alone — the ablation that says
    /// whether the encoder is earning its download.
    pub encoder_id: Option<String>,
    pub working_size: Option<u32>,
    pub pixels_per_frame: Option<usize>,
    pub augment_repeats: Option<usize>,
    pub budgets: Option<Vec<usize>>,
    pub curve_repeats: Option<usize>,
    pub epochs: Option<usize>,
    pub hidden: Option<usize>,
    pub val_fraction: Option<f32>,
    pub seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurveReport {
    pub points: Vec<CurvePoint>,
    pub train_frames: usize,
    pub val_frames: usize,
    pub feature_dim: usize,
    pub classes: usize,
    pub encoder: Option<String>,
    pub budgets: Vec<usize>,
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    stage: &'a str,
    done: usize,
    total: usize,
}

fn emit(app: &AppHandle, stage: &str, done: usize, total: usize) {
    let _ = app.emit("ml-progress", Progress { stage, done, total });
}

/// Default budget ladder: powers of two up to the pool size, always including
/// the full pool so the curve has an endpoint.
fn default_budgets(pool: usize) -> Vec<usize> {
    let mut b = Vec::new();
    let mut n = 1;
    while n < pool {
        b.push(n);
        n *= 2;
    }
    b.push(pool);
    b
}

/// Run the annotation-budget sweep and report held-out quality at each point.
///
/// The validation split is by **frame**, drawn once and shared by every budget,
/// so points differ only in how much training data they saw.
#[tauri::command]
pub fn ml_run_learning_curve(
    app: AppHandle,
    db: State<DbState>,
    options: CurveOptions,
) -> Result<CurveReport, String> {
    let frames = dataset::annotated_frame_ids(&db)?;
    let order = dataset::label_order(&db)?;
    if order.is_empty() {
        return Err("this project defines no segmentation labels".into());
    }
    if frames.len() < 2 {
        return Err(format!(
            "need at least 2 annotated frames to hold one out; found {}",
            frames.len()
        ));
    }
    let classes = order.len() + 1;
    let seed = options.seed.unwrap_or(0);

    // Deterministic frame-level split.
    let mut shuffled = frames.clone();
    let mut split_rng = Rng::new(seed ^ 0x5F1D_2E3C_4B5A_6978);
    for i in 0..shuffled.len() {
        let j = i + split_rng.below(shuffled.len() - i);
        shuffled.swap(i, j);
    }
    let val_fraction = options.val_fraction.unwrap_or(0.3).clamp(0.1, 0.5);
    let n_val = ((shuffled.len() as f32 * val_fraction).round() as usize).clamp(1, shuffled.len() - 1);
    let (val_ids, train_ids) = shuffled.split_at(n_val);

    let ds = DatasetConfig {
        working_size: options.working_size.unwrap_or(384),
        pixels_per_frame: options.pixels_per_frame.unwrap_or(4000),
        repeats: options.augment_repeats.unwrap_or(3).max(1),
        seed,
        ..Default::default()
    };

    // Load the encoder once, if requested.
    let mut encoder = match &options.encoder_id {
        Some(id) => {
            let spec = registry::find(id).ok_or_else(|| format!("unknown encoder '{id}'"))?;
            let path = registry::cache_path(&app, &spec)?;
            if !path.exists() {
                return Err(format!(
                    "encoder '{id}' is not downloaded yet — fetch it first"
                ));
            }
            Some(EncoderSession::load(&path, spec)?)
        }
        None => None,
    };

    let total = shuffled.len();
    let mut done = 0usize;

    // Validation frames are augmentation-free: held-out scores should measure
    // the model, not how lucky a jittered copy was.
    let val_cfg = DatasetConfig {
        repeats: 1,
        ..ds.clone()
    };
    let mut val = Samples::new(0);
    let mut feature_dim = 0usize;
    for &fid in val_ids {
        let mut rng = Rng::new(seed ^ (fid as u64).wrapping_mul(0x9E37));
        let s = dataset::build_frame_samples(&db, fid, &order, &val_cfg, encoder.as_mut(), &mut rng)?;
        if s.n > 0 {
            if val.n == 0 {
                val = Samples::new(s.d);
                feature_dim = s.d;
            }
            val.extend(&s);
        }
        done += 1;
        emit(&app, "features", done, total);
    }

    let mut per_frame: Vec<Samples> = Vec::new();
    for &fid in train_ids {
        let mut rng = Rng::new(seed ^ (fid as u64).wrapping_mul(0x1F123));
        let s = dataset::build_frame_samples(&db, fid, &order, &ds, encoder.as_mut(), &mut rng)?;
        if s.n > 0 {
            feature_dim = s.d;
            per_frame.push(s);
        }
        done += 1;
        emit(&app, "features", done, total);
    }

    if per_frame.is_empty() {
        return Err("no usable training frames (annotations may vanish at this working size)".into());
    }
    if val.is_empty() {
        return Err("no usable validation frames".into());
    }

    let budgets = options
        .budgets
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| default_budgets(per_frame.len()));
    let tcfg = TrainConfig {
        hidden: options.hidden.unwrap_or(64),
        epochs: options.epochs.unwrap_or(40),
        seed,
        ..Default::default()
    };

    emit(&app, "training", 0, budgets.len());
    let points = train::learning_curve(
        &per_frame,
        &val,
        classes,
        &budgets,
        options.curve_repeats.unwrap_or(3),
        &tcfg,
    )?;
    emit(&app, "training", budgets.len(), budgets.len());

    Ok(CurveReport {
        points,
        train_frames: per_frame.len(),
        val_frames: val_ids.len(),
        feature_dim,
        classes,
        encoder: options.encoder_id,
        budgets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_ladder_doubles_and_ends_at_the_pool() {
        assert_eq!(default_budgets(1), vec![1]);
        assert_eq!(default_budgets(5), vec![1, 2, 4, 5]);
        assert_eq!(default_budgets(8), vec![1, 2, 4, 8]);
        // Never proposes a budget larger than the pool.
        for pool in 1..40 {
            assert!(default_budgets(pool).iter().all(|&b| b <= pool));
            assert_eq!(*default_budgets(pool).last().unwrap(), pool);
        }
    }
}
