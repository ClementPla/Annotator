use tauri::command;
use std::fs::File;
use std::io::Write;
use std::path::Path;

#[command]
pub fn save_xml_file(filepath: String, xml_content: String) -> Result<(), String> {
    // Validate the filepath
    let path = Path::new(&filepath);
    
    // Ensure the directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // Open the file for writing
    let mut file = File::create(&path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    // Write the XML content to the file
    file.write_all(xml_content.as_bytes())
        .map_err(|e| format!("Failed to write XML content: {}", e))?;
    
    Ok(())
}