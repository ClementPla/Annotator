use std;

use std::path::{Path, PathBuf};
use std::io::Cursor;
use base64::{engine::general_purpose, Engine as _};
use image::{ImageBuffer, Rgba, Luma};

use image::{GenericImageView, DynamicImage};
use ndarray::{Array2, ArrayView2};

use serde::Deserialize;

use tauri::ipc::Response;

use tokio::task;
use futures::future;


#[derive(Deserialize)]
pub struct ThumbnailParams {
    image_names: Vec<String>,
    input_folder: String,
    output_folder: String,
    width: u32,
    height: u32,
}


#[tauri::command]
pub async fn create_thumbnails(params: ThumbnailParams) -> Vec<bool> {
    let mut handles = Vec::new();

    for image_name in params.image_names {
        let input_folder = params.input_folder.clone();
        let output_folder = params.output_folder.clone();
        let width = params.width;
        let height = params.height;

        let handle = task::spawn_blocking(move || {
            let thumbnail_path = create_thumbnail_path(&output_folder, &image_name);

            if thumbnail_path.exists() {
                eprintln!("Thumbnail {} already exists", thumbnail_path.display());
                return false;
            }

            if let Err(e) = std::fs::create_dir_all(&output_folder) {
                eprintln!(
                    "Failed to create directory {}: {:?}",
                    output_folder,
                    e
                );
                return false;
            }

            let image_path = create_thumbnail_path(&input_folder, &image_name);
            generate_thumbnail(&image_path, &thumbnail_path, width, height)
        });

        handles.push(handle);
    }

    // Await all the spawned tasks and collect their results
    future::join_all(handles)
        .await
        .into_iter()
        .map(|res| res.unwrap_or(false)) // Handle potential task failures
        .collect()
}

#[tauri::command]
pub fn load_image_as_base64(filepath: String) -> Result<Response, String> {
    let image_path = Path::new(&filepath);

    if !image_path.exists() {
        eprintln!("Image {} does not exist", image_path.display());
        return Err(format!("Image does not exist: {}", image_path.display()));
    }

    // Open the image
    let img = image::open(image_path).map_err(|err| {
        eprintln!("Failed to open image: {}", err);
        format!("Failed to open image: {}", err)
    })?;

    // Create a buffer wrapped in a Cursor
    let mut buffer = Cursor::new(Vec::new());

    // Write the image to the buffer
    img.write_to(&mut buffer, image::ImageFormat::Png).map_err(|err| {
        eprintln!("Failed to write image to buffer: {}", err);
        format!("Failed to write image to buffer: {}", err)
    })?;

    Ok(Response::new(buffer.into_inner()))
}


fn create_thumbnail_path(output_folder: &str, image_name: &str) -> PathBuf {
    Path::new(output_folder).join(Path::new(image_name))
}

fn generate_thumbnail(
    image_path: &PathBuf,
    thumbnail_path: &PathBuf,
    width: u32,
    height: u32,
) -> bool {
    println!(
        "Generating thumbnail for {} to {}",
        image_path.display(),
        thumbnail_path.display()
    );
    let img = image::open(image_path).unwrap();
    let thumbnail = img.thumbnail(width, height);
    if !thumbnail_path.parent().unwrap().exists() {
        std::fs::create_dir_all(thumbnail_path.parent().unwrap()).unwrap();
    }
    thumbnail.save(thumbnail_path).is_ok()
}



#[tauri::command]
pub fn process_image_blob(blob: Vec<u8>) -> Result<f64, String> {
    // Convert the blob to an image
    let img = match image::load_from_memory(&blob) {
        Ok(dynamic_image) => dynamic_image.to_rgba8(),
        Err(_) => return Err("Failed to load image from blob".to_string())
    };

    // Calculate mean pixel value
    let (width, height) = img.dimensions();
    let total_pixels = width * height;
    
    // Sum up all pixel values
    let sum: f64 = img.pixels()
        .map(|pixel| {
            // Calculate average of R, G, B channels (ignore alpha)
            (pixel[0] as f64 + pixel[1] as f64 + pixel[2] as f64) / 3.0
        })
        .sum();

    // Calculate mean
    let mean = sum / (total_pixels as f64);

    Ok(mean)
}


