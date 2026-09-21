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

use crate::protocol::{
    json_depth_exceeds, validate_id, Binding, ErrorBody, OutboundFrame, ProtocolError,
    ProtocolLimits, FRAME_PREFIX,
};

pub const VERSION: u64 = 2;
pub const REGISTRY_DIGEST: &str =
    "ffe911d3ad1f4ad9738148ad293d92c04811f61fc1c9d03cc0f3572853ea295e";

const FRAME_LIMIT_BYTES: usize = 16_777_216;
const JSON_PAYLOAD_LIMIT_BYTES: usize = 8_388_608;
const JSON_DEPTH_LIMIT: usize = 32;
const BINARY_PAYLOAD_LIMIT_BYTES: usize = 8_388_608;
const IN_FLIGHT_LIMIT: usize = 128;
const OUTBOUND_QUEUE_LIMIT: usize = 64;
const DEFAULT_DEADLINE_MS: u64 = 10_000;
const SHUTDOWN_GRACE_MS: u64 = 250;
const REBIND_ACK_DEADLINE_MS: u64 = 10_000;

pub const READY_CAPABILITIES: [&str; 3] = ["health-safe", "identity-mode", "identity-read"];
const LIFECYCLE_STATES: [&str; 2] = ["ready", "rebound"];

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

/// Keep the v2 registry's advertised limits equal to the manifest limits that
/// actually drive framing, parsing, queue admission, and deadlines. This is
/// deliberately checked before a v2 HELLO can initialize identity state.
pub fn validate_runtime_limits(limits: &ProtocolLimits) -> Result<(), ProtocolError> {
    if limits.frame_prefix != FRAME_PREFIX
        || limits.frame_limit_bytes != FRAME_LIMIT_BYTES
        || limits.json_payload_limit_bytes != JSON_PAYLOAD_LIMIT_BYTES
        || limits.json_depth_limit != JSON_DEPTH_LIMIT
        || limits.binary_payload_limit_bytes != BINARY_PAYLOAD_LIMIT_BYTES
        || limits.in_flight_limit != IN_FLIGHT_LIMIT
        || limits.outbound_queue_limit != OUTBOUND_QUEUE_LIMIT
        || limits.default_deadline_ms != DEFAULT_DEADLINE_MS
        || limits.shutdown_grace_ms != SHUTDOWN_GRACE_MS
        || limits.rebind_ack_deadline_ms != REBIND_ACK_DEADLINE_MS
    {
        return Err(ProtocolError::InvalidManifest("v2_limits"));
    }
    Ok(())
}

pub fn ready_capabilities_value() -> Value {
    Value::Array(
        READY_CAPABILITIES
            .iter()
            .map(|capability| Value::String((*capability).to_string()))
            .collect(),
    )
}

pub fn ready_frame(binding: &Binding) -> OutboundFrame {
    OutboundFrame {
        frame_type: "READY".to_string(),
        protocol_version: VERSION,
        profile_id: binding.profile_id.clone(),
        session_id: binding.session_id.clone(),
        generation_id: binding.generation_id,
        request_id: None,
        outcome: None,
        payload: Some(json!({"capabilities": ready_capabilities_value()})),
        error: None,
        event: None,
        sequence: None,
        registry_digest: Some(REGISTRY_DIGEST.to_string()),
    }
}

pub fn rebound_frame(binding: &Binding) -> OutboundFrame {
    OutboundFrame {
        frame_type: "REBOUND".to_string(),
        protocol_version: VERSION,
        profile_id: binding.profile_id.clone(),
        session_id: binding.session_id.clone(),
        generation_id: binding.generation_id,
        request_id: None,
        outcome: None,
        payload: None,
        error: None,
        event: None,
        sequence: None,
        registry_digest: Some(REGISTRY_DIGEST.to_string()),
    }
}

pub fn lifecycle_frame(binding: &Binding, sequence: u64, state: &str) -> OutboundFrame {
    OutboundFrame {
        frame_type: "EVENT".to_string(),
        protocol_version: VERSION,
        profile_id: binding.profile_id.clone(),
        session_id: binding.session_id.clone(),
        generation_id: binding.generation_id,
        request_id: None,
        outcome: None,
        payload: Some(json!({"state": state})),
        error: None,
        event: Some("host_lifecycle".to_string()),
        sequence: Some(sequence),
        registry_digest: Some(REGISTRY_DIGEST.to_string()),
    }
}

pub fn response_frame(
    binding: &Binding,
    request_id: String,
    outcome: &str,
    payload: Option<Value>,
    error_code: Option<&str>,
) -> OutboundFrame {
    OutboundFrame {
        frame_type: "RESPONSE".to_string(),
        protocol_version: VERSION,
        profile_id: binding.profile_id.clone(),
        session_id: binding.session_id.clone(),
        generation_id: binding.generation_id,
        request_id: Some(request_id),
        outcome: Some(outcome.to_string()),
        payload,
        error: error_code.map(|code| ErrorBody {
            code: code.to_string(),
        }),
        event: None,
        sequence: None,
        registry_digest: Some(REGISTRY_DIGEST.to_string()),
    }
}

