//! Convert raster label pixels into vector polygons for the editor's
//! "vectorize" tool. Reuses the contour + Douglas–Peucker geometry that the
//! COCO/YOLO exporters already rely on.

use crate::commands::formats::geometry;

/// Trace the connected component of `mask` under pixel `(x, y)` into simplified
/// outer-contour polygons (image-pixel coordinates). Returns an empty list when
/// the clicked pixel is background.
#[tauri::command]
pub fn vectorize_component(
    mask: Vec<u8>,
    width: u32,
    height: u32,
    x: u32,
    y: u32,
) -> Vec<Vec<[f64; 2]>> {
    geometry::component_polygons(&mask, width, height, x, y)
}

/// Trace **every** component of `mask` into simplified polygons.
///
/// The whole-mask counterpart of [`vectorize_component`], for turning a
/// predicted mask into editable shapes in one pass. Calling the single-seed
/// version repeatedly from the frontend would mean one IPC round trip per
/// object, and the caller would have to track which pixels it had already
/// consumed — work `regions_from_mask` already does.
///
/// `min_area` drops specks below a pixel count. A predicted mask carries
/// isolated noise that a hand-drawn one does not, and without a floor the user
/// inherits dozens of two-pixel shapes to delete by hand. Pass 0 to keep
/// everything.
#[tauri::command]
pub fn vectorize_mask(
    mask: Vec<u8>,
    width: u32,
    height: u32,
    min_area: u32,
) -> Vec<Vec<[f64; 2]>> {
    // `by_instance: false` — a predicted mask is one class, so every connected
    // blob is its own object rather than a numbered instance.
    geometry::regions_from_mask(&mask, width, height, false)
        .into_iter()
        .filter(|r| r.area >= min_area)
        .flat_map(|r| r.polygons)
        .filter(|p| p.len() >= 3)
        .collect()
}
