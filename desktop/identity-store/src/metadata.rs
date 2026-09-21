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
/// with `load_data=false`. The Linux implementation uses the pinned
/// `dbus-secret-service` `SearchItems` call with the exact service, username,
/// and `target=default` attributes emitted by `keyring::Entry::new` in the
/// selected backend. It never calls `GetSecret`, `Unlock`, or the legacy
/// default-collection search.
pub fn probe_identity_presence(service: &str) -> MetadataPresence {
    if service.is_empty() {
        return MetadataPresence::Error;
    }

    #[cfg(all(target_os = "macos", feature = "system-keyring"))]
    {
        return probe_macos_generic_password(service, "secrets");
    }

    #[cfg(all(target_os = "linux", feature = "system-keyring"))]
    {
        return probe_linux_secret_service(service, "secrets", "default");
    }

    #[cfg(not(any(
        all(target_os = "macos", feature = "system-keyring"),
        all(target_os = "linux", feature = "system-keyring"),
    )))]
    {
        let _ = service;
        MetadataPresence::Unavailable
    }
}

#[cfg(all(target_os = "linux", feature = "system-keyring"))]
fn probe_linux_secret_service(service: &str, account: &str, target: &str) -> MetadataPresence {
    use dbus_secret_service::{EncryptionType, SecretService};

    let secret_service = match SecretService::connect(EncryptionType::Plain) {
        Ok(secret_service) => secret_service,
        Err(error) => return classify_secret_service_error(&error),
    };
    let attributes = linux_search_attributes(service, account, target);
    let result = match secret_service.search_items(attributes) {
        Ok(result) => result,
        Err(error) => return classify_secret_service_error(&error),
    };
    classify_search_counts(result.unlocked.len(), result.locked.len())
}

#[cfg(all(target_os = "linux", feature = "system-keyring"))]
fn linux_search_attributes<'a>(
    service: &'a str,
    account: &'a str,
    target: &'a str,
) -> std::collections::HashMap<&'a str, &'a str> {
    std::collections::HashMap::from([
        ("service", service),
        ("username", account),
        ("target", target),
    ])
}

#[cfg(all(target_os = "linux", feature = "system-keyring"))]
fn classify_search_counts(unlocked: usize, locked: usize) -> MetadataPresence {
    match (unlocked, locked) {
        (0, 0) => MetadataPresence::NotFound,
        (1, 0) => MetadataPresence::Present,
        (0, 1) => MetadataPresence::Locked,
        _ => MetadataPresence::Error,
    }
}

#[cfg(all(target_os = "linux", feature = "system-keyring"))]
fn classify_secret_service_error(error: &dbus_secret_service::Error) -> MetadataPresence {
    use dbus_secret_service::Error;

    match error {
        Error::Unavailable => MetadataPresence::Unavailable,
        Error::Locked => MetadataPresence::Locked,
        Error::Dbus(error) => classify_dbus_error_name(error.name()),
        Error::NoResult => MetadataPresence::NotFound,
        _ => MetadataPresence::Error,
    }
}

#[cfg(all(target_os = "linux", feature = "system-keyring"))]
fn classify_dbus_error_name(name: Option<&str>) -> MetadataPresence {
    match name {
        Some("org.freedesktop.DBus.Error.AccessDenied")
        | Some("org.freedesktop.Secret.Error.PermissionDenied") => {
            MetadataPresence::PermissionDenied
        }
        Some("org.freedesktop.DBus.Error.ServiceUnknown")
        | Some("org.freedesktop.DBus.Error.NameHasNoOwner")
        | Some("org.freedesktop.DBus.Error.NoReply") => MetadataPresence::Unavailable,
        Some("org.freedesktop.Secret.Error.IsLocked") => MetadataPresence::Locked,
        _ => MetadataPresence::Error,
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

    #[cfg(all(target_os = "linux", feature = "system-keyring"))]
    #[test]
    fn secret_service_query_uses_exact_pinned_attributes() {
        let attributes = super::linux_search_attributes("service", "secrets", "default");
        assert_eq!(attributes.len(), 3);
        assert_eq!(attributes.get("service"), Some(&"service"));
        assert_eq!(attributes.get("username"), Some(&"secrets"));
        assert_eq!(attributes.get("target"), Some(&"default"));
        assert!(!attributes.contains_key("application"));
    }

    #[cfg(all(target_os = "linux", feature = "system-keyring"))]
    #[test]
    fn search_result_mapping_keeps_locked_and_ambiguous_distinct() {
        assert_eq!(
            super::classify_search_counts(0, 0),
            MetadataPresence::NotFound
        );
        assert_eq!(
            super::classify_search_counts(1, 0),
            MetadataPresence::Present
        );
        assert_eq!(
            super::classify_search_counts(0, 1),
            MetadataPresence::Locked
        );
        assert_eq!(super::classify_search_counts(2, 0), MetadataPresence::Error);
        assert_ne!(
            super::classify_search_counts(0, 1),
            MetadataPresence::NotFound
        );
    }

    #[cfg(all(target_os = "linux", feature = "system-keyring"))]
    #[test]
    fn dbus_error_mapping_never_turns_unknown_into_absence() {
        assert_eq!(
            super::classify_dbus_error_name(Some("org.freedesktop.DBus.Error.AccessDenied")),
            MetadataPresence::PermissionDenied
        );
        assert_eq!(
            super::classify_dbus_error_name(Some("org.freedesktop.DBus.Error.ServiceUnknown")),
            MetadataPresence::Unavailable
        );
        assert_eq!(
            super::classify_dbus_error_name(Some("org.freedesktop.Secret.Error.IsLocked")),
            MetadataPresence::Locked
        );
        assert_eq!(
            super::classify_dbus_error_name(Some("org.freedesktop.DBus.Error.Failed")),
            MetadataPresence::Error
        );
        assert_ne!(
            super::classify_dbus_error_name(Some("org.freedesktop.DBus.Error.Failed")),
            MetadataPresence::NotFound
        );
    }
}
