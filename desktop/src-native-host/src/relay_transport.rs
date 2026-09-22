//! Bounded RelayV2 socket transport (native relay lane).
//!
//! Synchronous driver over blocking tungstenite I/O with absolute deadlines
//! taken from the frozen registry limits. One active connection per helper:
//! a new connect closes any previous connection within bounds first.
//!
//! A background reader thread forwards validated inbound frames to the host;
//! every other operation runs on the calling thread with an absolute
//! deadline. There is no reconnect, no replay, no backoff, and no
//! subscription policy here; those belong to `RelayClient`. Generation
//! fencing discards work tied to a superseded transport generation before
//! delivery.
//!
//! Every failure maps to a finite [`relay_v2::ContractError`] code. Relay
//! prose, URLs, event content, tokens, signatures, and challenge bytes never
//! enter errors or logs; only op names, connection ids, and outcomes do.

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use nostr::{EventBuilder, Keys, RelayUrl};
use tungstenite::{client::client_with_config, http::Uri, stream::MaybeTlsStream};
use tungstenite::{client_tls_with_config, Message, WebSocket};
use uuid::Uuid;

use crate::relay_v2::{self, ContractError, ContractResult};

/// Absolute dial budget for opening the TCP/TLS socket.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Single absolute NIP-42 budget measured from socket creation.
pub const AUTH_BUDGET: Duration = Duration::from_secs(5);
/// Bound for subscribe acknowledgement and request round-trips.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Bound for publish acknowledgement.
pub const PUBLISH_TIMEOUT: Duration = Duration::from_secs(10);
/// Bound for the close handshake.
pub const CLOSE_TIMEOUT: Duration = Duration::from_millis(2500);
/// Grace for joining connection threads on teardown.
pub const SHUTDOWN_GRACE: Duration = Duration::from_millis(250);
/// Frozen relay frame bound enforced before parsing beyond the bound.
pub const RELAY_FRAME_CAP: usize = 524_288;
/// Wire read bound: frame cap plus envelope slack. Anything larger fails
/// closed at the socket without entering the parser.
pub const WIRE_CAP: usize = RELAY_FRAME_CAP + 4096;
/// Frozen subscription ceiling per connection.
pub const MAX_SUBSCRIPTIONS: usize = 1024;
/// Frozen inbound queue ceiling per connection reader.
pub const MAX_INBOUND_QUEUE: usize = 256;
/// Poll tick for the blocking reader so shutdown is observed promptly.
const READ_TICK: Duration = Duration::from_millis(100);

/// Legal helper socket states, matching the frozen contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportState {
    Created,
    Connecting,
    ChallengePending,
    AuthSent,
    Authenticated,
    Closing,
    Closed,
    Failed,
}

impl TransportState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Connecting => "connecting",
            Self::ChallengePending => "challenge_pending",
            Self::AuthSent => "auth_sent",
            Self::Authenticated => "authenticated",
            Self::Closing => "closing",
            Self::Closed => "closed",
            Self::Failed => "failed",
        }
    }
}

/// Minimal socket seam. The production implementation wraps blocking
/// tungstenite; tests script an in-memory fake through the same seam.
pub trait SocketIo: Send {
    /// Read one text frame, enforcing `deadline`. Returns `Ok(None)` when a
    /// poll tick elapses with the deadline still in the future so shutdown
    /// stays observable; pings are answered internally.
    fn read_text(&mut self, deadline: Instant) -> Result<Option<String>, ContractError>;
    /// Write one text frame, enforcing `deadline`.
    fn write_text(&mut self, text: &str, deadline: Instant) -> Result<(), ContractError>;
    /// Bounded close handshake within `deadline`, then teardown.
    fn close_handshake(&mut self, deadline: Instant);
    /// Best-effort socket teardown. Never fails.
    fn close_socket(&mut self);
}

/// Production blocking tungstenite socket with per-call timeouts derived
/// from absolute deadlines.
pub struct TungsteniteSocket {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    shutdown: Arc<AtomicBool>,
}

impl TungsteniteSocket {
    /// Dial `url` with a bounded TCP connect, then run the WS handshake.
    pub fn dial(url: &str, connect_deadline: Instant) -> ContractResult<Self> {
        let uri: Uri = url.parse().map_err(|_| ContractError::InvalidConnection)?;
        if !matches!(uri.scheme_str(), Some("ws") | Some("wss")) {
            return Err(ContractError::InvalidConnection);
        }
        let host = uri.host().ok_or(ContractError::InvalidConnection)?;
        let port = uri.port_u16().unwrap_or(match uri.scheme_str() {
            Some("wss") => 443,
            _ => 80,
        });
        let timeout = connect_deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::ZERO);
        if timeout.is_zero() {
            return Err(ContractError::ConnectTimeout);
        }
        let config =
            tungstenite::protocol::WebSocketConfig::default().max_message_size(Some(WIRE_CAP));
        let mut last_error = ContractError::InvalidConnection;
        for address in (host, port)
            .to_socket_addrs()
            .map_err(|_| ContractError::InvalidConnection)?
        {
            match TcpStream::connect_timeout(&address, timeout) {
                Ok(stream) => {
                    let _ = stream.set_nodelay(true);
                    let url = url.to_string();
                    let socket = match uri.scheme_str() {
                        Some("wss") => {
                            match client_tls_with_config(url, stream, Some(config), None) {
                                Ok((socket, _)) => socket,
                                Err(_) => return Err(ContractError::InvalidConnection),
                            }
                        }
                        _ => match client_with_config(url, stream, Some(config)) {
                            Ok((socket, _)) => {
                                // Normalize the plain stream into the same
                                // MaybeTlsStream envelope the struct holds.
                                WebSocket::from_raw_socket(
                                    MaybeTlsStream::Plain(socket.into_inner()),
                                    tungstenite::protocol::Role::Client,
                                    Some(config),
                                )
                            }
                            Err(_) => return Err(ContractError::InvalidConnection),
                        },
                    };
                    return Ok(Self {
                        socket,
                        shutdown: Arc::new(AtomicBool::new(false)),
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
                    last_error = ContractError::ConnectTimeout;
                }
                Err(_) => {
                    last_error = ContractError::InvalidConnection;
                }
            }
        }
        Err(last_error)
    }

    fn arm_read_timeout(&mut self, deadline: Instant) -> ContractResult<()> {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::ZERO);
        let tcp = match self.socket.get_mut() {
            MaybeTlsStream::Plain(stream) => stream,
            MaybeTlsStream::Rustls(stream) => stream.get_mut(),
            _ => return Err(ContractError::HostUnavailable),
        };
        tcp.set_read_timeout(Some(remaining.min(READ_TICK)))
            .map_err(|_| ContractError::HostUnavailable)
    }

    fn arm_write_timeout(&mut self, deadline: Instant) -> ContractResult<()> {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .unwrap_or(Duration::ZERO);
        if remaining.is_zero() {
            return Err(ContractError::RequestTimeout);
        }
        let tcp = match self.socket.get_mut() {
            MaybeTlsStream::Plain(stream) => stream,
            MaybeTlsStream::Rustls(stream) => stream.get_mut(),
            _ => return Err(ContractError::HostUnavailable),
        };
        tcp.set_write_timeout(Some(remaining))
            .map_err(|_| ContractError::HostUnavailable)
    }
}

impl SocketIo for TungsteniteSocket {
    fn read_text(&mut self, deadline: Instant) -> Result<Option<String>, ContractError> {
        loop {
            if self.shutdown.load(Ordering::SeqCst) {
                return Err(ContractError::RelayClosed);
            }
            if Instant::now() >= deadline {
                return Err(ContractError::RequestTimeout);
            }
            self.arm_read_timeout(deadline)?;
            match self.socket.read() {
                Ok(Message::Text(text)) => {
                    let text = text.as_str().to_string();
                    if text.len() > RELAY_FRAME_CAP {
                        return Err(ContractError::Oversized);
                    }
                    return Ok(Some(text));
                }
                Ok(Message::Binary(data)) => {
                    if data.len() > RELAY_FRAME_CAP {
                        return Err(ContractError::Oversized);
                    }
                    return Err(ContractError::MalformedFrame);
                }
                Ok(Message::Ping(payload)) => {
                    let _ = self.socket.send(Message::Pong(payload));
                }
                Ok(Message::Pong(_)) => {}
                Ok(Message::Close(_)) => return Err(ContractError::RelayClosed),
                Ok(Message::Frame(_)) => return Err(ContractError::MalformedFrame),
                Err(tungstenite::Error::Io(error))
                    if error.kind() == std::io::ErrorKind::TimedOut
                        || error.kind() == std::io::ErrorKind::WouldBlock =>
                {
                    return Ok(None);
                }
                Err(tungstenite::Error::ConnectionClosed)
                | Err(tungstenite::Error::AlreadyClosed) => {
                    return Err(ContractError::RelayClosed);
                }
                Err(_) => return Err(ContractError::RelayClosed),
            }
        }
    }

