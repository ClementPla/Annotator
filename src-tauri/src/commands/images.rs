use std;


use serde::Deserialize;

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
    let mut results = Vec::new();
    for image_name in params.image_names {
        let thumbnail_path = format!("{}/{}", params.output_folder, image_name);
        std::fs::create_dir_all(&params.output_folder).unwrap_or_else(|e| {
            eprintln!("Failed to create directory {}: {:?}", params.output_folder, e);
            results.push(false);
        });
        let image_path = format!("{}/{}", params.input_folder, image_name);
        let result = generate_thumbnail(&image_path, &thumbnail_path, params.width, params.height);
        results.push(result);
    }
    results
}

fn generate_thumbnail(image_path: &str, thumbnail_path: &str, width: u32, height: u32) -> bool {
    let img = image::open(image_path).unwrap();
    let thumbnail = img.thumbnail(width, height);
    thumbnail.save(thumbnail_path).is_ok()
}
