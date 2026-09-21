//! Strict, opt-in protocol v2 for the first native identity metadata slice.
//!
//! Protocol v1 intentionally remains in `protocol.rs` unchanged.  This module
//! owns the v2 wire types, duplicate-key rejection, and the canonical registry
//! digest so a future Electron carrier can adopt v2 without changing the
//! health-only v1 contract.

use std::collections::HashSet;

use serde::{
    de::{self, DeserializeSeed, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor},
    Deserialize,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::protocol::{json_depth_exceeds, validate_id, Binding, ProtocolError, ProtocolLimits};

pub const VERSION: u64 = 2;
pub const REGISTRY_DIGEST: &str =
    "a7e63821a0e3fe9bd0e5d32428d12c521d39665dab9749c8d78bd7ba663e6394";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityLaunch {
    pub profile_id: String,
    pub flavor: String,
    pub platform: String,
    pub user_data_root: String,
    pub identity_mode: String,
    pub shared_identity: bool,
    pub reset_provenance: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hello {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub protocol_version: u64,
    pub profile_id: String,
    pub session_id: String,
    pub generation_id: u64,
    pub build_id: String,
    pub registry_digest: String,
    pub identity_launch: IdentityLaunch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rehello {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub protocol_version: u64,
    pub profile_id: String,
    pub session_id: String,
    pub generation_id: u64,
    pub build_id: String,
    pub registry_digest: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub protocol_version: u64,
    pub profile_id: String,
    pub session_id: String,
    pub generation_id: u64,
    pub request_id: String,
    pub capability: String,
    pub method: String,
    pub payload: Value,
    pub registry_digest: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cancel {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub protocol_version: u64,
    pub profile_id: String,
    pub session_id: String,
    pub generation_id: u64,
    pub request_id: String,
    pub registry_digest: String,
}

#[derive(Debug, Clone)]
pub enum Frame {
    Hello(Hello),
    Rehello(Rehello),
    Request(Request),
    Cancel(Cancel),
}

impl Frame {
    pub fn binding_fields(&self) -> (&str, &str, u64) {
        match self {
            Self::Hello(frame) => (&frame.profile_id, &frame.session_id, frame.generation_id),
            Self::Rehello(frame) => (&frame.profile_id, &frame.session_id, frame.generation_id),
            Self::Request(frame) => (&frame.profile_id, &frame.session_id, frame.generation_id),
            Self::Cancel(frame) => (&frame.profile_id, &frame.session_id, frame.generation_id),
        }
    }

    pub fn registry_digest(&self) -> &str {
        match self {
            Self::Hello(frame) => &frame.registry_digest,
            Self::Rehello(frame) => &frame.registry_digest,
            Self::Request(frame) => &frame.registry_digest,
            Self::Cancel(frame) => &frame.registry_digest,
        }
    }

    pub fn binding(&self) -> Result<Binding, ProtocolError> {
        let (profile_id, session_id, generation_id) = self.binding_fields();
        Binding::from_parts(profile_id, session_id, generation_id)
    }
}

/// Decode a strict v2 frame while sharing the v1 framing and resource limits.
pub fn decode(frame: &[u8], limits: &ProtocolLimits) -> Result<Frame, ProtocolError> {
    let json_text = frame_json(frame, limits)?;
    reject_duplicate_keys(json_text.as_bytes())?;
    let value: Value = serde_json::from_str(json_text).map_err(|_| ProtocolError::InvalidJson)?;
    let frame_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or(ProtocolError::MissingField("type"))?;
    let decoded = match frame_type {
        "HELLO" => {
            Frame::Hello(serde_json::from_value(value).map_err(|_| ProtocolError::InvalidJson)?)
        }
        "REHELLO" => {
            Frame::Rehello(serde_json::from_value(value).map_err(|_| ProtocolError::InvalidJson)?)
        }
        "REQUEST" => {
            Frame::Request(serde_json::from_value(value).map_err(|_| ProtocolError::InvalidJson)?)
        }
        "CANCEL" => {
            Frame::Cancel(serde_json::from_value(value).map_err(|_| ProtocolError::InvalidJson)?)
        }
        _ => return Err(ProtocolError::UnknownFrame),
    };
    validate_frame(&decoded)
}

fn validate_frame(frame: &Frame) -> Result<Frame, ProtocolError> {
    let (profile_id, session_id, generation_id) = frame.binding_fields();
    validate_id(profile_id, "profile_id")?;
    validate_id(session_id, "session_id")?;
    if generation_id == 0 {
        return Err(ProtocolError::InvalidField("generation_id"));
    }
    if frame.registry_digest().len() != 64
        || frame
            .registry_digest()
            .bytes()
            .any(|byte| !byte.is_ascii_hexdigit())
    {
        return Err(ProtocolError::InvalidField("registry_digest"));
    }
    match frame {
        Frame::Hello(frame) => {
            if frame.frame_type != "HELLO" || frame.protocol_version != VERSION {
                return Err(ProtocolError::InvalidField("protocol_version"));
            }
            validate_id(&frame.build_id, "build_id")?;
        }
        Frame::Rehello(frame) => {
            if frame.frame_type != "REHELLO" || frame.protocol_version != VERSION {
                return Err(ProtocolError::InvalidField("protocol_version"));
            }
            validate_id(&frame.build_id, "build_id")?;
        }
        Frame::Request(frame) => {
            if frame.frame_type != "REQUEST" || frame.protocol_version != VERSION {
                return Err(ProtocolError::InvalidField("protocol_version"));
            }
            validate_id(&frame.request_id, "request_id")?;
            validate_id(&frame.capability, "capability")?;
            validate_id(&frame.method, "method")?;
        }
        Frame::Cancel(frame) => {
            if frame.frame_type != "CANCEL" || frame.protocol_version != VERSION {
                return Err(ProtocolError::InvalidField("protocol_version"));
            }
            validate_id(&frame.request_id, "request_id")?;
        }
    }
    Ok(frame.clone())
}

fn frame_json<'a>(frame: &'a [u8], limits: &ProtocolLimits) -> Result<&'a str, ProtocolError> {
    if frame
        .len()
        .checked_add(1)
        .is_none_or(|length| length > limits.frame_limit_bytes)
    {
        return Err(ProtocolError::FrameTooLarge);
    }
    let frame_text = std::str::from_utf8(frame).map_err(|_| ProtocolError::InvalidUtf8)?;
    let json_text = frame_text
        .strip_prefix(&limits.frame_prefix)
        .ok_or(ProtocolError::MissingPrefix)?;
    if json_text.is_empty() {
        return Err(ProtocolError::EmptyJson);
    }
    if json_text.len() > limits.json_payload_limit_bytes {
        return Err(ProtocolError::JsonTooLarge);
    }
    if json_depth_exceeds(json_text.as_bytes(), limits.json_depth_limit) {
        return Err(ProtocolError::JsonTooDeep);
    }
    Ok(json_text)
}

/// Return every top-level protocolVersion value, preserving duplicate keys.
/// A frame containing both v1 and v2 markers is routed to strict v2 decoding,
/// which rejects the duplicate instead of silently downgrading.
pub fn root_protocol_versions(
    frame: &[u8],
    limits: &ProtocolLimits,
) -> Result<Vec<u64>, ProtocolError> {
    let json_text = frame_json(frame, limits)?;
    let mut versions = Vec::new();
    let mut deserializer = serde_json::Deserializer::from_slice(json_text.as_bytes());
    RootVersionSeed {
        versions: &mut versions,
    }
    .deserialize(&mut deserializer)
    .map_err(|_| ProtocolError::InvalidJson)?;
    deserializer.end().map_err(|_| ProtocolError::InvalidJson)?;
    Ok(versions)
}

pub fn contains_v2_only_fields(
    frame: &[u8],
    limits: &ProtocolLimits,
) -> Result<bool, ProtocolError> {
    let json_text = frame_json(frame, limits)?;
    let value: Value = serde_json::from_str(json_text).map_err(|_| ProtocolError::InvalidJson)?;
    Ok(value.as_object().is_some_and(|object| {
        object
            .keys()
            .any(|key| matches!(key.as_str(), "identityLaunch" | "registryDigest"))
    }))
}

struct RootVersionSeed<'a> {
    versions: &'a mut Vec<u64>,
}

impl<'de, 'a> DeserializeSeed<'de> for RootVersionSeed<'a> {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(RootVersionVisitor {
            versions: self.versions,
        })
    }
}

