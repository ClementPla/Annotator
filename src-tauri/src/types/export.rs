//! Result and progress types shared by dataset export and import.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub total_exported: u32,
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub current: u32,
    pub total: u32,
    pub current_file: String,
}

/// Outcome of importing annotations into the open project (matched by filename).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub frames_matched: u32,
    pub frames_unmatched: u32,
    pub annotations_imported: u32,
    pub labels_created: u32,
    pub errors: Vec<String>,
}