pub fn load_image_to_grayscale_array(blob: &[u8]) -> Result<Array2<u8>, String> {
    // Load image from blob
    let img = match image::load_from_memory(blob) {
        Ok(dynamic_image) => dynamic_image,
        Err(_) => return Err("Failed to load image from blob".to_string())
    };

    // Convert to grayscale
    let gray_img = img.to_luma8();

    // Create ndarray with f64 values normalized to [0, 1]
    let (width, height) = gray_img.dimensions();
    let array = Array2::from_shape_vec(
        (height as usize, width as usize), 
        gray_img.into_raw()
            .into_iter()
            .collect()
    ).map_err(|_| "Failed to create array".to_string())?;

    Ok(array)
}

// Optional: Companion function for color images if needed
pub fn load_color_image_to_array(blob: &[u8]) -> Result<(Array2<f64>, Array2<f64>, Array2<f64>), String> {
    // Load image from blob
    let img = match image::load_from_memory(blob) {
        Ok(dynamic_image) => dynamic_image,
        Err(_) => return Err("Failed to load image from blob".to_string())
    };

    // Convert to RGB
    let rgb_img = img.to_rgb8();
    let (width, height) = rgb_img.dimensions();

    // Separate channels
    let raw_rgb = rgb_img.clone().into_raw();
    let r_channel = Array2::from_shape_vec(
        (height as usize, width as usize), 
        raw_rgb.iter()
            .enumerate()
            .filter_map(|(i, &pixel)| {
                if i % 3 == 0 { Some((pixel as f64) / 255.0) } else { None }
            })
            .collect()
    ).map_err(|_| "Failed to create R channel array".to_string())?;

    let raw_rgb = rgb_img.clone().into_raw();
    let g_channel = Array2::from_shape_vec(
        (height as usize, width as usize), 
        raw_rgb.iter()
            .enumerate()
            .filter_map(|(i, &pixel)| {
                if i % 3 == 1 { Some((pixel as f64) / 255.0) } else { None }
            })
            .collect()
    ).map_err(|_| "Failed to create G channel array".to_string())?;

    let raw_rgb = rgb_img.into_raw();
    let b_channel = Array2::from_shape_vec(
        (height as usize, width as usize), 
        raw_rgb.iter()
            .enumerate()
            .filter_map(|(i, &pixel)| {
                if i % 3 == 2 { Some((pixel as f64) / 255.0) } else { None }
            })
            .collect()
    ).map_err(|_| "Failed to create B channel array".to_string())?;

    Ok((r_channel, g_channel, b_channel))
}


pub fn convert_mask_to_blob(mask: &Array2<bool>, color: &[u8; 4]) -> Result<Vec<u8>, String> {
    let (height, width) = mask.dim();
    
    // Create an image buffer from the boolean mask
    // White (255,255,255,255) for true, Black (0,0,0,255) for false
    let mask_image: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(
        width as u32, 
        height as u32, 
        |x, y| {
            if mask[[y as usize, x as usize]] {
                Rgba(*color) // White pixel with full opacity
            } else {
                Rgba([0, 0, 0, 0]) // Black pixel with full opacity
            }
        }
    );
    
    // Convert to PNG blob
    let mut blob = Vec::new();
    let mut cursor = Cursor::new(&mut blob);
    mask_image.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|_| "Failed to convert mask to blob".to_string())?;
    
    Ok(blob)
}

pub fn load_mask_to_array(blob: &[u8]) -> Result<(Array2<bool>, [u8; 4]), String> {
    // Load image from blob
    let img = image::load_from_memory(blob)
        .map_err(|_| "Failed to load mask from blob".to_string())?;

    let (width, height) = img.dimensions();

    // Convert to RGBA8 format
    let rgba_img = img.to_rgba8();

    let pixels = rgba_img.into_raw(); // Vec<u8>

    let mut mask_data = Vec::with_capacity((width * height) as usize);
    let mut mask_color: Option<[u8; 4]> = None;

    // Iterate over pixels
    for pixel in pixels.chunks(4) {
        let r = pixel[0];
        let g = pixel[1];
        let b = pixel[2];
        let a = pixel[3];

        // Binarization using the alpha channel
        let is_masked = a > 128;

        mask_data.push(is_masked);

        if is_masked && mask_color.is_none() {
            // Extract mask color from RGB channels of the first masked pixel
            mask_color = Some([r, g, b, 255]);
        }
    }

    // Convert mask_data into an Array2<bool>
    let mask = Array2::from_shape_vec(
        (height as usize, width as usize),
        mask_data,
    )
    .map_err(|_| "Failed to create mask array".to_string())?;

    // Handle the case where no masked pixels are found
    let mask_color = match mask_color {
        Some(color) => color,
        None => return Err("No masked pixels found".to_string()),
    };

    Ok((mask, mask_color))
}