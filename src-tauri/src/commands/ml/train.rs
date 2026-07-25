//! The trainable head, its optimisation loop, and the learning-curve sweep.
//!
//! # Shape of the model
//!
//! The head is an MLP applied per pixel: a feature vector (encoder channels ⊕
//! local basis ⊕ scribble distances) maps to one logit per class. Applied
//! densely this is identical to a stack of 1x1 convolutions, but phrasing it as
//! an MLP over sampled pixels keeps training cheap — a dense `[D, H, W]` volume
//! is hundreds of megabytes, while a sample of pixels from the same image is a
//! small matrix. All spatial context arrives through the multi-scale features,
//! not through the head's receptive field.
//!
//! # Why sampled pixels, and why that is honest
//!
//! Sampling changes the class balance seen during optimisation, so the loop
//! samples pixels per frame without rebalancing classes, and every reported
//! metric is computed on held-out *frames* rather than held-out pixels. Pixels
//! from one image are strongly correlated; scoring on held-out pixels of a
//! trained-on image would inflate the curve badly.

use burn::backend::{Autodiff, NdArray};
use burn::module::{AutodiffModule, Module};
use burn::nn::loss::CrossEntropyLossConfig;
use burn::nn::{Linear, LinearConfig, Relu};
use burn::optim::{AdamConfig, GradientsParams, Optimizer};
use burn::tensor::backend::Backend;
use burn::tensor::{Int, Tensor, TensorData};

use super::scribble::Rng;

pub type TrainBackend = Autodiff<NdArray>;
pub type InferBackend = NdArray;

/// A flat table of per-pixel samples: `x` is row-major `[n, d]`.
#[derive(Debug, Clone, Default)]
pub struct Samples {
    pub x: Vec<f32>,
    pub y: Vec<i32>,
    pub n: usize,
    pub d: usize,
}

impl Samples {
    pub fn new(d: usize) -> Self {
        Self {
            x: Vec::new(),
            y: Vec::new(),
            n: 0,
            d,
        }
    }

    pub fn push(&mut self, features: &[f32], label: i32) {
        debug_assert_eq!(features.len(), self.d);
        self.x.extend_from_slice(features);
        self.y.push(label);
        self.n += 1;
    }

    pub fn extend(&mut self, other: &Samples) {
        debug_assert_eq!(self.d, other.d);
        self.x.extend_from_slice(&other.x);
        self.y.extend_from_slice(&other.y);
        self.n += other.n;
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }
}

#[derive(Debug, Clone)]
pub struct TrainConfig {
    pub hidden: usize,
    pub epochs: usize,
    pub lr: f64,
    pub batch: usize,
    pub seed: u64,
}

impl Default for TrainConfig {
    fn default() -> Self {
        Self {
            hidden: 64,
            epochs: 40,
            lr: 1e-3,
            batch: 512,
            seed: 0,
        }
    }
}

/// Per-pixel MLP head.
#[derive(Module, Debug)]
pub struct SegHead<B: Backend> {
    l1: Linear<B>,
    l2: Linear<B>,
    out: Linear<B>,
    act: Relu,
}

impl<B: Backend> SegHead<B> {
    pub fn new(d_in: usize, hidden: usize, n_classes: usize, device: &B::Device) -> Self {
        Self {
            l1: LinearConfig::new(d_in, hidden).init(device),
            l2: LinearConfig::new(hidden, hidden).init(device),
            out: LinearConfig::new(hidden, n_classes).init(device),
            act: Relu::new(),
        }
    }

    /// `[n, d] -> [n, n_classes]` logits.
    pub fn forward(&self, x: Tensor<B, 2>) -> Tensor<B, 2> {
        let h = self.act.forward(self.l1.forward(x));
        let h = self.act.forward(self.l2.forward(h));
        self.out.forward(h)
    }
}

/// Held-out quality for one trained head.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalMetrics {
    pub accuracy: f32,
    /// Mean Dice over classes actually present in the reference.
    pub mean_dice: f32,
    pub per_class_dice: Vec<f32>,
}

