//! Isolated host-neutral PTY contract for Phase 1 terminal parity.
//!
//! Scope: this crate pins the host-neutral event interface and the
//! transport state machine the extracted PTY service must obey, proven
//! without spawning a PTY, touching the desktop UI runtime, or wiring
//! the shared host binary. It owns constants, the wire event/request
//! shapes, the credit and viewport-ordering state machine (a faithful
//! port of the upstream transport module), the wire wireframe mapper,
//! and the scroll-sign crossing. Real PTY spawn, reader threads, renderer
//! channels, and host-binary dispatch are explicitly future work owned by
//! the native-owner integration step, not claimed here.
//!
//! Upstream baseline (`origin/develop` in `colony-ai`):
//!
//! - `desktop/src-tauri/src/terminal_runtime.rs`: `TerminalSessions`,
//!   `terminal_attach/detach/close/input/resize/scroll/ack/viewport_ready/`
//!   `focus`, PTY spawn via `portable_pty`, reader/action threads,
//!   channel-based message delivery, `MAX_LIVE_SESSIONS = 20`,
//!   `MAX_INPUT_BYTES = 1 MiB`, non-zero dimension guard.
//! - Upstream transport module: `FramePublisher`
//!   credit (one frame in flight, at most one pending snapshot), viewport
//!   generation gating, `attach/offer/acknowledge/viewport_ready/fault/`
//!   `close`, `SubscriptionId`, `OfferError::PendingFrameMustBeSnapshot`.
//! - Engine: `desktop/src-tauri/crates/buzz-terminal/*` (grid, parser,
//!   damage encoding, lifecycle/shutdown ordering, scroll-sign crossing),
//!   linked here as a path dependency so the extracted state machine
//!   operates on the real frame types.
//!
//! Host framing (`phase-1-design/host-protocol`): `@colony-native:` newline
//! envelopes, 16 MiB frame cap, 8 MiB JSON/depth-32 cap, 8 MiB bounded
//! base64 binary field with declared decoded length (or a reviewed
//! equivalent), 128 in-flight requests, 64-frame outbound queue, 10 s
//! default deadline. Terminal frames ride the host pipe as typed events,
//! never as an untyped invoke tunnel.
//!
//! What this crate proves (contract only): credit/backpressure ordering,
//! viewport-generation gating, attach/reattach bootstrap semantics,
//! resize-ack/viewport-ready interleavings, fault/close detachment,
//! input/resize/scroll bounds, the wire wireframe mapper (soft-wrap
//! metadata, cluster expansion, atomic multi-char clusters, inconsistent
//! span rejection), the DOM-to-engine scroll-sign crossing, and
//! bounded-buffer/session-cap failure behavior. Real PTY output, input
//! echo, resize propagation into a live pty, child exit, and renderer
//! delivery remain the hosted runtime gate and are explicitly not claimed
//! here.

pub mod adapter;
pub mod events;
pub mod publisher;
pub mod scroll;
pub mod wire;

pub use events::{
    AckRequest, AttachRequest, AttachResponse, CloseRequest, DetachRequest, FocusRequest,
    InputRequest, Request, ResizeRequest, ScrollRequest, TerminalEvent, Viewport, ViewportConfirm,
};
pub use publisher::{FramePublisher, FrameViewport, OfferError, Publication, SubscriptionId};
pub use scroll::{dom_lines_to_engine, DomLines};
pub use wire::{wire_frame, WireCursor, WireFrame, WireRow, WireSpan, WireStyle, WireViewport};

/// Maximum concurrent terminal sessions.
///
/// Mirrors `MAX_LIVE_SESSIONS` in upstream `terminal_runtime.rs` (itself
/// kept from the abandoned `feat/terminal` branch): each session costs a
/// pty pair, a reader thread, and a scrollback grid, and tab creation is
/// one keystroke with nothing else bounding it.
pub const MAX_LIVE_SESSIONS: usize = 20;

/// Maximum input payload in bytes per `terminal_input` call.
///
/// Mirrors `MAX_INPUT_BYTES` in upstream `terminal_runtime.rs`.
pub const MAX_INPUT_BYTES: usize = 1024 * 1024;

/// Maximum in-flight host requests per session (host-protocol candidate).
pub const MAX_IN_FLIGHT_REQUESTS: usize = 128;

/// Validate an input payload length against the upstream 1 MiB gate.
pub fn validate_input_bytes(len: usize) -> Result<(), &'static str> {
    if len <= MAX_INPUT_BYTES {
        Ok(())
    } else {
        Err("terminal input exceeds 1 MiB")
    }
}

/// Validate terminal dimensions: both axes must be non-zero.
///
/// Mirrors the `size()` guard in upstream `terminal_runtime.rs`. Scrollback
/// stays the engine default (10_000); this contract does not renegotiate it.
pub fn validate_dimensions(columns: u16, rows: u16) -> Result<(), &'static str> {
    if columns == 0 || rows == 0 {
        return Err("terminal dimensions must be non-zero");
    }
    Ok(())
}

/// True when `live_sessions` has reached the session cap; excess attaches
/// must fail with a bounded error without allocating a PTY.
pub fn session_backpressure(live_sessions: usize) -> bool {
    live_sessions >= MAX_LIVE_SESSIONS
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn dimensions_reject_zero() {
        assert!(validate_dimensions(0, 24).is_err());
        assert!(validate_dimensions(80, 0).is_err());
        assert!(validate_dimensions(80, 24).is_ok());
    }

    #[test]
    fn input_gate_matches_upstream_1mib() {
        assert!(validate_input_bytes(0).is_ok());
        assert!(validate_input_bytes(MAX_INPUT_BYTES).is_ok());
        assert!(validate_input_bytes(MAX_INPUT_BYTES + 1).is_err());
    }

    #[test]
    fn session_cap_trips_only_at_twenty() {
        assert!(!session_backpressure(0));
        assert!(!session_backpressure(19));
        assert!(session_backpressure(20));
        assert!(session_backpressure(100));
    }
}
