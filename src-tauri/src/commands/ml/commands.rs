//! Tauri surface for the segmentation-head lab.
//!
//! Long-running work (feature extraction, the budget sweep, prediction) is
//! declared `#[tauri::command(async)]`. The bodies stay synchronous — which
//! keeps `State<DbState>` usable without fighting `Send` across awaits — but
//! the attribute is what moves them onto a worker thread.
//!
//! This matters more than it looks: a plain `#[tauri::command]` runs on the
//! **main thread**, so a multi-minute sweep freezes the window and starves the
//! very event loop that is meant to deliver progress. The bar would sit at zero
//! until the whole job finished, which is indistinguishable from a hang.
//!
//! Progress is streamed as `ml-progress` / `ml-train-progress` events rather
//! than returned, so a sweep over dozens of frames shows movement throughout.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::dl::model_manager::ensure_model_cached;
use crate::storage::DbState;

use super::dataset::{self, DatasetConfig};
use super::encoder::EncoderSession;
use super::predict::{self, MlState, PredictedFrame, ScribbleInput, TrainedModel};
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
    // The graph comes first and its path is what we report back, but every
    // sidecar has to arrive too: `ort` resolves external weights relative to
    // the graph, so a partial download opens a graph with no weights in it.
    let mut graph_path = None;
    for cfg in spec.all_model_configs() {
        let path = ensure_model_cached(&app, &cfg).await?;
        graph_path.get_or_insert(path);
    }
    let path = graph_path.ok_or_else(|| format!("encoder '{encoder_id}' declares no files"))?;
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
    pub patches_per_frame: Option<usize>,
    pub augment_repeats: Option<usize>,
    pub budgets: Option<Vec<usize>>,
    pub curve_repeats: Option<usize>,
    pub epochs: Option<usize>,
    pub hidden: Option<usize>,
    pub depth: Option<usize>,
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
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    stage: &'a str,
    done: usize,
    total: usize,
    /// Milliseconds spent on the most recent frame — feature extraction is the
    /// other slow phase, and its per-frame cost is what a user needs in order
    /// to judge whether the working size is sane.
    last_ms: f32,
    eta_ms: f32,
}

/// `avg_ms` drives the ETA rather than `last_ms`: per-frame cost varies several
/// -fold (a training frame runs every augmentation repeat, a validation frame
/// runs one), so extrapolating from the most recent frame makes the estimate
/// lurch by 3x between updates and reads as unreliable.
fn emit_avg(app: &AppHandle, stage: &str, done: usize, total: usize, last_ms: f32, avg_ms: f32) {
    let eta_ms = if done > 0 {
        avg_ms * total.saturating_sub(done) as f32
    } else {
        0.0
    };
    let _ = app.emit(
        "ml-progress",
        Progress {
            stage,
            done,
            total,
            last_ms,
            eta_ms,
        },
    );
}