fn to_x<B: Backend>(s: &Samples, device: &B::Device) -> Tensor<B, 2> {
    Tensor::<B, 2>::from_data(TensorData::new(s.x.clone(), [s.n, s.d]), device)
}

fn to_y<B: Backend>(s: &Samples, device: &B::Device) -> Tensor<B, 1, Int> {
    Tensor::<B, 1, Int>::from_data(TensorData::new(s.y.clone(), [s.n]), device)
}

/// Argmax predictions for a sample table.
fn predict<B: Backend>(model: &SegHead<B>, s: &Samples, device: &B::Device) -> Vec<i32> {
    if s.is_empty() {
        return Vec::new();
    }
    let logits = model.forward(to_x::<B>(s, device));
    let idx = logits.argmax(1).into_data();
    idx.iter::<i64>().map(|v| v as i32).collect()
}

/// Argmax class per row for a raw `[n, d]` feature matrix.
///
/// The dense-inference entry point: callers chunk large frames through this
/// rather than materialising one enormous tensor.
pub fn predict_rows(model: &SegHead<InferBackend>, x: &[f32], n: usize, d: usize) -> Vec<i32> {
    if n == 0 || d == 0 {
        return Vec::new();
    }
    let device = Default::default();
    let t = Tensor::<InferBackend, 2>::from_data(TensorData::new(x.to_vec(), [n, d]), &device);
    let idx = model.forward(t).argmax(1).into_data();
    idx.iter::<i64>().map(|v| v as i32).collect()
}

/// Accuracy plus per-class Dice against a reference labelling.
pub fn evaluate(pred: &[i32], truth: &[i32], n_classes: usize) -> EvalMetrics {
    if pred.is_empty() || pred.len() != truth.len() {
        return EvalMetrics::default();
    }
    let correct = pred.iter().zip(truth).filter(|(a, b)| a == b).count();
    let mut per_class = vec![0.0f32; n_classes];
    let mut present = 0usize;
    let mut sum = 0.0f32;
    for c in 0..n_classes as i32 {
        let inter = pred
            .iter()
            .zip(truth)
            .filter(|&(&p, &t)| p == c && t == c)
            .count() as f32;
        let np = pred.iter().filter(|&&p| p == c).count() as f32;
        let nt = truth.iter().filter(|&&t| t == c).count() as f32;
        // A class absent from the reference is not scored: including a
        // free 1.0 for correctly predicting nothing would flatter the curve.
        if nt == 0.0 {
            continue;
        }
        let dice = if np + nt > 0.0 {
            2.0 * inter / (np + nt)
        } else {
            0.0
        };
        per_class[c as usize] = dice;
        sum += dice;
        present += 1;
    }
    EvalMetrics {
        accuracy: correct as f32 / pred.len() as f32,
        mean_dice: if present > 0 {
            sum / present as f32
        } else {
            0.0
        },
        per_class_dice: per_class,
    }
}

/// A tick from inside the optimisation loop.
///
/// Training dominates a sweep's wall-clock, so it reports per epoch rather than
/// per fit — a silent progress bar during the slowest phase reads as a hang.
/// `loss` is included because a falling loss is the signal that tells a user
/// the run is healthy, not merely alive.
#[derive(Debug, Clone, Copy)]
pub struct TrainProgress {
    pub budget: usize,
    pub repeat: usize,
    pub epoch: usize,
    pub epochs: usize,
    pub loss: f32,
    /// Position within a sweep; both zero for a single fit.
    pub point: usize,
    pub points: usize,
    /// Wall-clock for the epoch just finished.
    pub epoch_ms: f32,
    /// Wall-clock since this fit started.
    pub elapsed_ms: f32,
    /// Projected time left across the *whole* job, not just this fit.
    pub eta_ms: f32,
    /// Where the optimisation is actually running. Worth surfacing: this
    /// backend is CPU-only, so a user expecting GPU acceleration should be
    /// told rather than left to infer it from the speed.
    pub device: &'static str,
    pub samples: usize,
    pub features: usize,
}

