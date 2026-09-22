//! Terminal-owned dispatch/event adapter: the native-owner-applyable
//! shape of the shared-side patch, expressed against terminal-owned
//! types only.
//!
//! This module is the concrete proposal the native owner sequences into
//! `desktop/src-native-host` (registry entries, dispatch arms, event
//! emission, rebind-fault hook, Cargo path-dep). It contains no shared
//! file edits: every item here names the exact shared location, the
//! exact terminal-owned validator it calls, and the exact failure code
//! on violation. The native owner applies the mechanically-described
//! edits at schedule time; until then this module is verified by tests
//! that drive the terminal-owned side of each boundary.
//!
//! Agreed interfaces (native owner `bc9add6f`, root-witnessed):
//!
//! 1. Payloads: per-method validated request schemas under the
//!    `terminal-pty` capability (no envelope change; the `{}` rule is
//!    identity-lane-specific).
//! 2. Responses: shape-only entries in the v2 `payloadSchemas` table
//!    (`attach-response`, `terminal-viewport`, `terminal-ack`); byte
//!    bounds enforced in Rust dispatch.
//! 3. Frame events ride the existing `EVENT` envelope with new event
//!    names (`terminal-frame`, `terminal-title`, `terminal-bell`,
//!    `terminal-exit`) under a new `terminal-event` schema; no new
//!    outbound kind or frame type.
//! 4. Capability `terminal-pty`, renderer-to-host, `binary: false`;
//!    `deadlineClass` standard for control ops
//!    (attach/detach/viewport-ready/focus), request for
//!    input/resize/scroll/ack paths.
//! 5. Path dep applied native-side at schedule time:
//!    `colony_native_host_terminal = { path = "../src-native-host-terminal" }`
//!    (no features).
//! 6. Rebind: native side owns the reject-pending hook; terminal side
//!    owns only the `fault()` call surface (subscriptions drop, PTY
//!    sessions survive).

use serde::{Deserialize, Serialize};

/// Capability string the registry entry must carry.
pub const TERMINAL_CAPABILITY: &str = "terminal-pty";

/// Event names for host-to-renderer terminal events on the existing
/// `EVENT` envelope.
pub const EVENT_FRAME: &str = "terminal-frame";
pub const EVENT_TITLE: &str = "terminal-title";
pub const EVENT_BELL: &str = "terminal-bell";
pub const EVENT_EXIT: &str = "terminal-exit";

/// Terminal methods and their deadline classes, in registry-entry order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MethodSpec {
    pub method: &'static str,
    pub deadline_class: DeadlineClass,
    pub deadline_ms: u64,
    pub request_schema: &'static str,
    pub response_schema: &'static str,
    pub side_effect: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeadlineClass {
    Standard,
    Request,
}

