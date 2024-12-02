mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system_infos::list_files_in_folder,
            commands::images::create_thumbnails,
            commands::images::load_image_as_base64,
            commands::images::process_image_blob,
            commands::segmentation::refine_segmentation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