    fn write_text(&mut self, text: &str, deadline: Instant) -> Result<(), ContractError> {
        if text.len() > RELAY_FRAME_CAP {
            return Err(ContractError::Oversized);
        }
        self.arm_write_timeout(deadline)?;
        self.socket
            .send(Message::Text(text.into()))
            .map_err(|_| ContractError::RelayClosed)?;
        self.socket.flush().map_err(|_| ContractError::RelayClosed)
    }

    fn close_handshake(&mut self, deadline: Instant) {
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = self.socket.close(None);
        // Bounded wait for the peer close/EOF; the socket is torn down after.
        while Instant::now() < deadline {
            match self.read_text(deadline) {
                Err(ContractError::RelayClosed) => break,
                Err(_) => break,
                Ok(_) => {}
            }
        }
        self.close_socket();
    }

    fn close_socket(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = self.socket.close(None);
    }
}

/// In-memory scripted socket for unit tests.
#[cfg(test)]
pub struct FakeSocket {
    reads: VecDeque<FakeRead>,
    /// Every written frame, in order, for assertion.
    pub writes: Vec<String>,
    pub closed: bool,
}

/// One scripted read: a fixed outcome, or an OK acknowledgement minted for
/// the event id carried by the most recent AUTH write.
#[cfg(test)]
pub enum FakeRead {
    Fixed(Result<Option<String>, ContractError>),
    OkForLastAuth,
}

#[cfg(test)]
impl FakeSocket {
    pub fn scripted(reads: Vec<FakeRead>) -> Self {
        Self {
            reads: reads.into(),
            writes: Vec::new(),
            closed: false,
        }
    }

    fn auth_event_id(&self) -> Option<String> {
        self.writes.iter().rev().find_map(|written| {
            let value: serde_json::Value = serde_json::from_str(written).ok()?;
            let array = value.as_array()?;
            if array.first().and_then(|v| v.as_str()) != Some("AUTH") {
                return None;
            }
            array.get(1)?.get("id")?.as_str().map(str::to_string)
        })
    }
}

#[cfg(test)]
impl SocketIo for FakeSocket {
    fn read_text(&mut self, _deadline: Instant) -> Result<Option<String>, ContractError> {
        match self.reads.pop_front().unwrap_or(FakeRead::Fixed(Ok(None))) {
            FakeRead::Fixed(outcome) => outcome,
            FakeRead::OkForLastAuth => match self.auth_event_id() {
                Some(id) => Ok(Some(
                    serde_json::json!(["OK", id, true, "accepted"]).to_string(),
                )),
                None => Err(ContractError::MalformedFrame),
            },
        }
    }

    fn write_text(&mut self, text: &str, _deadline: Instant) -> Result<(), ContractError> {
        self.writes.push(text.to_string());
        Ok(())
    }

    fn close_handshake(&mut self, _deadline: Instant) {
        self.closed = true;
    }

    fn close_socket(&mut self) {
        self.closed = true;
    }
}

/// Relay hello descriptor from trusted main. The URL and authority handle are
/// main-resolved; renderer payloads never supply them.
#[derive(Debug, Clone)]
pub struct RelayHello {
    pub relay_url: String,
    pub authority_ref: String,
    pub user_data_root: String,
    pub flavor: String,
}

impl RelayHello {
    /// Parse and bound the descriptor. Absolute data roots only; the URL is
    /// shape-checked here while dial failures stay dial errors.
    pub fn parse(value: &serde_json::Value) -> ContractResult<Self> {
        let object = value.as_object().ok_or(ContractError::InvalidPayload)?;
        if object.len() != 4
            || !object.contains_key("relayUrl")
            || !object.contains_key("authorityRef")
            || !object.contains_key("userDataRoot")
            || !object.contains_key("flavor")
        {
            return Err(ContractError::InvalidPayload);
        }
        let relay_url = object
            .get("relayUrl")
            .and_then(|value| value.as_str())
            .ok_or(ContractError::InvalidPayload)?;
        if relay_url.len() > 2048
            || !(relay_url.starts_with("ws://") || relay_url.starts_with("wss://"))
        {
            return Err(ContractError::InvalidConnection);
        }
        let authority_ref = object
            .get("authorityRef")
            .and_then(|value| value.as_str())
            .ok_or(ContractError::InvalidPayload)?;
        relay_v2::validate_authority_ref(authority_ref)?;
        let user_data_root = object
            .get("userDataRoot")
            .and_then(|value| value.as_str())
            .ok_or(ContractError::InvalidPayload)?;
        if !user_data_root.starts_with('/') || user_data_root.len() > 1024 {
            return Err(ContractError::InvalidPayload);
        }
        let flavor = object
            .get("flavor")
            .and_then(|value| value.as_str())
            .ok_or(ContractError::InvalidPayload)?;
        if flavor != "normal" && flavor != "instrumented" {
            return Err(ContractError::InvalidPayload);
        }
        Ok(Self {
            relay_url: relay_url.to_string(),
            authority_ref: authority_ref.to_string(),
            user_data_root: user_data_root.to_string(),
            flavor: flavor.to_string(),
        })
    }
}

/// Map a relay op name to its frozen capability and op deadline.
pub fn relay_operation(operation: &str) -> Result<(&'static str, Duration), ContractError> {
    match operation {
        "relay-transport/connect" => Ok(("relay-transport", CONNECT_TIMEOUT)),
        "relay-transport/authenticate" => Ok(("relay-transport", AUTH_BUDGET)),
        "relay-transport/subscribe" => Ok(("relay-transport", REQUEST_TIMEOUT)),
        "relay-transport/close_subscription" => Ok(("relay-transport", CLOSE_TIMEOUT)),
        "relay-transport/publish" => Ok(("relay-transport", PUBLISH_TIMEOUT)),
        "relay-transport/close" => Ok(("relay-transport", CLOSE_TIMEOUT)),
        "identity-sign/sign_message"
        | "identity-sign/sign_presence"
        | "identity-sign/sign_typing"
        | "identity-sign/sign_user_status" => Ok(("identity-sign", REQUEST_TIMEOUT)),
        _ => Err(ContractError::InvalidPayload),
    }
}

/// Typed inbound relay traffic after wire parsing plus frozen validation,
/// tagged with the transport generation that produced it.
#[derive(Debug, Clone)]
pub struct TypedInbound {
    pub generation: u64,
    pub message_type: &'static str,
    pub payload: serde_json::Value,
}

/// Raw upstream Nostr wire shapes, parsed before any envelope is built.
/// Real relays send bare arrays: `["AUTH", challenge]`, `["OK", id, bool,
/// string]`, `["EVENT", sub, event]`, `["EOSE", sub]`, `["CLOSED", sub,
/// string]`, `["NOTICE", string]`. The host envelope below is constructed
/// from these, never confused with them.
#[derive(Debug, Clone)]
pub enum WireInbound {
    Auth {
        challenge: String,
    },
    Ok {
        event_id: String,
        accepted: bool,
        message: String,
    },
    Event {
        subscription_id: String,
        event: serde_json::Value,
    },
    Eose {
        subscription_id: String,
    },
    Closed {
        subscription_id: String,
        message: String,
    },
    Notice {
        message: String,
    },
}

/// Parse one raw relay text frame into its wire shape. Bounds first, raw
/// wire second, envelope later. Unknown classes and malformed shapes fail
/// closed here; oversized frames never enter the parser beyond the bound.
pub fn parse_wire(text: &str) -> ContractResult<WireInbound> {
    if text.len() > RELAY_FRAME_CAP {
        return Err(ContractError::Oversized);
    }
    let frame: serde_json::Value =
        serde_json::from_str(text).map_err(|_| ContractError::InvalidJson)?;
    let array = frame.as_array().ok_or(ContractError::MalformedFrame)?;
    let label = array
        .first()
        .and_then(|v| v.as_str())
        .ok_or(ContractError::MalformedFrame)?;
    let at = |index: usize| array.get(index);
    match label {
        "AUTH" => {
            let challenge = at(1)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            if challenge.len() > 64 {
                return Err(ContractError::InvalidPayload);
            }
            Ok(WireInbound::Auth {
                challenge: challenge.to_string(),
            })
        }
        "OK" => {
            let event_id = at(1)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            let accepted = at(2)
                .and_then(|v| v.as_bool())
                .ok_or(ContractError::MalformedFrame)?;
            let message = at(3)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            Ok(WireInbound::Ok {
                event_id: event_id.to_string(),
                accepted,
                message: message.to_string(),
            })
        }
        "EVENT" => {
            let subscription_id = at(1)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            let event = at(2).cloned().ok_or(ContractError::MalformedFrame)?;
            Ok(WireInbound::Event {
                subscription_id: subscription_id.to_string(),
                event,
            })
        }
        "EOSE" => {
            let subscription_id = at(1)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            Ok(WireInbound::Eose {
                subscription_id: subscription_id.to_string(),
            })
        }
        "CLOSED" => {
            let subscription_id = at(1)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            let message = at(2)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            Ok(WireInbound::Closed {
                subscription_id: subscription_id.to_string(),
                message: message.to_string(),
            })
        }
        "NOTICE" => {
            let message = at(1)
                .and_then(|v| v.as_str())
                .ok_or(ContractError::MalformedFrame)?;
            Ok(WireInbound::Notice {
                message: message.to_string(),
            })
        }
        _ => Err(ContractError::MalformedFrame),
    }
}

