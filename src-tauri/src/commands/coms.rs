use zmq;
use std::io::Result;
use std::thread;
use tauri::{AppHandle, Emitter};
use std::sync::OnceLock;

fn context() -> &'static zmq::Context {
    static mut CONTEXT: OnceLock<zmq::Context> = OnceLock::new();
    unsafe { CONTEXT.get_or_init(zmq::Context::new) }
}



pub fn setup_zmq_receiver(app: AppHandle) -> Result<()> {
    let context = context();
    let socket = context.socket(zmq::PAIR)?;
    
    // Bind to the same address used in Python
    socket.bind("tcp://0.0.0.0:5555")?;
    
    // Spawn a thread to handle incoming messages
    thread::spawn(move || {
        let app = app.clone();
        loop {
            match socket.recv_bytes(0) {
                Ok(msg_bytes) => {
                    // Try to parse as JSON first (for image data)
                    match serde_json::from_slice::<ImageData>(&msg_bytes) {
                        Ok(image_data) => {
                            if let Err(e) = app.emit("update_image", image_data) {
                                eprintln!("Error emitting image data: {}", e);
                            }
                        }
                        Err(_) => {
                            // If not image data, try as text
                            match String::from_utf8(msg_bytes) {
                                Ok(txt_data) => {
                                    if let Err(e) = app.emit("update_txt", txt_data) {
                                        eprintln!("Error emitting text data: {}", e);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Error parsing message: {}", e);
                                }
                            }
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

// Struct to represent image data
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ImageData {
    data: Vec<u8>,
    width: u32,
    height: u32,
    dtype: String,
}