#[cfg(any(feature = "identity-file-only", feature = "identity-system-keyring"))]
mod identity;
#[cfg(any(feature = "identity-file-only", feature = "identity-system-keyring"))]
mod identity_ownership;
mod protocol;
mod relay_transport;
#[allow(dead_code)]
mod relay_v2;
mod v2;

use std::{
    collections::{HashMap, HashSet},
    env,
    io::{self, BufReader, BufWriter, Read, Write},
    process,
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError},
    thread,
    time::{Duration, Instant},
};

use protocol::{
    decode_frame, encode_frame, load_manifest, Binding, Envelope, ErrorBody, IdentityProfiles,
    OutboundFrame, ProtocolError, ProtocolLimits, FALLBACK_RELAY_URL, TEST_DEADLINE_ENV,
};
use relay_transport::{
    relay_host_lifecycle_event, relay_operation_for, RelayHello, RelaySession, TypedInbound,
};
use relay_v2::{ContractError, RequestContext};

const FAULT_ENV: &str = "COLONY_STAGE0_FAULT";
const EXIT_BEFORE_READY_CODE: i32 = 17;
const PROTOCOL_FAILURE_CODE: i32 = 2;
const READER_POLL_MS: u64 = 10;
const MAX_SEEN_REQUEST_IDS_MULTIPLIER: usize = 32;