/// Single-shot progress with no history to average over.
fn emit(app: &AppHandle, stage: &str, done: usize, total: usize, last_ms: f32) {
    emit_avg(app, stage, done, total, last_ms, last_ms);
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

/// Everything a fit needs, built once so the sweep and a single training run
/// cannot disagree about how features or splits were made.
struct Split {
    per_frame: Vec<Samples>,
    val: Samples,
    order: Vec<i64>,
    classes: usize,
    feature_dim: usize,
    val_frames: usize,
}

/// Open (or reuse) the encoder a run asks for, caching it in state.
fn ensure_encoder(
    app: &AppHandle,
    state: &MlState,
    encoder_id: &Option<String>,
) -> Result<(), String> {
    let Some(id) = encoder_id else { return Ok(()) };
    let mut slot = state.encoder.lock();
    if slot.as_ref().map(|(cached, _)| cached == id).unwrap_or(false) {
        return Ok(());
    }
    let spec = registry::find(id).ok_or_else(|| format!("unknown encoder '{id}'"))?;
    let path = registry::cache_path(app, &spec)?;
    if !path.exists() {
        return Err(format!(
            "encoder '{id}' is not downloaded yet — fetch it first"
        ));
    }
    *slot = Some((id.clone(), EncoderSession::load(&path, spec)?));
    Ok(())
}

fn build_split(
    app: &AppHandle,
    db: &DbState,
    state: &MlState,
    options: &CurveOptions,
) -> Result<Split, String> {
    let frames = dataset::annotated_frame_ids(db)?;
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
        patches_per_frame: options.patches_per_frame.unwrap_or(24),
        repeats: options.augment_repeats.unwrap_or(3).max(1),
        seed,
        ..Default::default()
    };

    ensure_encoder(app, state, &options.encoder_id)?;
    let mut guard = state.encoder.lock();
    let mut encoder = if options.encoder_id.is_some() {
        guard.as_mut().map(|(_, e)| e)
    } else {
        None
    };

    let total = shuffled.len();
    let mut done = 0usize;
    let mut spent_ms = 0.0f32;

    // Validation frames are augmentation-free, and carry **no scribbles**.
    //
    // The latter fixes a leak that inflated every number this lab has
    // reported: simulated strokes are drawn from a frame's own ground truth, so
    // conditioning a validation frame on them shows the model strokes derived
    // from the answer it is about to be scored against. The head can then score
    // well by following the strokes rather than by reading the image. Held-out
    // frames are now scored unconditioned, which is the honest question --
    // "what does this model do on an image it has never seen?"
    let val_cfg = DatasetConfig {
        repeats: 1,
        scribble_strokes: 0,
        scribble_dropout: 0.0,
        ..ds.clone()
    };
    let mut val = Samples::new(0);
    let mut feature_dim = 0usize;
    for &fid in val_ids {
        let t0 = std::time::Instant::now();
        let mut rng = Rng::new(seed ^ (fid as u64).wrapping_mul(0x9E37));
        let s = dataset::build_frame_samples(db, fid, &order, &val_cfg, encoder.as_deref_mut(), &mut rng)?;
        let ms = t0.elapsed().as_secs_f32() * 1000.0;
        if s.n > 0 {
            if val.n == 0 {
                val = Samples::new(s.d);
                feature_dim = s.d;
            }
            val.extend(&s);
        }
        done += 1;
        spent_ms += ms;
        println!("[ml] features val frame {fid} — {ms:.0} ms ({done}/{total})");
        emit_avg(app, "features", done, total, ms, spent_ms / done as f32);
    }

    let mut per_frame: Vec<Samples> = Vec::new();
    for &fid in train_ids {
        let t0 = std::time::Instant::now();
        let mut rng = Rng::new(seed ^ (fid as u64).wrapping_mul(0x1F123));
        let s = dataset::build_frame_samples(db, fid, &order, &ds, encoder.as_deref_mut(), &mut rng)?;
        let ms = t0.elapsed().as_secs_f32() * 1000.0;
        if s.n > 0 {
            feature_dim = s.d;
            per_frame.push(s);
        }
        done += 1;
        spent_ms += ms;
        println!("[ml] features train frame {fid} — {ms:.0} ms ({done}/{total})");
        emit_avg(app, "features", done, total, ms, spent_ms / done as f32);
    }

    if per_frame.is_empty() {
        return Err("no usable training frames (annotations may vanish at this working size)".into());
    }
    if val.is_empty() {
        return Err("no usable validation frames".into());
    }

    Ok(Split {
        per_frame,
        val,
        order,
        classes,
        feature_dim,
        val_frames: val_ids.len(),
    })
}

fn train_config(options: &CurveOptions) -> TrainConfig {
    TrainConfig {
        hidden: options.hidden.unwrap_or(128),
        depth: options.depth.unwrap_or(3),
        epochs: options.epochs.unwrap_or(40),
        seed: options.seed.unwrap_or(0),
        ..Default::default()
    }
}

