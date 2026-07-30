//! Choosing where the head trains and runs.
//!
//! burn selects a backend at *compile* time — the backend is a type parameter,
//! not a value — but "use the GPU if there is one" is inherently a *runtime*
//! question. This module bridges the two: both backends are compiled in, and
//! [`Selection::detect`] decides which one a given machine actually uses.
//!
//! The cost of that bridge is that every generic function over `B: Backend`
//! gets instantiated twice. That is a compile-time cost only, and it buys a
//! binary that runs on a laptop without CUDA and a workstation with one,
//! without a separate build.
//!
//! # Why the probe looks the way it does
//!
//! There is no `is_available()` to ask. cubecl initialises CUDA lazily and
//! *panics* — inside a `Result`-free path — when the driver, the toolkit or a
//! usable device is missing. Catching that panic is therefore the only honest
//! test. It is done once, behind a `OnceLock`, because the first CUDA context
//! costs a few hundred milliseconds and the answer cannot change mid-run.

use burn::backend::{Autodiff, NdArray};

/// CPU backend. Always compiled; the fallback that must never fail.
pub type CpuTrain = Autodiff<NdArray>;
pub type CpuInfer = NdArray;

/// CUDA backend, compiled only when the `gpu` feature is on.
#[cfg(feature = "gpu")]
pub type GpuTrain = Autodiff<burn::backend::Cuda>;
#[cfg(feature = "gpu")]
pub type GpuInfer = burn::backend::Cuda;

/// Which backend a run will use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Selection {
    Cpu,
    #[cfg(feature = "gpu")]
    Cuda,
}

impl Selection {
    /// The best backend this machine can actually run.
    ///
    /// GPU is preferred when present: the convolutional head is orders of
    /// magnitude more expensive than the per-pixel MLP it replaced, and on CPU
    /// a realistic sweep runs for minutes per fit.
    pub fn detect() -> Self {
        #[cfg(feature = "gpu")]
        if cuda_works() {
            return Selection::Cuda;
        }
        Selection::Cpu
    }

    /// Human-readable name, surfaced in logs and in the UI.
    ///
    /// Worth reporting rather than leaving implicit: a user who expects GPU
    /// acceleration and silently gets CPU will read the result as "this tool is
    /// slow" instead of "my CUDA install is broken".
    pub const fn label(self) -> &'static str {
        match self {
            Selection::Cpu => "CPU (burn ndarray)",
            #[cfg(feature = "gpu")]
            Selection::Cuda => "CUDA (GPU)",
        }
    }
}

// The probe below is only a fallback because the panic can be caught. Under
// `panic = "abort"` there is nothing to catch: the process dies on the first
// machine without a usable CUDA runtime, and it dies at the moment training
// starts — after the user has waited through feature extraction.
//
// This shipped once. A developer machine with the toolkit on PATH never sees
// it, because the probe succeeds there; the installed build inherits the system
// PATH, fails to find NVRTC, and aborts. Fail the build instead.
#[cfg(all(feature = "gpu", panic = "abort"))]
compile_error!(
    "`panic = \"abort\"` breaks the CUDA probe in this module: it relies on \
     `catch_unwind` to fall back to the CPU backend, and abort turns that \
     fallback into a hard crash on any machine without a usable CUDA runtime. \
     Remove `panic = \"abort\"` from the release profile in Cargo.toml."
);

/// Whether a CUDA context can be created *and used* on this machine.
///
/// Probed once. Allocation alone would prove nothing — burn is lazy, so a
/// tensor can be "created" against a device that cannot execute anything; the
/// probe forces a real kernel and reads the result back.
///
/// Correctness here depends on unwinding — see the `compile_error!` above.
#[cfg(feature = "gpu")]
pub fn cuda_works() -> bool {
    use burn::tensor::Tensor;
    use std::sync::OnceLock;

    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| {
        // Silence the default hook for the duration: a failed probe is an
        // expected outcome on a CPU-only machine, and printing a backtrace for
        // it would look like a crash.
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let ok = std::panic::catch_unwind(|| {
            let device = Default::default();
            let t = Tensor::<GpuInfer, 1>::ones([8], &device);
            let sum: f32 = (t.clone() + t)
                .sum()
                .into_data()
                .iter::<f32>()
                .next()
                .unwrap_or(0.0);
            // 8 elements of 1.0, doubled.
            assert!((sum - 16.0).abs() < 1e-3, "cuda probe returned {sum}");
        })
        .is_ok();
        std::panic::set_hook(prev);
        if ok {
            log::info!("[ml] CUDA backend available — head will train on the GPU");
        } else {
            log::info!(
                "[ml] CUDA backend unavailable (no device, driver, or NVRTC) — \
                 falling back to CPU"
            );
        }
        ok
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_always_yields_a_usable_backend() {
        // The point of the fallback: this must return *something* on any
        // machine, including CI runners with no GPU at all.
        let s = Selection::detect();
        assert!(!s.label().is_empty());
    }

    #[test]
    #[cfg(feature = "gpu")]
    fn the_cuda_probe_is_stable() {
        // Whatever the answer is, it must not change between calls — callers
        // pick a backend once and then build tensors against it.
        assert_eq!(cuda_works(), cuda_works());
    }
}