#[derive(Debug)]
enum ReaderMessage {
    Frame(Vec<u8>),
    Eof,
    Error(ProtocolError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WriterOutcome {
    Drained,
    IoError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WriterSignal {
    FrameStarted,
    Progress,
    FrameComplete,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WriterFailure {
    Io,
    Deadline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LaunchMode {
    HealthOnly,
    IdentityV2Test,
    IdentityV2Derivative,
    IdentityV2Production,
    RelayV2,
}

impl LaunchMode {
    fn is_identity(self) -> bool {
        matches!(
            self,
            Self::IdentityV2Test | Self::IdentityV2Derivative | Self::IdentityV2Production
        )
    }

    fn is_relay(self) -> bool {
        matches!(self, Self::RelayV2)
    }

    fn is_production(self) -> bool {
        matches!(self, Self::IdentityV2Production)
    }

    fn uses_production_schema(self) -> bool {
        matches!(
            self,
            Self::IdentityV2Derivative | Self::IdentityV2Production
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionMode {
    Undecided,
    V1,
    V2,
    RelayV2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingKind {
    V1Health,
    V2Health,
    V2SharedIdentity,
    V2Identity,
    RelayOp,
}

impl PendingKind {
    fn v2_response_schema(self) -> Option<&'static str> {
        match self {
            Self::V1Health => None,
            Self::V2Health => Some("relay-url"),
            Self::V2SharedIdentity => Some("boolean"),
            Self::V2Identity => Some("identity-snapshot"),
            Self::RelayOp => None,
        }
    }
}

enum DecodedFrame {
    V1(Envelope),
    V2(v2::Frame),
}

impl WriterFailure {
    fn protocol_error(self) -> ProtocolError {
        match self {
            Self::Io => ProtocolError::Io,
            Self::Deadline => ProtocolError::WriteTimeout,
        }
    }
}

#[derive(Debug)]
struct PendingRequest {
    binding: Binding,
    deadline: Instant,
    kind: PendingKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FaultMode {
    None,
    DelayResponse,
    HoldResponses,
}

impl FaultMode {
    fn from_environment(launch_mode: LaunchMode) -> Self {
        if launch_mode == LaunchMode::IdentityV2Production {
            return Self::None;
        }
        match env::var(FAULT_ENV).ok().as_deref() {
            Some("delay-response") => Self::DelayResponse,
            Some("hold-responses") if launch_mode == LaunchMode::IdentityV2Test => {
                Self::HoldResponses
            }
            _ => Self::None,
        }
    }
}

struct Host {
    limits: ProtocolLimits,
    expected_profile_id: String,
    identity_manifest_digest: String,
    identity_profiles: IdentityProfiles,
    output: SyncSender<Vec<u8>>,
    binding: Option<Binding>,
    sequence: u64,
    pending: HashMap<String, PendingRequest>,
    seen_request_ids: HashSet<String>,
    delayed_once: bool,
    fault: FaultMode,
    deadline: Duration,
    launch_mode: LaunchMode,
    crash_after_reservation: bool,
    crash_after_b1: bool,
    session_mode: SessionMode,
    relay: Option<RelaySession>,
    #[cfg(any(feature = "identity-file-only", feature = "identity-system-keyring"))]
    identity: Option<identity::IdentityRuntime>,
}

impl Host {
    fn new(
        limits: ProtocolLimits,
        expected_profile_id: String,
        identity_manifest_digest: String,
        identity_profiles: IdentityProfiles,
        fault: FaultMode,
        output: SyncSender<Vec<u8>>,
        launch_mode: LaunchMode,
        crash_after_reservation: bool,
        crash_after_b1: bool,
    ) -> Self {
        let deadline = test_or_manifest_deadline(&limits, launch_mode);
        Self {
            limits,
            expected_profile_id,
            identity_manifest_digest,
            identity_profiles,
            output,
            binding: None,
            sequence: 0,
            pending: HashMap::new(),
            seen_request_ids: HashSet::new(),
            delayed_once: false,
            fault,
            deadline,
            launch_mode,
            crash_after_reservation,
            crash_after_b1,
            session_mode: SessionMode::Undecided,
            relay: None,
            #[cfg(any(feature = "identity-file-only", feature = "identity-system-keyring"))]
            identity: None,
        }
    }

    fn run(
        &mut self,
        receiver: Receiver<ReaderMessage>,
        writer_failures: Receiver<WriterFailure>,
    ) -> Result<(), ProtocolError> {
        loop {
            self.observe_writer_failure(&writer_failures)?;
            if self.session_mode == SessionMode::RelayV2 {
                self.drain_relay_inbox()?;
                self.check_relay_health()?;
            }
            if let Err(error) = self.expire_pending() {
                return self.fail(error);
            }
            match receiver.recv_timeout(Duration::from_millis(READER_POLL_MS)) {
                Ok(ReaderMessage::Frame(bytes)) => {
                    let frame = match decode_any_frame(&bytes, &self.limits) {
                        Ok(frame) => frame,
                        Err(error) => return self.fail(error),
                    };
                    if let Err(error) = self.handle_decoded(frame) {
                        return self.fail(error);
                    }
                }
                Ok(ReaderMessage::Eof) => {
                    return match self.reject_pending("host_unavailable") {
                        Ok(()) => Ok(()),
                        Err(error) => self.fail(error),
                    };
                }
                Ok(ReaderMessage::Error(error)) => return self.fail(error),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    self.observe_writer_failure(&writer_failures)?;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return self.fail(ProtocolError::Io);
                }
            }
        }
    }

    fn observe_writer_failure(
        &mut self,
        writer_failures: &Receiver<WriterFailure>,
    ) -> Result<(), ProtocolError> {
        match writer_failures.try_recv() {
            Ok(failure) => self.fail(failure.protocol_error()),
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => Ok(()),
        }
    }

    fn fail(&mut self, error: ProtocolError) -> Result<(), ProtocolError> {
        // Every fatal parser, dispatch, reader, expiry, or writer failure
        // stops admissions by leaving run(), retires pending health-safe work
        // exactly once, and lets the caller wait for the bounded writer drain.
        // If the pipe is full or broken, some terminal bytes cannot be
        // delivered; those requests are still retired and are never replayed.
        if let Err(cleanup_error) = self.reject_pending("host_unavailable") {
            eprintln!("native host terminal response unavailable: {cleanup_error}");
        }
        Err(error)
    }

    fn handle_decoded(&mut self, frame: DecodedFrame) -> Result<(), ProtocolError> {
        match frame {
            DecodedFrame::V1(envelope) => {
                if self.launch_mode.is_relay() {
                    // RelayV2 is main-selected; the same envelope framing is
                    // dispatched into the relay table with its own profile,
                    // digest, and session mode.
                    if self.session_mode == SessionMode::RelayV2
                        || envelope.frame_type.as_str() == "HELLO"
                    {
                        return self.handle_relay_frame(envelope);
                    }
                    return Err(ProtocolError::WrongBinding);
                }
                if self.launch_mode.is_identity() || self.session_mode == SessionMode::V2 {
                    return Err(ProtocolError::IdentityModeRequired);
                }
                self.session_mode = SessionMode::V1;
                self.handle_v1(envelope)
            }
            DecodedFrame::V2(frame) => {
                if self.launch_mode.is_relay() || !self.launch_mode.is_identity() {
                    return Err(ProtocolError::IdentityModeRequired);
                }
                if self.session_mode == SessionMode::V1 || self.session_mode == SessionMode::RelayV2
                {
                    return Err(ProtocolError::IdentityModeRequired);
                }
                self.session_mode = SessionMode::V2;
                self.handle_v2(frame)
            }
        }
    }

    fn handle_relay_frame(&mut self, envelope: Envelope) -> Result<(), ProtocolError> {
        match envelope.frame_type.as_str() {
            "HELLO" => self.handle_hello_relay(&envelope),
            "REHELLO" => {
                if self.session_mode == SessionMode::RelayV2 {
                    self.handle_rehello_relay(&envelope)
                } else {
                    Err(ProtocolError::WrongBinding)
                }
            }
            "REQUEST" => {
                if self.session_mode == SessionMode::RelayV2 {
                    self.handle_request_relay(&envelope)
                } else {
                    Err(ProtocolError::WrongBinding)
                }
            }
            "CANCEL" => {
                if self.session_mode == SessionMode::RelayV2 {
                    self.handle_cancel(envelope)
                } else {
                    Err(ProtocolError::WrongBinding)
                }
            }
            _ => Err(ProtocolError::UnknownFrame),
        }
    }

    fn handle_v1(&mut self, envelope: Envelope) -> Result<(), ProtocolError> {
        match envelope.frame_type.as_str() {
            "HELLO" => self.handle_hello(envelope),
            "REHELLO" => self.handle_rehello(envelope),
            "REQUEST" => self.handle_request(envelope),
            "CANCEL" => self.handle_cancel(envelope),
            _ => Err(ProtocolError::UnknownFrame),
        }
    }

    fn handle_hello(&mut self, envelope: Envelope) -> Result<(), ProtocolError> {
        if self.binding.is_some() {
            return Err(ProtocolError::WrongBinding);
        }
        let binding = Binding::from_envelope(&envelope)?;
        if binding.profile_id != self.expected_profile_id || binding.generation_id != 1 {
            return Err(ProtocolError::WrongBinding);
        }
        if envelope.build_id.as_deref().is_none_or(str::is_empty) {
            return Err(ProtocolError::MissingField("build_id"));
        }
        self.binding = Some(binding.clone());
        self.send_ready(&binding)?;
        self.sequence = 1;
        self.send_lifecycle(&binding, "ready")
    }

    fn handle_rehello(&mut self, envelope: Envelope) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        if !current.matches(&envelope) || envelope.protocol_version != self.limits.version {
            return Err(ProtocolError::WrongBinding);
        }
        if envelope.generation_id == current.generation_id {
            self.send_rebound(&current)?;
            return Ok(());
        }
        if envelope.generation_id != current.generation_id.saturating_add(1) {
            return Err(ProtocolError::WrongBinding);
        }
        let next = Binding {
            profile_id: current.profile_id,
            session_id: current.session_id,
            generation_id: envelope.generation_id,
        };
        self.reject_pending("renderer_rebound")?;
        self.binding = Some(next.clone());
        self.send_rebound(&next)?;
        self.sequence = self.sequence.saturating_add(1);
        self.send_lifecycle(&next, "rebound")
    }

    fn handle_request(&mut self, envelope: Envelope) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        let request_id = envelope
            .request_id
            .clone()
            .ok_or(ProtocolError::MissingField("request_id"))?;
        if !current.matches(&envelope) {
            return Err(ProtocolError::WrongBinding);
        }
        if envelope.generation_id != current.generation_id {
            let code = if envelope.generation_id < current.generation_id {
                "stale_generation"
            } else {
                "future_generation"
            };
            return self.send_response(&current, request_id, "error", None, Some(code));
        }
        if self.seen_request_ids.contains(&request_id) {
            return self.send_response(
                &current,
                request_id,
                "error",
                None,
                Some("duplicate_request_id"),
            );
        }
        if self.seen_request_ids.len()
            >= self
                .limits
                .in_flight_limit
                .saturating_mul(MAX_SEEN_REQUEST_IDS_MULTIPLIER)
        {
            // A rejected identifier is deliberately not retained. Repeating it
            // remains host_busy, while accepted identifiers stay replay-fenced.
            return self.send_response(&current, request_id, "error", None, Some("host_busy"));
        }
        self.seen_request_ids.insert(request_id.clone());
        if self.pending.len() >= self.limits.in_flight_limit {
            return self.send_response(&current, request_id, "error", None, Some("host_busy"));
        }
        if envelope.capability.as_deref() != Some("health-safe") {
            return self.send_response(
                &current,
                request_id,
                "error",
                None,
                Some("unknown_capability"),
            );
        }
        if envelope.method.as_deref() != Some("get_default_relay_url") {
            return self.send_response(&current, request_id, "error", None, Some("unknown_method"));
        }
        if envelope.payload.as_ref() != Some(&serde_json::json!({})) {
            return self.send_response(
                &current,
                request_id,
                "error",
                None,
                Some("invalid_payload"),
            );
        }

        let pending = PendingRequest {
            binding: current.clone(),
            deadline: Instant::now() + self.deadline,
            kind: PendingKind::V1Health,
        };
        let delayed = match self.fault {
            FaultMode::DelayResponse => !self.delayed_once,
            FaultMode::HoldResponses => true,
            FaultMode::None => false,
        };
        self.delayed_once |= delayed;
        self.pending.insert(request_id.clone(), pending);
        if delayed {
            return Ok(());
        }
        self.complete_ok(&request_id)
    }

    fn handle_cancel(&mut self, envelope: Envelope) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        let request_id = envelope
            .request_id
            .clone()
            .ok_or(ProtocolError::MissingField("request_id"))?;
        if !current.matches(&envelope) {
            return Err(ProtocolError::WrongBinding);
        }
        if envelope.generation_id != current.generation_id {
            return Ok(());
        }
        if let Some(pending) = self.pending.remove(&request_id) {
            self.send_response(
                &pending.binding,
                request_id,
                "cancelled",
                None,
                Some("cancelled"),
            )?;
        }
        Ok(())
    }

    fn complete_ok(&mut self, request_id: &str) -> Result<(), ProtocolError> {
        let pending = self
            .pending
            .remove(request_id)
            .ok_or(ProtocolError::Closed)?;
        match pending.kind {
            // Relay ops always complete inline through the relay dispatcher,
            // so reaching here means a logic defect; fail closed loudly.
            // Cancel/expiry races drain through this arm with outcome
            // forwarding instead of the normal completed-ok path.
            PendingKind::RelayOp => {
                return self.send_response(
                    &pending.binding,
                    request_id.to_string(),
                    "error",
                    None,
                    Some("host_unavailable"),
                );
            }
            PendingKind::V1Health => {
                let relay_url = configured_relay_url();
                self.send_response(
                    &pending.binding,
                    request_id.to_string(),
                    "ok",
                    Some(serde_json::json!({"relayUrl": relay_url})),
                    None,
                )
            }
            PendingKind::V2Health => self.send_response_v2_with_schema(
                &pending.binding,
                request_id.to_string(),
                "ok",
                Some(serde_json::json!({"relayUrl": configured_relay_url()})),
                None,
                pending.kind.v2_response_schema(),
            ),
            PendingKind::V2SharedIdentity => {
                #[cfg(any(feature = "identity-file-only", feature = "identity-system-keyring"))]
                let shared = self
                    .identity
                    .as_ref()
                    .ok_or(ProtocolError::IdentityInitializationFailed)?
                    .is_shared_identity();
                #[cfg(not(any(
                    feature = "identity-file-only",
                    feature = "identity-system-keyring"
                )))]
                let shared = false;
                self.send_response_v2_with_schema(
                    &pending.binding,
                    request_id.to_string(),
                    "ok",
                    Some(serde_json::json!({"value": shared})),
                    None,
                    pending.kind.v2_response_schema(),
                )
            }
            PendingKind::V2Identity => {
                #[cfg(any(feature = "identity-file-only", feature = "identity-system-keyring"))]
                {
                    let identity = self
                        .identity
                        .as_ref()
                        .ok_or(ProtocolError::IdentityInitializationFailed)?;
                    let snapshot = identity.snapshot();
                    let payload = serde_json::json!({
                        "pubkey": snapshot.pubkey.clone(),
                        "display_name": snapshot.display_name.clone(),
                        "storage": snapshot.storage.clone(),
                        "lost": snapshot.lost,
                        "locked": snapshot.locked,
                        "reset_failed": snapshot.reset_failed,
                    });
                    return self.send_response_v2_with_schema(
                        &pending.binding,
                        request_id.to_string(),
                        "ok",
                        Some(payload),
                        None,
                        pending.kind.v2_response_schema(),
                    );
                }
                #[cfg(not(any(
                    feature = "identity-file-only",
                    feature = "identity-system-keyring"
                )))]
                {
                    self.send_response_v2(
                        &pending.binding,
                        request_id.to_string(),
                        "error",
                        None,
                        Some("identity_unavailable"),
                    )
                }
            }
        }
    }

    fn expire_pending(&mut self) -> Result<(), ProtocolError> {
        let now = Instant::now();
        let expired = self
            .pending
            .iter()
            .filter(|(_, pending)| pending.deadline <= now)
            .map(|(request_id, _)| request_id.clone())
            .collect::<Vec<_>>();
        for request_id in expired {
            if let Some(pending) = self.pending.remove(&request_id) {
                self.send_pending_response(&pending, request_id, "error", None, Some("timeout"))?;
            }
        }
        Ok(())
    }

    fn reject_pending(&mut self, code: &'static str) -> Result<(), ProtocolError> {
        let pending = self.pending.drain().collect::<Vec<_>>();
        for (request_id, request) in pending {
            let outcome = if code == "renderer_rebound" {
                "outcome_unknown"
            } else {
                "error"
            };
            self.send_pending_response(&request, request_id, outcome, None, Some(code))?;
        }
        Ok(())
    }

    fn send_pending_response(
        &mut self,
        pending: &PendingRequest,
        request_id: String,
        outcome: &str,
        payload: Option<serde_json::Value>,
        error_code: Option<&str>,
    ) -> Result<(), ProtocolError> {
        match pending.kind {
            PendingKind::V1Health => {
                self.send_response(&pending.binding, request_id, outcome, payload, error_code)
            }
            // Relay ops complete inline with typed responses; this arm only
            // serves cancel/expiry races, which forward their outcome as-is.
            PendingKind::RelayOp => {
                self.send_response(&pending.binding, request_id, outcome, payload, error_code)
            }
            PendingKind::V2Health | PendingKind::V2SharedIdentity | PendingKind::V2Identity => self
                .send_response_v2_with_schema(
                    &pending.binding,
                    request_id,
                    outcome,
                    payload,
                    error_code,
                    pending.kind.v2_response_schema(),
                ),
        }
    }

    fn send_ready(&mut self, binding: &Binding) -> Result<(), ProtocolError> {
        self.write(OutboundFrame {
            frame_type: "READY".to_string(),
            protocol_version: self.limits.version,
            profile_id: binding.profile_id.clone(),
            session_id: binding.session_id.clone(),
            generation_id: binding.generation_id,
            request_id: None,
            outcome: None,
            payload: Some(serde_json::json!({"capabilities": ["health-safe"]})),
            error: None,
            event: None,
            sequence: None,
            registry_digest: Some(self.limits.registry_digest.clone()),
        })
    }

    fn send_rebound(&mut self, binding: &Binding) -> Result<(), ProtocolError> {
        self.write(OutboundFrame {
            frame_type: "REBOUND".to_string(),
            protocol_version: self.limits.version,
            profile_id: binding.profile_id.clone(),
            session_id: binding.session_id.clone(),
            generation_id: binding.generation_id,
            request_id: None,
            outcome: None,
            payload: None,
            error: None,
            event: None,
            sequence: None,
            registry_digest: Some(self.limits.registry_digest.clone()),
        })
    }

    fn send_lifecycle(&mut self, binding: &Binding, state: &str) -> Result<(), ProtocolError> {
        self.write(OutboundFrame {
            frame_type: "EVENT".to_string(),
            protocol_version: self.limits.version,
            profile_id: binding.profile_id.clone(),
            session_id: binding.session_id.clone(),
            generation_id: binding.generation_id,
            request_id: None,
            outcome: None,
            payload: Some(serde_json::json!({"state": state})),
            error: None,
            event: Some("host_lifecycle".to_string()),
            sequence: Some(self.sequence),
            registry_digest: None,
        })
    }

    fn send_response(
        &mut self,
        binding: &Binding,
        request_id: String,
        outcome: &str,
        payload: Option<serde_json::Value>,
        error_code: Option<&str>,
    ) -> Result<(), ProtocolError> {
        self.write(OutboundFrame {
            frame_type: "RESPONSE".to_string(),
            protocol_version: self.limits.version,
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
            registry_digest: None,
        })
    }

    fn send_response_v2(
        &mut self,
        binding: &Binding,
        request_id: String,
        outcome: &str,
        payload: Option<serde_json::Value>,
        error_code: Option<&str>,
    ) -> Result<(), ProtocolError> {
        self.send_response_v2_with_schema(binding, request_id, outcome, payload, error_code, None)
    }

    fn send_response_v2_with_schema(
        &mut self,
        binding: &Binding,
        request_id: String,
        outcome: &str,
        payload: Option<serde_json::Value>,
        error_code: Option<&str>,
        response_schema: Option<&str>,
    ) -> Result<(), ProtocolError> {
        self.write_v2(
            v2::response_frame_for(
                binding,
                request_id,
                outcome,
                payload,
                error_code,
                self.launch_mode.uses_production_schema(),
            ),
            response_schema,
        )
    }

    fn send_ready_v2(&mut self, binding: &Binding) -> Result<(), ProtocolError> {
        self.write_v2(
            v2::ready_frame_for(binding, self.launch_mode.uses_production_schema()),
            None,
        )
    }

    fn send_rebound_v2(&mut self, binding: &Binding) -> Result<(), ProtocolError> {
        self.write_v2(
            v2::rebound_frame_for(binding, self.launch_mode.uses_production_schema()),
            None,
        )
    }

    fn send_lifecycle_v2(&mut self, binding: &Binding, state: &str) -> Result<(), ProtocolError> {
        self.write_v2(
            v2::lifecycle_frame_for(
                binding,
                self.sequence,
                state,
                self.launch_mode.uses_production_schema(),
            ),
            None,
        )
    }

    fn handle_v2(&mut self, frame: v2::Frame) -> Result<(), ProtocolError> {
        v2::validate_runtime_limits(&self.limits)?;
        let production_schema = self.launch_mode.uses_production_schema();
        v2::validate_registry_for(production_schema)?;
        let registry_digest = v2::registry_digest_for(production_schema);
        if frame.registry_digest() != registry_digest.as_str() {
            return Err(ProtocolError::RegistryMismatch);
        }
        match frame {
            v2::Frame::Hello(frame) => self.handle_hello_v2(frame),
            v2::Frame::Rehello(frame) => self.handle_rehello_v2(frame),
            v2::Frame::Request(frame) => self.handle_request_v2(frame),
            v2::Frame::Cancel(frame) => self.handle_cancel_v2(frame),
        }
    }

    fn handle_hello_v2(&mut self, frame: v2::Hello) -> Result<(), ProtocolError> {
        if self.binding.is_some() {
            return Err(ProtocolError::WrongBinding);
        }
        if frame.generation_id != 1 || frame.build_id.is_empty() {
            return Err(ProtocolError::WrongBinding);
        }
        let binding =
            Binding::from_parts(&frame.profile_id, &frame.session_id, frame.generation_id)?;
        if binding.profile_id != frame.identity_launch.profile_id {
            return Err(ProtocolError::IdentityDescriptorRejected);
        }
        let production = self.launch_mode.is_production();
        let derivative = self.launch_mode == LaunchMode::IdentityV2Derivative;
        if frame.identity_launch.identity_manifest_digest.is_some()
            != self.launch_mode.uses_production_schema()
        {
            return Err(ProtocolError::IdentityDescriptorRejected);
        }
        if production && !cfg!(feature = "identity-system-keyring") {
            return Err(ProtocolError::IdentityUnavailable);
        }
        if derivative && !cfg!(feature = "identity-file-only") {
            return Err(ProtocolError::IdentityUnavailable);
        }
        #[cfg(any(feature = "identity-file-only", feature = "identity-system-keyring"))]
        {
            let identity = (if production {
                identity::IdentityRuntime::initialize_production(
                    &frame.identity_launch,
                    &self.identity_profiles,
                    &self.identity_manifest_digest,
                    &frame.build_id,
                    self.crash_after_reservation,
                    self.crash_after_b1,
                )
            } else if derivative {
                identity::IdentityRuntime::initialize_derivative(
                    &frame.identity_launch,
                    &self.identity_profiles,
                    &self.identity_manifest_digest,
                )
            } else {
                identity::IdentityRuntime::initialize_test(&frame.identity_launch)
            })
            .map_err(|error| match error {
                identity::IdentityInitError::DescriptorRejected => {
                    ProtocolError::IdentityDescriptorRejected
                }
                identity::IdentityInitError::ManifestMismatch => {
                    ProtocolError::IdentityManifestMismatch
                }
                identity::IdentityInitError::Unavailable => ProtocolError::IdentityUnavailable,
                identity::IdentityInitError::NamespaceUnverified => {
                    ProtocolError::IdentityNamespaceUnverified
                }
                identity::IdentityInitError::InitializationFailed => {
                    ProtocolError::IdentityInitializationFailed
                }
            })?;
            self.identity = Some(identity);
            self.binding = Some(binding.clone());
            self.sequence = 1;
            self.send_ready_v2(&binding)?;
            self.send_lifecycle_v2(&binding, "ready")
        }
        #[cfg(not(any(feature = "identity-file-only", feature = "identity-system-keyring")))]
        {
            Err(ProtocolError::IdentityUnavailable)
        }
    }

    fn handle_rehello_v2(&mut self, frame: v2::Rehello) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        if !current.matches_parts(&frame.profile_id, &frame.session_id) {
            return Err(ProtocolError::WrongBinding);
        }
        if frame.generation_id == current.generation_id {
            self.send_rebound_v2(&current)?;
            return Ok(());
        }
        if frame.generation_id != current.generation_id.saturating_add(1) {
            return Err(ProtocolError::WrongBinding);
        }
        let next = Binding::from_parts(&frame.profile_id, &frame.session_id, frame.generation_id)?;
        self.reject_pending("renderer_rebound")?;
        self.binding = Some(next.clone());
        self.send_rebound_v2(&next)?;
        self.sequence = self.sequence.saturating_add(1);
        self.send_lifecycle_v2(&next, "rebound")
    }

    fn handle_request_v2(&mut self, frame: v2::Request) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        if !current.matches_parts(&frame.profile_id, &frame.session_id) {
            return Err(ProtocolError::WrongBinding);
        }
        if frame.generation_id != current.generation_id {
            let code = if frame.generation_id < current.generation_id {
                "stale_generation"
            } else {
                "future_generation"
            };
            return self.send_response_v2(&current, frame.request_id, "error", None, Some(code));
        }
        if self.seen_request_ids.contains(&frame.request_id) {
            return self.send_response_v2(
                &current,
                frame.request_id,
                "error",
                None,
                Some("duplicate_request_id"),
            );
        }
        if self.seen_request_ids.len()
            >= self
                .limits
                .in_flight_limit
                .saturating_mul(MAX_SEEN_REQUEST_IDS_MULTIPLIER)
        {
            return self.send_response_v2(
                &current,
                frame.request_id,
                "error",
                None,
                Some("host_busy"),
            );
        }
        self.seen_request_ids.insert(frame.request_id.clone());
        if self.pending.len() >= self.limits.in_flight_limit {
            return self.send_response_v2(
                &current,
                frame.request_id,
                "error",
                None,
                Some("host_busy"),
            );
        }
        let kind = match (frame.capability.as_str(), frame.method.as_str()) {
            ("health-safe", "get_default_relay_url") => PendingKind::V2Health,
            ("identity-mode", "is_shared_identity") => PendingKind::V2SharedIdentity,
            ("identity-read", "get_identity") => PendingKind::V2Identity,
            _ if !matches!(
                frame.capability.as_str(),
                "health-safe" | "identity-mode" | "identity-read"
            ) =>
            {
                return self.send_response_v2(
                    &current,
                    frame.request_id,
                    "error",
                    None,
                    Some("unknown_capability"),
                )
            }
            _ => {
                return self.send_response_v2(
                    &current,
                    frame.request_id,
                    "error",
                    None,
                    Some("unknown_method"),
                )
            }
        };
        if frame.payload != serde_json::json!({}) {
            return self.send_response_v2(
                &current,
                frame.request_id,
                "error",
                None,
                Some("invalid_payload"),
            );
        }
        let request_id = frame.request_id;
        self.pending.insert(
            request_id.clone(),
            PendingRequest {
                binding: current,
                deadline: Instant::now() + self.deadline,
                kind,
            },
        );
        let delayed = match self.fault {
            FaultMode::DelayResponse => !self.delayed_once,
            FaultMode::HoldResponses => true,
            FaultMode::None => false,
        };
        self.delayed_once |= delayed;
        if delayed {
            return Ok(());
        }
        self.complete_ok(&request_id)
    }

    fn handle_cancel_v2(&mut self, frame: v2::Cancel) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        if !current.matches_parts(&frame.profile_id, &frame.session_id) {
            return Err(ProtocolError::WrongBinding);
        }
        if frame.generation_id != current.generation_id {
            return Ok(());
        }
        if let Some(pending) = self.pending.remove(&frame.request_id) {
            self.send_pending_response(
                &pending,
                frame.request_id,
                "cancelled",
                None,
                Some("cancelled"),
            )?;
        }
        Ok(())
    }

    // ---- RelayV2 session (trusted-main selected launch mode) ----
    //
    // The relay surface reuses the V1 envelope framing with a distinct
    // session mode, profile, digest, and op table. Validation runs through
    // the frozen relay registry before any socket dispatch; every execution
    // error answers with a finite redacted code, never a fatal host error.

    fn relay_response(
        &mut self,
        binding: &Binding,
        request_id: String,
        result: Result<serde_json::Value, ContractError>,
    ) -> Result<(), ProtocolError> {
        match result {
            Ok(payload) => self.send_response(binding, request_id, "ok", Some(payload), None),
            Err(error) => {
                self.send_response(binding, request_id, "error", None, Some(error.code()))
            }
        }
    }

    fn send_ready_relay(&mut self, binding: &Binding) -> Result<(), ProtocolError> {
        self.write(OutboundFrame {
            frame_type: "READY".to_string(),
            protocol_version: self.limits.version,
            profile_id: binding.profile_id.clone(),
            session_id: binding.session_id.clone(),
            generation_id: binding.generation_id,
            request_id: None,
            outcome: None,
            payload: Some(
                serde_json::json!({"capabilities": ["relay-transport", "identity-sign"]}),
            ),
            error: None,
            event: None,
            sequence: None,
            registry_digest: Some(relay_v2::REGISTRY_DIGEST.to_string()),
        })
    }

    fn send_host_lifecycle_relay(
        &mut self,
        binding: &Binding,
        state: &str,
        error: Option<&str>,
    ) -> Result<(), ProtocolError> {
        let payload = relay_host_lifecycle_event(binding.generation_id, state, error)
            .map_err(|_| ProtocolError::Serialization)?;
        self.write(OutboundFrame {
            frame_type: "EVENT".to_string(),
            protocol_version: self.limits.version,
            profile_id: binding.profile_id.clone(),
            session_id: binding.session_id.clone(),
            generation_id: binding.generation_id,
            request_id: None,
            outcome: None,
            payload: Some(payload),
            error: None,
            event: Some("host_lifecycle".to_string()),
            sequence: Some(self.sequence),
            registry_digest: None,
        })
    }

    fn send_relay_message_event(
        &mut self,
        binding: &Binding,
        inbound: &TypedInbound,
    ) -> Result<(), ProtocolError> {
        let connection_id = match self
            .relay
            .as_ref()
            .and_then(|session| session.live_connection_id())
        {
            Some(id) => id.to_string(),
            None => return Ok(()),
        };
        let payload = serde_json::json!({
            "connectionId": connection_id,
            "generation": binding.generation_id,
            "messageType": inbound.message_type,
            "payload": inbound.payload,
        });
        self.write(OutboundFrame {
            frame_type: "EVENT".to_string(),
            protocol_version: self.limits.version,
            profile_id: binding.profile_id.clone(),
            session_id: binding.session_id.clone(),
            generation_id: binding.generation_id,
            request_id: None,
            outcome: None,
            payload: Some(payload),
            error: None,
            event: Some("relay_message".to_string()),
            sequence: Some(self.sequence),
            registry_digest: None,
        })
    }

    fn handle_hello_relay(&mut self, envelope: &Envelope) -> Result<(), ProtocolError> {
        if self.binding.is_some() {
            return Err(ProtocolError::WrongBinding);
        }
        let binding = Binding::from_envelope(envelope)?;
        if binding.profile_id != "relay-v2"
            || binding.profile_id != self.expected_profile_id
            || binding.generation_id != 1
        {
            return Err(ProtocolError::WrongBinding);
        }
        if envelope.build_id.as_deref().is_none_or(str::is_empty) {
            return Err(ProtocolError::MissingField("build_id"));
        }
        let descriptor = envelope
            .payload
            .as_ref()
            .ok_or(ProtocolError::MissingField("payload"))?;
        let hello = RelayHello::parse(descriptor).map_err(|_| ProtocolError::WrongBinding)?;
        let service = self
            .identity_profiles
            .for_flavor(&hello.flavor)
            .ok_or(ProtocolError::WrongBinding)?
            .keychain_service
            .clone();
        let session = RelaySession::establish(hello, &service, binding.generation_id)
            .map_err(|_| ProtocolError::IdentityInitializationFailed)?;
        self.binding = Some(binding.clone());
        self.session_mode = SessionMode::RelayV2;
        self.relay = Some(session);
        self.sequence = 1;
        self.send_ready_relay(&binding)?;
        self.send_host_lifecycle_relay(&binding, "ready", None)
    }

    fn handle_rehello_relay(&mut self, envelope: &Envelope) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        if !current.matches(envelope) || envelope.protocol_version != self.limits.version {
            return Err(ProtocolError::WrongBinding);
        }
        if envelope.generation_id == current.generation_id {
            return self.send_rebound_relay(&current);
        }
        if envelope.generation_id != current.generation_id.saturating_add(1) {
            return Err(ProtocolError::WrongBinding);
        }
        let next = Binding {
            profile_id: current.profile_id,
            session_id: current.session_id,
            generation_id: envelope.generation_id,
        };
        self.reject_pending("renderer_rebound")?;
        if let Some(session) = self.relay.as_mut() {
            session.abort_all();
        }
        self.binding = Some(next.clone());
        self.send_rebound_relay(&next)?;
        self.sequence = self.sequence.saturating_add(1);
        self.send_host_lifecycle_relay(&next, "renderer_rebound", None)
    }

    fn send_rebound_relay(&mut self, binding: &Binding) -> Result<(), ProtocolError> {
        self.write(OutboundFrame {
            frame_type: "REBOUND".to_string(),
            protocol_version: self.limits.version,
            profile_id: binding.profile_id.clone(),
            session_id: binding.session_id.clone(),
            generation_id: binding.generation_id,
            request_id: None,
            outcome: None,
            payload: None,
            error: None,
            event: None,
            sequence: None,
            registry_digest: Some(relay_v2::REGISTRY_DIGEST.to_string()),
        })
    }

    fn drain_relay_inbox(&mut self) -> Result<(), ProtocolError> {
        let binding = match self.binding.clone() {
            Some(binding) => binding,
            None => return Ok(()),
        };
        let inbound = match self.relay.as_mut() {
            Some(session) => session.drain_inbox(),
            None => return Ok(()),
        };
        for event in inbound {
            let forward = match event.message_type {
                "EVENT" | "EOSE" => {
                    let subscription = event
                        .payload
                        .get("subscriptionId")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    self.relay
                        .as_ref()
                        .is_some_and(|session| session.is_subscribed(subscription))
                }
                _ => true,
            };
            if !forward {
                continue;
            }
            if event.message_type == "CLOSED" {
                if let Some(subscription) = event
                    .payload
                    .get("subscriptionId")
                    .and_then(|value| value.as_str())
                {
                    let subscription = subscription.to_string();
                    if let Some(session) = self.relay.as_mut() {
                        session.note_relay_closed(&subscription);
                    }
                }
            }
            self.send_relay_message_event(&binding, &event)?;
        }
        Ok(())
    }

    fn check_relay_health(&mut self) -> Result<(), ProtocolError> {
        let failed = match self.relay.as_mut() {
            Some(session) => session.poll_health().err(),
            None => return Ok(()),
        };
        if let Some(error) = failed {
            if let Some(binding) = self.binding.clone() {
                self.send_host_lifecycle_relay(&binding, "relay_failed", Some(error.code()))?;
            }
        }
        Ok(())
    }

    fn handle_request_relay(&mut self, envelope: &Envelope) -> Result<(), ProtocolError> {
        let current = self.binding.clone().ok_or(ProtocolError::WrongBinding)?;
        let request_id = envelope
            .request_id
            .clone()
            .ok_or(ProtocolError::MissingField("request_id"))?;
        if !current.matches(envelope) {
            return Err(ProtocolError::WrongBinding);
        }
        if envelope.generation_id != current.generation_id {
            let code = if envelope.generation_id < current.generation_id {
                "stale_generation"
            } else {
                "future_generation"
            };
            return self.send_response(&current, request_id, "error", None, Some(code));
        }
        if self.seen_request_ids.contains(&request_id) {
            return self.send_response(
                &current,
                request_id,
                "error",
                None,
                Some("duplicate_request_id"),
            );
        }
        if self.seen_request_ids.len()
            >= self
                .limits
                .in_flight_limit
                .saturating_mul(MAX_SEEN_REQUEST_IDS_MULTIPLIER)
        {
            return self.send_response(&current, request_id, "error", None, Some("host_busy"));
        }
        let capability = envelope.capability.as_deref().unwrap_or("");
        let method = envelope.method.as_deref().unwrap_or("");
        let (operation, expected_capability, op_deadline) =
            match relay_operation_for(capability, method) {
                Ok(mapping) => mapping,
                Err(code) => {
                    return self.send_response(&current, request_id, "error", None, Some(code))
                }
            };
        let payload = envelope.payload.clone().unwrap_or(serde_json::Value::Null);
        let authority = match self.relay.as_ref() {
            Some(session) => session.authority_ref().to_string(),
            None => return Err(ProtocolError::Closed),
        };
        let context = RequestContext {
            protocol_version: 2,
            profile: "relay-v2",
            registry_digest: relay_v2::REGISTRY_DIGEST,
            operation,
            capability: expected_capability,
            authority_ref: Some(authority.as_str()),
            connection_id: payload
                .as_object()
                .and_then(|object| object.get("connectionId"))
                .and_then(|value| value.as_str()),
        };
        if let Err(error) = relay_v2::validate_request(&context, &payload) {
            return self.send_response(&current, request_id, "error", None, Some(error.code()));
        }
        self.seen_request_ids.insert(request_id.clone());
        if self.pending.len() >= self.limits.in_flight_limit {
            return self.send_response(&current, request_id, "error", None, Some("host_busy"));
        }
        let backstop = Instant::now() + op_deadline + Duration::from_secs(2);
        self.pending.insert(
            request_id.clone(),
            PendingRequest {
                binding: current.clone(),
                deadline: backstop,
                kind: PendingKind::RelayOp,
            },
        );
        let delayed = match self.fault {
            FaultMode::DelayResponse => !self.delayed_once,
            FaultMode::HoldResponses => true,
            FaultMode::None => false,
        };
        self.delayed_once |= delayed;
        if delayed {
            return Ok(());
        }
        let outcome = self.execute_relay_operation(operation, &payload, &current);
        self.pending.remove(&request_id);
        self.relay_response(&current, request_id, outcome)
    }

    fn execute_relay_operation(
        &mut self,
        operation: &str,
        payload: &serde_json::Value,
        binding: &Binding,
    ) -> Result<serde_json::Value, ContractError> {
        match operation {
            "relay-transport/connect" => {
                // Borrow discipline: complete the blocking dial first, then
                // report lifecycle transitions; holding the session borrow
                // across a &mut self send is a borrow error.
                self.send_host_lifecycle_relay(binding, "relay_connecting", None)
                    .map_err(|_| ContractError::HostUnavailable)?;
                let dialed = match self.relay.as_mut() {
                    Some(session) => session.connect(),
                    None => return Err(ContractError::HostUnavailable),
                };
                match dialed {
                    Ok(connection_id) => {
                        self.send_host_lifecycle_relay(binding, "relay_authenticated", None)
                            .map_err(|_| ContractError::HostUnavailable)?;
                        Ok(serde_json::json!({"connectionId": connection_id}))
                    }
                    Err(error) => {
                        self.send_host_lifecycle_relay(binding, "relay_failed", Some(error.code()))
                            .map_err(|_| ContractError::HostUnavailable)?;
                        Err(error)
                    }
                }
            }
            "relay-transport/authenticate" => {
                let connection_id = match self.relay.as_ref() {
                    Some(session) => session.live_connection_id(),
                    None => return Err(ContractError::HostUnavailable),
                };
                match connection_id {
                    Some(connection_id) => Ok(serde_json::json!({
                        "authenticated": true,
                        "connectionId": connection_id,
                    })),
                    None => Err(ContractError::AuthRequired),
                }
            }
            "relay-transport/subscribe" => {
                let subscription_id = payload
                    .get("subscriptionId")
                    .and_then(|value| value.as_str())
                    .ok_or(ContractError::InvalidPayload)?;
                let filter = payload.get("filter").ok_or(ContractError::InvalidPayload)?;
                let connection_id = match self.relay.as_mut() {
                    Some(session) => {
                        session.subscribe(subscription_id, filter)?;
                        session
                            .live_connection_id()
                            .ok_or(ContractError::AuthRequired)?
                            .to_string()
                    }
                    None => return Err(ContractError::HostUnavailable),
                };
                Ok(serde_json::json!({
                    "connectionId": connection_id,
                    "subscriptionId": subscription_id,
                }))
            }
            "relay-transport/close_subscription" => {
                let subscription_id = payload
                    .get("subscriptionId")
                    .and_then(|value| value.as_str())
                    .ok_or(ContractError::InvalidPayload)?;
                let connection_id = payload
                    .get("connectionId")
                    .and_then(|value| value.as_str())
                    .ok_or(ContractError::InvalidPayload)?;
                match self.relay.as_mut() {
                    Some(session) => session.unsubscribe(subscription_id)?,
                    None => return Err(ContractError::HostUnavailable),
                };
                Ok(serde_json::json!({
                    "connectionId": connection_id,
                    "subscriptionId": subscription_id,
                    "closed": true,
                }))
            }
            "relay-transport/publish" => {
                let handle = payload
                    .get("eventHandle")
                    .and_then(|value| value.as_str())
                    .ok_or(ContractError::InvalidPayload)?;
                let connection_id = payload
                    .get("connectionId")
                    .and_then(|value| value.as_str())
                    .ok_or(ContractError::InvalidPayload)?;
                match self.relay.as_mut() {
                    Some(session) => session.publish(handle)?,
                    None => return Err(ContractError::HostUnavailable),
                };
                Ok(serde_json::json!({
                    "accepted": true,
                    "connectionId": connection_id,
                    "eventHandle": handle,
                }))
            }
            "relay-transport/close" => {
                // The frozen relay-closed schema requires a subscription id;
                // for a whole-connection close the connection id fills it.
                // Responses key off request ids, so this stays unambiguous.
                let connection_id = payload
                    .get("connectionId")
                    .and_then(|value| value.as_str())
                    .ok_or(ContractError::InvalidPayload)?;
                match self.relay.as_mut() {
                    Some(session) => session.close_connection(),
                    None => return Err(ContractError::HostUnavailable),
                };
                Ok(serde_json::json!({
                    "connectionId": connection_id,
                    "subscriptionId": connection_id,
                    "closed": true,
                }))
            }
            "identity-sign/sign_message"
            | "identity-sign/sign_presence"
            | "identity-sign/sign_typing"
            | "identity-sign/sign_user_status" => {
                let (handle, event) = match self.relay.as_mut() {
                    Some(session) => session.sign(operation, payload)?,
                    None => return Err(ContractError::HostUnavailable),
                };
                Ok(serde_json::json!({
                    "eventHandle": handle,
                    "signedEvent": event,
                }))
            }
            _ => Err(ContractError::UnknownOperation),
        }
    }

    fn write(&mut self, frame: OutboundFrame) -> Result<(), ProtocolError> {
        if frame.protocol_version == v2::VERSION {
            return self.write_v2(frame, None);
        }
        let bytes = encode_frame(&frame, &self.limits)?;
        self.output.try_send(bytes).map_err(|error| match error {
            TrySendError::Full(_) => ProtocolError::OutputQueueFull,
            TrySendError::Disconnected(_) => ProtocolError::Io,
        })
    }

    fn write_v2(
        &mut self,
        frame: OutboundFrame,
        response_schema: Option<&str>,
    ) -> Result<(), ProtocolError> {
        v2::validate_outbound_for_registry(
            &frame,
            response_schema,
            self.launch_mode.uses_production_schema(),
        )?;
        let bytes = encode_frame(&frame, &self.limits)?;
        self.output.try_send(bytes).map_err(|error| match error {
            TrySendError::Full(_) => ProtocolError::OutputQueueFull,
            TrySendError::Disconnected(_) => ProtocolError::Io,
        })
    }
}

