use zmq::{self, Socket};
use std::thread;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use serde_json::Value;


#[derive(Serialize, Deserialize, Debug)]
struct Command {
    command: String,
    data: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct ProjectConfig {
    project_name: String,
    input_dir: String,
    output_dir: String,
    is_segmentation: bool,
    is_classification: bool,
    is_instance_segmentation: bool,
    segmentation_classes: Option<Vec<String>>,
    classification_classes: Option<Vec<String>>,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
struct ImageConfig{
    image_path: String,
    mask_data: Option<Vec<String>>,
    segmentation_classes: Option<Vec<String>>,
    classification_classes: Option<Vec<String>>,


}
#[derive(Serialize, Deserialize, Debug)]
struct ImageListResponse {
    images: Vec<String>
}

fn handle_command(app: Arc<AppHandle>, command: Command, socket: &Socket) {
    match command.command.as_str() {
        "get_images" => {
            // Get images from project service
            // let response = ImageListResponse {
            //     images: app.state::<ProjectService>().get_images()
            // };
            
            // if let Ok(json) = serde_json::to_string(&response) {
            //     if let Err(e) = socket.send(json.as_bytes(), 0) {
            //         eprintln!("Error sending response: {}", e);
            //     }
            // }
        }
        "load_image" => {
            if let Ok(config) = serde_json::from_value::<ImageConfig>(command.data) {
                // Handle project creation logic here
                println!("Loading image: {:?}", config.image_path);
                // Emit event or perform other actions
                if let Err(e) = app.emit("load_image", config) {
                    eprintln!("Error emitting image loaded event: {}", e);
                }
            } else {
                eprintln!("Invalid image configuration data");
            }
        }
        "create_project" => {
            if let Ok(config) = serde_json::from_value::<ProjectConfig>(command.data) {
                // Handle project creation logic here
                println!("Creating project: {:?}", config);
                // Emit event or perform other actions
                if let Err(e) = app.emit("create_project", config) {
                    eprintln!("Error emitting project created event: {}", e);
                }
            } else {
                eprintln!("Invalid project configuration data");
            }
        }
        "next_image" => {
            // Handle next image logic here
            if let Err(e) = app.emit("next_image", ()) {
                eprintln!("Error emitting next image event: {}", e);
            }
        }
        "previous_image" => {
            // Handle previous image logic here
            if let Err(e) = app.emit("previous_image", ()) {
                eprintln!("Error emitting previous image event: {}", e);
            }
        }
        _ => {
            eprintln!("Unknown command: {}", command.command);
        }
    }
}

pub fn setup_zmq_receiver(app: AppHandle) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let context = zmq::Context::new();
    let socket = context.socket(zmq::PAIR)?;

    // Bind to the same address used in Python
    socket.bind("tcp://0.0.0.0:5555")?;

    // Spawn a thread to handle incoming messages
    let app = Arc::new(app);
    thread::spawn(move || {
        let app = app.clone();
        loop {
            match socket.recv_bytes(0) {
                Ok(msg_bytes) => {
                    // Try to parse as JSON command
                    match serde_json::from_slice::<Command>(&msg_bytes) {
                        Ok(command) => {
                            handle_command(app.clone(), command, &socket);
                        }
                        Err(_) => {
                            eprintln!("Error parsing command");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Error receiving message: {}", e);
                    break;
                }
            }
        }
    });

    Ok(())
}


