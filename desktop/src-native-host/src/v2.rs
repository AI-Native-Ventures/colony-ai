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
    "1032c9f29dee5495099ebf951133bf3cf80c144e39476af39bb67fe62dee3565";
pub const PRODUCTION_REGISTRY_DIGEST: &str =
    "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";

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
const STORAGE_VALUES: [&str; 4] = ["ephemeral", "system-keyring", "local-file", "environment"];
const V2_ERROR_CODES: [&str; 12] = [
    "cancelled",
    "duplicate_request_id",
    "future_generation",
    "host_busy",
    "host_unavailable",
    "identity_unavailable",
    "invalid_payload",
    "renderer_rebound",
    "stale_generation",
    "timeout",
    "unknown_capability",
    "unknown_method",
];

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
    #[serde(default)]
    pub identity_manifest_digest: Option<String>,
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
            if let Some(digest) = frame.identity_launch.identity_manifest_digest.as_deref() {
                validate_digest(digest, "identity_manifest_digest")?;
            }
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

fn validate_digest(value: &str, field: &'static str) -> Result<(), ProtocolError> {
    if value.len() != 64 || value.bytes().any(|byte| !byte.is_ascii_hexdigit()) {
        return Err(ProtocolError::InvalidField(field));
    }
    Ok(())
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
    ready_frame_for(binding, false)
}

pub fn ready_frame_for(binding: &Binding, production: bool) -> OutboundFrame {
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
        registry_digest: Some(registry_digest_for(production)),
    }
}

pub fn rebound_frame(binding: &Binding) -> OutboundFrame {
    rebound_frame_for(binding, false)
}

pub fn rebound_frame_for(binding: &Binding, production: bool) -> OutboundFrame {
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
        registry_digest: Some(registry_digest_for(production)),
    }
}

pub fn lifecycle_frame(binding: &Binding, sequence: u64, state: &str) -> OutboundFrame {
    lifecycle_frame_for(binding, sequence, state, false)
}

pub fn lifecycle_frame_for(
    binding: &Binding,
    sequence: u64,
    state: &str,
    production: bool,
) -> OutboundFrame {
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
        registry_digest: Some(registry_digest_for(production)),
    }
}

pub fn response_frame(
    binding: &Binding,
    request_id: String,
    outcome: &str,
    payload: Option<Value>,
    error_code: Option<&str>,
) -> OutboundFrame {
    response_frame_for(binding, request_id, outcome, payload, error_code, false)
}

pub fn response_frame_for(
    binding: &Binding,
    request_id: String,
    outcome: &str,
    payload: Option<Value>,
    error_code: Option<&str>,
    production: bool,
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
        registry_digest: Some(registry_digest_for(production)),
    }
}

