//! Isolated synthetic PCM/audio-output contract for Phase 1 Huddle parity.
//!
//! Scope: this crate pins the smallest host-neutral extraction of the upstream
//! Huddle/raw-PCM/audio-output transport that can be proven without touching a
//! microphone, speaker, relay, or the shared host binary. It owns constants,
//! the v2 frame-header codec, ordering/cancellation/generation rules, and the
//! bounded base64/device-name validators. It performs no audio I/O, no Opus
//! encode/decode, no jitter-buffer playout, and no Electron/JS wiring.
//!
//! Upstream baseline (`origin/develop` in `colony-ai`, Buzz behavior at
//! `ef2aa1ae`):
//!
//! - `desktop/src-tauri/src/huddle/wire.rs`: v2 8-byte header (`seq` u16 BE
//!   wrapping +1/frame, `ts_48k` u32 BE +960 per 20 ms frame, `level_dbov` i8
//!   clamped to `-127..=0`, `flags` u8 with bit 0 = DTX and all other bits
//!   ignored); relay prefixes one `peer_index: u8` on receive.
//! - `desktop/src-tauri/src/huddle/jitter.rs`: 48 kHz mono, 20 ms encoder
//!   frames, 10 ms NetEq playout ticks (480 `f32` samples per `get_audio`).
//! - `desktop/src-tauri/src/huddle/relay_api.rs`: `pcm_rx`
//!   `mpsc::channel::<Vec<u8>>(50)` send queue; per-connection
//!   `CancellationToken`; dropping the sender or `cancel()` shuts the relay
//!   task down; TTS 24 kHz is upsampled 2x to 48 kHz and chunked into 960-
//!   sample frames.
//! - `desktop/src-tauri/src/huddle/audio_output.rs`: `rodio`/`cpal` device
//!   enumeration `(name, is_default)`; preferred-device name takes effect on
//!   the next join with fallback to the system default.
//! - `desktop/src-tauri/src/huddle/playout.rs`: ordered per-peer playout,
//!   500 ms speaker ticks, 500 ms idle grace, queue-depth recovery.
//!
//! Host framing (`phase-1-design/host-protocol`): `@colony-native:` newline
//! envelopes, 16 MiB frame cap, 8 MiB JSON/depth-32 cap, 8 MiB bounded base64
//! binary field with declared decoded length, 128 in-flight requests, 64-frame
//! outbound queue, 10 s default deadline, best-effort `CANCEL(requestId)`,
//! monotonic transport `generationId` fencing, at-most-one terminal response,
//! no automatic retry of effectful work.
//!
//! What this crate proves (synthetic/contract only): header round-trips, level
//! clamping, reserved-flag tolerance, short-frame rejection, wrapping sequence
//! ordering, timestamp deltas, base64 bounds, device-name validation,
//! cancellation state transitions with late-completion discard, and generation
//! fencing. Real microphone capture, speaker playout, Opus, NetEq/jitter,
//! relay audio sockets, and renderer/Electron playback remain future hosted
//! gates and are explicitly not claimed here.

/// Audio sample rate for Huddle voice transport (Opus VoIP, mono).
pub const SAMPLE_RATE_HZ: u32 = 48_000;
/// Channel count: mono.
pub const CHANNELS: u8 = 1;
/// Encoder frame duration in milliseconds.
pub const FRAME_DURATION_MS: u32 = 20;
/// Canonical 20 ms PCM frame: 960 `f32` samples at 48 kHz mono.
pub const FRAME_SAMPLES_20MS: usize = 960;
/// 48 kHz media-time increment per encoder frame.
pub const FRAME_TIMESTAMP_DELTA: u32 = 960;
/// Playout tick granularity in milliseconds.
pub const PLAYOUT_TICK_MS: u32 = 10;
/// Samples per 10 ms playout tick at 48 kHz mono.
pub const PLAYOUT_SAMPLES_10MS: usize = 480;
/// Upstream PCM send-queue depth (`mpsc` bound in `relay_api.rs`).
pub const PCM_QUEUE_DEPTH: usize = 50;

