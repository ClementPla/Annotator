use std::collections::HashMap;

use rusqlite::params;
use serde::Serialize;
use ts_rs::TS;
use tauri::State;

use crate::commands::frame::Frame;
use crate::storage::{queries, DbState};
use crate::utils::error::{AppError, Result};

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/app/lib/generated/")]
pub struct Sequence {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    #[ts(type = "number")]
    pub frame_count: i64,
    pub sort_order: i32,
}


// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_sequences(db: State<DbState>) -> Result<Vec<Sequence>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT 
                s.id, 
                s.name, 
                s.sort_order,
                COUNT(f.id) as frame_count
             FROM sequences s
             LEFT JOIN frames f ON f.sequence_id = s.id
             GROUP BY s.id
             ORDER BY s.sort_order, s.name"
        ).map_err(|e| AppError::Database(e))?;

        let rows = stmt.query_map([], |row| {
            Ok(Sequence {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                frame_count: row.get(3)?,
            })
        }).map_err(|e| AppError::Database(e))?;

        let sequences: Vec<Sequence> = rows
            .filter_map(|r| r.ok())
            .collect();

        Ok(sequences)
    })
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/app/lib/generated/")]
pub struct GallerySequence {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    #[ts(type = "number")]
    pub sort_order: i64,
    #[ts(type = "number")]
    pub frame_count: i64,
    #[ts(type = "number")]
    pub reviewed_count: i64,
    /// Frames with at least one annotation (raster mask or vector shape).
    #[ts(type = "number")]
    pub annotated_count: i64,
    #[ts(type = "number | null")]
    pub first_frame_id: Option<i64>,
    /// Any registration of this sequence has at least one keypoint pair.
    pub has_keypoints: bool,
}

#[tauri::command]
pub fn get_gallery_sequences(db: State<DbState>) -> Result<Vec<GallerySequence>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT 
                s.id,
                s.name,
                s.sort_order,
                COUNT(f.id) as frame_count,
                COUNT(DISTINCT CASE
                    WHEN EXISTS (SELECT 1 FROM frame_reviews fr WHERE fr.frame_id = f.id)
                    THEN f.id END) as reviewed_count,
                COUNT(DISTINCT CASE
                    WHEN {}
                    THEN f.id END) as annotated_count,
                MIN(f.id) as first_frame_id,
                EXISTS (
                    SELECT 1
                    FROM registrations r
                    JOIN keypoint_pairs kp ON kp.registration_id = r.id
                    WHERE r.sequence_id = s.id
                ) as has_keypoints
             FROM sequences s
             LEFT JOIN frames f ON f.sequence_id = s.id
             GROUP BY s.id
             ORDER BY s.sort_order",
            queries::FRAME_HAS_ANNOTATION
        )).map_err(|e| AppError::Database(e))?;
        
        let rows = stmt.query_map([], |row| {
            Ok(GallerySequence {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                frame_count: row.get(3)?,
                reviewed_count: row.get(4)?,
                annotated_count: row.get(5)?,
                first_frame_id: row.get(6)?,
                has_keypoints: row.get(7)?,
            })
        }).map_err(|e| AppError::Database(e))?;
        
        let sequences: Vec<GallerySequence> = rows
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(sequences)
    })
}

#[tauri::command]
pub fn get_all_frame_ids_by_sequence(db: State<DbState>) -> Result<HashMap<i64, Vec<i64>>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT sequence_id, id FROM frames ORDER BY sequence_id, frame_index"
        ).map_err(|e| AppError::Database(e))?;
        
        let mut result: HashMap<i64, Vec<i64>> = HashMap::new();
        
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        }).map_err(|e| AppError::Database(e))?;
        
        for row in rows.flatten() {
            result.entry(row.0).or_default().push(row.1);
        }
        
        Ok(result)
    })
}

#[tauri::command]
pub fn get_sequence_frames(db: State<DbState>, sequence_id: i64) -> Result<Vec<Frame>> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT 
                id, 
                sequence_id, 
                frame_index, 
                relative_path,
                width, 
                height, 
                EXISTS (SELECT 1 FROM frame_reviews r WHERE r.frame_id = frames.id),
                embedded_data IS NOT NULL as is_embedded
             FROM frames 
             WHERE sequence_id = ?1
             ORDER BY frame_index"
        ).map_err(|e| AppError::Database(e))?;

        let rows = stmt.query_map(params![sequence_id], |row| {
            Ok(Frame {
                id: row.get(0)?,
                sequence_id: row.get(1)?,
                frame_index: row.get(2)?,
                relative_path: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                reviewed: row.get(6)?,
                is_embedded: row.get(7)?,
            })
        }).map_err(|e| AppError::Database(e))?;

        let frames: Vec<Frame> = rows
            .filter_map(|r| r.ok())
            .collect();

        Ok(frames)
    })
}
