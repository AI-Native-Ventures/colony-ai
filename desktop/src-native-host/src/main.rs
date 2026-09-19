mod protocol;

use std::{
    collections::{HashMap, HashSet},
    env,
    io::{self, BufReader, BufWriter, Read, Write},
    process,
    sync::mpsc::{self, Receiver, SyncSender, TrySendError},
    thread,
    time::{Duration, Instant},
};

use protocol::{
    decode_frame, encode_frame, load_manifest, Binding, Envelope, ErrorBody, OutboundFrame,
    ProtocolError, ProtocolLimits, FALLBACK_RELAY_URL, TEST_DEADLINE_ENV,
};

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

#[derive(Debug)]
struct PendingRequest {
    binding: Binding,
    deadline: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FaultMode {
    None,
    DelayResponse,
}

impl FaultMode {
    fn from_environment() -> Self {
        match env::var(FAULT_ENV).ok().as_deref() {
            Some("delay-response") => Self::DelayResponse,
            _ => Self::None,
        }
    }
}

struct Host {
    limits: ProtocolLimits,
    expected_profile_id: String,
    output: SyncSender<Vec<u8>>,
    binding: Option<Binding>,
    sequence: u64,
    pending: HashMap<String, PendingRequest>,
    seen_request_ids: HashSet<String>,
    delayed_once: bool,
    fault: FaultMode,
    deadline: Duration,
}

impl Host {
    fn new(
        limits: ProtocolLimits,
        expected_profile_id: String,
        fault: FaultMode,
        output: SyncSender<Vec<u8>>,
    ) -> Self {
        let deadline = test_or_manifest_deadline(&limits);
        Self {
            limits,
            expected_profile_id,
            output,
            binding: None,
            sequence: 0,
            pending: HashMap::new(),
            seen_request_ids: HashSet::new(),
            delayed_once: false,
            fault,
            deadline,
        }
    }

    fn run(&mut self, receiver: Receiver<ReaderMessage>) -> Result<(), ProtocolError> {
        loop {
            self.expire_pending()?;
            match receiver.recv_timeout(Duration::from_millis(READER_POLL_MS)) {
                Ok(ReaderMessage::Frame(bytes)) => {
                    let envelope = decode_frame(&bytes, &self.limits)?;
                    self.handle(envelope)?;
                }
                Ok(ReaderMessage::Eof) => {
                    self.reject_pending("host_unavailable")?;
                    return Ok(());
                }
                Ok(ReaderMessage::Error(error)) => {
                    self.reject_pending("protocol_error")?;
                    return Err(error);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.reject_pending("host_unavailable")?;
                    return Ok(());
                }
            }
        }
    }

    fn handle(&mut self, envelope: Envelope) -> Result<(), ProtocolError> {
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
        };
        let delayed = self.fault == FaultMode::DelayResponse && !self.delayed_once;
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
        let relay_url = configured_relay_url();
        self.send_response(
            &pending.binding,
            request_id.to_string(),
            "ok",
            Some(serde_json::json!({"relayUrl": relay_url})),
            None,
        )
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
                self.send_response(&pending.binding, request_id, "error", None, Some("timeout"))?;
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
            self.send_response(&request.binding, request_id, outcome, None, Some(code))?;
        }
        Ok(())
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

    fn write(&mut self, frame: OutboundFrame) -> Result<(), ProtocolError> {
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

fn main() {
    let manifest = match load_manifest() {
        Ok(manifest) => manifest,
        Err(error) => {
            eprintln!("native host startup failed: {error}");
            process::exit(PROTOCOL_FAILURE_CODE);
        }
    };
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

    let queue_limit = manifest.protocol.outbound_queue_limit;
    let frame_limit = manifest.protocol.frame_limit_bytes;
    let expected_profile_id = manifest.namespace.profile_id.clone();
    let (input_sender, receiver) = mpsc::sync_channel(queue_limit);
    let (output_sender, output_receiver) = mpsc::sync_channel(queue_limit);
    let (writer_done_sender, writer_done_receiver) = mpsc::channel();
    let reader = thread::spawn(move || reader_loop(input_sender, frame_limit));
    let writer = thread::spawn(move || writer_loop(output_receiver, writer_done_sender));
    let fault = FaultMode::from_environment();
    let shutdown_grace_ms = manifest.protocol.shutdown_grace_ms;
    let mut host = Host::new(manifest.protocol, expected_profile_id, fault, output_sender);
    let result = host.run(receiver);
    match result {
        Ok(()) => {
            let _ = reader.join();
            drop(host);
            match writer_done_receiver.recv_timeout(Duration::from_millis(shutdown_grace_ms)) {
                Ok(WriterOutcome::Drained) => {
                    let _ = writer.join();
                }
                Ok(WriterOutcome::IoError) => process::exit(PROTOCOL_FAILURE_CODE),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // The writer may be blocked by a non-reading parent. The
                    // protocol's shutdown grace is a process-lifecycle bound;
                    // once it expires, terminate without waiting on that pipe.
                    process::exit(0);
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => process::exit(0),
            }
        }
        Err(error) => {
            eprintln!("native host protocol closed: {error}");
            // A fatal protocol error owns process termination. The stdin reader
            // may be blocked on a parent-held pipe, so joining it here would
            // turn fail-closed handling into an unbounded wait.
            process::exit(PROTOCOL_FAILURE_CODE);
        }
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

fn writer_loop(receiver: Receiver<Vec<u8>>, done: mpsc::Sender<WriterOutcome>) {
    let mut output = BufWriter::new(io::stdout());
    let mut outcome = WriterOutcome::Drained;
    while let Ok(frame) = receiver.recv() {
        if output
            .write_all(&frame)
            .and_then(|_| output.flush())
            .is_err()
        {
            outcome = WriterOutcome::IoError;
            break;
        }
    }
    let _ = done.send(outcome);
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

fn test_or_manifest_deadline(limits: &ProtocolLimits) -> Duration {
    let milliseconds = env::var(TEST_DEADLINE_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0 && *value <= limits.default_deadline_ms)
        .unwrap_or(limits.default_deadline_ms);
    Duration::from_millis(milliseconds)
}