/// Redact relay prose into the finite NOTICE vocabulary. Raw server strings
/// never cross this seam except as `unknown`.
pub fn redact_notice(message: &str) -> &'static str {
    match message {
        "invalid_request" => "invalid_request",
        "not_authorized" => "not_authorized",
        "rate_limited" => "rate_limited",
        "server_error" => "server_error",
        "maintenance" => "maintenance",
        _ => "unknown",
    }
}

/// Redact relay prose into the finite OK vocabulary.
pub fn redact_ok_message(message: &str) -> &'static str {
    match message {
        "accepted" => "accepted",
        "rejected" => "rejected",
        "duplicate" => "duplicate",
        "invalid_event" => "invalid_event",
        "not_authorized" => "not_authorized",
        "rate_limited" => "rate_limited",
        "server_error" => "server_error",
        _ => "unknown",
    }
}

/// Redact relay prose into the finite CLOSED vocabulary.
pub fn redact_closed_message(message: &str) -> &'static str {
    match message {
        "auth_required" => "auth_required",
        "invalid_request" => "invalid_request",
        "not_authorized" => "not_authorized",
        "rate_limited" => "rate_limited",
        "server_error" => "server_error",
        "timeout" => "timeout",
        _ => "unknown",
    }
}

/// Translate one parsed wire frame into its frozen host envelope and
/// validate the envelope through the frozen registry. Construction and
/// validation live behind one seam so fixtures can never substitute a
/// hand-written envelope for real wire.
pub fn translate_wire(
    wire: &WireInbound,
    connection_id: &str,
    generation: u64,
) -> ContractResult<TypedInbound> {
    let (class, payload) = match wire {
        WireInbound::Auth { challenge } => ("AUTH", serde_json::json!({"challengeRef": challenge})),
        WireInbound::Ok {
            event_id,
            accepted,
            message,
        } => (
            "OK",
            serde_json::json!({
                "eventId": event_id,
                "accepted": accepted,
                "messageCode": redact_ok_message(message),
            }),
        ),
        WireInbound::Event {
            subscription_id,
            event,
        } => (
            "EVENT",
            serde_json::json!({"subscriptionId": subscription_id, "event": event}),
        ),
        WireInbound::Eose { subscription_id } => (
            "EOSE",
            serde_json::json!({"subscriptionId": subscription_id}),
        ),
        WireInbound::Closed {
            subscription_id,
            message,
        } => (
            "CLOSED",
            serde_json::json!({
                "subscriptionId": subscription_id,
                "reasonCode": redact_closed_message(message),
            }),
        ),
        WireInbound::Notice { message } => (
            "NOTICE",
            serde_json::json!({"code": redact_notice(message)}),
        ),
    };
    let envelope_value = serde_json::json!({
        "connectionId": connection_id,
        "generation": generation,
        "messageType": class,
        "payload": payload,
    });
    relay_v2::validate_inbound_event(&envelope_value)?;
    Ok(TypedInbound {
        generation,
        message_type: class,
        payload,
    })
}

/// Parse one raw relay text frame: wire shape first, then envelope
/// construction plus frozen validation, tagged with `generation`.
pub fn parse_inbound(
    text: &str,
    connection_id: &str,
    generation: u64,
) -> ContractResult<TypedInbound> {
    translate_wire(&parse_wire(text)?, connection_id, generation)
}

/// Read until `predicate` accepts a parsed inbound frame or `deadline`
/// passes with `timeout_code`. Ticks keep shutdown observable. The parsed
/// frames are tagged with `generation` so stale traffic is fenced here,
/// not delivered. The socket carries raw upstream wire; envelopes are
/// constructed per frame with the reader's connection id.
pub fn read_until<S, F>(
    socket: &mut S,
    deadline: Instant,
    timeout_code: ContractError,
    connection_id: &str,
    generation: u64,
    mut predicate: F,
) -> ContractResult<TypedInbound>
where
    S: SocketIo,
    F: FnMut(&TypedInbound) -> bool,
{
    loop {
        if Instant::now() >= deadline {
            return Err(timeout_code);
        }
        match socket.read_text(deadline) {
            Ok(Some(text)) => {
                let inbound = parse_inbound(&text, connection_id, generation)?;
                if inbound.generation == generation && predicate(&inbound) {
                    return Ok(inbound);
                }
            }
            Ok(None) => {}
            Err(ContractError::RequestTimeout) => return Err(timeout_code),
            Err(error) => return Err(error),
        }
    }
}

/// Build and sign the NIP-42 AUTH event for `challenge` against `relay_url`.
/// The challenge value is consumed here and never retained in errors.
pub fn build_auth_event(
    challenge: &str,
    relay_url: &str,
    keys: &Keys,
) -> ContractResult<nostr::Event> {
    if challenge.len() > 64 {
        return Err(ContractError::InvalidPayload);
    }
    let relay = RelayUrl::parse(relay_url).map_err(|_| ContractError::InvalidConnection)?;
    EventBuilder::auth(challenge, relay)
        .sign_with_keys(keys)
        .map_err(|_| ContractError::AuthRejected)
}

/// Reader outcome posted to the host: validated inbound traffic or a
/// terminal connection failure. Only ids and codes cross this boundary.
/// (Retained for the host-facing API; the current reader reports through the
/// validated inbox plus polled health instead of this enum.)
#[allow(dead_code)]
pub enum ReaderOutcome {
    Inbound(TypedInbound),
    Failed(ContractError),
}

/// A live authenticated relay connection: shared socket, background reader,
/// generation tag, and authority binding. No `Debug`: the socket, keys, and
/// reader handles must never format into logs.
pub struct RelayConnection {
    socket: Arc<Mutex<Box<dyn SocketIo>>>,
    reader_shutdown: Arc<AtomicBool>,
    reader_handle: Option<JoinHandle<()>>,
    reader_alive: Arc<AtomicBool>,
    reader_failed: Arc<Mutex<Option<ContractError>>>,
    pub connection_id: String,
    pub generation: u64,
    authority_ref: String,
    state: TransportState,
    subscriptions: HashMap<String, ()>,
}

impl fmt::Debug for RelayConnection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RelayConnection")
            .field("connection_id", &self.connection_id)
            .field("generation", &self.generation)
            .field("state", &self.state)
            .field("subscriptions", &self.subscriptions.len())
            .finish_non_exhaustive()
    }
}

impl RelayConnection {
    /// The bound authority handle must match every relay op in this session.
    /// A missing, replayed, or mismatched handle fails before socket dispatch.
    pub fn check_authority(&self, authority_ref: &str) -> ContractResult<()> {
        if authority_ref == self.authority_ref {
            Ok(())
        } else {
            Err(ContractError::InvalidAuthority)
        }
    }

    pub fn state(&self) -> TransportState {
        self.state
    }

    fn set_state(&mut self, state: TransportState) {
        self.state = state;
    }

    pub fn subscription_count(&self) -> usize {
        self.subscriptions.len()
    }

    /// The background reader stopped unexpectedly; surface its terminal code
    /// once so the host can fail the connection closed.
    pub fn poll_reader_health(&self) -> ContractResult<()> {
        if self.reader_alive.load(Ordering::SeqCst) {
            return Ok(());
        }
        match self.reader_failed.lock() {
            Ok(guard) => Err(guard.unwrap_or(ContractError::RelayClosed)),
            Err(_) => Err(ContractError::HostUnavailable),
        }
    }

    /// Note a validated subscription. Enforces the frozen ceiling.
    pub fn note_subscribed(&mut self, subscription_id: &str) -> ContractResult<()> {
        if self.subscriptions.len() >= MAX_SUBSCRIPTIONS
            && !self.subscriptions.contains_key(subscription_id)
        {
            return Err(ContractError::Oversized);
        }
        self.subscriptions.insert(subscription_id.to_string(), ());
        Ok(())
    }

    pub fn note_unsubscribed(&mut self, subscription_id: &str) {
        self.subscriptions.remove(subscription_id);
    }

