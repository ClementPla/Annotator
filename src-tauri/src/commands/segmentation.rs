use super::images::{convert_image_to_luma_u8_array, convert_image_to_mask_array};
use super::refine::{denoise, refine, Refine};
use ndarray::{Array2, Zip};
use tauri::{self, ipc::Response};

fn otsu_level(pixels: &Vec<u8>) -> u8 {
    let mut histogram = [0u32; 256];
    for &pixel in pixels {
        histogram[pixel as usize] += 1;
    }

    let total_pixels = pixels.len() as f64;

    let mut probability = [0f64; 256];
    for i in 0..256 {
        probability[i] = (histogram[i] as f64) / total_pixels;
    }

    let mut max_between_class_variance = 0.0;
    let mut optimal_threshold = 0u8;

    let mut w0 = 0.0; // Weight for background class
    let mut sum0 = 0.0; // Cumulative sum for background class
    let mut total_mean = 0.0;

    for i in 0..256 {
        total_mean += (i as f64) * probability[i];
    }

    for t in 0..256 {
        w0 += probability[t];
        if w0 == 0.0 {
            continue;
        }

        let w1 = 1.0 - w0;
        if w1 == 0.0 {
            break;
        }

        sum0 += (t as f64) * probability[t];
        let μ0 = sum0 / w0;
        let μ1 = (total_mean - sum0) / w1;

        let between_class_variance = w0 * w1 * (μ0 - μ1) * (μ0 - μ1);

        if between_class_variance > max_between_class_variance {
            max_between_class_variance = between_class_variance;
            optimal_threshold = t as u8;
        }
    }

    optimal_threshold
}

fn otsu_in_mask(
    image: &Array2<u8>,
    mask: &Array2<bool>,
    inverse: bool,
) -> Result<Array2<bool>, String> {
    if image.dim() != mask.dim() {
        return Err("Image and mask dimensions must match".to_string());
    }

    let mut masked_pixels = Vec::new();
    for (&pixel, &is_masked) in image.iter().zip(mask.iter()) {
        if is_masked {
            if inverse {
                masked_pixels.push(255 - pixel);
            } else {
                masked_pixels.push(pixel);
            }
        }
    }

    if masked_pixels.is_empty() {
        return Err("Masked pixels are empty; cannot compute Otsu threshold".to_string());
    }

    // Otsu threshold of the pixels under the mask.
    let threshold = otsu_level(&masked_pixels);

    let thresholded_image = if inverse {
        image.map(|&pixel| 255 - pixel > threshold)
    } else {
        image.map(|&pixel| pixel > threshold)
    };

    let refined_mask = Zip::from(&thresholded_image)
        .and(mask)
        .map_collect(|&thresholded, &original_mask| thresholded && original_mask);

    Ok(refined_mask)
}

#[tauri::command]
pub async fn otsu_segmentation(
    image: Vec<u8>,
    mask: Vec<u8>,
    inverse: bool,
    denoise_sigma: f32,
    smooth: f32,
    fill_holes: bool,
    connectedness: bool,
    width: usize,
    height: usize,
) -> Result<Response, String> {

    let image = image::DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width as u32, height as u32, image).unwrap(),
    );

    let mask = image::DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(width as u32, height as u32, mask).unwrap(),
    );

    // Thresholding a lightly blurred image gives an outline free of pixel
    // noise that still follows the real edge.
    let image = denoise(&convert_image_to_luma_u8_array(&image), denoise_sigma);
    let mask = convert_image_to_mask_array(&mask);

    let refined_mask = refine(
        &otsu_in_mask(&image, &mask, inverse)?,
        &Refine { fill_holes, smooth, largest_only: connectedness },
    );

    // Single-channel presence mask (255 = foreground), row-major.
    let mut output = vec![0u8; width * height];
    for y in 0..height {
        for x in 0..width {
            if *refined_mask.get([y, x]).unwrap() {
                output[y * width + x] = 255;
            }
        }
    }
    Ok(Response::new(output))
}