/// The upstream command surface is exactly nine `terminal_*` commands
/// (`terminal_runtime.rs` lines 370/600/620/638/667/734/752/773/793,
/// all nine registered in `lib.rs:524-532`):
/// attach, detach, close, input, resize, scroll, ack, viewport_ready,
/// focus. The earlier "ten" count in lane prose was an error — it
/// double-counted the internal `publish_viewport` helper (line 716),
/// which is not a command, has no IPC boundary, and needs no registry
/// entry: it republishes the viewport after input-driven
/// `scroll_to_bottom` inside the already-admitted `terminal_input`
/// path. This fragment therefore names nine methods with no silent
/// drop: every upstream command maps 1:1, and the internal helper rides
/// the frame-credit machine it already rode upstream.
///
/// Deadline split: control ops (attach/detach/viewport-ready/focus) are
/// `standard`; streaming-adjacent paths (input/resize/scroll/ack/close)
/// are `request`. `close` is `request`-class: it must terminate and reap
/// a live child under the same deadline discipline as any other
/// potentially-blocking op, never the fire-and-forget class.
pub const TERMINAL_METHODS: [MethodSpec; 9] = [
    MethodSpec {
        method: "terminal_attach",
        deadline_class: DeadlineClass::Standard,
        deadline_ms: 10_000,
        request_schema: "terminal-attach",
        response_schema: "attach-response",
        side_effect: "spawns-pty",
    },
    MethodSpec {
        method: "terminal_detach",
        deadline_class: DeadlineClass::Standard,
        deadline_ms: 10_000,
        request_schema: "terminal-detach",
        response_schema: "terminal-ack",
        side_effect: "none",
    },
    MethodSpec {
        method: "terminal_close",
        deadline_class: DeadlineClass::Request,
        deadline_ms: 10_000,
        request_schema: "terminal-close",
        response_schema: "terminal-ack",
        side_effect: "ends-session",
    },
    MethodSpec {
        method: "terminal_input",
        deadline_class: DeadlineClass::Request,
        deadline_ms: 10_000,
        request_schema: "terminal-input",
        response_schema: "terminal-ack",
        side_effect: "writes-pty",
    },
    MethodSpec {
        method: "terminal_resize",
        deadline_class: DeadlineClass::Request,
        deadline_ms: 10_000,
        request_schema: "terminal-resize",
        response_schema: "terminal-viewport",
        side_effect: "resizes-pty",
    },
    MethodSpec {
        method: "terminal_scroll",
        deadline_class: DeadlineClass::Request,
        deadline_ms: 10_000,
        request_schema: "terminal-scroll",
        response_schema: "terminal-ack",
        side_effect: "none",
    },
    MethodSpec {
        method: "terminal_ack",
        deadline_class: DeadlineClass::Request,
        deadline_ms: 10_000,
        request_schema: "terminal-ack-request",
        response_schema: "terminal-ack",
        side_effect: "none",
    },
    MethodSpec {
        method: "terminal_viewport_ready",
        deadline_class: DeadlineClass::Standard,
        deadline_ms: 10_000,
        request_schema: "terminal-viewport-ready",
        response_schema: "terminal-ack",
        side_effect: "none",
    },
    MethodSpec {
        method: "terminal_focus",
        deadline_class: DeadlineClass::Standard,
        deadline_ms: 10_000,
        request_schema: "terminal-focus",
        response_schema: "terminal-ack",
        side_effect: "writes-pty",
    },
];

/// Native-side dispatch contract for one terminal request, expressed in
/// terminal-owned terms. The native owner maps each arm onto this enum;
/// the `Err` code is the exact v2 error the dispatch must emit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Dispatch {
    Attach,
    Detach,
    Close,
    Input { bytes: usize },
    Resize { columns: u16, rows: u16 },
    Scroll { lines: i32 },
    Ack,
    ViewportReady,
    Focus { focused: bool },
}

/// Validate one dispatch against the terminal-owned bounds. Returns the
/// exact v2 error code on violation, so the native arm is a mechanical
/// mapping with no policy discretion.
pub fn validate_dispatch(dispatch: &Dispatch) -> Result<(), &'static str> {
    match dispatch {
        Dispatch::Attach | Dispatch::Detach | Dispatch::Close | Dispatch::Ack => Ok(()),
        Dispatch::Input { bytes } => {
            crate::validate_input_bytes(*bytes).map_err(|_| "invalid_payload")
        }
        Dispatch::Resize { columns, rows } => {
            crate::validate_dimensions(*columns, *rows).map_err(|_| "invalid_payload")
        }
        // Scroll lines are any i32 (saturating conversion at the boundary);
        // focus is a bool. Both are schema-shaped, no Rust bound beyond
        // the envelope.
        Dispatch::Scroll { .. } | Dispatch::ViewportReady | Dispatch::Focus { .. } => Ok(()),
    }
}

/// Rebind-fault contract: on renderer rebind the native hook must call
/// `fault()` for every live terminal subscription while leaving PTY
/// sessions (child, reader, grid) untouched. This function is the
/// terminal-owned assertion of that split: it faults the publisher and
/// reports whether a subscription was actually dropped.
pub fn rebind_fault_subscription(
    publisher: &mut crate::FramePublisher,
    id: crate::SubscriptionId,
) -> bool {
    publisher.fault(id)
}