struct RootVersionVisitor<'a> {
    versions: &'a mut Vec<u64>,
}

impl<'de, 'a> Visitor<'de> for RootVersionVisitor<'a> {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a protocol frame object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        while let Some(key) = map.next_key::<String>()? {
            if key == "protocolVersion" {
                self.versions.push(map.next_value::<u64>()?);
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(())
    }
}

fn reject_duplicate_keys(raw: &[u8]) -> Result<(), ProtocolError> {
    let mut deserializer = serde_json::Deserializer::from_slice(raw);
    DuplicateSeed
        .deserialize(&mut deserializer)
        .map_err(|_| ProtocolError::InvalidJson)?;
    deserializer.end().map_err(|_| ProtocolError::InvalidJson)
}

struct DuplicateSeed;

impl<'de> DeserializeSeed<'de> for DuplicateSeed {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(DuplicateVisitor)
    }
}

struct DuplicateVisitor;

impl<'de> Visitor<'de> for DuplicateVisitor {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("JSON without duplicate object keys")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut keys = HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !keys.insert(key) {
                return Err(de::Error::custom("duplicate object key"));
            }
            map.next_value_seed(DuplicateSeed)?;
        }
        Ok(())
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while sequence.next_element_seed(DuplicateSeed)?.is_some() {}
        Ok(())
    }

    fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_string<E>(self, _value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        DuplicateSeed.deserialize(deserializer)
    }
}