    fn lock_socket(&self) -> ContractResult<std::sync::MutexGuard<'_, Box<dyn SocketIo>>> {
        self.socket
            .lock()
            .map_err(|_| ContractError::HostUnavailable)
    }

    /// Send a validated REQ for an already-validated filter value.
    pub fn send_subscribe(
        &self,
        subscription_id: &str,
        filter: &serde_json::Value,
        deadline: Instant,
    ) -> ContractResult<()> {
        let frame = serde_json::json!(["REQ", subscription_id, filter]);
        let text = serde_json::to_string(&frame).map_err(|_| ContractError::InvalidPayload)?;
        self.lock_socket()?.write_text(&text, deadline)
    }

    /// Send a validated signed event for publish.
    pub fn send_publish(&self, event: &serde_json::Value, deadline: Instant) -> ContractResult<()> {
        let frame = serde_json::json!(["EVENT", event]);
        let text = serde_json::to_string(&frame).map_err(|_| ContractError::InvalidPayload)?;
        self.lock_socket()?.write_text(&text, deadline)
    }
    /// Send CLOSE for one subscription.
    pub fn send_close_subscription(
        &mut self,
        subscription_id: &str,
        deadline: Instant,
    ) -> ContractResult<()> {
        let frame = serde_json::json!(["CLOSE", subscription_id]);
        let text = serde_json::to_string(&frame).map_err(|_| ContractError::InvalidPayload)?;
        self.lock_socket()?.write_text(&text, deadline)?;
        self.note_unsubscribed(subscription_id);
        Ok(())
    }

    /// Bounded close handshake, reader join within grace, then socket
    /// teardown. Never fails; always leaves no owned thread behind past the
    /// grace bound.
    pub fn close(&mut self) {
        let deadline = Instant::now() + CLOSE_TIMEOUT;
        if let Ok(mut socket) = self.socket.lock() {
            socket.close_handshake(deadline);
        }
        self.reader_shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.reader_handle.take() {
            let grace_deadline = Instant::now() + SHUTDOWN_GRACE + CLOSE_TIMEOUT;
            while !handle.is_finished() {
                if Instant::now() >= grace_deadline {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            // A finished reader joins cleanly; an over-grace reader is already
            // socket-torn-down, so its next tick exits. Detaching there cannot
            // outlive the helper process teardown it belongs to.
            if handle.is_finished() {
                let _ = handle.join();
            }
        }
    }
}

impl Drop for RelayConnection {
    fn drop(&mut self) {
        self.close();
    }
}

/// Spawn the background reader for an authenticated socket. Every raw wire
/// frame is parsed, translated into its envelope, and forwarded with
/// `generation`; the reader exits on shutdown, socket failure, or a full
/// inbound queue (bounded memory wins over delivery, and the failure is
/// surfaced through health).
pub fn spawn_reader(
    socket: Arc<Mutex<Box<dyn SocketIo>>>,
    inbox: mpsc::SyncSender<TypedInbound>,
    shutdown: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    failed: Arc<Mutex<Option<ContractError>>>,
    connection_id: String,
    generation: u64,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let outcome: ContractResult<()> = (|| loop {
            if shutdown.load(Ordering::SeqCst) {
                return Ok(());
            }
            let next = {
                let mut guard = socket.lock().map_err(|_| ContractError::HostUnavailable)?;
                guard.read_text(Instant::now() + Duration::from_secs(60))
            };
            match next {
                Ok(Some(text)) => match parse_inbound(&text, &connection_id, generation) {
                    Ok(inbound) => {
                        if inbox.try_send(inbound).is_err() {
                            return Err(ContractError::QueueFull);
                        }
                    }
                    Err(error) => return Err(error),
                },
                Ok(None) => {}
                Err(ContractError::RequestTimeout) => {}
                Err(error) => return Err(error),
            }
        })();
        if let Err(error) = outcome {
            if let Ok(mut guard) = failed.lock() {
                *guard = Some(error);
            }
        }
        alive.store(false, Ordering::SeqCst);
    })
}

/// Factory for [`RelayConnection`] over an injected socket. Production passes
/// a dialed [`TungsteniteSocket`]; tests pass a [`FakeSocket`].
pub struct ConnectionFactory;

impl ConnectionFactory {
    /// Run the full NIP-42 handshake inside the single absolute auth budget
    /// measured from `socket_created`. Returns the authenticated connection
    /// with a fresh helper-minted connection id.
    pub fn connect_authenticated<S: SocketIo + 'static>(
        mut socket: S,
        authority_ref: &str,
        relay_url: &str,
        keys: &Keys,
        generation: u64,
        socket_created: Instant,
    ) -> ContractResult<RelayConnection> {
        relay_v2::validate_authority_ref(authority_ref)?;
        let auth_deadline = socket_created + AUTH_BUDGET;
        if Instant::now() >= auth_deadline {
            return Err(ContractError::AuthTimeout);
        }
        let challenge = read_until(
            &mut socket,
            auth_deadline,
            ContractError::AuthTimeout,
            // The connection id is minted after the handshake; challenge
            // parsing only needs envelope shape validity, so the zero UUID
            // stands in until the real id exists.
            "00000000-0000-0000-0000-000000000000",
            generation,
            |inbound| inbound.message_type == "AUTH",
        )?;
        let challenge_ref = challenge
            .payload
            .get("challengeRef")
            .and_then(|value| value.as_str())
            .ok_or(ContractError::MalformedFrame)?;
        // The challenge value is consumed here and never retained.
        let event = build_auth_event(challenge_ref, relay_url, keys)?;
        let event_id = event.id.to_hex();
        let auth_text = serde_json::to_string(&serde_json::json!(["AUTH", event]))
            .map_err(|_| ContractError::InvalidPayload)?;
        socket.write_text(&auth_text, auth_deadline)?;
        let ok = read_until(
            &mut socket,
            auth_deadline,
            ContractError::AuthTimeout,
            "00000000-0000-0000-0000-000000000000",
            generation,
            |inbound| {
                inbound.message_type == "OK"
                    && inbound.payload.get("eventId").and_then(|v| v.as_str())
                        == Some(event_id.as_str())
            },
        )?;
        let accepted = ok
            .payload
            .get("accepted")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if !accepted {
            return Err(ContractError::AuthRejected);
        }
        let mut connection = RelayConnection {
            socket: Arc::new(Mutex::new(Box::new(socket))),
            reader_shutdown: Arc::new(AtomicBool::new(false)),
            reader_handle: None,
            reader_alive: Arc::new(AtomicBool::new(true)),
            reader_failed: Arc::new(Mutex::new(None)),
            connection_id: Uuid::new_v4().to_string(),
            generation,
            authority_ref: authority_ref.to_string(),
            state: TransportState::Connecting,
            subscriptions: HashMap::new(),
        };
        connection.set_state(TransportState::Authenticated);
        Ok(connection)
    }

    /// Attach the background reader to a live connection. The inbox bound is
    /// the frozen inbound ceiling; overflow fails the connection closed.
    pub fn attach_reader(connection: &mut RelayConnection, inbox: mpsc::SyncSender<TypedInbound>) {
        if connection.reader_handle.is_some() {
            return;
        }
        let handle = spawn_reader(
            Arc::clone(&connection.socket),
            inbox,
            Arc::clone(&connection.reader_shutdown),
            Arc::clone(&connection.reader_alive),
            Arc::clone(&connection.reader_failed),
            connection.connection_id.clone(),
            connection.generation,
        );
        connection.reader_handle = Some(handle);
    }
}