/// Wire protocol version this contract speaks (v2 frame layout).
pub const PROTOCOL_VERSION: u8 = 2;
/// Length of the v2 per-frame header in bytes.
pub const V2_HEADER_LEN: usize = 8;
/// Flag bit for DTX / comfort-noise frames.
pub const FLAG_DTX: u8 = 0x01;
/// Bits outside `FLAG_DTX` are reserved and must be ignored on decode.
pub const RESERVED_FLAG_MASK: u8 = !FLAG_DTX;

/// Maximum decoded binary payload per host frame (host-protocol candidate).
pub const MAX_BINARY_BYTES_PER_FRAME: usize = 8 * 1024 * 1024;
/// Maximum envelope size including prefix (host-protocol candidate).
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
/// Maximum in-flight audio requests per host session.
pub const MAX_IN_FLIGHT_AUDIO_REQUESTS: usize = 128;
/// Maximum audio device-name length in bytes.
pub const MAX_DEVICE_NAME_BYTES: usize = 256;

/// Parsed view of one v2 header. Cheap (`Copy`). Semantics mirror
/// `desktop/src-tauri/src/huddle/wire.rs::FrameHeader`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    /// Sender-authored wrapping sequence number (+1 per packet).
    pub seq: u16,
    /// Sender-authored 48 kHz RTP-style media timestamp (+960 per frame).
    pub ts_48k: u32,
    /// Audio level in dBov, canonical range `-127..=0`.
    pub level_dbov: i8,
    /// Raw flags byte; only `FLAG_DTX` is inspected.
    pub flags: u8,
}

impl FrameHeader {
    /// Encode `self` into 8 bytes, network byte order.
    pub fn encode(self) -> [u8; V2_HEADER_LEN] {
        let mut out = [0u8; V2_HEADER_LEN];
        out[0..2].copy_from_slice(&self.seq.to_be_bytes());
        out[2..6].copy_from_slice(&self.ts_48k.to_be_bytes());
        out[6] = self.level_dbov as u8;
        out[7] = self.flags;
        out
    }

    /// Parse a v2 header from the leading 8 bytes of `bytes`, returning
    /// `(header, remainder)`. `level_dbov` is clamped into `-127..=0`;
    /// out-of-range telemetry coerces to `-127` without dropping the frame.
    /// Returns `None` when fewer than 8 bytes are available.
    pub fn parse(bytes: &[u8]) -> Option<(Self, &[u8])> {
        if bytes.len() < V2_HEADER_LEN {
            return None;
        }
        let seq = u16::from_be_bytes([bytes[0], bytes[1]]);
        let ts_48k = u32::from_be_bytes([bytes[2], bytes[3], bytes[4], bytes[5]]);
        let raw_level = bytes[6] as i8;
        let level_dbov = if (-127..=0).contains(&raw_level) {
            raw_level
        } else {
            -127
        };
        let flags = bytes[7];
        Some((
            Self {
                seq,
                ts_48k,
                level_dbov,
                flags,
            },
            &bytes[V2_HEADER_LEN..],
        ))
    }

    /// True for DTX / comfort-noise frames.
    pub fn is_dtx(self) -> bool {
        self.flags & FLAG_DTX != 0
    }
}

/// Wrapping "is `next` newer than `prev`?" comparison for 16-bit sequence
/// numbers. A forward distance in `1..=32768` counts as newer; zero and the
/// far half of the ring count as stale/duplicate, so a delayed packet from a
/// previous occupant can never fence out fresh frames after reassignment.
pub fn seq_is_newer(prev: u16, next: u16) -> bool {
    let distance = next.wrapping_sub(prev);
    distance != 0 && distance <= 0x8000
}

/// Expected timestamp delta for `frame_count` consecutive 20 ms frames.
pub fn expected_ts_delta(frame_count: u32) -> u32 {
    frame_count.wrapping_mul(FRAME_TIMESTAMP_DELTA)
}