/// Forward optimisation ticks to the UI.
fn emit_train(app: &AppHandle, p: train::TrainProgress) {
    let _ = app.emit(
        "ml-train-progress",
        TrainTick {
            budget: p.budget,
            repeat: p.repeat,
            epoch: p.epoch,
            epochs: p.epochs,
            loss: p.loss,
            point: p.point,
            points: p.points,
            epoch_ms: p.epoch_ms,
            elapsed_ms: p.elapsed_ms,
            eta_ms: p.eta_ms,
            // Two different devices are in play and conflating them misleads:
            // the encoder (ort) and the head (burn) choose independently, so
            // one can be on the GPU while the other has fallen back to CPU.
            device: format!(
                "head {} · encoder {}",
                p.device,
                super::encoder::detect_accelerator()
            ),
            samples: p.samples,
            features: p.features,
        },
    );
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrainTick {
    budget: usize,
    repeat: usize,
    epoch: usize,
    epochs: usize,
    loss: f32,
    point: usize,
    points: usize,
    epoch_ms: f32,
    elapsed_ms: f32,
    eta_ms: f32,
    device: String,
    samples: usize,
    features: usize,
}

/// Run the annotation-budget sweep and report held-out quality at each point.
///
/// The validation split is by **frame**, drawn once and shared by every budget,
/// so points differ only in how much training data they saw.
#[tauri::command(async)]
pub fn ml_run_learning_curve(
    app: AppHandle,
    db: State<DbState>,
    state: State<MlState>,
    options: CurveOptions,
) -> Result<CurveReport, String> {
    // Fired before any heavy work: if this never reaches the UI, the event
    // channel itself is at fault rather than anything being slow or blocked.
    emit(&app, "starting", 0, 1, 0.0);
    let split = build_split(&app, &db, &state, &options)?;
    let budgets = options
        .budgets
        .clone()
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| default_budgets(split.per_frame.len()));

    let points = train::learning_curve_with(
        &split.per_frame,
        &split.val,
        split.classes,
        &budgets,
        options.curve_repeats.unwrap_or(3),
        &train_config(&options),
        &mut |p| emit_train(&app, p),
    )?;

    Ok(CurveReport {
        points,
        train_frames: split.per_frame.len(),
        val_frames: split.val_frames,
        feature_dim: split.feature_dim,
        classes: split.classes,
        encoder: options.encoder_id.clone(),
        budgets,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainSummary {
    pub train_frames: usize,
    pub val_frames: usize,
    pub feature_dim: usize,
    pub classes: usize,
    pub encoder: Option<String>,
    pub metrics: train::EvalMetrics,
    /// Where the head was fitted. Reported because backend selection happens
    /// automatically: a user who expects the GPU and silently got the CPU
    /// should be able to see that rather than infer it from the run time.
    pub device: String,
}

/// Fit one head on every available training frame and keep it for per-frame
/// prediction. This is the model the user actually applies; the sweep only
/// characterises how quality scales.
#[tauri::command(async)]
pub fn ml_train_model(
    app: AppHandle,
    db: State<DbState>,
    state: State<MlState>,
    options: CurveOptions,
) -> Result<TrainSummary, String> {
    let split = build_split(&app, &db, &state, &options)?;
    let mut all = Samples::new(split.feature_dim);
    for s in &split.per_frame {
        all.extend(s);
    }

    let (head, metrics) = train::train_head_with(
        &all,
        &split.val,
        split.classes,
        &train_config(&options),
        &mut |p| emit_train(&app, p),
    )?;

    let summary = TrainSummary {
        train_frames: split.per_frame.len(),
        val_frames: split.val_frames,
        feature_dim: split.feature_dim,
        classes: split.classes,
        encoder: options.encoder_id.clone(),
        metrics: metrics.clone(),
        device: head.device().to_string(),
    };

    *state.model.lock() = Some(TrainedModel {
        head,
        feature_dim: split.feature_dim,
        classes: split.classes,
        label_order: split.order,
        encoder_id: options.encoder_id.clone(),
        working_size: options.working_size.unwrap_or(384),
        metrics,
        train_frames: split.per_frame.len(),
    });

    Ok(summary)
}

/// Whether a head is loaded, and what it was fitted with.
#[tauri::command]
pub fn ml_model_status(state: State<MlState>) -> Option<TrainSummary> {
    state.model.lock().as_ref().map(|m| TrainSummary {
        train_frames: m.train_frames,
        val_frames: 0,
        feature_dim: m.feature_dim,
        classes: m.classes,
        encoder: m.encoder_id.clone(),
        metrics: m.metrics.clone(),
        device: m.head.device().to_string(),
    })
}

/// Apply the loaded head to one frame, optionally conditioned on scribbles.
#[tauri::command(async)]
pub fn ml_predict_frame(
    app: AppHandle,
    db: State<DbState>,
    state: State<MlState>,
    frame_id: i64,
    scribbles: Option<ScribbleInput>,
) -> Result<PredictedFrame, String> {
    let guard = state.model.lock();
    let model = guard
        .as_ref()
        .ok_or_else(|| "no trained head yet — train one first".to_string())?;

    ensure_encoder(&app, &state, &model.encoder_id)?;
    let mut enc_guard = state.encoder.lock();
    let encoder = if model.encoder_id.is_some() {
        enc_guard.as_mut().map(|(_, e)| e)
    } else {
        None
    };

    let mut features = state.features.lock();
    predict::predict_frame(
        &db,
        model,
        frame_id,
        encoder,
        &mut features,
        scribbles.as_ref(),
        &|stage, done, total| emit(&app, stage, done, total, 0.0),
    )
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
