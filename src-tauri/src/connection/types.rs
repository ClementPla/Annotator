use thiserror::Error;

#[derive(Error, Debug)]
pub enum ComError {
    #[error("ZMQ error: {0}")]
    ZmqError(#[from] zmq::Error),
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Other error: {0}")]
    Other(String),
    /// The Python peer answered `ok: false`; the message is its own.
    #[error("{0}")]
    Peer(String),
    #[error("Python did not answer in time")]
    NoReply,
}

impl From<tauri::Error> for ComError {

    fn from(error: tauri::Error) -> Self {

        ComError::Other(error.to_string())

    }
}