/// Validate the canonical registry's references and schema metadata.
///
/// This is intentionally a small integrity fence rather than a second
/// protocol description. Every schema used by a frame, entry, or nested
/// payload must resolve, and every field/type declaration consumed by the
/// outbound validator must be structurally valid before a v2 host can start.
pub fn validate_registry_document(document: &Value) -> Result<(), ProtocolError> {
    let root = document
        .as_object()
        .ok_or(ProtocolError::InvalidManifest("v2_registry"))?;
    if root.get("protocolVersion") != Some(&json!(VERSION)) {
        return Err(ProtocolError::InvalidManifest("v2_registry_version"));
    }
    let schemas = root
        .get("schemas")
        .and_then(Value::as_object)
        .ok_or(ProtocolError::InvalidManifest("v2_registry_schemas"))?;
    let mut referenced = HashSet::new();

    let capabilities = root
        .get("capabilities")
        .and_then(Value::as_object)
        .and_then(|capabilities| capabilities.get("ready"))
        .and_then(Value::as_array)
        .ok_or(ProtocolError::InvalidManifest("v2_registry_capabilities"))?;
    ensure_unique_strings(capabilities, "v2_registry_capabilities")?;

    let mut require_schema = |value: &Value, field: &'static str| -> Result<(), ProtocolError> {
        let schema_id = value
            .as_str()
            .ok_or(ProtocolError::InvalidManifest(field))?;
        if !schemas.contains_key(schema_id) {
            return Err(ProtocolError::InvalidManifest(field));
        }
        referenced.insert(schema_id.to_string());
        Ok(())
    };

    let frame_schemas = root
        .get("frameSchemas")
        .and_then(Value::as_object)
        .ok_or(ProtocolError::InvalidManifest("v2_registry_frames"))?;
    for schema_id in frame_schemas.values() {
        require_schema(schema_id, "v2_registry_frame_schema")?;
    }

    let outbound = root
        .get("outbound")
        .and_then(Value::as_object)
        .ok_or(ProtocolError::InvalidManifest("v2_registry_outbound"))?;
    for entry in outbound.values() {
        let entry = entry
            .as_object()
            .ok_or(ProtocolError::InvalidManifest("v2_registry_outbound_entry"))?;
        if let Some(schema) = entry.get("schema") {
            require_schema(schema, "v2_registry_outbound_schema")?;
        }
        for field in ["capabilities", "states"] {
            if let Some(values) = entry.get(field).and_then(Value::as_array) {
                ensure_unique_strings(values, "v2_registry_outbound_values")?;
            }
        }
    }

    let entries = root
        .get("entries")
        .and_then(Value::as_object)
        .ok_or(ProtocolError::InvalidManifest("v2_registry_entries"))?;
    for entry in entries.values() {
        let entry = entry
            .as_object()
            .ok_or(ProtocolError::InvalidManifest("v2_registry_entry"))?;
        for field in ["requestSchema", "responseSchema", "eventSchema"] {
            let schema = entry
                .get(field)
                .ok_or(ProtocolError::InvalidManifest(field))?;
            require_schema(schema, field)?;
        }
    }

    for schema in schemas.values() {
        let schema = schema
            .as_object()
            .ok_or(ProtocolError::InvalidManifest("v2_registry_schema"))?;
        let fields = schema
            .get("fields")
            .and_then(Value::as_array)
            .ok_or(ProtocolError::InvalidManifest("v2_registry_fields"))?;
        ensure_unique_strings(fields, "v2_registry_fields")?;
        let field_names = fields
            .iter()
            .map(|field| {
                field
                    .as_str()
                    .ok_or(ProtocolError::InvalidManifest("v2_registry_fields"))
            })
            .collect::<Result<HashSet<_>, _>>()?;
        let required = schema
            .get("required")
            .and_then(Value::as_array)
            .ok_or(ProtocolError::InvalidManifest("v2_registry_required"))?;
        ensure_unique_strings(required, "v2_registry_required")?;
        for field in required {
            let field = field
                .as_str()
                .ok_or(ProtocolError::InvalidManifest("v2_registry_required"))?;
            if !field_names.contains(field) {
                return Err(ProtocolError::InvalidManifest("v2_registry_required"));
            }
        }
        if let Some(types) = schema.get("types").and_then(Value::as_object) {
            for (field, type_name) in types {
                if !field_names.contains(field.as_str())
                    || !matches!(
                        type_name.as_str(),
                        Some("array" | "boolean" | "integer" | "number" | "object" | "string")
                    )
                {
                    return Err(ProtocolError::InvalidManifest("v2_registry_types"));
                }
            }
        }
        for key in ["enums", "exactArrays"] {
            if let Some(values) = schema.get(key).and_then(Value::as_object) {
                for (field, values) in values {
                    if !field_names.contains(field.as_str())
                        || !values.is_array()
                        || values.as_array().is_some_and(|values| values.is_empty())
                    {
                        return Err(ProtocolError::InvalidManifest("v2_registry_values"));
                    }
                    if key == "enums" {
                        ensure_unique_values(values, "v2_registry_enum")?;
                    }
                }
            }
        }
        if let Some(schema_id) = schema.get("payloadSchema") {
            require_schema(schema_id, "v2_registry_payload_schema")?;
        }
        if let Some(schema_ids) = schema.get("payloadSchemas") {
            let schema_ids = schema_ids.as_array().ok_or(ProtocolError::InvalidManifest(
                "v2_registry_payload_schemas",
            ))?;
            ensure_unique_strings(schema_ids, "v2_registry_payload_schemas")?;
            for schema_id in schema_ids {
                require_schema(schema_id, "v2_registry_payload_schema")?;
            }
        }
        if let Some(schema_id) = schema.get("errorSchema") {
            require_schema(schema_id, "v2_registry_error_schema")?;
        }
        if let Some(nested) = schema.get("nestedSchemas").and_then(Value::as_object) {
            for schema_id in nested.values() {
                require_schema(schema_id, "v2_registry_nested_schema")?;
            }
        }
    }

    let schema_ids = schemas.keys().cloned().collect::<HashSet<_>>();
    if referenced != schema_ids {
        return Err(ProtocolError::InvalidManifest("v2_registry_references"));
    }
    Ok(())
}

