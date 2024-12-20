use tauri::{ self, ipc::Response };
use ort::{ self, session::SessionOutputs };
use ort::execution_providers::CUDAExecutionProvider;
use image::GenericImageView;
use ort::session::{ builder::GraphOptimizationLevel, Session, SessionInputValue };
use ndarray::{ Array, Array2 };
use ort::value::Tensor;
use super::images::load_blob_to_image;
use std::io::Cursor;

use std::sync::OnceLock;
use lazy_static::lazy_static;

// Optional: Create a thread-safe singleton for the model
lazy_static! {
  static ref MODEL_SESSION: OnceLock<Session> = OnceLock::new();
}

fn get_or_create_model() -> Result<&'static Session, ort::Error> {
  Ok(
    MODEL_SESSION.get_or_init(|| {
      // First, create the CUDA execution provider
      let cuda_provider = CUDAExecutionProvider::default();

      Session::builder()
        .unwrap()
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .unwrap()
        .with_intra_threads(4)
        .unwrap()
        // Try using .with_provider() instead
        .with_execution_providers(vec![cuda_provider.into()])
        .unwrap()
        .commit_from_file("C:/Users/cleme/Documents/Projects/Annotator/dev/test/LiteMedSam/MedSAM/medsam.onnx")
        .unwrap()
    })
  )
}

#[tauri::command]
pub fn sam_segment(image: Vec<u8>, coarse_mask: Vec<u8>) -> Result<Response, String> {
  // ort::init()
  // 	.with_execution_providers([CUDAExecutionProvider::default().build().error_on_failure()])
  // .commit().map_err(|e| e.to_string())?;

  let model = get_or_create_model().map_err(|e| format!("Model loading failed: {}", e))?;
  let image = load_blob_to_image(&image).unwrap();
  let coarse_mask = load_blob_to_image(&coarse_mask).unwrap();

  // Get size
  let (width, height) = image.dimensions();

  // Find min and max pixel value (all channels combined)


  // Resize image to 1024x1024
  let image = image.resize_exact(256, 256, image::imageops::FilterType::Nearest);
  let coarse_mask = coarse_mask.resize_exact(256, 256, image::imageops::FilterType::Nearest);

  // Convert image to tensor
  let mut image_array = Array::zeros((1, 3, 256, 256));
  let mut bbox_array = Array::zeros((1, 1, 4));

  for pixel in image.pixels() {
    let x = pixel.0 as _;
    let y = pixel.1 as _;
    let [r, g, b, _] = pixel.2.0;
    image_array[[0, 0, y, x]] = (r as f32) / 255.0; 
    image_array[[0, 1, y, x]] = (g as f32)/ 255.0;  
    image_array[[0, 2, y, x]] = (b as f32)/ 255.0;  
  }
  let mut color = [255, 255, 255, 255];
  
  // We find the bounding box of the mask as xmin, ymin, xmax, ymax
  let mut xmin = 256;
  let mut ymin = 256;
  let mut xmax = 0;
  let mut ymax = 0;

  for pixel in coarse_mask.pixels() {
    let x = pixel.0 as _;
    let y = pixel.1 as _;
    let [r, g, b, a] = pixel.2.0;
    if r > 0 {
      color = [r, g, b, a];
      if x < xmin {
        xmin = x;
      }
      if x > xmax {
        xmax = x;
      }
      if y < ymin {
        ymin = y;
      }
      if y > ymax {
        ymax = y;
      }

    }
     
  }

  bbox_array[[0, 0, 0]] = xmin as f32;
  bbox_array[[0, 0, 1]] = ymin as f32;
  bbox_array[[0, 0, 2]] = xmax as f32;
  bbox_array[[0, 0, 3]] = ymax as f32;

  // Convert image array to a Tensor
  let image_value = Tensor::from_array(image_array).unwrap();
  let mask_value = Tensor::from_array(bbox_array).unwrap();

  // Load model
  let data: Vec<(&str, SessionInputValue)> = vec![
    ("images".into(), SessionInputValue::from(image_value)),
    ("bbox".into(), SessionInputValue::from(mask_value))
  ];

  let outputs: SessionOutputs = model.run(data).expect("Failed to run model inference");
  let output: ndarray::ArrayBase<
    ndarray::ViewRepr<&f32>,
    ndarray::Dim<ndarray::IxDynImpl>
  > = outputs["output_masks"].try_extract_tensor().unwrap();

  // Display a message

  println!("Model ran successfully");

  // Remove the batch dimension
  let output_2d = output.into_dimensionality::<ndarray::Ix2>().unwrap();
  let output_bool_2d: Array2<bool> = output_2d.mapv(|x| x > 0.5  );

  // Cast to image and resize to original size

  let output_mask_image = image::DynamicImage::ImageRgba8(
    image::ImageBuffer::from_fn(256, 256, |x, y| {
      let value = output_bool_2d[[y as usize, x as usize]];
      if value {
        image::Rgba(color)
      } else {
        image::Rgba([0, 0, 0, 0])
      }
    })
  );

  let output_mask_image = output_mask_image.resize_exact(
    width,
    height,
    image::imageops::FilterType::CatmullRom,
  );

  let mut blob = Vec::new();
  let mut cursor = Cursor::new(&mut blob);
  output_mask_image
    .write_to(&mut cursor, image::ImageFormat::Png)
    .map_err(|_| "Failed to convert mask to blob".to_string())?;

  Ok(Response::new(blob))
}