fn configured_relay_url() -> String {
    // This follows the upstream desktop relay URL contract: a trimmed,
    // non-empty runtime BUZZ_RELAY_URL wins, then the optional build-time
    // override, then the local development default. The host does not open a
    // socket or consult identity state for this health-safe value.
    env::var("BUZZ_RELAY_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| option_env!("BUZZ_DESKTOP_BUILD_RELAY_URL").map(str::to_string))
        .unwrap_or_else(|| FALLBACK_RELAY_URL.to_string())
}

fn decode_any_frame(frame: &[u8], limits: &ProtocolLimits) -> Result<DecodedFrame, ProtocolError> {
    let versions = match v2::root_protocol_versions(frame, limits) {
        Ok(versions) => versions,
        Err(_) => return decode_frame(frame, limits).map(DecodedFrame::V1),
    };
    if versions.contains(&v2::VERSION) {
        v2::decode(frame, limits).map(DecodedFrame::V2)
    } else {
        if v2::contains_v2_only_fields(frame, limits)? {
            return Err(ProtocolError::IdentityModeRequired);
        }
        decode_frame(frame, limits).map(DecodedFrame::V1)
    }
}

fn select_launch_mode(
    test: bool,
    derivative: bool,
    production: bool,
    relay: bool,
) -> Option<LaunchMode> {
    if [test, derivative, production, relay]
        .into_iter()
        .filter(|enabled| *enabled)
        .count()
        > 1
    {
        return None;
    }
    if production {
        Some(LaunchMode::IdentityV2Production)
    } else if derivative {
        Some(LaunchMode::IdentityV2Derivative)
    } else if relay {
        Some(LaunchMode::RelayV2)
    } else if test {
        Some(LaunchMode::IdentityV2Test)
    } else {
        Some(LaunchMode::HealthOnly)
    }
}

fn launch_mode_from_args() -> LaunchMode {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    match select_launch_mode(
        arguments
            .iter()
            .any(|argument| argument == "--identity-v2-test"),
        arguments
            .iter()
            .any(|argument| argument == "--identity-v2-file-test"),
        arguments.iter().any(|argument| argument == "--identity-v2"),
        arguments.iter().any(|argument| argument == "--relay-v2"),
    ) {
        Some(mode) => mode,
        None => {
            eprintln!("native host startup rejected mixed launch modes");
            process::exit(PROTOCOL_FAILURE_CODE);
        }
    }
}

fn crash_controls_from_args(launch_mode: LaunchMode) -> (bool, bool) {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let after_reservation = arguments
        .iter()
        .any(|argument| argument == "--identity-v2-crash-after-reservation");
    let after_b1 = arguments
        .iter()
        .any(|argument| argument == "--identity-v2-crash-after-b1");
    if (after_reservation || after_b1)
        && (launch_mode != LaunchMode::IdentityV2Production
            || !cfg!(feature = "identity-crash-test")
            || (after_reservation && after_b1))
    {
        eprintln!("native host startup rejected invalid identity crash control");
        process::exit(PROTOCOL_FAILURE_CODE);
    }
    (after_reservation, after_b1)
}

fn main() {
    let manifest = match load_manifest() {
        Ok(manifest) => manifest,
        Err(error) => {
            eprintln!("native host startup failed: {error}");
            process::exit(PROTOCOL_FAILURE_CODE);
        }
    };
    let launch_mode = launch_mode_from_args();
    if launch_mode.is_relay() {
        // The relay socket path is the only TLS user in this helper. rustls
        // panics when two providers are visible without an explicit default,
        // so pin exactly one here before any wss dial.
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    }
    let (crash_after_reservation, crash_after_b1) = crash_controls_from_args(launch_mode);
    if launch_mode != LaunchMode::IdentityV2Production {
        match env::var(FAULT_ENV).ok().as_deref() {
            Some("exit-before-ready") => process::exit(EXIT_BEFORE_READY_CODE),
            Some("malformed-frame") => {
                let _ = io::stdout()
                    .write_all(format!("{}{{not-json\n", protocol::FRAME_PREFIX).as_bytes());
                let _ = io::stdout().flush();
                return;
            }
            _ => {}
        }
    }

    let queue_limit = manifest.protocol.outbound_queue_limit;
    let frame_limit = manifest.protocol.frame_limit_bytes;
    let writer_deadline = test_or_manifest_deadline(&manifest.protocol, launch_mode);
    // RelayV2 is main-selected, never renderer-selected: the expected profile
    // is the frozen relay profile, not the manifest identity namespace.
    let expected_profile_id = if launch_mode.is_relay() {
        relay_v2::PROFILE_ID.to_string()
    } else {
        manifest.namespace.profile_id.clone()
    };
    let (input_sender, receiver) = mpsc::sync_channel(queue_limit);
    let (output_sender, output_receiver) = mpsc::sync_channel(queue_limit);
    let (writer_done_sender, writer_done_receiver) = mpsc::channel();
    let (writer_progress_sender, writer_progress_receiver) = mpsc::sync_channel(1);
    let (writer_failure_sender, writer_failure_receiver) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || reader_loop(input_sender, frame_limit));
    let _writer_watchdog = thread::spawn(move || {
        writer_watchdog(
            writer_progress_receiver,
            writer_deadline,
            writer_failure_sender,
        )
    });
    let writer = thread::spawn(move || {
        writer_loop(output_receiver, writer_progress_sender, writer_done_sender)
    });
    let shutdown_grace_ms = manifest.protocol.shutdown_grace_ms;
    let fault = FaultMode::from_environment(launch_mode);
    let identity_manifest_digest = manifest.identity_manifest_digest.clone();
    let identity_profiles = manifest.identity_profiles.clone();
    let mut host = Host::new(
        manifest.protocol,
        expected_profile_id,
        identity_manifest_digest,
        identity_profiles,
        fault,
        output_sender,
        launch_mode,
        crash_after_reservation,
        crash_after_b1,
    );
    let result = host.run(receiver, writer_failure_receiver);
    finish_host(
        result,
        host,
        reader,
        writer,
        writer_done_receiver,
        shutdown_grace_ms,
    );
}