/// Construct a host lifecycle event value for relay sessions. Only the relay
/// host states are accepted; identity states are rejected here.
pub fn relay_host_lifecycle_event(
    generation: u64,
    state: &str,
    error: Option<&str>,
) -> ContractResult<serde_json::Value> {
    const STATES: [&str; 7] = [
        "ready",
        "renderer_rebound",
        "unavailable",
        "relay_connecting",
        "relay_authenticated",
        "relay_closed",
        "relay_failed",
    ];
    if !STATES.contains(&state) {
        return Err(ContractError::InvalidPayload);
    }
    if let Some(code) = error {
        relay_v2::validate_redacted_code(code)?;
    }
    let mut value = serde_json::json!({
        "generation": generation,
        "state": state,
    });
    if let Some(code) = error {
        value
            .as_object_mut()
            .ok_or(ContractError::InvalidPayload)?
            .insert(
                "error".to_string(),
                serde_json::Value::String(code.to_string()),
            );
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVENT_ID: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const CONNECTION_ID: &str = "11111111-1111-1111-1111-111111111111";

    /// Raw upstream wire frames. Real relays send bare arrays; envelopes
    /// are constructed by the translator, never hand-written in fixtures.
    fn auth_wire(challenge: &str) -> String {
        serde_json::json!(["AUTH", challenge]).to_string()
    }

    fn ok_wire(event_id: &str, accepted: bool, message: &str) -> String {
        serde_json::json!(["OK", event_id, accepted, message]).to_string()
    }

    fn event_wire(subscription_id: &str, event: serde_json::Value) -> String {
        serde_json::json!(["EVENT", subscription_id, event]).to_string()
    }

    fn eose_wire(subscription_id: &str) -> String {
        serde_json::json!(["EOSE", subscription_id]).to_string()
    }

    fn closed_wire(subscription_id: &str, message: &str) -> String {
        serde_json::json!(["CLOSED", subscription_id, message]).to_string()
    }

    fn notice_wire(message: &str) -> String {
        serde_json::json!(["NOTICE", message]).to_string()
    }

    fn test_connection() -> RelayConnection {
        RelayConnection {
            socket: Arc::new(Mutex::new(
                Box::new(FakeSocket::scripted(vec![])) as Box<dyn SocketIo>
            )),
            reader_shutdown: Arc::new(AtomicBool::new(false)),
            reader_handle: None,
            reader_alive: Arc::new(AtomicBool::new(true)),
            reader_failed: Arc::new(Mutex::new(None)),
            connection_id: "11111111-1111-1111-1111-111111111111".to_string(),
            generation: 7,
            authority_ref: "a".repeat(64),
            state: TransportState::Authenticated,
            subscriptions: HashMap::new(),
        }
    }

    #[test]
    fn operation_table_covers_all_ten_entries() {
        let ops = [
            "relay-transport/connect",
            "relay-transport/authenticate",
            "relay-transport/subscribe",
            "relay-transport/close_subscription",
            "relay-transport/publish",
            "relay-transport/close",
            "identity-sign/sign_message",
            "identity-sign/sign_presence",
            "identity-sign/sign_typing",
            "identity-sign/sign_user_status",
        ];
        for op in ops {
            assert!(relay_operation(op).is_ok(), "missing op {op}");
        }
        assert!(relay_operation("relay-transport/send_raw").is_err());
        assert!(relay_operation("unknown/op").is_err());
    }

    #[test]
    fn envelope_mapping_rejects_unknown_capabilities_and_methods() {
        let (operation, capability, _) =
            relay_operation_for("relay-transport", "subscribe").expect("known pair");
        assert_eq!(operation, "relay-transport/subscribe");
        assert_eq!(capability, "relay-transport");
        let (operation, capability, _) =
            relay_operation_for("identity-sign", "sign_typing").expect("known pair");
        assert_eq!(operation, "identity-sign/sign_typing");
        assert_eq!(capability, "identity-sign");
        assert_eq!(
            relay_operation_for("relay-transport", "send_raw").unwrap_err(),
            "unknown_method"
        );
        assert_eq!(
            relay_operation_for("relay-transportX", "subscribe").unwrap_err(),
            "unknown_capability"
        );
        assert_eq!(
            relay_operation_for("", "").unwrap_err(),
            "unknown_capability"
        );
    }

    #[test]
    fn hello_descriptor_rejects_bad_shapes() {
        let good = serde_json::json!({
            "relayUrl": "ws://127.0.0.1:18080",
            "authorityRef": "a".repeat(64),
            "userDataRoot": "/tmp/relay-d0",
            "flavor": "normal",
        });
        assert!(RelayHello::parse(&good).is_ok());
        for bad in [
            serde_json::json!({}),
            serde_json::json!({
                "relayUrl": "https://example.com",
                "authorityRef": "a".repeat(64),
                "userDataRoot": "/tmp/x",
                "flavor": "normal",
            }),
            serde_json::json!({
                "relayUrl": "ws://127.0.0.1:18080",
                "authorityRef": "short",
                "userDataRoot": "/tmp/x",
                "flavor": "normal",
            }),
            serde_json::json!({
                "relayUrl": "ws://127.0.0.1:18080",
                "authorityRef": "a".repeat(64),
                "userDataRoot": "relative/path",
                "flavor": "normal",
            }),
            serde_json::json!({
                "relayUrl": "ws://127.0.0.1:18080",
                "authorityRef": "a".repeat(64),
                "userDataRoot": "/tmp/x",
                "flavor": "prod",
            }),
            serde_json::json!({
                "relayUrl": "ws://127.0.0.1:18080",
                "authorityRef": "a".repeat(64),
                "userDataRoot": "/tmp/x",
                "flavor": "normal",
                "rendererUrl": "wss://evil.example",
            }),
        ] {
            assert!(RelayHello::parse(&bad).is_err());
        }
    }

    #[test]
    fn wire_parser_accepts_real_shapes_and_rejects_count_and_oversize() {
        // Real upstream wire first: bare arrays, exactly as relays send.
        assert!(matches!(
            parse_wire(&auth_wire("challenge-1")).expect("AUTH parses"),
            WireInbound::Auth { .. }
        ));
        assert!(matches!(
            parse_wire(&ok_wire(EVENT_ID, true, "accepted")).expect("OK parses"),
            WireInbound::Ok { .. }
        ));
        assert!(matches!(
            parse_wire(&eose_wire("sub-1")).expect("EOSE parses"),
            WireInbound::Eose { .. }
        ));
        assert!(parse_wire(r#"["COUNT",{"kinds":[1]}]"#).is_err());
        assert!(parse_wire(r#"["OK",{"eventId":"x"}]"#).is_err());
        assert!(parse_wire("not json").is_err());
        let oversized = "x".repeat(RELAY_FRAME_CAP + 1);
        assert_eq!(
            parse_wire(&notice_wire(&oversized)).unwrap_err(),
            ContractError::Oversized
        );
        // Raw prose survives parsing but is redacted at translation.
        assert_eq!(redact_notice("weird prose"), "unknown");
        assert_eq!(redact_ok_message("weird prose"), "unknown");
        assert_eq!(redact_closed_message("weird prose"), "unknown");
    }

    #[test]
    fn translator_builds_validated_envelopes_from_wire() {
        // Translation constructs the frozen envelope and validates it; the
        // six classes pass, and prose is redacted to finite codes.
        let ok = translate_wire(
            &parse_wire(&ok_wire(EVENT_ID, true, "accepted")).expect("wire"),
            CONNECTION_ID,
            3,
        )
        .expect("valid OK translates");
        assert_eq!(ok.message_type, "OK");
        assert_eq!(ok.generation, 3);
        assert_eq!(
            ok.payload.get("messageCode").and_then(|v| v.as_str()),
            Some("accepted")
        );
        let ok = translate_wire(
            &parse_wire(&ok_wire(EVENT_ID, false, "relay exploded")).expect("wire"),
            CONNECTION_ID,
            3,
        )
        .expect("rejected OK translates");
        assert_eq!(
            ok.payload.get("messageCode").and_then(|v| v.as_str()),
            Some("unknown")
        );
        assert_eq!(
            ok.payload.get("accepted").and_then(|v| v.as_bool()),
            Some(false)
        );
        // Full EVENT wire with a signed-shaped event validates end to end.
        let event = serde_json::json!({
            "id": "a".repeat(64),
            "pubkey": "b".repeat(64),
            "created_at": 1,
            "kind": 9,
            "tags": [],
            "content": "hello",
            "sig": "c".repeat(128),
        });
        let translated = translate_wire(
            &parse_wire(&event_wire("sub-1", event)).expect("wire"),
            CONNECTION_ID,
            3,
        )
        .expect("EVENT translates");
        assert_eq!(translated.message_type, "EVENT");
        // Oversize and malformed wire fail at the socket seam.
        let oversized = "x".repeat(RELAY_FRAME_CAP + 1);
        assert_eq!(
            parse_inbound(&notice_wire(&oversized), CONNECTION_ID, 3).unwrap_err(),
            ContractError::Oversized
        );
        assert!(parse_inbound(r#"["COUNT",{"kinds":[1]}]"#, CONNECTION_ID, 3).is_err());
    }

    #[test]
    fn handshake_succeeds_and_mints_connection_id() {
        let keys = Keys::generate();
        let socket = FakeSocket::scripted(vec![
            FakeRead::Fixed(Ok(Some(auth_wire("challenge-1")))),
            FakeRead::OkForLastAuth,
        ]);
        let connection = ConnectionFactory::connect_authenticated(
            socket,
            &"a".repeat(64),
            "ws://127.0.0.1:18080",
            &keys,
            7,
            Instant::now(),
        )
        .expect("handshake succeeds");
        assert_eq!(connection.generation, 7);
        assert!(connection.check_authority(&"a".repeat(64)).is_ok());
        assert!(connection.check_authority(&"b".repeat(64)).is_err());
        // The connection id is a fresh helper-minted UUID per handshake.
        assert_eq!(connection.connection_id.len(), 36);
    }

    #[test]
    fn handshake_rejects_timed_out_and_broken_challenges() {
        let keys = Keys::generate();
        // No challenge within budget: spent socket budget fails fast.
        let socket = FakeSocket::scripted(vec![]);
        assert_eq!(
            ConnectionFactory::connect_authenticated(
                socket,
                &"a".repeat(64),
                "ws://127.0.0.1:18080",
                &keys,
                1,
                Instant::now() - AUTH_BUDGET,
            )
            .unwrap_err(),
            ContractError::AuthTimeout
        );
        // Broken socket during the OK wait surfaces relay_closed: the
        // factory reads AUTH first, writes AUTH, then the broken read
        // fails the OK wait deterministically.
        let socket = FakeSocket::scripted(vec![
            FakeRead::Fixed(Ok(Some(auth_wire("challenge-1")))),
            FakeRead::Fixed(Err(ContractError::RelayClosed)),
        ]);
        assert_eq!(
            ConnectionFactory::connect_authenticated(
                socket,
                &"a".repeat(64),
                "ws://127.0.0.1:18080",
                &keys,
                1,
                Instant::now(),
            )
            .unwrap_err(),
            ContractError::RelayClosed
        );
    }

    #[test]
    fn build_auth_event_rejects_long_challenge_and_bad_url() {
        let keys = Keys::generate();
        assert!(build_auth_event(&"c".repeat(65), "ws://127.0.0.1:1", &keys).is_err());
        assert!(build_auth_event("c", "https://example.com", &keys).is_err());
        assert!(build_auth_event("c", "ws://127.0.0.1:18080", &keys).is_ok());
    }

    #[test]
    fn authority_mismatch_fails_before_dispatch() {
        let connection = test_connection();
        assert!(connection.check_authority(&"a".repeat(64)).is_ok());
        assert_eq!(
            connection.check_authority(&"b".repeat(64)).unwrap_err(),
            ContractError::InvalidAuthority
        );
    }

    #[test]
    fn subscription_ceiling_is_enforced() {
        let mut connection = test_connection();
        for index in 0..MAX_SUBSCRIPTIONS {
            connection
                .note_subscribed(&format!("sub-{index}"))
                .expect("within ceiling");
        }
        assert_eq!(
            connection.note_subscribed("one-too-many").unwrap_err(),
            ContractError::Oversized
        );
    }

    #[test]
    fn lifecycle_constructors_reject_unknown_states() {
        assert!(relay_host_lifecycle_event(1, "relay_authenticated", None).is_ok());
        assert!(relay_host_lifecycle_event(1, "ready", Some("relay_closed")).is_ok());
        assert!(relay_host_lifecycle_event(1, "ready", Some("raw relay prose")).is_err());
        assert!(relay_host_lifecycle_event(1, "identity_ready", None).is_err());
    }

    #[test]
    fn error_codes_are_finite_and_redacted() {
        // ContractError carries no payload by construction: codes only.
        for code in [
            ContractError::AuthTimeout,
            ContractError::AuthRejected,
            ContractError::PublishRejected,
            ContractError::RelayClosed,
            ContractError::MalformedFrame,
        ] {
            let rendered = format!("{:?}", code);
            assert!(!rendered.contains("challenge"));
            assert!(!rendered.contains("ws://"));
        }
        assert_eq!(ContractError::AuthTimeout.code(), "auth_timeout");
        assert_eq!(ContractError::AuthRejected.code(), "auth_rejected");
        assert_eq!(ContractError::PublishRejected.code(), "publish_rejected");
        assert_eq!(ContractError::RelayClosed.code(), "relay_closed");
        assert_eq!(ContractError::ConnectTimeout.code(), "connect_timeout");
        assert_eq!(
            ContractError::InvalidConnection.code(),
            "invalid_connection"
        );
        assert_eq!(ContractError::HostUnavailable.code(), "host_unavailable");
        assert_eq!(ContractError::QueueFull.code(), "queue_full");
        assert_eq!(ContractError::Shutdown.code(), "shutdown");
        assert_eq!(ContractError::StaleGeneration.code(), "stale_generation");
        assert_eq!(ContractError::FutureGeneration.code(), "future_generation");
        assert_eq!(ContractError::MalformedFrame.code(), "malformed_frame");
        assert_eq!(ContractError::RequestTimeout.code(), "request_timeout");
    }
}

/// One-use signed-event handle store bound. Handles are publish-bound,
/// current-session singletons; beyond the bound the signer is busy.
pub const MAX_EVENT_HANDLES: usize = 64;

/// Cap for the session-side reorder buffer that backs acknowledgement
/// waits. Streaming frames accumulate here while a publish waits; beyond
/// the cap the waiter fails closed instead of growing memory.
pub const INBOX_BUFFER_CAP: usize = 1024;

/// A bound relay session: trusted hello descriptor, device keys, at most one
/// live connection, one-use signed-event handles, and the streaming inbox.
/// Owned by the host run loop; all socket work inside is absolutely bounded.
pub struct RelaySession {
    hello: RelayHello,
    keys: Keys,
    generation: u64,
    connection: Option<RelayConnection>,
    inbox_tx: mpsc::SyncSender<TypedInbound>,
    inbox_rx: mpsc::Receiver<TypedInbound>,
    inbox_buffer: VecDeque<TypedInbound>,
    handles: HashMap<String, serde_json::Value>,
}

impl RelaySession {
    /// Establish the session from a validated hello descriptor and keyring
    /// service. Keys load from the existing profile file only through the
    /// established custody API; any failure closes the session before bind.
    pub fn establish(
        hello: RelayHello,
        keychain_service: &str,
        generation: u64,
    ) -> ContractResult<Self> {
        use colony_identity_kernel::{load_file_or_generate, ProfileScope};
        let scope = ProfileScope::for_keyring_service(
            hello.user_data_root.clone(),
            keychain_service.to_string(),
        );
        let keys = load_file_or_generate(&scope).map_err(|_| ContractError::HostUnavailable)?;
        let (inbox_tx, inbox_rx) = mpsc::sync_channel(MAX_INBOUND_QUEUE);
        Ok(Self {
            hello,
            keys,
            generation,
            connection: None,
            inbox_tx,
            inbox_rx,
            inbox_buffer: VecDeque::new(),
            handles: HashMap::new(),
        })
    }

    pub fn authority_ref(&self) -> &str {
        &self.hello.authority_ref
    }

    pub fn is_authenticated(&self) -> bool {
        self.connection.is_some()
    }

    pub fn live_connection_id(&self) -> Option<&str> {
        self.connection.as_ref().map(|c| c.connection_id.as_str())
    }

    pub fn connection_state(&self) -> Option<TransportState> {
        self.connection.as_ref().map(|c| c.state())
    }

    /// Dial and run the NIP-42 handshake inside the absolute auth budget,
    /// closing any previous connection within bounds first. Emits nothing;
    /// the caller reports lifecycle transitions.
    pub fn connect(&mut self) -> ContractResult<String> {
        if let Some(previous) = self.connection.as_mut() {
            previous.close();
        }
        self.connection = None;
        let socket_created = Instant::now();
        let dial_deadline = socket_created + CONNECT_TIMEOUT;
        let mut socket =
            TungsteniteSocket::dial(&self.hello.relay_url, dial_deadline).map_err(|error| {
                match error {
                    ContractError::ConnectTimeout => ContractError::ConnectTimeout,
                    _ => ContractError::InvalidConnection,
                }
            })?;
        let _ = &mut socket;
        let mut connection = ConnectionFactory::connect_authenticated(
            socket,
            &self.hello.authority_ref,
            &self.hello.relay_url,
            &self.keys,
            self.generation,
            socket_created,
        )?;
        ConnectionFactory::attach_reader(&mut connection, self.inbox_tx.clone());
        let id = connection.connection_id.clone();
        self.connection = Some(connection);
        Ok(id)
    }

    fn live(&self) -> ContractResult<&RelayConnection> {
        self.connection.as_ref().ok_or(ContractError::AuthRequired)
    }

    fn live_mut(&mut self) -> ContractResult<&mut RelayConnection> {
        self.connection.as_mut().ok_or(ContractError::AuthRequired)
    }

    /// Subscribe a validated filter. The subscription id ceiling is enforced;
    /// streaming traffic arrives on the inbox tagged with this generation.
    pub fn subscribe(
        &mut self,
        subscription_id: &str,
        filter: &serde_json::Value,
    ) -> ContractResult<()> {
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        let live = self.live_mut()?;
        live.note_subscribed(subscription_id)?;
        if let Err(error) = live.send_subscribe(subscription_id, filter, deadline) {
            live.note_unsubscribed(subscription_id);
            return Err(error);
        }
        Ok(())
    }

    pub fn unsubscribe(&mut self, subscription_id: &str) -> ContractResult<()> {
        let deadline = Instant::now() + CLOSE_TIMEOUT;
        match self.live_mut() {
            Ok(live) => live.send_close_subscription(subscription_id, deadline),
            Err(_) => {
                // No live connection: nothing to close; still success-closed.
                Ok(())
            }
        }
    }

    /// Publish the event stored under one-use `handle`. The handle is consumed
    /// even when the relay rejects, so replays cannot double-send. The OK
    /// acknowledgement is awaited on the session inbox because the background
    /// reader owns the socket once attached.
    pub fn publish(&mut self, handle: &str) -> ContractResult<()> {
        let event = self
            .handles
            .remove(handle)
            .ok_or(ContractError::InvalidPayload)?;
        let event_id = event
            .get("id")
            .and_then(|value| value.as_str())
            .ok_or(ContractError::InvalidPayload)?;
        let deadline = Instant::now() + PUBLISH_TIMEOUT;
        let live = self.live()?;
        live.send_publish(&event, deadline)?;
        self.await_ok(event_id, deadline)
    }

    /// Wait for the OK acknowledgement of `event_id` on the session inbox.
    /// Non-matching traffic accumulates in the bounded reorder buffer for
    /// the streaming drain; anything beyond the cap fails closed.
    fn await_ok(&mut self, event_id: &str, deadline: Instant) -> ContractResult<()> {
        loop {
            if let Some(position) = self.inbox_buffer.iter().position(|inbound| {
                inbound.message_type == "OK"
                    && inbound.payload.get("eventId").and_then(|v| v.as_str()) == Some(event_id)
            }) {
                let inbound = match self.inbox_buffer.remove(position) {
                    Some(inbound) => inbound,
                    None => return Err(ContractError::HostUnavailable),
                };
                let accepted = inbound
                    .payload
                    .get("accepted")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                return if accepted {
                    Ok(())
                } else {
                    Err(ContractError::PublishRejected)
                };
            }
            if Instant::now() >= deadline {
                return Err(ContractError::RequestTimeout);
            }
            match self.inbox_rx.recv_timeout(Duration::from_millis(50)) {
                Ok(inbound) => {
                    if inbound.generation == self.generation {
                        if self.inbox_buffer.len() >= INBOX_BUFFER_CAP {
                            return Err(ContractError::QueueFull);
                        }
                        self.inbox_buffer.push_back(inbound);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(ContractError::RelayClosed)
                }
            }
        }
    }

    /// Sign one of the four identity operations per the hashed signing rules
    /// and store the signed event under a fresh one-use handle. Returns the
    /// handle plus the signed event value.
    pub fn sign(
        &mut self,
        operation: &str,
        payload: &serde_json::Value,
    ) -> ContractResult<(String, serde_json::Value)> {
        if self.handles.len() >= MAX_EVENT_HANDLES {
            return Err(ContractError::QueueFull);
        }
        let event = sign_operation(operation, payload, &self.keys)?;
        let event_value =
            serde_json::to_value(&event).map_err(|_| ContractError::InvalidPayload)?;
        let handle = Uuid::new_v4().simple().to_string();
        self.handles.insert(handle.clone(), event_value.clone());
        Ok((handle, event_value))
    }

    /// Graceful connection close within bounds. Handles are cleared; the
    /// session binding itself survives for re-connect.
    pub fn close_connection(&mut self) {
        if let Some(connection) = self.connection.as_mut() {
            connection.close();
        }
        self.connection = None;
        self.handles.clear();
    }

    /// Rebound: drop the socket, clear handles and subscriptions, keep the
    /// trusted hello binding. No new relay work until the next HELLO cycle.
    pub fn abort_all(&mut self) {
        self.close_connection();
        self.drain_inbox();
    }

    /// Non-blocking drain of validated inbound traffic for this generation.
    /// Stale-generation frames are dropped here before delivery. Frames
    /// buffered by an acknowledgement wait drain first, in order.
    pub fn drain_inbox(&mut self) -> Vec<TypedInbound> {
        let mut out = Vec::new();
        while let Some(inbound) = self.inbox_buffer.pop_front() {
            if inbound.generation == self.generation {
                out.push(inbound);
            }
        }
        while let Ok(inbound) = self.inbox_rx.try_recv() {
            if inbound.generation == self.generation {
                out.push(inbound);
            }
        }
        out
    }

    /// Fail the connection closed when its reader died unexpectedly.
    pub fn poll_health(&mut self) -> ContractResult<()> {
        match self.connection.as_ref() {
            None => Ok(()),
            Some(connection) => match connection.poll_reader_health() {
                Ok(()) => Ok(()),
                Err(error) => {
                    self.close_connection();
                    Err(error)
                }
            },
        }
    }

    pub fn is_subscribed(&self, subscription_id: &str) -> bool {
        self.connection
            .as_ref()
            .map(|connection| connection.subscriptions.contains_key(subscription_id))
            .unwrap_or(false)
    }

    /// Drop a subscription record after the relay closes it.
    pub fn note_relay_closed(&mut self, subscription_id: &str) {
        if let Some(connection) = self.connection.as_mut() {
            connection.note_unsubscribed(subscription_id);
        }
    }
}

/// Build and sign one identity operation per the hashed signing policy.
/// Payload shapes are validated by the caller through the frozen registry;
/// construction here follows the same rules and fails closed on mismatch.
fn sign_operation(
    operation: &str,
    payload: &serde_json::Value,
    keys: &Keys,
) -> ContractResult<nostr::Event> {
    use nostr::{Kind, Tag};
    let object = payload.as_object().ok_or(ContractError::InvalidPayload)?;
    let string_field = |name: &str| {
        object
            .get(name)
            .and_then(|value| value.as_str())
            .ok_or(ContractError::InvalidPayload)
    };
    let (kind, content, tags) = match operation {
        "identity-sign/sign_message" => {
            let channel_id = string_field("channelId")?;
            let content = string_field("content")?;
            let mut tags =
                vec![Tag::parse(["h", channel_id]).map_err(|_| ContractError::InvalidTags)?];
            let mentions = object
                .get("mentionPubkeys")
                .and_then(|value| value.as_array())
                .ok_or(ContractError::InvalidPayload)?;
            for mention in mentions {
                let pubkey = mention.as_str().ok_or(ContractError::InvalidPayload)?;
                tags.push(Tag::parse(["p", pubkey]).map_err(|_| ContractError::InvalidTags)?);
            }
            let extras = object
                .get("extraTags")
                .and_then(|value| value.as_array())
                .ok_or(ContractError::InvalidPayload)?;
            for extra in extras {
                let items = extra.as_array().ok_or(ContractError::InvalidPayload)?;
                let strings: Option<Vec<String>> = items
                    .iter()
                    .map(|item| item.as_str().map(str::to_string))
                    .collect();
                let strings = strings.ok_or(ContractError::InvalidPayload)?;
                let refs: Vec<&str> = strings.iter().map(String::as_str).collect();
                tags.push(Tag::parse(refs).map_err(|_| ContractError::InvalidTags)?);
            }
            (Kind::Custom(9), content.to_string(), tags)
        }
        "identity-sign/sign_presence" => {
            let status = string_field("status")?;
            (Kind::Custom(20001), status.to_string(), Vec::new())
        }
        "identity-sign/sign_typing" => {
            let channel_id = string_field("channelId")?;
            let mut tags =
                vec![Tag::parse(["h", channel_id]).map_err(|_| ContractError::InvalidTags)?];
            let parent = object.get("parentEventId").and_then(|v| v.as_str());
            let root = object.get("rootEventId").and_then(|v| v.as_str());
            match (root, parent) {
                (Some(root_id), Some(parent_id)) => {
                    tags.push(
                        Tag::parse(["e", root_id, "", "root"])
                            .map_err(|_| ContractError::InvalidTags)?,
                    );
                    tags.push(
                        Tag::parse(["e", parent_id, "", "reply"])
                            .map_err(|_| ContractError::InvalidTags)?,
                    );
                }
                (None, Some(parent_id)) => {
                    tags.push(
                        Tag::parse(["e", parent_id, "", "reply"])
                            .map_err(|_| ContractError::InvalidTags)?,
                    );
                }
                _ => {}
            }
            (Kind::Custom(20002), String::new(), tags)
        }
        "identity-sign/sign_user_status" => {
            let text = string_field("text")?;
            let mut tags =
                vec![Tag::parse(["d", "general"]).map_err(|_| ContractError::InvalidTags)?];
            if let Some(emoji) = object.get("emoji").and_then(|v| v.as_str()) {
                if !emoji.is_empty() {
                    tags.push(
                        Tag::parse(["emoji", emoji]).map_err(|_| ContractError::InvalidTags)?,
                    );
                }
            }
            if let Some(expires) = object.get("expiresAt").and_then(|v| v.as_u64()) {
                tags.push(
                    Tag::parse(["expiration", &expires.to_string()])
                        .map_err(|_| ContractError::InvalidTags)?,
                );
            }
            (Kind::Custom(30315), text.to_string(), tags)
        }
        _ => return Err(ContractError::UnknownOperation),
    };
    EventBuilder::new(kind, content)
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|_| ContractError::InvalidPayload)
}

#[cfg(test)]
mod session_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "relay-transport-test-{}-{}-{}",
            name,
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&root).expect("temp root");
        root
    }

    fn test_hello(root: &std::path::Path) -> RelayHello {
        RelayHello {
            relay_url: "ws://127.0.0.1:18080".to_string(),
            authority_ref: "a".repeat(64),
            user_data_root: root.to_string_lossy().to_string(),
            flavor: "normal".to_string(),
        }
    }

    fn establish_in(root: &std::path::Path) -> RelaySession {
        RelaySession::establish(test_hello(root), "relay-transport-test-service", 1)
            .expect("session establishes")
    }

    fn event_tags(event: &serde_json::Value) -> Vec<Vec<String>> {
        event
            .get("tags")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|tag| {
                tag.as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .collect()
    }

    #[test]
    fn establish_generates_and_reloads_test_profile_keys() {
        let root = temp_root("establish");
        let first = establish_in(&root);
        let _ = first;
        // Second establish on the same root reloads the same identity.
        let second = establish_in(&root);
        let _ = second;
        let scope = colony_identity_kernel::ProfileScope::for_keyring_service(
            root.to_string_lossy().to_string(),
            "relay-transport-test-service".to_string(),
        );
        let keys = colony_identity_kernel::load_file_or_generate(&scope).expect("reload");
        let _ = keys.public_key().to_hex();
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sign_message_builds_h_tag_mentions_and_extras() {
        let root = temp_root("sign-message");
        let mut session = establish_in(&root);
        let payload = serde_json::json!({
            "connectionId": "11111111-1111-1111-1111-111111111111",
            "channelId": "channel-1",
            "content": "hello",
            "mentionPubkeys": ["b".repeat(64)],
            "extraTags": [["broadcast", "1"]],
        });
        let (handle, event) = session
            .sign("identity-sign/sign_message", &payload)
            .expect("signs");
        assert_eq!(handle.len(), 32);
        assert_eq!(event.get("kind").and_then(|v| v.as_u64()), Some(9));
        assert_eq!(
            event_tags(&event),
            vec![
                vec!["h".to_string(), "channel-1".to_string()],
                vec!["p".to_string(), "b".repeat(64)],
                vec!["broadcast".to_string(), "1".to_string()],
            ]
        );
        // Handles are one-use: resolving consumes them.
        assert!(session.handles.contains_key(&handle));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sign_typing_and_status_follow_hashed_construction() {
        let root = temp_root("sign-shapes");
        let mut session = establish_in(&root);
        let typing = serde_json::json!({
            "connectionId": "11111111-1111-1111-1111-111111111111",
            "channelId": "channel-1",
            "parentEventId": "c".repeat(64),
            "rootEventId": "d".repeat(64),
        });
        let (_, event) = session
            .sign("identity-sign/sign_typing", &typing)
            .expect("signs typing");
        assert_eq!(event.get("kind").and_then(|v| v.as_u64()), Some(20002));
        assert_eq!(
            event_tags(&event),
            vec![
                vec!["h".to_string(), "channel-1".to_string()],
                vec![
                    "e".to_string(),
                    "d".repeat(64),
                    String::new(),
                    "root".to_string()
                ],
                vec![
                    "e".to_string(),
                    "c".repeat(64),
                    String::new(),
                    "reply".to_string()
                ],
            ]
        );
        let status = serde_json::json!({
            "connectionId": "11111111-1111-1111-1111-111111111111",
            "text": "away",
            "emoji": "zzz",
            "expiresAt": 99,
        });
        let (_, event) = session
            .sign("identity-sign/sign_user_status", &status)
            .expect("signs status");
        assert_eq!(event.get("kind").and_then(|v| v.as_u64()), Some(30315));
        assert_eq!(
            event_tags(&event),
            vec![
                vec!["d".to_string(), "general".to_string()],
                vec!["emoji".to_string(), "zzz".to_string()],
                vec!["expiration".to_string(), "99".to_string()],
            ]
        );
        let presence = serde_json::json!({
            "connectionId": "11111111-1111-1111-1111-111111111111",
            "status": "online",
        });
        let (_, event) = session
            .sign("identity-sign/sign_presence", &presence)
            .expect("signs presence");
        assert_eq!(event.get("kind").and_then(|v| v.as_u64()), Some(20001));
        assert!(event_tags(&event).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn unknown_handles_and_full_store_fail_closed() {
        let root = temp_root("handles");
        let mut session = establish_in(&root);
        assert_eq!(
            session.publish("no-such-handle").unwrap_err(),
            ContractError::InvalidPayload
        );
        for _ in 0..MAX_EVENT_HANDLES {
            let payload = serde_json::json!({
                "connectionId": "11111111-1111-1111-1111-111111111111",
                "status": "online",
            });
            session
                .sign("identity-sign/sign_presence", &payload)
                .expect("stores");
        }
        let payload = serde_json::json!({
            "connectionId": "11111111-1111-1111-1111-111111111111",
            "status": "online",
        });
        assert_eq!(
            session
                .sign("identity-sign/sign_presence", &payload)
                .unwrap_err(),
            ContractError::QueueFull
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn abort_clears_connection_handles_and_inbox() {
        let root = temp_root("abort");
        let mut session = establish_in(&root);
        let payload = serde_json::json!({
            "connectionId": "11111111-1111-1111-1111-111111111111",
            "status": "online",
        });
        let (handle, _) = session
            .sign("identity-sign/sign_presence", &payload)
            .expect("stores");
        session.abort_all();
        assert!(!session.is_authenticated());
        assert_eq!(
            session.publish(&handle).unwrap_err(),
            ContractError::InvalidPayload
        );
        assert!(session.drain_inbox().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    const LIVE_ID: &str = "11111111-1111-1111-1111-111111111111";

    fn attach_live_connection(session: &mut RelaySession) {
        let connection = RelayConnection {
            socket: Arc::new(Mutex::new(
                Box::new(FakeSocket::scripted(vec![])) as Box<dyn SocketIo>
            )),
            reader_shutdown: Arc::new(AtomicBool::new(false)),
            reader_handle: None,
            reader_alive: Arc::new(AtomicBool::new(true)),
            reader_failed: Arc::new(Mutex::new(None)),
            connection_id: LIVE_ID.to_string(),
            generation: session.generation,
            authority_ref: "a".repeat(64),
            state: TransportState::Authenticated,
            subscriptions: HashMap::new(),
        };
        session.generation = 1;
        session.connection = Some(connection);
    }

    fn presence_payload() -> serde_json::Value {
        serde_json::json!({
            "connectionId": LIVE_ID,
            "status": "online",
        })
    }

    fn inject_ok(session: &RelaySession, event_id: &str, accepted: bool, code: &str) {
        // Inbox entries arrive only via translate_wire in production; build
        // the entry through the same seam so the test cannot hand-write an
        // envelope the wire would never produce.
        let inbound = translate_wire(
            &parse_wire(&ok_wire(event_id, accepted, code)).expect("test wire parses"),
            "11111111-1111-1111-1111-111111111111",
            1,
        )
        .expect("test translation validates");
        session
            .inbox_tx
            .send(inbound)
            .expect("inbox accepts test frame");
    }

    #[test]
    fn publish_consumes_handles_and_maps_acceptance() {
        let root = temp_root("publish-accept");
        let mut session = establish_in(&root);
        // No live connection: the handle is still consumed, then auth fails.
        let (handle, _) = session
            .sign("identity-sign/sign_presence", &presence_payload())
            .expect("stores");
        assert_eq!(
            session.publish(&handle).unwrap_err(),
            ContractError::AuthRequired
        );
        assert!(!session.handles.contains_key(&handle));
        // Live connection with an injected accepted OK publishes cleanly.
        let (handle, event) = session
            .sign("identity-sign/sign_presence", &presence_payload())
            .expect("stores");
        let event_id = event
            .get("id")
            .and_then(|value| value.as_str())
            .expect("signed id")
            .to_string();
        attach_live_connection(&mut session);
        assert_eq!(
            session.connection_state(),
            Some(TransportState::Authenticated)
        );
        inject_ok(&session, &event_id, true, "accepted");
        assert!(session.publish(&handle).is_ok());
        assert!(!session.handles.contains_key(&handle));
        // A rejected OK surfaces publish_rejected and still consumes.
        let (handle, event) = session
            .sign("identity-sign/sign_presence", &presence_payload())
            .expect("stores");
        let event_id = event
            .get("id")
            .and_then(|value| value.as_str())
            .expect("signed id")
            .to_string();
        inject_ok(&session, &event_id, false, "not_authorized");
        assert_eq!(
            session.publish(&handle).unwrap_err(),
            ContractError::PublishRejected
        );
        assert!(!session.handles.contains_key(&handle));
        std::fs::remove_dir_all(&root).ok();
    }
}

/// Map a `(capability, method)` pair from the host envelope to the frozen
/// operation literal plus its deadline. Unknown pairs fail closed with the
/// host protocol codes the caller translates to responses.
pub fn relay_operation_for(
    capability: &str,
    method: &str,
) -> Result<(&'static str, &'static str, Duration), &'static str> {
    let operation: &'static str = match (capability, method) {
        ("relay-transport", "connect") => "relay-transport/connect",
        ("relay-transport", "authenticate") => "relay-transport/authenticate",
        ("relay-transport", "subscribe") => "relay-transport/subscribe",
        ("relay-transport", "close_subscription") => "relay-transport/close_subscription",
        ("relay-transport", "publish") => "relay-transport/publish",
        ("relay-transport", "close") => "relay-transport/close",
        ("identity-sign", "sign_message") => "identity-sign/sign_message",
        ("identity-sign", "sign_presence") => "identity-sign/sign_presence",
        ("identity-sign", "sign_typing") => "identity-sign/sign_typing",
        ("identity-sign", "sign_user_status") => "identity-sign/sign_user_status",
        ("relay-transport", _) | ("identity-sign", _) => return Err("unknown_method"),
        _ => return Err("unknown_capability"),
    };
    let (expected_capability, deadline) = match relay_operation(operation) {
        Ok(mapping) => mapping,
        Err(_) => return Err("unknown_method"),
    };
    Ok((operation, expected_capability, deadline))
}
