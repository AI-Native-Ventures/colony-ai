//! Server-only model eligibility, pseudonymous attribution and response boundary.

use hmac::{Hmac, KeyInit, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use uuid::Uuid;
use zeroize::Zeroizing;

pub(super) struct Policy {
    allowed_models: Vec<String>,
    user_hash_key: Option<Zeroizing<String>>,
}

impl Policy {
    pub(super) fn new(
        model: &str,
        allowed_models: Vec<String>,
        openrouter: bool,
        secret: Option<String>,
    ) -> Result<Self, ()> {
        if allowed_models.is_empty()
            || allowed_models.len() > 16
            || allowed_models.iter().any(|m| m.is_empty() || m.len() > 200)
            || !allowed_models.iter().any(|m| m == model)
            || (openrouter && secret.as_ref().is_none_or(|s| s.len() < 32))
        {
            return Err(());
        }
        Ok(Self {
            allowed_models,
            user_hash_key: secret.map(Zeroizing::new),
        })
    }

    pub(super) fn check_model(&self, model: &str) -> Result<(), ()> {
        if self.allowed_models.iter().any(|m| m == model) {
            Ok(())
        } else {
            Err(())
        }
    }

    pub(super) fn user(&self, account: Uuid) -> Result<String, ()> {
        let key = self.user_hash_key.as_ref().ok_or(())?;
        let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key.as_bytes()).map_err(|_| ())?;
        mac.update(b"colony-credits-user-v1\0");
        mac.update(account.as_bytes());
        Ok(format!(
            "colony_{}",
            hex::encode(mac.finalize().into_bytes())
        ))
    }
}

/// Only the managed agent's text/function output crosses this boundary.
/// Provider credentials, endpoint metadata and arbitrary response fields do not.
pub(super) fn choices(value: &Value) -> Result<Value, ()> {
    let values = value.as_array().ok_or(())?;
    if values.len() != 1 {
        return Err(());
    }
    let choice = &values[0];
    let message = &choice["message"];
    if message["role"] != "assistant"
        || !(message["content"].is_string() || message["content"].is_null())
    {
        return Err(());
    }
    let mut safe = json!({"role":"assistant", "content":message["content"]});
    if let Some(calls) = message.get("tool_calls") {
        let calls = calls.as_array().ok_or(())?;
        if calls.len() > 64 {
            return Err(());
        }
        let mut sanitized = Vec::with_capacity(calls.len());
        for call in calls {
            if call["type"] != "function"
                || !call["id"].is_string()
                || !call["function"]["name"].is_string()
                || !call["function"]["arguments"].is_string()
            {
                return Err(());
            }
            sanitized.push(json!({"id":call["id"],"type":"function","function":{"name":call["function"]["name"],"arguments":call["function"]["arguments"]}}));
        }
        safe["tool_calls"] = json!(sanitized);
    }
    let reason = choice["finish_reason"].as_str().unwrap_or("stop");
    if !["stop", "length", "tool_calls", "content_filter"].contains(&reason) {
        return Err(());
    }
    Ok(json!([{"index":0,"message":safe,"finish_reason":reason}]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_policy_requires_allowlisted_model_and_dedicated_tracking_secret() {
        let key = "synthetic-customer-hmac-key-at-least-32-bytes";
        assert!(Policy::new("unchecked", vec!["checked".into()], true, Some(key.into())).is_err());
        assert!(Policy::new("checked", vec!["checked".into()], true, None).is_err());
        assert!(Policy::new(
            "checked",
            vec!["checked".into()],
            true,
            Some("short".into())
        )
        .is_err());
        let policy =
            Policy::new("checked", vec!["checked".into()], true, Some(key.into())).unwrap();
        assert!(policy.check_model("unchecked").is_err());
        assert_eq!(
            policy.user(Uuid::nil()).unwrap(),
            "colony_641adf8cc2c788e3dbe39731bfceb1bc0100274205a1a2f1caf32271063511a6"
        );
        let account = Uuid::new_v4();
        assert_eq!(policy.user(account).unwrap(), policy.user(account).unwrap());
        assert_ne!(
            policy.user(account).unwrap(),
            policy.user(Uuid::new_v4()).unwrap()
        );
        let replacement = Policy::new(
            "checked",
            vec!["checked".into()],
            true,
            Some(format!("different-{key}")),
        )
        .unwrap();
        assert_ne!(
            policy.user(account).unwrap(),
            replacement.user(account).unwrap()
        );
        assert!(!policy.user(account).unwrap().contains(&account.to_string()));
    }
}