fn finish_host(
    result: Result<(), ProtocolError>,
    host: Host,
    reader: thread::JoinHandle<()>,
    writer: thread::JoinHandle<()>,
    writer_done: Receiver<WriterOutcome>,
    shutdown_grace_ms: u64,
) -> ! {
    let fatal = result.is_err();
    if !fatal {
        let _ = reader.join();
    }

    // Host::run has already retired pending requests on every fatal path.
    // Dropping its sender closes admissions; the writer acknowledgement is the
    // only bounded delivery wait. A blocked reader is intentionally not joined
    // on failure: process lifecycle is the portable cancellation boundary.
    drop(host);
    let writer_result = writer_done.recv_timeout(Duration::from_millis(shutdown_grace_ms));
    let writer_drained = matches!(&writer_result, &Ok(WriterOutcome::Drained));
    if writer_drained {
        let _ = writer.join();
    }

    match result {
        Err(error) => {
            if !writer_drained {
                eprintln!("native host protocol closed before output drain: {error}");
            } else {
                eprintln!("native host protocol closed: {error}");
            }
            process::exit(PROTOCOL_FAILURE_CODE);
        }
        Ok(()) => match writer_result {
            Ok(WriterOutcome::Drained) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                process::exit(0)
            }
            Ok(WriterOutcome::IoError) | Err(mpsc::RecvTimeoutError::Timeout) => {
                process::exit(PROTOCOL_FAILURE_CODE)
            }
        },
    }
}