/// Validate that `declared_len` (decoded bytes) fits the host binary bound
/// and that `base64_len` (encoded chars, no whitespace) can actually carry
/// exactly that many bytes: `ceil(declared_len / 3) * 4` with `=` padding
/// allowed only as the final 1-2 characters. Pure length math; no decoding.
pub fn validate_bounded_base64_field(
    base64_len: usize,
    declared_len: usize,
) -> Result<(), &'static str> {
    if declared_len > MAX_BINARY_BYTES_PER_FRAME {
        return Err("binary_too_large");
    }
    if declared_len == 0 {
        return if base64_len == 0 {
            Ok(())
        } else {
            Err("length_mismatch")
        };
    }
    let full_groups = declared_len / 3;
    let remainder = declared_len % 3;
    let expected_len = full_groups
        .checked_mul(4)
        .and_then(|full| full.checked_add(if remainder == 0 { 0 } else { 4 }))
        .ok_or("binary_too_large")?;
    if base64_len != expected_len {
        return Err("length_mismatch");
    }
    if expected_len > MAX_FRAME_BYTES {
        return Err("frame_too_large");
    }
    Ok(())
}

/// Validate a preferred audio-output device name. Empty selects the system
/// default (upstream `set_audio_output_device` semantics). Non-empty names
/// must be 1-256 bytes of printable UTF-8 with no NUL, newline, or carriage
/// return; path separators and `..` are rejected so a device name can never
/// smuggle a filesystem path into the host.
pub fn validate_output_device_name(name: &str) -> Result<(), &'static str> {
    if name.is_empty() {
        return Ok(());
    }
    let len = name.len();
    if len > MAX_DEVICE_NAME_BYTES {
        return Err("device_name_too_long");
    }
    if name.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r') {
        return Err("device_name_invalid");
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("device_name_invalid");
    }
    Ok(())
}

/// Lifecycle of one host-bound audio request. Mirrors the host-protocol
/// contract: at most one terminal outcome, best-effort cancellation, late
/// completions discarded, effectful work never auto-retried by the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioRequestState {
    Pending,
    Completed,
    Cancelled,
    TimedOut,
}

/// Apply one transition to `state`. `complete_after_terminal` models a late
/// completion arriving after cancel/timeout: it is discarded (`Ok(false)`)
/// and never resurrects the request. Returns `Ok(true)` when the transition
/// produced the terminal outcome, `Err` for illegal transitions.
pub fn transition_audio_request(
    state: &mut AudioRequestState,
    event: AudioRequestEvent,
) -> Result<bool, &'static str> {
    match (*state, event) {
        (AudioRequestState::Pending, AudioRequestEvent::Complete) => {
            *state = AudioRequestState::Completed;
            Ok(true)
        }
        (AudioRequestState::Pending, AudioRequestEvent::Cancel) => {
            *state = AudioRequestState::Cancelled;
            Ok(true)
        }
        (AudioRequestState::Pending, AudioRequestEvent::Timeout) => {
            *state = AudioRequestState::TimedOut;
            Ok(true)
        }
        (
            AudioRequestState::Cancelled | AudioRequestState::TimedOut,
            AudioRequestEvent::Complete,
        ) => Ok(false),
        (AudioRequestState::Completed, AudioRequestEvent::Complete) => Ok(false),
        _ => Err("illegal_transition"),
    }
}

/// Events that can resolve one audio request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioRequestEvent {
    Complete,
    Cancel,
    Timeout,
}

/// Generation fence for transport bindings. `current` is the host's active
/// transport generation; frames carrying any other generation are dropped
/// from user state and must never resurrect old subscriptions, low-level
/// WebSocket handles, or playout queues.
pub fn generation_is_current(current: u64, frame_generation: u64) -> bool {
    current != 0 && frame_generation == current
}

/// True when `in_flight` has reached the host session cap; excess requests
/// must fail with `host_busy` without allocation.
pub fn audio_backpressure(in_flight: usize) -> bool {
    in_flight >= MAX_IN_FLIGHT_AUDIO_REQUESTS
}

/// Validate one canonical 20 ms PCM frame length in samples.
pub fn validate_pcm_frame_samples(sample_count: usize) -> Result<(), &'static str> {
    if sample_count == FRAME_SAMPLES_20MS {
        Ok(())
    } else {
        Err("pcm_frame_must_be_960_samples")
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn header_round_trip_preserves_fields() {
        let header = FrameHeader {
            seq: 41,
            ts_48k: 960 * 41,
            level_dbov: -30,
            flags: 0,
        };
        let bytes = header.encode();
        let (parsed, rest) = FrameHeader::parse(&bytes).expect("8-byte header parses");
        assert_eq!(parsed, header);
        assert!(rest.is_empty());
    }
}
