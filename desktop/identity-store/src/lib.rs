//! Shared platform blob storage and the strict profile-scoped headless store.
//!
//! The legacy implementation lives in `legacy.rs` while this bounded
//! extraction is reviewed. It is compiled by the Tauri compatibility crate and
//! this standalone consumer from the same source, so the existing Tauri
//! migration/fallback behavior and the new headless adapter cannot drift.

#[path = "legacy.rs"]
mod legacy;

mod metadata;

pub use legacy::*;
pub use metadata::{probe_identity_presence, MetadataPresence};
