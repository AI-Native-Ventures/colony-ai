#[cfg(test)]
use std::collections::HashMap;

use uuid::Uuid;
use zeroize::Zeroize;

#[cfg(feature = "system-keyring")]
use crate::secret_store::SecretStore;

#[cfg(any(test, feature = "system-keyring"))]
const MAX_SECRET_VALUE_BYTES: usize = 64 * 1024;

#[cfg(any(test, feature = "system-keyring"))]
trait DeviceSecretStore {
    fn store(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

#[cfg(feature = "system-keyring")]
struct OperatingSystemSecretStore(&'static SecretStore);

#[cfg(feature = "system-keyring")]
impl DeviceSecretStore for OperatingSystemSecretStore {
    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        self.0.store(key, value)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.0.delete(key)
    }
}

#[cfg(any(test, feature = "system-keyring"))]
fn secret_storage_key(relay_pubkey: &str, binding_id: Uuid) -> Result<String, String> {
    if relay_pubkey.len() != 64 || !relay_pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The relay identity is unavailable.".into());
    }
    Ok(format!(
        "company-secret:{}:{}",
        relay_pubkey.to_ascii_lowercase(),
        binding_id
    ))
}

#[cfg(any(test, feature = "system-keyring"))]
fn store_device_secret(
    store: &impl DeviceSecretStore,
    relay_pubkey: &str,
    binding_id: Uuid,
    value: &str,
) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_SECRET_VALUE_BYTES || value.contains('\0') {
        return Err("Enter a non-empty credential of 64 KB or less.".into());
    }
    let key = secret_storage_key(relay_pubkey, binding_id)?;
    store
        .store(&key, value)
        .map_err(|_| "Device secure storage is unavailable.".to_owned())
}

#[cfg(any(test, feature = "system-keyring"))]
fn delete_device_secret(
    store: &impl DeviceSecretStore,
    relay_pubkey: &str,
    binding_id: Uuid,
) -> Result<(), String> {
    let key = secret_storage_key(relay_pubkey, binding_id)?;
    store
        .delete(&key)
        .map_err(|_| "Device secure storage is unavailable.".to_owned())
}

/// Store a device-scoped company credential without returning or logging it.
#[tauri::command]
pub fn store_company_secret(
    relay_pubkey: String,
    binding_id: String,
    mut secret_value: String,
) -> Result<(), String> {
    let binding_id = Uuid::parse_str(&binding_id).map_err(|_| {
        secret_value.zeroize();
        "The secret binding is unavailable.".to_owned()
    })?;

    #[cfg(feature = "system-keyring")]
    {
        let store =
            OperatingSystemSecretStore(SecretStore::shared(crate::app_state::keyring_service()));
        let result = store_device_secret(&store, &relay_pubkey, binding_id, &secret_value);
        secret_value.zeroize();
        result
    }

    #[cfg(not(feature = "system-keyring"))]
    {
        let _ = (relay_pubkey, binding_id);
        secret_value.zeroize();
        Err("Device secure storage is unavailable in this build.".into())
    }
}

/// Remove a device-scoped credential after an unactivated binding fails.
#[tauri::command]
pub fn delete_company_secret(relay_pubkey: String, binding_id: String) -> Result<(), String> {
    let binding_id = Uuid::parse_str(&binding_id)
        .map_err(|_| "The secret binding is unavailable.".to_owned())?;

    #[cfg(feature = "system-keyring")]
    {
        let store =
            OperatingSystemSecretStore(SecretStore::shared(crate::app_state::keyring_service()));
        delete_device_secret(&store, &relay_pubkey, binding_id)
    }

    #[cfg(not(feature = "system-keyring"))]
    {
        let _ = (relay_pubkey, binding_id);
        Err("Device secure storage is unavailable in this build.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core_pkg::company_records::{
        SecretBindingAction, SecretBindingActionKind, SecretBindingSpec, SecretStorage,
        COMPANY_RECORD_SCHEMA_VERSION,
    };
    use buzz_core_pkg::kind::KIND_SECRET_BINDING_ACTION;
    use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag};
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemorySecretStore(Mutex<HashMap<String, String>>);

    impl DeviceSecretStore for MemorySecretStore {
        fn store(&self, key: &str, value: &str) -> Result<(), String> {
            self.0
                .lock()
                .map_err(|_| "memory store unavailable".to_owned())?
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }

        fn delete(&self, key: &str) -> Result<(), String> {
            self.0
                .lock()
                .map_err(|_| "memory store unavailable".to_owned())?
                .remove(key);
            Ok(())
        }
    }

    #[test]
    fn sentinel_stays_out_of_binding_event_errors_and_cli_projection() {
        let store = MemorySecretStore::default();
        let binding_id = Uuid::new_v4();
        let relay_pubkey = "a".repeat(64);
        let sentinel = format!("credential-{}", Uuid::new_v4().simple());
        store_device_secret(&store, &relay_pubkey, binding_id, &sentinel)
            .expect("store in memory without a platform credential provider");

        let binding = SecretBindingSpec {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            name: "Publishing credential".into(),
            employee_pubkey: "b".repeat(64),
            tool_name: "Social publishing".into(),
            allowed_use: "Prepare campaign drafts".into(),
            storage: SecretStorage::Device,
            source_ask: None,
        };
        let action = SecretBindingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            action: SecretBindingActionKind::Create,
            expected_head_event_id: None,
            binding: Some(binding.clone()),
        };
        let content = serde_json::to_string(&action).expect("serialize metadata action");
        let event = EventBuilder::new(Kind::Custom(KIND_SECRET_BINDING_ACTION as u16), content)
            .tags([
                Tag::parse(["d", format!("company:secret:{binding_id}").as_str()])
                    .expect("binding coordinate"),
            ])
            .sign_with_keys(&Keys::generate())
            .expect("sign metadata event");

        let error = store_device_secret(&store, "invalid", binding_id, &sentinel)
            .expect_err("invalid relay identity is rejected");
        let cli_output = serde_json::json!({
            "bindingId": binding_id,
            "name": binding.name,
            "status": "pending"
        })
        .to_string();
        let event_json = event
            .try_as_json()
            .expect("serialize signed test event for output inspection");
        let captured_outputs = [
            event_json,
            event.content.clone(),
            error,
            cli_output,
            format!("stored company secret binding {}", binding_id),
        ];
        for output in captured_outputs {
            assert!(
                !output.contains(&sentinel),
                "secret value appeared in captured output"
            );
        }

        let key = secret_storage_key(&relay_pubkey, binding_id).expect("storage key");
        assert_eq!(
            store.0.lock().expect("memory store lock").get(&key),
            Some(&sentinel)
        );
        delete_device_secret(&store, &relay_pubkey, binding_id)
            .expect("remove pending credential without a platform credential provider");
        assert!(!store
            .0
            .lock()
            .expect("memory store lock")
            .contains_key(&key));
    }
}