fn reader_loop(sender: SyncSender<ReaderMessage>, frame_limit: usize) {
    let stdin = io::stdin();
    let mut input = BufReader::with_capacity(8 * 1024, stdin.lock());
    loop {
        match read_frame(&mut input, frame_limit) {
            Ok(Some(frame)) => {
                if sender.send(ReaderMessage::Frame(frame)).is_err() {
                    return;
                }
            }
            Ok(None) => {
                let _ = sender.send(ReaderMessage::Eof);
                return;
            }
            Err(error) => {
                let _ = sender.send(ReaderMessage::Error(error));
                return;
            }
        }
    }
}

fn writer_loop(
    receiver: Receiver<Vec<u8>>,
    progress: SyncSender<WriterSignal>,
    done: mpsc::Sender<WriterOutcome>,
) {
    let mut output = BufWriter::new(io::stdout());
    let mut outcome = WriterOutcome::Drained;
    while let Ok(frame) = receiver.recv() {
        if progress.send(WriterSignal::FrameStarted).is_err() {
            outcome = WriterOutcome::IoError;
            break;
        }
        let mut offset = 0;
        let mut failed = false;
        while offset < frame.len() {
            match output.write(&frame[offset..]) {
                Ok(0) => {
                    failed = true;
                    break;
                }
                Ok(written) => {
                    offset += written;
                    if progress.send(WriterSignal::Progress).is_err() {
                        failed = true;
                        break;
                    }
                }
                Err(_) => {
                    failed = true;
                    break;
                }
            }
        }
        if !failed && output.flush().is_err() {
            failed = true;
        }
        if failed {
            outcome = WriterOutcome::IoError;
            let _ = progress.send(WriterSignal::Failed);
            break;
        }
        if progress.send(WriterSignal::FrameComplete).is_err() {
            outcome = WriterOutcome::IoError;
            break;
        }
    }
    let _ = done.send(outcome);
}