/// Build the v2 registry document.  The object is intentionally described in
/// data rather than inferred from Rust dispatch so JS can mirror it exactly.
pub fn registry_document() -> Value {
    json!({
        "entries": {
            "get_default_relay_url": {
                "authorization": "bound-session",
                "binary": false,
                "capability": "health-safe",
                "deadlineClass": "standard",
                "deadlineMs": 10000,
                "direction": "renderer-to-host",
                "requestSchema": "empty-object",
                "responseSchema": "relay-url",
                "sideEffect": "none"
            },
            "get_identity": {
                "authorization": "bound-session",
                "binary": false,
                "capability": "identity-read",
                "deadlineClass": "standard",
                "deadlineMs": 10000,
                "direction": "renderer-to-host",
                "requestSchema": "empty-object",
                "responseSchema": "identity-snapshot",
                "sideEffect": "none"
            },
            "is_shared_identity": {
                "authorization": "bound-session",
                "binary": false,
                "capability": "identity-mode",
                "deadlineClass": "standard",
                "deadlineMs": 10000,
                "direction": "renderer-to-host",
                "requestSchema": "empty-object",
                "responseSchema": "boolean",
                "sideEffect": "none"
            }
        },
        "limits": {
            "binaryPayloadLimitBytes": 8388608,
            "frameLimitBytes": 16777216,
            "inFlightLimit": 128,
            "jsonDepthLimit": 32,
            "jsonPayloadLimitBytes": 8388608,
            "outboundQueueLimit": 64,
            "rebindAckDeadlineMs": 10000
        },
        "protocolVersion": 2,
        "schemas": {
            "cancel": {
                "fields": ["generationId", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"],
                "required": ["generationId", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"]
            },
            "empty-object": {"fields": [], "required": []},
            "hello": {
                "fields": ["buildId", "generationId", "identityLaunch", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "required": ["buildId", "generationId", "identityLaunch", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"]
            },
            "identity-launch": {
                "fields": ["flavor", "identityMode", "platform", "profileId", "resetProvenance", "sharedIdentity", "userDataRoot"],
                "required": ["flavor", "identityMode", "platform", "profileId", "resetProvenance", "sharedIdentity", "userDataRoot"]
            },
            "identity-snapshot": {
                "fields": ["display_name", "locked", "lost", "pubkey", "reset_failed", "storage"],
                "required": ["display_name", "locked", "lost", "pubkey", "reset_failed", "storage"]
            },
            "rehello": {
                "fields": ["buildId", "generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "required": ["buildId", "generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"]
            },
            "request": {
                "fields": ["capability", "generationId", "method", "payload", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"],
                "required": ["capability", "generationId", "method", "payload", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"]
            },
            "response": {
                "fields": ["error", "generationId", "outcome", "payload", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"],
                "required": ["generationId", "outcome", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"]
            }
        }
    })
}

pub fn canonical_registry_json() -> String {
    canonicalize(&registry_document())
}

pub fn registry_digest() -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_registry_json().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn canonicalize(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string()),
        Value::Array(values) => {
            let items = values.iter().map(canonicalize).collect::<Vec<_>>();
            format!("[{}]", items.join(","))
        }
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            let items = entries
                .into_iter()
                .map(|(key, value)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string()),
                        canonicalize(value)
                    )
                })
                .collect::<Vec<_>>();
            format!("{{{}}}", items.join(","))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical_registry_json, registry_digest, REGISTRY_DIGEST};

    #[test]
    fn registry_hash_vector_is_stable() {
        assert!(!canonical_registry_json().is_empty());
        assert_eq!(registry_digest(), REGISTRY_DIGEST);
    }
}