/// Shape-only registry fragment the native side merges into
/// `registry_document()`. Serialized here so the proposal is exact and
/// reviewable; the native owner owns the merge and digest recompute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryFragment {
    pub capability: String,
    pub binary: bool,
    pub methods: Vec<RegistryMethod>,
    pub response_schemas: Vec<String>,
    pub event_names: Vec<String>,
    pub event_schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryMethod {
    pub method: String,
    pub deadline_class: String,
    pub deadline_ms: u64,
    pub request_schema: String,
    pub response_schema: String,
    pub side_effect: String,
}

/// Build the exact fragment the native registry edit must contain.
/// Mechanical: derived from `TERMINAL_METHODS`, so drift fails tests.
pub fn registry_fragment() -> RegistryFragment {
    RegistryFragment {
        capability: TERMINAL_CAPABILITY.to_string(),
        binary: false,
        methods: TERMINAL_METHODS
            .iter()
            .map(|spec| RegistryMethod {
                method: spec.method.to_string(),
                deadline_class: match spec.deadline_class {
                    DeadlineClass::Standard => "standard".to_string(),
                    DeadlineClass::Request => "request".to_string(),
                },
                deadline_ms: spec.deadline_ms,
                request_schema: spec.request_schema.to_string(),
                response_schema: spec.response_schema.to_string(),
                side_effect: spec.side_effect.to_string(),
            })
            .collect(),
        response_schemas: vec![
            "attach-response".to_string(),
            "terminal-viewport".to_string(),
            "terminal-ack".to_string(),
        ],
        event_names: vec![
            EVENT_FRAME.to_string(),
            EVENT_TITLE.to_string(),
            EVENT_BELL.to_string(),
            EVENT_EXIT.to_string(),
        ],
        event_schema: "terminal-event".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragment_names_nine_methods_with_agreed_deadline_split() {
        let fragment = registry_fragment();
        assert_eq!(fragment.capability, "terminal-pty");
        assert!(!fragment.binary);
        // GATE-PROBE: intentionally wrong (9 methods, not 7). Revert after
        // the hosted gate proves it sees this target.
        assert_eq!(fragment.methods.len(), 7);
        let standard: Vec<_> = fragment
            .methods
            .iter()
            .filter(|m| m.deadline_class == "standard")
            .map(|m| m.method.as_str())
            .collect();
        assert_eq!(
            standard,
            vec![
                "terminal_attach",
                "terminal_detach",
                "terminal_viewport_ready",
                "terminal_focus"
            ]
        );
    }

    #[test]
    fn dispatch_bounds_reject_oversize_input_and_zero_resize() {
        assert!(validate_dispatch(&Dispatch::Input { bytes: 1 }).is_ok());
        assert!(validate_dispatch(&Dispatch::Input {
            bytes: crate::MAX_INPUT_BYTES + 1
        })
        .is_err());
        assert!(validate_dispatch(&Dispatch::Resize {
            columns: 80,
            rows: 24
        })
        .is_ok());
        assert!(validate_dispatch(&Dispatch::Resize {
            columns: 0,
            rows: 24
        })
        .is_err());
    }

    #[test]
    fn rebind_fault_drops_subscription_and_reports_it() {
        use crate::{FramePublisher, FrameViewport};
        let v0 = FrameViewport {
            generation: 0,
            columns: 80,
            screen_lines: 24,
        };
        let mut publisher = FramePublisher::new(v0);
        let id = crate::SubscriptionId::new();
        let engine_size = buzz_terminal::Size {
            columns: 80,
            screen_lines: 24,
            ..buzz_terminal::Size::default()
        };
        let (term, _actions) =
            buzz_terminal::Terminal::new(engine_size, buzz_terminal::Fences::default());
        let shared = buzz_terminal::SharedTerminal::new(term);
        let mut encoder = buzz_terminal::damage::Encoder::new();
        let snapshot = shared.snapshot(&mut encoder);
        publisher.attach(id, snapshot).unwrap();
        assert!(rebind_fault_subscription(&mut publisher, id));
        // Second fault reports nothing: already dropped, never double-free.
        assert!(!rebind_fault_subscription(&mut publisher, id));
    }
}