fn writer_watchdog(
    progress: Receiver<WriterSignal>,
    write_deadline: Duration,
    failures: SyncSender<WriterFailure>,
) {
    loop {
        match progress.recv() {
            Ok(WriterSignal::FrameStarted) => loop {
                match progress.recv_timeout(write_deadline) {
                    Ok(WriterSignal::Progress) => {}
                    Ok(WriterSignal::FrameComplete) => break,
                    Ok(WriterSignal::Failed) => {
                        let _ = failures.send(WriterFailure::Io);
                        return;
                    }
                    Ok(WriterSignal::FrameStarted) => {
                        let _ = failures.send(WriterFailure::Io);
                        return;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        let _ = failures.send(WriterFailure::Deadline);
                        return;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            },
            Ok(WriterSignal::Progress | WriterSignal::FrameComplete) => {
                let _ = failures.send(WriterFailure::Io);
                return;
            }
            Ok(WriterSignal::Failed) => {
                let _ = failures.send(WriterFailure::Io);
                return;
            }
            Err(_) => return,
        }
    }
}

fn read_frame(
    reader: &mut impl Read,
    frame_limit: usize,
) -> Result<Option<Vec<u8>>, ProtocolError> {
    let mut frame = Vec::new();
    let content_limit = frame_limit.saturating_sub(1);
    let mut byte = [0_u8; 1];
    loop {
        match reader.read_exact(&mut byte) {
            Ok(()) => {
                if byte[0] == b'\n' {
                    if frame.is_empty() {
                        return Err(ProtocolError::EmptyJson);
                    }
                    return Ok(Some(frame));
                }
                if frame.len() >= content_limit {
                    return Err(ProtocolError::FrameTooLarge);
                }
                frame.push(byte[0]);
            }
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
                if frame.is_empty() {
                    return Ok(None);
                }
                return Err(ProtocolError::InvalidJson);
            }
            Err(_) => return Err(ProtocolError::Io),
        }
    }
}

fn test_or_manifest_deadline(limits: &ProtocolLimits, launch_mode: LaunchMode) -> Duration {
    if launch_mode == LaunchMode::IdentityV2Production {
        return Duration::from_millis(limits.default_deadline_ms);
    }
    let milliseconds = env::var(TEST_DEADLINE_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0 && *value <= limits.default_deadline_ms)
        .unwrap_or(limits.default_deadline_ms);
    Duration::from_millis(milliseconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v2_limit_mismatch_fails_before_identity_initialization_or_ready() {
        let manifest = load_manifest().expect("stage manifest should load");
        let mut limits = manifest.protocol;
        limits.in_flight_limit += 1;
        let (output, receiver) = mpsc::sync_channel(1);
        let mut host = Host::new(
            limits,
            manifest.namespace.profile_id,
            manifest.identity_manifest_digest,
            manifest.identity_profiles,
            FaultMode::None,
            output,
            LaunchMode::IdentityV2Test,
            false,
            false,
        );
        let frame = v2::Frame::Hello(v2::Hello {
            frame_type: "HELLO".to_string(),
            protocol_version: v2::VERSION,
            profile_id: "colony-b2a-test-profile".to_string(),
            session_id: "v2-limit-test".to_string(),
            generation_id: 1,
            build_id: "v2-limit-test".to_string(),
            registry_digest: v2::REGISTRY_DIGEST.to_string(),
            identity_launch: v2::IdentityLaunch {
                profile_id: "colony-b2a-test-profile".to_string(),
                flavor: "test".to_string(),
                platform: "linux".to_string(),
                user_data_root: "/tmp/colony-b2a-limit-test".to_string(),
                identity_mode: "explicit".to_string(),
                shared_identity: false,
                reset_provenance: "not_attempted_fresh".to_string(),
                identity_manifest_digest: None,
            },
        });
        let error = host
            .handle_v2(frame)
            .expect_err("limit mismatch must fail closed");
        assert_eq!(error.code(), "invalid_manifest");
        assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    }

    #[test]
    fn relay_launch_mode_is_exclusive_and_distinct() {
        assert_eq!(
            select_launch_mode(false, false, false, true),
            Some(LaunchMode::RelayV2)
        );
        assert_eq!(
            select_launch_mode(false, false, false, false),
            Some(LaunchMode::HealthOnly)
        );
        assert_eq!(select_launch_mode(true, false, false, true), None);
        assert_eq!(select_launch_mode(false, false, true, true), None);
        assert_eq!(select_launch_mode(false, true, false, true), None);
        assert!(LaunchMode::RelayV2.is_relay());
        assert!(!LaunchMode::RelayV2.is_identity());
        assert!(!LaunchMode::HealthOnly.is_relay());
    }
}
