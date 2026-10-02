//! Tauri compatibility export for the shared identity-store implementation.
//!
//! The implementation remains in `desktop/identity-store` so the Tauri
//! adapter and the future headless native host use the same blob backend and
//! lock/cache behavior. Existing callers retain this module path and its
//! legacy migration/global-store semantics.

pub use colony_identity_store::*;
