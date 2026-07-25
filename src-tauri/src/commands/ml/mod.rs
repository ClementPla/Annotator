//! In-app training of a small, scribble-conditioned segmentation head.
//!
//! # Goal
//!
//! Answer, for a given project, the question "how good does a model get as I
//! annotate more?" — without leaving the app and without a Python toolchain.
//!
//! # Architecture
//!
//! ```text
//!   image ──┬─> frozen ONNX encoder (ort) ─> patch tokens ─> upsample ─┐
//!           │                                                          ├─> concat ─> head (burn) ─> per-class logits
//!           ├─> local feature basis (filters.rs, full resolution) ─────┤
//!           └─> scribble distance channels ────────────────────────────┘
//! ```
//!
//! Two deliberate splits:
//!
//! * **The encoder never trains.** It is a frozen feature source, so no
//!   gradient crosses the `ort` boundary and the expensive forward pass can be
//!   cached per frame. Only the head — a few thousand parameters — is fit.
//! * **Training happens on sampled pixels, not dense maps.** A dense
//!   `[384, H, W]` feature volume is hundreds of megabytes per image; sampling
//!   pixels turns the same information into a small matrix and makes the head a
//!   plain MLP. Dense evaluation is reserved for inference on one frame at a
//!   time.
//!
//! The head is multi-class over whatever labels the project defines — nothing
//! here assumes a particular modality, organ, or binary foreground.

pub mod encoder;
pub mod filters;
pub mod registry;
pub mod scribble;
pub mod train;
