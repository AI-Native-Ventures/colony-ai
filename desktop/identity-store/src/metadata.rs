//! Metadata-only presence probes for the explicit identity namespace.
//!
//! This module is deliberately separate from the legacy `SecretStore` path:
//! the ownership preflight must be able to distinguish an empty namespace from
//! an occupied or unavailable one without loading a credential blob.  The
//! existing Tauri keyring/fallback behavior remains in `legacy.rs` unchanged.

/// The finite outcome of an exact identity-store metadata query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataPresence {
    /// The exact service/account has no matching item.
    NotFound,
    /// The exact service/account has at least one matching item.
    Present,
    /// The backend explicitly reports a locked item/session.
    Locked,
    /// The process is not permitted to inspect the metadata.
    PermissionDenied,
    /// The selected metadata-only API is unavailable on this platform.
    Unavailable,
    /// The backend returned an error that is not safe to classify further.
    Error,
}

/// Probe the exact identity service without returning or loading secret data.
///
/// The production macOS implementation requests generic-password attributes
/// with `load_data=false`. Other platforms intentionally return `Unavailable`
/// until their own safe metadata-only adapters are proven; they do not fall
/// back to the legacy keyring read path.
pub fn probe_identity_presence(service: &str) -> MetadataPresence {
    if service.is_empty() {
        return MetadataPresence::Error;
    }

    #[cfg(all(target_os = "macos", feature = "system-keyring"))]
    {
        return probe_macos_generic_password(service, "secrets");
    }

    #[cfg(not(all(target_os = "macos", feature = "system-keyring")))]
    {
        let _ = service;
        MetadataPresence::Unavailable
    }
}

#[cfg(all(target_os = "macos", feature = "system-keyring"))]
fn probe_macos_generic_password(service: &str, account: &str) -> MetadataPresence {
    use security_framework::item::{ItemClass, ItemSearchOptions};

    let mut options = ItemSearchOptions::new();
    let result = options
        .class(ItemClass::generic_password())
        .service(service)
        .account(account)
        .limit(1_i64)
        .load_attributes(true)
        .load_data(false)
        .search();

    match result {
        Ok(items) if items.is_empty() => MetadataPresence::NotFound,
        Ok(_) => MetadataPresence::Present,
        Err(error) => classify_security_status(error.code()),
    }
}

#[cfg(all(target_os = "macos", feature = "system-keyring"))]
fn classify_security_status(code: i32) -> MetadataPresence {
    // These are the stable Security.framework status values needed for the
    // conservative mapping. The wrapper exposes the numeric status without
    // requiring the application to import its unsafe sys crate directly.
    match code {
        -25300 => MetadataPresence::NotFound, // errSecItemNotFound
        -34018 => MetadataPresence::PermissionDenied, // errSecMissingEntitlement
        // The pinned wrapper does not expose a lock-specific result. Keep
        // interaction/authentication failures unavailable rather than guessing
        // that an item is merely locked.
        -25291 | -25308 => MetadataPresence::Unavailable, // not-available / interaction-not-allowed
        _ => MetadataPresence::Error,
    }
}

#[cfg(test)]
mod tests {
    use super::MetadataPresence;

    #[test]
    fn unavailable_is_not_fresh_absence() {
        assert_ne!(MetadataPresence::Unavailable, MetadataPresence::NotFound);
        assert_ne!(
            MetadataPresence::PermissionDenied,
            MetadataPresence::NotFound
        );
        assert_ne!(MetadataPresence::Error, MetadataPresence::NotFound);
    }

    #[cfg(all(target_os = "macos", feature = "system-keyring"))]
    #[test]
    fn security_status_mapping_never_guesses_locked_or_absent() {
        assert_eq!(
            super::classify_security_status(-25300),
            MetadataPresence::NotFound
        );
        assert_eq!(
            super::classify_security_status(-34018),
            MetadataPresence::PermissionDenied
        );
        assert_eq!(
            super::classify_security_status(-25308),
            MetadataPresence::Unavailable
        );
        assert_eq!(
            super::classify_security_status(-12345),
            MetadataPresence::Error
        );
    }
}
