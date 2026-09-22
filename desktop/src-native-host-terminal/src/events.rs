//! Host-neutral terminal event and request shapes.
//!
//! These types describe the PTY service boundary without naming the
//! desktop UI runtime, Electron, or any renderer transport. A host binary
//! maps them onto its pipe frames; a shell adapter maps them onto window
//! operations. The shapes mirror the upstream command surface
//! (`terminal_attach`, `terminal_detach`, `terminal_close`,
//! `terminal_input`, `terminal_resize`, `terminal_scroll`,
//! `terminal_ack`, `terminal_viewport_ready`, `terminal_focus`) and the
//! message event union, with the UI-runtime channel and state parameters
//! removed.

use serde::{Deserialize, Serialize};

use crate::wire::{WireFrame, WireViewport};

/// Viewport identity: generation plus geometry, compared as one value.
///
/// Mirrors upstream `Viewport`/`WireViewport`: a consumer that compares
/// generation and dimensions field-by-field can compare two of three and
/// be wrong on a resize that changes only the one it skipped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub generation: u64,
    pub columns: usize,
    pub screen_lines: usize,
}

/// Attach (or reattach) a renderer subscription to a PTY-backed session.
///
/// `session_id` present means remount onto an existing session; absent
/// means spawn. Mirrors the upstream attach request exactly, minus the
/// UI-runtime channel which becomes the host's event sink.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachRequest {
    pub session_id: Option<String>,
    pub channel_id: String,
    pub channel_name: String,
    pub thread_id: Option<String>,
    pub npub: String,
    pub relay_url: String,
    pub columns: u16,
    pub rows: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

/// Successful attach: the session, the new subscription, and the viewport
/// the bootstrap snapshot describes. Mirrors `AttachResponse`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachResponse {
    pub session_id: String,
    pub subscription_id: String,
    pub viewport: Viewport,
}

/// Resize request. Returns the applied viewport (not necessarily the
/// requested one: same-size resizes are inert). Mirrors `terminal_resize`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeRequest {
    pub session_id: String,
    pub columns: u16,
    pub rows: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

/// Input request. `data` is UTF-8 text; the 1 MiB gate applies to its byte
/// length. Mirrors `terminal_input`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRequest {
    pub session_id: String,
    pub data: String,
}

/// Scroll request in DOM wheel cells; sign conversion happens once at the
/// command boundary (see `crate::scroll`). Mirrors `terminal_scroll`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollRequest {
    pub session_id: String,
    pub lines: i32,
}

/// Renderer confirmation that a frame was consumed. Mirrors `terminal_ack`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckRequest {
    pub session_id: String,
    pub subscription_id: String,
    pub sequence: u64,
}

/// Renderer confirmation that the resize result was installed. Mirrors
/// `terminal_viewport_ready`. Equality against the applied viewport is the
/// entire policy: old subscription IDs and superseded values are inert.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportConfirm {
    pub session_id: String,
    pub subscription_id: String,
    pub viewport: Viewport,
}

/// Focus report. Mirrors `terminal_focus`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusRequest {
    pub session_id: String,
    pub focused: bool,
}

/// Detach request. Mirrors `terminal_detach`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachRequest {
    pub session_id: String,
    pub subscription_id: String,
}

/// Close request. Mirrors `terminal_close`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequest {
    pub session_id: String,
}

/// Every renderer-to-host terminal request in one enum, so the host
/// registry can name each variant explicitly. There is no generic
/// "invoke any function" tunnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum Request {
    Attach(AttachRequest),
    Detach(DetachRequest),
    Close(CloseRequest),
    Input(InputRequest),
    Resize(ResizeRequest),
    Scroll(ScrollRequest),
    Ack(AckRequest),
    ViewportReady(ViewportConfirm),
    Focus(FocusRequest),
}

/// Every host-to-renderer terminal event in one enum.
///
/// Mirrors upstream `TerminalMessage` (`Frame`, `Title`, `ResetTitle`,
/// `Bell`, `Exit`) with the frame payload in host-neutral wire form.
/// Ordering and credit rules are owned by `crate::publisher`, not by
/// this enum: at most one frame in flight per subscription, events for a
/// fenced generation never emitted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum TerminalEvent {
    Frame(WireFrame),
    Title(String),
    ResetTitle,
    Bell,
    Exit,
}

impl From<WireViewport> for Viewport {
    fn from(value: WireViewport) -> Self {
        Self {
            generation: value.generation,
            columns: value.columns,
            screen_lines: value.screen_lines,
        }
    }
}

impl From<Viewport> for WireViewport {
    fn from(value: Viewport) -> Self {
        Self {
            generation: value.generation,
            columns: value.columns,
            screen_lines: value.screen_lines,
        }
    }
}