/// The compute device the head trains on.
///
/// burn's ndarray backend is CPU. The head is small and trains on cached
/// features, so this is a deliberate trade — but it must not be a silent one.
pub const DEVICE_LABEL: &str = "CPU (burn ndarray)";

/// Fit a head on `train` and score it on `val`.
pub fn train_head(
    train: &Samples,
    val: &Samples,
    n_classes: usize,
    cfg: &TrainConfig,
) -> Result<(SegHead<InferBackend>, EvalMetrics), String> {
    train_head_with(train, val, n_classes, cfg, &mut |_| {})
}

/// As [`train_head`], reporting each epoch to `on`.
pub fn train_head_with(
    train: &Samples,
    val: &Samples,
    n_classes: usize,
    cfg: &TrainConfig,
    on: &mut dyn FnMut(TrainProgress),
) -> Result<(SegHead<InferBackend>, EvalMetrics), String> {
    if train.is_empty() {
        return Err("no training samples".into());
    }
    if n_classes < 2 {
        return Err("need at least two classes".into());
    }
    let device = Default::default();
    let mut model = SegHead::<TrainBackend>::new(train.d, cfg.hidden, n_classes, &device);
    let mut optim = AdamConfig::new().init();
    let loss_fn = CrossEntropyLossConfig::new().init(&device);
    let mut rng = Rng::new(cfg.seed);

    let batch = cfg.batch.min(train.n).max(1);
    let batches_per_epoch = (train.n + batch - 1) / batch;

    println!(
        "[ml] fit start — device={} samples={} features={} classes={} epochs={} batch={}",
        DEVICE_LABEL, train.n, train.d, n_classes, cfg.epochs, batch
    );
    let fit_start = std::time::Instant::now();

    for epoch in 0..cfg.epochs {
        let epoch_start = std::time::Instant::now();
        let mut epoch_loss = 0.0f32;
        for _ in 0..batches_per_epoch {
            // Sample a minibatch with replacement — cheap, and avoids
            // materialising a shuffled index per epoch.
            let mut bx = Vec::with_capacity(batch * train.d);
            let mut by = Vec::with_capacity(batch);
            for _ in 0..batch {
                let i = rng.below(train.n);
                bx.extend_from_slice(&train.x[i * train.d..(i + 1) * train.d]);
                by.push(train.y[i]);
            }
            let x = Tensor::<TrainBackend, 2>::from_data(
                TensorData::new(bx, [batch, train.d]),
                &device,
            );
            let y = Tensor::<TrainBackend, 1, Int>::from_data(
                TensorData::new(by, [batch]),
                &device,
            );

            let logits = model.forward(x);
            let loss = loss_fn.forward(logits, y);
            epoch_loss += loss
                .clone()
                .into_data()
                .iter::<f32>()
                .next()
                .unwrap_or(0.0);
            let grads = GradientsParams::from_grads(loss.backward(), &model);
            model = optim.step(cfg.lr, model, grads);
        }
        let epoch_ms = epoch_start.elapsed().as_secs_f32() * 1000.0;
        let elapsed_ms = fit_start.elapsed().as_secs_f32() * 1000.0;
        let avg_ms = elapsed_ms / (epoch + 1) as f32;
        let loss = epoch_loss / batches_per_epoch.max(1) as f32;

        println!(
            "[ml] epoch {}/{} — loss {:.4} — {:.0} ms (avg {:.0} ms)",
            epoch + 1,
            cfg.epochs,
            loss,
            epoch_ms,
            avg_ms
        );

        on(TrainProgress {
            budget: 0,
            repeat: 0,
            epoch: epoch + 1,
            epochs: cfg.epochs,
            loss,
            point: 0,
            points: 0,
            epoch_ms,
            elapsed_ms,
            // Remaining epochs of this fit only; the sweep wrapper widens this
            // to cover the fits still queued behind it.
            eta_ms: avg_ms * (cfg.epochs.saturating_sub(epoch + 1)) as f32,
            device: DEVICE_LABEL,
            samples: train.n,
            features: train.d,
        });
    }
    println!(
        "[ml] fit done — {:.1} s",
        fit_start.elapsed().as_secs_f32()
    );

    let model = model.valid();
    let infer_device = Default::default();
    let metrics = if val.is_empty() {
        EvalMetrics::default()
    } else {
        let pred = predict::<InferBackend>(&model, val, &infer_device);
        evaluate(&pred, &val.y, n_classes)
    };
    Ok((model, metrics))
}