fn ensure_unique_strings(values: &[Value], field: &'static str) -> Result<(), ProtocolError> {
    let mut seen = HashSet::new();
    for value in values {
        let value = value
            .as_str()
            .ok_or(ProtocolError::InvalidManifest(field))?;
        if !seen.insert(value) {
            return Err(ProtocolError::InvalidManifest(field));
        }
    }
    Ok(())
}

fn ensure_unique_values(values: &Value, field: &'static str) -> Result<(), ProtocolError> {
    let values = values
        .as_array()
        .ok_or(ProtocolError::InvalidManifest(field))?;
    for (index, value) in values.iter().enumerate() {
        if values[..index].contains(value) {
            return Err(ProtocolError::InvalidManifest(field));
        }
    }
    Ok(())
}

pub fn validate_registry() -> Result<(), ProtocolError> {
    validate_registry_for(false)
}

pub fn validate_registry_for(production: bool) -> Result<(), ProtocolError> {
    let document = registry_document_for(production);
    validate_registry_document(&document)?;
    if digest_for_document(&document) != registry_digest_for(production) {
        return Err(ProtocolError::RegistryMismatch);
    }
    Ok(())
}

fn schema<'a>(
    document: &'a Value,
    schema_id: &str,
) -> Result<&'a serde_json::Map<String, Value>, ProtocolError> {
    document
        .get("schemas")
        .and_then(Value::as_object)
        .and_then(|schemas| schemas.get(schema_id))
        .and_then(Value::as_object)
        .ok_or(ProtocolError::InvalidManifest("v2_registry_schema"))
}

fn validate_value_schema(
    value: &Value,
    schema_id: &str,
    document: &Value,
) -> Result<(), ProtocolError> {
    let schema = schema(document, schema_id)?;
    let object = value.as_object().ok_or(ProtocolError::Serialization)?;
    let fields = schema
        .get("fields")
        .and_then(Value::as_array)
        .ok_or(ProtocolError::Serialization)?;
    let allowed = fields
        .iter()
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();
    if object.keys().any(|field| !allowed.contains(field.as_str())) {
        return Err(ProtocolError::Serialization);
    }
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .ok_or(ProtocolError::Serialization)?;
    if required
        .iter()
        .filter_map(Value::as_str)
        .any(|field| !object.contains_key(field))
    {
        return Err(ProtocolError::Serialization);
    }
    if let Some(types) = schema.get("types").and_then(Value::as_object) {
        for (field, type_name) in types {
            let Some(value) = object.get(field) else {
                continue;
            };
            let valid = match type_name.as_str() {
                Some("array") => value.is_array(),
                Some("boolean") => value.is_boolean(),
                Some("integer") => value.as_i64().is_some() || value.as_u64().is_some(),
                Some("number") => value.is_number(),
                Some("object") => value.is_object(),
                Some("string") => value.is_string(),
                _ => false,
            };
            if !valid {
                return Err(ProtocolError::Serialization);
            }
        }
    }
    if let Some(enums) = schema.get("enums").and_then(Value::as_object) {
        for (field, allowed_values) in enums {
            let value = object.get(field).ok_or(ProtocolError::Serialization)?;
            let allowed_values = allowed_values
                .as_array()
                .ok_or(ProtocolError::Serialization)?;
            if !allowed_values.contains(value) {
                return Err(ProtocolError::Serialization);
            }
        }
    }
    if let Some(exact_arrays) = schema.get("exactArrays").and_then(Value::as_object) {
        for (field, expected) in exact_arrays {
            if object.get(field) != Some(expected) {
                return Err(ProtocolError::Serialization);
            }
        }
    }
    if let Some(payload_schema) = schema.get("payloadSchema").and_then(Value::as_str) {
        let payload = object.get("payload").ok_or(ProtocolError::Serialization)?;
        validate_value_schema(payload, payload_schema, document)?;
    }
    if let Some(nested) = schema.get("nestedSchemas").and_then(Value::as_object) {
        for (field, nested_schema) in nested {
            let nested = nested_schema.as_str().ok_or(ProtocolError::Serialization)?;
            let value = object.get(field).ok_or(ProtocolError::Serialization)?;
            validate_value_schema(value, nested, document)?;
        }
    }
    if let Some(error_schema) = schema.get("errorSchema").and_then(Value::as_str) {
        if let Some(error) = object.get("error") {
            validate_value_schema(error, error_schema, document)?;
        }
    }
    Ok(())
}