/// Validate every v2 outbound frame against the same shapes that are hashed
/// in the registry. v1 continues to use its existing encoder unchecked here.
pub fn validate_outbound(frame: &OutboundFrame) -> Result<(), ProtocolError> {
    if frame.protocol_version != VERSION
        || frame.registry_digest.as_deref() != Some(REGISTRY_DIGEST)
    {
        return Err(ProtocolError::RegistryMismatch);
    }
    Binding::from_parts(&frame.profile_id, &frame.session_id, frame.generation_id)?;
    match frame.frame_type.as_str() {
        "READY" => {
            if frame.request_id.is_some()
                || frame.outcome.is_some()
                || frame.error.is_some()
                || frame.event.is_some()
                || frame.sequence.is_some()
                || frame.payload.as_ref()
                    != Some(&json!({"capabilities": ready_capabilities_value()}))
            {
                return Err(ProtocolError::Serialization);
            }
        }
        "REBOUND" => {
            if frame.request_id.is_some()
                || frame.outcome.is_some()
                || frame.payload.is_some()
                || frame.error.is_some()
                || frame.event.is_some()
                || frame.sequence.is_some()
            {
                return Err(ProtocolError::Serialization);
            }
        }
        "EVENT" => {
            let state = frame
                .payload
                .as_ref()
                .and_then(|payload| payload.get("state"))
                .and_then(Value::as_str);
            if frame.request_id.is_some()
                || frame.outcome.is_some()
                || frame.error.is_some()
                || frame.event.as_deref() != Some("host_lifecycle")
                || frame.sequence.is_none_or(|sequence| sequence == 0)
                || !state.is_some_and(|state| LIFECYCLE_STATES.contains(&state))
            {
                return Err(ProtocolError::Serialization);
            }
        }
        "RESPONSE" => {
            let request_id = frame
                .request_id
                .as_deref()
                .ok_or(ProtocolError::Serialization)?;
            validate_id(request_id, "request_id")?;
            if frame.event.is_some() || frame.sequence.is_some() {
                return Err(ProtocolError::Serialization);
            }
            match frame.outcome.as_deref() {
                Some("ok") if frame.error.is_none() => {}
                Some("error" | "cancelled" | "outcome_unknown") if frame.error.is_some() => {}
                _ => return Err(ProtocolError::Serialization),
            }
        }
        _ => return Err(ProtocolError::UnknownFrame),
    }
    Ok(())
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
        "capabilities": {
            "ready": READY_CAPABILITIES
        },
        "entries": {
            "get_default_relay_url": {
                "authorization": "bound-session",
                "binary": false,
                "capability": "health-safe",
                "deadlineClass": "standard",
                "deadlineMs": 10000,
                "direction": "renderer-to-host",
                "eventSchema": "host-lifecycle-event",
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
                "eventSchema": "host-lifecycle-event",
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
                "eventSchema": "host-lifecycle-event",
                "requestSchema": "empty-object",
                "responseSchema": "boolean",
                "sideEffect": "none"
            }
        },
        "limits": {
            "binaryPayloadLimitBytes": BINARY_PAYLOAD_LIMIT_BYTES,
            "defaultDeadlineMs": DEFAULT_DEADLINE_MS,
            "frameLimitBytes": FRAME_LIMIT_BYTES,
            "inFlightLimit": IN_FLIGHT_LIMIT,
            "jsonDepthLimit": JSON_DEPTH_LIMIT,
            "jsonPayloadLimitBytes": JSON_PAYLOAD_LIMIT_BYTES,
            "outboundQueueLimit": OUTBOUND_QUEUE_LIMIT,
            "rebindAckDeadlineMs": REBIND_ACK_DEADLINE_MS,
            "shutdownGraceMs": SHUTDOWN_GRACE_MS
        },
        "outbound": {
            "lifecycleEvent": {
                "event": "host_lifecycle",
                "schema": "host-lifecycle-event",
                "states": LIFECYCLE_STATES
            },
            "ready": {
                "capabilities": READY_CAPABILITIES,
                "schema": "ready"
            },
            "rebound": {"schema": "rebound"}
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
            "host-lifecycle-event": {
                "fields": ["event", "generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sequence", "sessionId", "type"],
                "required": ["event", "generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sequence", "sessionId", "type"],
                "payloadFields": ["state"],
                "states": LIFECYCLE_STATES
            },
            "ready": {
                "fields": ["generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "required": ["generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "payloadFields": ["capabilities"]
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
            },
            "rebound": {
                "fields": ["generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "required": ["generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"]
            }
        }
    })
}

pub fn canonical_registry_json() -> String {
    canonicalize(&registry_document())
}

pub fn registry_digest() -> String {
    digest_for_document(&registry_document())
}

pub fn digest_for_document(document: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonicalize(document).as_bytes());
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
    use super::{
        canonical_registry_json, digest_for_document, registry_digest, registry_document,
        validate_runtime_limits, REGISTRY_DIGEST,
    };
    use crate::protocol::load_manifest;
    use serde_json::json;

    #[test]
    fn registry_hash_vector_is_stable() {
        assert!(!canonical_registry_json().is_empty());
        assert_eq!(registry_digest(), REGISTRY_DIGEST);
    }

    #[test]
    fn lifecycle_and_capability_mutations_change_the_digest() {
        let mut lifecycle = registry_document();
        lifecycle["schemas"]["host-lifecycle-event"]["states"][0] = json!("changed");
        assert_ne!(digest_for_document(&lifecycle), registry_digest());

        let mut capabilities = registry_document();
        capabilities["capabilities"]["ready"][0] = json!("changed");
        assert_ne!(digest_for_document(&capabilities), registry_digest());
    }

    #[test]
    fn runtime_limits_must_match_the_hashed_contract() {
        let mut limits = load_manifest()
            .expect("stage manifest should load")
            .protocol;
        validate_runtime_limits(&limits).expect("manifest limits should match v2");
        limits.in_flight_limit += 1;
        assert!(validate_runtime_limits(&limits).is_err());
    }
}