/// One point of a learning curve.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurvePoint {
    /// How many annotated frames the head was allowed to see.
    pub n_frames: usize,
    /// Repeat index — budgets are re-run with different frame subsets so the
    /// curve carries a spread rather than a single lucky draw.
    pub repeat: usize,
    pub metrics: EvalMetrics,
}

/// Sweep annotation budgets and report held-out quality at each.
///
/// `per_frame` holds one sample table per *training* frame; `val` is built from
/// frames excluded from every budget. Budgets are drawn as random subsets and
/// repeated, because with few frames the *choice* of frames dominates the score
/// — a single-draw curve mostly measures luck.
pub fn learning_curve(
    per_frame: &[Samples],
    val: &Samples,
    n_classes: usize,
    budgets: &[usize],
    repeats: usize,
    cfg: &TrainConfig,
) -> Result<Vec<CurvePoint>, String> {
    learning_curve_with(per_frame, val, n_classes, budgets, repeats, cfg, &mut |_| {})
}

/// As [`learning_curve`], reporting every epoch of every fit to `on`.
pub fn learning_curve_with(
    per_frame: &[Samples],
    val: &Samples,
    n_classes: usize,
    budgets: &[usize],
    repeats: usize,
    cfg: &TrainConfig,
    on: &mut dyn FnMut(TrainProgress),
) -> Result<Vec<CurvePoint>, String> {
    if per_frame.is_empty() {
        return Err("no annotated training frames".into());
    }
    let d = per_frame[0].d;
    let mut out = Vec::new();
    let mut rng = Rng::new(cfg.seed ^ 0xC0FFEE);

    // Total fits, known up front so the UI can show real overall progress
    // rather than a bar that restarts at every budget.
    let total_points: usize = budgets
        .iter()
        .map(|&b| {
            let b = b.min(per_frame.len());
            if b == 0 {
                0
            } else if b == per_frame.len() {
                1
            } else {
                repeats.max(1)
            }
        })
        .sum();
    let mut point = 0usize;

    for &budget in budgets {
        let budget = budget.min(per_frame.len());
        if budget == 0 {
            continue;
        }
        // A full-budget draw has only one distinct subset; repeating it would
        // just re-run the same fit.
        let reps = if budget == per_frame.len() {
            1
        } else {
            repeats.max(1)
        };
        for repeat in 0..reps {
            let mut idx: Vec<usize> = (0..per_frame.len()).collect();
            // Partial Fisher-Yates: first `budget` entries become the subset.
            for i in 0..budget {
                let j = i + rng.below(idx.len() - i);
                idx.swap(i, j);
            }
            let mut train = Samples::new(d);
            for &i in idx.iter().take(budget) {
                train.extend(&per_frame[i]);
            }
            let mut sub = cfg.clone();
            // Vary the seed per point so repeats differ in init as well as data.
            sub.seed = cfg.seed
                .wrapping_add((budget as u64) << 32)
                .wrapping_add(repeat as u64);
            println!(
                "[ml] curve point {}/{} — budget {} frames, draw {}",
                point + 1,
                total_points,
                budget,
                repeat + 1
            );
            let (_, metrics) = train_head_with(&train, val, n_classes, &sub, &mut |p| {
                // Widen the per-fit ETA to the whole sweep: the fits still
                // queued behind this one cost roughly a full fit each.
                let per_epoch = if p.epoch > 0 {
                    p.elapsed_ms / p.epoch as f32
                } else {
                    0.0
                };
                let remaining_fits = total_points.saturating_sub(point + 1);
                on(TrainProgress {
                    budget,
                    repeat,
                    point,
                    points: total_points,
                    eta_ms: p.eta_ms + per_epoch * (remaining_fits * p.epochs) as f32,
                    ..p
                });
            })?;
            point += 1;
            out.push(CurvePoint {
                n_frames: budget,
                repeat,
                metrics,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two Gaussian-ish blobs in feature space, linearly separable-ish.
    fn synth(n: usize, d: usize, seed: u64) -> Samples {
        let mut s = Samples::new(d);
        let mut rng = Rng::new(seed);
        for i in 0..n {
            let cls = (i % 2) as i32;
            let centre = if cls == 0 { -1.0 } else { 1.0 };
            let f: Vec<f32> = (0..d)
                .map(|_| centre + (rng.unit() - 0.5) * 0.8)
                .collect();
            s.push(&f, cls);
        }
        s
    }

    #[test]
    fn evaluate_scores_perfect_and_ignores_absent_classes() {
        let m = evaluate(&[0, 1, 1, 0], &[0, 1, 1, 0], 2);
        assert!((m.accuracy - 1.0).abs() < 1e-6);
        assert!((m.mean_dice - 1.0).abs() < 1e-6);

        // Class 2 never appears in truth -> excluded from the mean, so a
        // perfect result on the present classes still scores 1.0.
        let m = evaluate(&[0, 1], &[0, 1], 3);
        assert!((m.mean_dice - 1.0).abs() < 1e-6, "got {}", m.mean_dice);
    }

    #[test]
    fn evaluate_penalises_a_constant_predictor() {
        // Always predicting class 0 when truth is balanced.
        let pred = vec![0; 8];
        let truth: Vec<i32> = (0..8).map(|i| (i % 2) as i32).collect();
        let m = evaluate(&pred, &truth, 2);
        assert!((m.accuracy - 0.5).abs() < 1e-6);
        assert!(m.mean_dice < 0.5, "constant predictor scored {}", m.mean_dice);
    }

    #[test]
    fn evaluate_handles_mismatched_and_empty_input() {
        assert_eq!(evaluate(&[], &[], 2).accuracy, 0.0);
        assert_eq!(evaluate(&[0, 1], &[0], 2).accuracy, 0.0);
    }

    #[test]
    fn head_learns_a_separable_problem() {
        let train = synth(400, 6, 1);
        let val = synth(200, 6, 2);
        let cfg = TrainConfig {
            epochs: 30,
            ..Default::default()
        };
        let (_, m) = train_head(&train, &val, 2, &cfg).unwrap();
        assert!(
            m.accuracy > 0.9,
            "head failed to learn a separable problem: acc={} dice={}",
            m.accuracy,
            m.mean_dice
        );
    }

    #[test]
    fn training_rejects_degenerate_requests() {
        let empty = Samples::new(4);
        let val = synth(10, 4, 3);
        assert!(train_head(&empty, &val, 2, &TrainConfig::default()).is_err());
        let train = synth(10, 4, 4);
        assert!(train_head(&train, &val, 1, &TrainConfig::default()).is_err());
    }

    #[test]
    fn learning_curve_covers_requested_budgets() {
        let per_frame: Vec<Samples> = (0..6).map(|i| synth(60, 5, 100 + i)).collect();
        let val = synth(120, 5, 999);
        let cfg = TrainConfig {
            epochs: 4,
            ..Default::default()
        };
        let pts = learning_curve(&per_frame, &val, 2, &[1, 3, 6], 2, &cfg).unwrap();

        // 1 and 3 repeat twice; the full budget collapses to a single draw.
        assert_eq!(pts.len(), 2 + 2 + 1);
        assert!(pts.iter().all(|p| p.n_frames <= 6));
        assert!(pts.iter().any(|p| p.n_frames == 1));
        assert!(pts.iter().any(|p| p.n_frames == 6));
        // Budgets larger than the pool are clamped, not an error.
        let clamped = learning_curve(&per_frame, &val, 2, &[100], 1, &cfg).unwrap();
        assert_eq!(clamped[0].n_frames, 6);
    }

    #[test]
    fn learning_curve_needs_training_frames() {
        let val = synth(10, 3, 1);
        assert!(learning_curve(&[], &val, 2, &[1], 1, &TrainConfig::default()).is_err());
    }
}
