use std::{collections::BTreeMap, fmt, str};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MANIFEST_JSON: &str = include_str!("../../electron-stage0-manifest.json");
pub const FRAME_PREFIX: &str = "@colony-native:";
pub const FALLBACK_RELAY_URL: &str = "ws://localhost:3000";
pub const EXPECTED_REGISTRY_DIGEST: &str =
    "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49";
pub const MAX_ID_BYTES: usize = 128;
pub const TEST_DEADLINE_ENV: &str = "COLONY_STAGE0_TEST_DEADLINE_MS";

const EXPECTED_PROFILE_ID: &str = "0000000000000001";
const EXPECTED_FAULTS: [&str; 4] = [
    "host-unavailable",
    "exit-before-ready",
    "malformed-frame",
    "delay-response",
];
const EXPECTED_FRAMES: [&str; 8] = [
    "HELLO", "READY", "REHELLO", "REBOUND", "REQUEST", "RESPONSE", "EVENT", "CANCEL",
];

#[derive(Debug)]
pub enum ProtocolError {
    InvalidManifest(&'static str),
    FrameTooLarge,
    JsonTooLarge,
    InvalidUtf8,
    MissingPrefix,
    EmptyJson,
    JsonTooDeep,
    InvalidJson,
    MissingField(&'static str),
    InvalidField(&'static str),
    UnknownFrame,
    WrongBinding,
    Closed,
    OutputTooLarge,
    Serialization,
    Io,
}

impl ProtocolError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidManifest(_) => "invalid_manifest",
            Self::FrameTooLarge => "frame_too_large",
            Self::JsonTooLarge => "json_too_large",
            Self::InvalidUtf8 => "invalid_utf8",
            Self::MissingPrefix => "invalid_prefix",
            Self::EmptyJson => "invalid_json",
            Self::JsonTooDeep => "json_too_deep",
            Self::InvalidJson => "invalid_json",
            Self::MissingField(_) => "missing_field",
            Self::InvalidField(_) => "invalid_field",
            Self::UnknownFrame => "unknown_frame",
            Self::WrongBinding => "wrong_binding",
            Self::Closed => "host_unavailable",
            Self::OutputTooLarge => "outbound_too_large",
            Self::Serialization => "serialization_error",
            Self::Io => "io_error",
        }
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub namespace: Namespace,
    pub protocol: ProtocolLimits,
    pub fault_inputs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Namespace {
    pub profile_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolLimits {
    pub version: u64,
    pub frame_prefix: String,
    pub frame_limit_bytes: usize,
    pub json_payload_limit_bytes: usize,
    pub json_depth_limit: usize,
    pub binary_payload_limit_bytes: usize,
    pub in_flight_limit: usize,
    pub outbound_queue_limit: usize,
    pub default_deadline_ms: u64,
    pub shutdown_grace_ms: u64,
    pub rebind_ack_deadline_ms: u64,
    pub registry_digest: String,
    pub registry: BTreeMap<String, RegistryEntry>,
    pub frames: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RegistryEntry {
    pub request: String,
    pub event: String,
}

pub fn load_manifest() -> Result<Manifest, ProtocolError> {
    let manifest: Manifest =
        serde_json::from_str(MANIFEST_JSON).map_err(|_| ProtocolError::InvalidManifest("json"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn validate_manifest(manifest: &Manifest) -> Result<(), ProtocolError> {
    let protocol = &manifest.protocol;
    if manifest.namespace.profile_id != EXPECTED_PROFILE_ID {
        return Err(ProtocolError::InvalidManifest("profile_id"));
    }
    if protocol.version != 1 {
        return Err(ProtocolError::InvalidManifest("version"));
    }
    if protocol.frame_prefix != FRAME_PREFIX {
        return Err(ProtocolError::InvalidManifest("frame_prefix"));
    }
    if protocol.frame_limit_bytes != 16_777_216
        || protocol.json_payload_limit_bytes != 8_388_608
        || protocol.json_depth_limit != 32
        || protocol.binary_payload_limit_bytes != 8_388_608
        || protocol.in_flight_limit != 128
        || protocol.outbound_queue_limit != 64
        || protocol.default_deadline_ms != 10_000
        || protocol.shutdown_grace_ms != 250
        || protocol.rebind_ack_deadline_ms != 10_000
    {
        return Err(ProtocolError::InvalidManifest("limits"));
    }
    if protocol.registry_digest != EXPECTED_REGISTRY_DIGEST {
        return Err(ProtocolError::InvalidManifest("registry_digest"));
    }
    if protocol.frames
        != EXPECTED_FRAMES
            .iter()
            .map(|frame| (*frame).to_string())
            .collect::<Vec<_>>()
    {
        return Err(ProtocolError::InvalidManifest("frames"));
    }
    let health = protocol
        .registry
        .get("health-safe")
        .ok_or(ProtocolError::InvalidManifest("health-safe"))?;
    if health.request != "get_default_relay_url" || health.event != "host_lifecycle" {
        return Err(ProtocolError::InvalidManifest("health-safe"));
    }
    if manifest.fault_inputs
        != EXPECTED_FAULTS
            .iter()
            .map(|fault| (*fault).to_string())
            .collect::<Vec<_>>()
    {
        return Err(ProtocolError::InvalidManifest("fault_inputs"));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub protocol_version: u64,
    pub profile_id: String,
    pub session_id: String,
    pub generation_id: u64,
    #[serde(default)]
    pub build_id: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub capability: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboundFrame {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub protocol_version: u64,
    pub profile_id: String,
    pub session_id: String,
    pub generation_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub profile_id: String,
    pub session_id: String,
    pub generation_id: u64,
}

impl Binding {
    pub fn from_envelope(envelope: &Envelope) -> Result<Self, ProtocolError> {
        validate_id(&envelope.profile_id, "profile_id")?;
        validate_id(&envelope.session_id, "session_id")?;
        if envelope.generation_id == 0 {
            return Err(ProtocolError::InvalidField("generation_id"));
        }
        Ok(Self {
            profile_id: envelope.profile_id.clone(),
            session_id: envelope.session_id.clone(),
            generation_id: envelope.generation_id,
        })
    }

    pub fn matches(&self, envelope: &Envelope) -> bool {
        self.profile_id == envelope.profile_id && self.session_id == envelope.session_id
    }
}

pub fn decode_frame(frame: &[u8], limits: &ProtocolLimits) -> Result<Envelope, ProtocolError> {
    if frame
        .len()
        .checked_add(1)
        .is_none_or(|length| length > limits.frame_limit_bytes)
    {
        return Err(ProtocolError::FrameTooLarge);
    }
    let frame_text = str::from_utf8(frame).map_err(|_| ProtocolError::InvalidUtf8)?;
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
    let envelope: Envelope =
        serde_json::from_str(json_text).map_err(|_| ProtocolError::InvalidJson)?;
    if envelope.frame_type.is_empty() || envelope.frame_type.len() > MAX_ID_BYTES {
        return Err(ProtocolError::InvalidField("type"));
    }
    if envelope.protocol_version != limits.version {
        return Err(ProtocolError::InvalidField("protocol_version"));
    }
    Binding::from_envelope(&envelope)?;
    if let Some(request_id) = &envelope.request_id {
        validate_id(request_id, "request_id")?;
    }
    if envelope
        .build_id
        .as_ref()
        .is_some_and(|build_id| build_id.len() > MAX_ID_BYTES)
    {
        return Err(ProtocolError::InvalidField("build_id"));
    }
    Ok(envelope)
}

pub fn encode_frame(
    frame: &OutboundFrame,
    limits: &ProtocolLimits,
) -> Result<Vec<u8>, ProtocolError> {
    let json = serde_json::to_vec(frame).map_err(|_| ProtocolError::Serialization)?;
    if json.len() > limits.json_payload_limit_bytes {
        return Err(ProtocolError::OutputTooLarge);
    }
    let total_len = limits
        .frame_prefix
        .len()
        .checked_add(json.len())
        .and_then(|length| length.checked_add(1))
        .ok_or(ProtocolError::OutputTooLarge)?;
    if total_len > limits.frame_limit_bytes {
        return Err(ProtocolError::OutputTooLarge);
    }
    let mut output = Vec::with_capacity(total_len);
    output.extend_from_slice(limits.frame_prefix.as_bytes());
    output.extend_from_slice(&json);
    output.push(b'\n');
    Ok(output)
}

pub fn validate_id(value: &str, field: &'static str) -> Result<(), ProtocolError> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(ProtocolError::InvalidField(field));
    }
    Ok(())
}

pub fn json_depth_exceeds(input: &[u8], max_depth: usize) -> bool {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for byte in input {
        if in_string {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match *byte {
            b'"' => in_string = true,
            b'{' | b'[' => {
                depth = depth.saturating_add(1);
                if depth > max_depth {
                    return true;
                }
            }
            b'}' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    false
}