fn response_schema_is_declared(document: &Value, schema_id: &str) -> bool {
    document
        .get("schemas")
        .and_then(Value::as_object)
        .and_then(|schemas| schemas.get("response"))
        .and_then(Value::as_object)
        .and_then(|response| response.get("payloadSchemas"))
        .and_then(Value::as_array)
        .is_some_and(|schemas| {
            schemas
                .iter()
                .any(|schema| schema.as_str() == Some(schema_id))
        })
}

/// Validate every v2 outbound frame against the exact schema selected by the
/// pending method. v1 continues to use its existing encoder unchecked here.
pub fn validate_outbound(
    frame: &OutboundFrame,
    response_schema: Option<&str>,
) -> Result<(), ProtocolError> {
    validate_outbound_for_registry(frame, response_schema, false)
}

pub fn validate_outbound_for_registry(
    frame: &OutboundFrame,
    response_schema: Option<&str>,
    production: bool,
) -> Result<(), ProtocolError> {
    validate_registry_for(production)?;
    let document = registry_document_for(production);
    let registry_digest = registry_digest_for(production);
    if frame.protocol_version != VERSION
        || frame.registry_digest.as_deref() != Some(registry_digest.as_str())
    {
        return Err(ProtocolError::RegistryMismatch);
    }
    Binding::from_parts(&frame.profile_id, &frame.session_id, frame.generation_id)?;
    let serialized = serde_json::to_value(frame).map_err(|_| ProtocolError::Serialization)?;
    match frame.frame_type.as_str() {
        "READY" => {
            validate_value_schema(&serialized, "ready", &document)?;
        }
        "REBOUND" => {
            validate_value_schema(&serialized, "rebound", &document)?;
        }
        "EVENT" => {
            validate_value_schema(&serialized, "host-lifecycle-event", &document)?;
            if frame.sequence.is_none_or(|sequence| sequence == 0) {
                return Err(ProtocolError::Serialization);
            }
        }
        "RESPONSE" => {
            validate_value_schema(&serialized, "response", &document)?;
            let request_id = frame
                .request_id
                .as_deref()
                .ok_or(ProtocolError::Serialization)?;
            validate_id(request_id, "request_id")?;
            if frame.event.is_some() || frame.sequence.is_some() {
                return Err(ProtocolError::Serialization);
            }
            match frame.outcome.as_deref() {
                Some("ok") => {
                    if frame.error.is_some() {
                        return Err(ProtocolError::Serialization);
                    }
                    let schema_id = response_schema.ok_or(ProtocolError::Serialization)?;
                    if !response_schema_is_declared(&document, schema_id) {
                        return Err(ProtocolError::Serialization);
                    }
                    let payload = frame.payload.as_ref().ok_or(ProtocolError::Serialization)?;
                    validate_value_schema(payload, schema_id, &document)?;
                }
                Some("error" | "cancelled" | "outcome_unknown") => {
                    if frame.error.is_none() || frame.payload.is_some() {
                        return Err(ProtocolError::Serialization);
                    }
                }
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
        "frameSchemas": {
            "CANCEL": "cancel",
            "EVENT": "host-lifecycle-event",
            "HELLO": "hello",
            "READY": "ready",
            "REBOUND": "rebound",
            "REHELLO": "rehello",
            "REQUEST": "request",
            "RESPONSE": "response"
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
                "nestedSchemas": {"identityLaunch": "identity-launch"},
                "required": ["buildId", "generationId", "identityLaunch", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"]
            },
            "identity-launch": {
                "fields": ["flavor", "identityMode", "platform", "profileId", "resetProvenance", "sharedIdentity", "userDataRoot"],
                "required": ["flavor", "identityMode", "platform", "profileId", "resetProvenance", "sharedIdentity", "userDataRoot"]
            },
            "identity-snapshot": {
                "enums": {"storage": STORAGE_VALUES},
                "fields": ["display_name", "locked", "lost", "pubkey", "reset_failed", "storage"],
                "required": ["display_name", "locked", "lost", "pubkey", "reset_failed", "storage"],
                "types": {
                    "display_name": "string",
                    "locked": "boolean",
                    "lost": "boolean",
                    "pubkey": "string",
                    "reset_failed": "boolean",
                    "storage": "string"
                }
            },
            "host-lifecycle-event": {
                "enums": {"event": ["host_lifecycle"], "type": ["EVENT"]},
                "fields": ["event", "generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sequence", "sessionId", "type"],
                "payloadSchema": "lifecycle-payload",
                "required": ["event", "generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sequence", "sessionId", "type"],
                "types": {
                    "event": "string",
                    "generationId": "integer",
                    "payload": "object",
                    "profileId": "string",
                    "protocolVersion": "integer",
                    "registryDigest": "string",
                    "sequence": "integer",
                    "sessionId": "string",
                    "type": "string"
                }
            },
            "lifecycle-payload": {
                "enums": {"state": LIFECYCLE_STATES},
                "fields": ["state"],
                "required": ["state"],
                "types": {"state": "string"}
            },
            "ready": {
                "enums": {"type": ["READY"]},
                "fields": ["generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "payloadSchema": "ready-payload",
                "required": ["generationId", "payload", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "types": {
                    "generationId": "integer",
                    "payload": "object",
                    "profileId": "string",
                    "protocolVersion": "integer",
                    "registryDigest": "string",
                    "sessionId": "string",
                    "type": "string"
                }
            },
            "ready-payload": {
                "exactArrays": {"capabilities": READY_CAPABILITIES},
                "fields": ["capabilities"],
                "required": ["capabilities"],
                "types": {"capabilities": "array"}
            },
            "rehello": {
                "fields": ["buildId", "generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "required": ["buildId", "generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"]
            },
            "relay-url": {
                "fields": ["relayUrl"],
                "required": ["relayUrl"],
                "types": {"relayUrl": "string"}
            },
            "boolean": {
                "fields": ["value"],
                "required": ["value"],
                "types": {"value": "boolean"}
            },
            "request": {
                "fields": ["capability", "generationId", "method", "payload", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"],
                "required": ["capability", "generationId", "method", "payload", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"]
            },
            "response": {
                "enums": {"outcome": ["cancelled", "error", "ok", "outcome_unknown"], "type": ["RESPONSE"]},
                "errorSchema": "error-envelope",
                "fields": ["error", "generationId", "outcome", "payload", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"],
                "payloadSchemas": ["boolean", "identity-snapshot", "relay-url"],
                "required": ["generationId", "outcome", "profileId", "protocolVersion", "registryDigest", "requestId", "sessionId", "type"],
                "types": {
                    "error": "object",
                    "generationId": "integer",
                    "outcome": "string",
                    "payload": "object",
                    "profileId": "string",
                    "protocolVersion": "integer",
                    "registryDigest": "string",
                    "requestId": "string",
                    "sessionId": "string",
                    "type": "string"
                }
            },
            "error-envelope": {
                "enums": {"code": V2_ERROR_CODES},
                "fields": ["code"],
                "required": ["code"],
                "types": {"code": "string"}
            },
            "rebound": {
                "enums": {"type": ["REBOUND"]},
                "fields": ["generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "required": ["generationId", "profileId", "protocolVersion", "registryDigest", "sessionId", "type"],
                "types": {
                    "generationId": "integer",
                    "profileId": "string",
                    "protocolVersion": "integer",
                    "registryDigest": "string",
                    "sessionId": "string",
                    "type": "string"
                }
            }
        }
    })
}

/// Return the strict production-v2 contract. The B2a test registry remains
/// byte-for-byte stable; production adds only the manifest digest required to
/// bind the trusted carrier to the embedded flavor authority.
pub fn registry_document_for(production: bool) -> Value {
    if !production {
        return registry_document();
    }
    let mut document = registry_document();
    let Some(identity_launch) = document
        .get_mut("schemas")
        .and_then(Value::as_object_mut)
        .and_then(|schemas| schemas.get_mut("identity-launch"))
        .and_then(Value::as_object_mut)
    else {
        return document;
    };
    if let Some(fields) = identity_launch
        .get_mut("fields")
        .and_then(Value::as_array_mut)
    {
        fields.push(json!("identityManifestDigest"));
    }
    if let Some(required) = identity_launch
        .get_mut("required")
        .and_then(Value::as_array_mut)
    {
        required.push(json!("identityManifestDigest"));
    }
    if let Some(types) = identity_launch
        .entry("types")
        .or_insert_with(|| json!({}))
        .as_object_mut()
    {
        types.insert("identityManifestDigest".to_string(), json!("string"));
    }
    document
}

pub fn production_registry_digest() -> String {
    PRODUCTION_REGISTRY_DIGEST.to_string()
}

pub fn registry_digest_for(production: bool) -> String {
    if production {
        production_registry_digest()
    } else {
        REGISTRY_DIGEST.to_string()
    }
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
        canonical_registry_json, digest_for_document, lifecycle_frame, production_registry_digest,
        ready_frame, rebound_frame, registry_digest, registry_document, registry_document_for,
        response_frame, validate_outbound, validate_registry_document, validate_registry_for,
        validate_runtime_limits, PRODUCTION_REGISTRY_DIGEST, REGISTRY_DIGEST,
    };
    use crate::protocol::{load_manifest, Binding};
    use serde_json::json;

    fn binding() -> Binding {
        Binding::from_parts("profile", "session", 1).expect("test binding should be valid")
    }

    #[test]
    fn registry_hash_vector_is_stable() {
        assert!(!canonical_registry_json().is_empty());
        assert_eq!(registry_digest(), REGISTRY_DIGEST);
        assert_eq!(production_registry_digest(), PRODUCTION_REGISTRY_DIGEST);
        validate_registry_for(true).expect("production registry should validate");
        assert_ne!(
            digest_for_document(&registry_document_for(true)),
            REGISTRY_DIGEST
        );
    }

    #[test]
    fn lifecycle_and_capability_mutations_change_the_digest() {
        let mut lifecycle = registry_document();
        lifecycle["schemas"]["lifecycle-payload"]["enums"]["state"][0] = json!("changed");
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

    #[test]
    fn every_registry_reference_resolves_and_unused_schemas_fail_closed() {
        let document = registry_document();
        validate_registry_document(&document).expect("canonical schema references should resolve");

        let mut missing = document.clone();
        missing["schemas"]
            .as_object_mut()
            .expect("schemas should be an object")
            .remove("boolean");
        assert!(validate_registry_document(&missing).is_err());

        let mut missing_relay = registry_document();
        missing_relay["schemas"]
            .as_object_mut()
            .expect("schemas should be an object")
            .remove("relay-url");
        assert!(validate_registry_document(&missing_relay).is_err());

        let mut unused = document;
        unused["schemas"]["unused"] = json!({"fields": [], "required": []});
        assert!(validate_registry_document(&unused).is_err());
    }

    #[test]
    fn every_legitimate_v2_output_matches_its_hashed_shape() {
        let binding = binding();
        validate_outbound(&ready_frame(&binding), None).expect("READY should validate");
        validate_outbound(&rebound_frame(&binding), None).expect("REBOUND should validate");
        validate_outbound(&lifecycle_frame(&binding, 1, "ready"), None)
            .expect("lifecycle event should validate");
        validate_outbound(
            &response_frame(
                &binding,
                "relay-request".to_string(),
                "ok",
                Some(json!({"relayUrl": "ws://localhost:3000"})),
                None,
            ),
            Some("relay-url"),
        )
        .expect("relay response should validate");
        validate_outbound(
            &response_frame(
                &binding,
                "mode-request".to_string(),
                "ok",
                Some(json!({"value": false})),
                None,
            ),
            Some("boolean"),
        )
        .expect("boolean response should validate");
        validate_outbound(
            &response_frame(
                &binding,
                "identity-request".to_string(),
                "ok",
                Some(json!({
                    "display_name": "npub1abc…wxyz",
                    "locked": false,
                    "lost": false,
                    "pubkey": "0123456789abcdef",
                    "reset_failed": false,
                    "storage": "local-file"
                })),
                None,
            ),
            Some("identity-snapshot"),
        )
        .expect("identity response should validate");
        validate_outbound(
            &response_frame(
                &binding,
                "error-request".to_string(),
                "error",
                None,
                Some("timeout"),
            ),
            Some("relay-url"),
        )
        .expect("finite error response should validate");
    }

    #[test]
    fn invalid_outbound_shapes_are_rejected_before_encoding() {
        let binding = binding();

        let mut extra_lifecycle = lifecycle_frame(&binding, 1, "ready");
        extra_lifecycle.payload = Some(json!({"state": "ready", "extra": true}));
        assert!(validate_outbound(&extra_lifecycle, None).is_err());

        let wrong_state = lifecycle_frame(&binding, 1, "stale");
        assert!(validate_outbound(&wrong_state, None).is_err());

        let wrong_relay = response_frame(
            &binding,
            "relay-request".to_string(),
            "ok",
            Some(json!({"relayUrl": false})),
            None,
        );
        assert!(validate_outbound(&wrong_relay, Some("relay-url")).is_err());

        let wrong_boolean = response_frame(
            &binding,
            "mode-request".to_string(),
            "ok",
            Some(json!({"value": "false"})),
            None,
        );
        assert!(validate_outbound(&wrong_boolean, Some("boolean")).is_err());

        let identity_cases = [
            json!({"display_name": "x", "locked": false, "lost": false, "pubkey": "x", "reset_failed": false, "storage": "unknown"}),
            json!({"display_name": "x", "locked": false, "lost": false, "pubkey": null, "reset_failed": false, "storage": "local-file"}),
            json!({"display_name": "x", "locked": false, "lost": false, "pubkey": "x", "reset_failed": false, "storage": "local-file", "private_key": "nsec1secret"}),
        ];
        for payload in identity_cases {
            let frame = response_frame(
                &binding,
                "identity-request".to_string(),
                "ok",
                Some(payload),
                None,
            );
            assert!(validate_outbound(&frame, Some("identity-snapshot")).is_err());
        }

        let error_with_payload = response_frame(
            &binding,
            "error-request".to_string(),
            "error",
            Some(json!({"relayUrl": "ws://localhost:3000"})),
            Some("timeout"),
        );
        assert!(validate_outbound(&error_with_payload, Some("relay-url")).is_err());

        let missing_error =
            response_frame(&binding, "error-request".to_string(), "error", None, None);
        assert!(validate_outbound(&missing_error, Some("relay-url")).is_err());

        let unknown_error = response_frame(
            &binding,
            "error-request".to_string(),
            "error",
            None,
            Some("backend secret: nsec1hidden"),
        );
        assert!(validate_outbound(&unknown_error, Some("relay-url")).is_err());
    }
}
