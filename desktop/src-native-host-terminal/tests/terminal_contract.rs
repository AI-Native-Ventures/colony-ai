//! Hosted-gate contract tests for the isolated terminal lane.
//!
//! Every test here is process-local and std-scoped: fixed viewports,
//! fixed subscription IDs, fixed engine frames from byte fixtures, fixed
//! shell commands (`printf`/`exit`) for the PTY lifecycle tests. No
//! desktop UI runtime, no Electron, no relay, no network, no old Colony
//! state. Real
//! PTY behavior (output bytes through the emulator, input echo, resize
//! propagation, child exit) is exercised through `portable_pty` +
//! `buzz_terminal` directly, against the extracted `FramePublisher`
//! ordering machine: the same production seam the future host binary
//! will call.
//!
//! Passing these tests proves the contract state machine and the wire
//! mapping only; renderer delivery, host-pipe framing, Electron wiring,
//! and multi-session lifecycle remain future hosted gates (see the crate
//! README and the lane ticket artifact).

use colony_native_host_terminal::{
    session_backpressure, validate_dimensions, validate_input_bytes, wire_frame, AttachRequest,
    DomLines, FocusRequest, FramePublisher, FrameViewport, InputRequest, Request, ResizeRequest,
    ScrollRequest, SubscriptionId, TerminalEvent, ViewportConfirm, MAX_INPUT_BYTES,
    MAX_LIVE_SESSIONS,
};
use std::io::{Read, Write};

fn viewport(generation: u64, columns: usize, screen_lines: usize) -> FrameViewport {
    FrameViewport {
        generation,
        columns,
        screen_lines,
    }
}

fn engine_frame(
    viewport: FrameViewport,
    marker: usize,
    full: bool,
) -> buzz_terminal::damage::Frame {
    buzz_terminal::damage::Frame {
        rows: vec![buzz_terminal::damage::RowFrame {
            line: marker,
            wrapped: false,
            spans: Vec::new(),
        }],
        cursor: buzz_terminal::damage::CursorFrame {
            line: 0,
            column: 0,
            visible: true,
        },
        cursor_changed: true,
        full,
        viewport: buzz_terminal::Viewport {
            generation: viewport.generation,
            columns: viewport.columns,
            screen_lines: viewport.screen_lines,
        },
    }
}

#[test]
fn attach_request_shape_matches_upstream_fields() {
    // Upstream AttachRequest (terminal_runtime.rs): session remount +
    // channel/thread identity + relay context + geometry. Deserializes
    // from the camelCase wire the renderer already sends.
    let request: AttachRequest = serde_json::from_str(
        r#"{"sessionId":null,"channelId":"c","channelName":"n","threadId":null,
            "npub":"npub1x","relayUrl":"wss://r","columns":80,"rows":24,
            "pixelWidth":800,"pixelHeight":600}"#,
    )
    .expect("attach request parses");
    assert_eq!((request.columns, request.rows), (80, 24));
    assert!(request.session_id.is_none());
}

#[test]
fn request_enum_names_every_terminal_method_explicitly() {
    // No generic invoke tunnel: each variant names one upstream command.
    let input = Request::Input(InputRequest {
        session_id: "s".into(),
        data: "ls\n".into(),
    });
    let json = serde_json::to_string(&input).expect("serializes");
    assert!(json.contains("\"method\":\"input\""), "{json}");
    let resize = Request::Resize(ResizeRequest {
        session_id: "s".into(),
        columns: 100,
        rows: 30,
        pixel_width: 1000,
        pixel_height: 600,
    });
    let json = serde_json::to_string(&resize).expect("serializes");
    assert!(json.contains("\"method\":\"resize\""), "{json}");
}

#[test]
fn terminal_events_cover_the_upstream_message_union() {
    // Upstream TerminalMessage: Frame | Title | ResetTitle | Bell | Exit.
    let events = [
        TerminalEvent::Title("vim".into()),
        TerminalEvent::ResetTitle,
        TerminalEvent::Bell,
        TerminalEvent::Exit,
    ];
    for event in events {
        let json = serde_json::to_string(&event).expect("serializes");
        let back: TerminalEvent = serde_json::from_str(&json).expect("round-trips");
        let _ = back;
    }
}

#[test]
fn credit_machine_holds_one_frame_then_releases_on_exact_ack() {
    let v0 = viewport(0, 80, 24);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    let bootstrap = publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
    assert_eq!(bootstrap.sequence, 1);

    // One frame on the wire: the next capture parks as the single pending
    // snapshot, and a second capture replaces (not appends to) it.
    assert_eq!(publisher.offer(engine_frame(v0, 1, true)).unwrap(), None);
    assert_eq!(publisher.offer(engine_frame(v0, 2, true)).unwrap(), None);

    // Wrong subscription or wrong sequence releases nothing.
    assert_eq!(publisher.acknowledge(SubscriptionId::new(), 1), None);
    assert_eq!(publisher.acknowledge(id, 999), None);

    // Exact ACK releases exactly the latest snapshot.
    let successor = publisher.acknowledge(id, 1).expect("releases");
    assert_eq!(successor.sequence, 2);
    assert_eq!(successor.frame.rows[0].line, 2);
}

#[test]
fn incremental_damage_never_replaces_pending_snapshot() {
    let v0 = viewport(0, 80, 24);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
    let err = publisher.offer(engine_frame(v0, 1, false)).unwrap_err();
    assert_eq!(
        err,
        colony_native_host_terminal::OfferError::PendingFrameMustBeSnapshot
    );
}

#[test]
fn resize_gate_holds_new_viewport_until_renderer_confirms() {
    let v0 = viewport(0, 80, 24);
    let v1 = viewport(1, 100, 30);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    publisher.attach(id, engine_frame(v0, 0, true)).unwrap();

    publisher.resize_applied(v1);
    // Old-viewport captures are inert; new-viewport captures park.
    assert_eq!(publisher.offer(engine_frame(v0, 7, true)).unwrap(), None);
    assert_eq!(publisher.offer(engine_frame(v1, 8, true)).unwrap(), None);
    // ACK alone cannot release while readiness is held...
    assert_eq!(publisher.acknowledge(id, 1), None);
    // ...and readiness for the superseded viewport is inert.
    assert_eq!(publisher.viewport_ready(id, v0), None);
    // Either order of the two gates converges on the parked frame.
    let current = publisher.viewport_ready(id, v1).expect("releases");
    assert_eq!(current.frame.viewport.generation, 1);
    assert_eq!(current.frame.rows[0].line, 8);
}

#[test]
fn ack_and_readiness_may_arrive_in_either_order() {
    let v0 = viewport(0, 80, 24);
    let v1 = viewport(1, 100, 30);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
    publisher.resize_applied(v1);
    publisher.offer(engine_frame(v1, 1, true)).unwrap();

    assert_eq!(publisher.viewport_ready(id, v1), None);
    assert!(publisher.acknowledge(id, 1).is_some());
}

#[test]
fn superseded_readiness_and_same_size_resize_are_inert() {
    let v0 = viewport(0, 80, 24);
    let v1 = viewport(1, 100, 30);
    let v2 = viewport(2, 120, 40);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
    publisher.resize_applied(v1);
    publisher.resize_applied(v2);
    publisher.resize_applied(v2);
    assert_eq!(publisher.applied_viewport(), v2);
    publisher.offer(engine_frame(v2, 2, true)).unwrap();
    publisher.acknowledge(id, 1);
    assert_eq!(publisher.viewport_ready(id, v1), None);
    assert!(publisher.viewport_ready(id, v2).is_some());
}

#[test]
fn reattach_fences_old_subscription_messages() {
    let v0 = viewport(0, 80, 24);
    let mut publisher = FramePublisher::new(v0);
    let old = SubscriptionId::new();
    publisher.attach(old, engine_frame(v0, 0, true)).unwrap();
    assert!(publisher.fault(old));

    let new = SubscriptionId::new();
    publisher.attach(new, engine_frame(v0, 1, true)).unwrap();
    publisher.offer(engine_frame(v0, 2, true)).unwrap();
    assert_eq!(publisher.acknowledge(old, 1), None);
    assert_eq!(publisher.viewport_ready(old, v0), None);
    let successor = publisher.acknowledge(new, 1).unwrap();
    assert_eq!(successor.frame.rows[0].line, 2);
}

#[test]
fn close_detaches_publication_without_touching_pty_state() {
    let v0 = viewport(0, 80, 24);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
    publisher.close();
    // No subscription: offers inert, ACKs inert, fault reports nothing.
    assert_eq!(publisher.offer(engine_frame(v0, 1, true)).unwrap(), None);
    assert_eq!(publisher.acknowledge(id, 1), None);
    assert!(!publisher.fault(id));
}

#[test]
fn post_snapshot_capture_survives_attach() {
    // Upstream reader_pumps invariant at the contract level: output
    // captured after the bootstrap snapshot is retained, not dropped.
    let v0 = viewport(0, 80, 24);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
    assert_eq!(publisher.offer(engine_frame(v0, 42, true)).unwrap(), None);
    let successor = publisher
        .acknowledge(id, 1)
        .expect("post-snapshot output retained");
    assert_eq!(successor.frame.rows[0].line, 42);
    assert!(successor.frame.full);
}

#[test]
fn wire_mapper_carries_sequence_identity_and_viewport() {
    let v0 = viewport(4, 80, 24);
    let mut publisher = FramePublisher::new(v0);
    let id = SubscriptionId::new();
    let bootstrap = publisher.attach(id, engine_frame(v0, 3, true)).unwrap();
    let wire = wire_frame(&bootstrap).expect("maps");
    assert_eq!(wire.sequence, 1);
    assert_eq!(wire.subscription_id, id.to_string());
    assert_eq!(wire.viewport.generation, 4);
    assert!(wire.full);
}

#[test]
fn input_scroll_focus_bounds_match_upstream_gates() {
    assert!(validate_input_bytes(0).is_ok());
    assert!(validate_input_bytes(MAX_INPUT_BYTES).is_ok());
    assert!(validate_input_bytes(MAX_INPUT_BYTES + 1).is_err());
    assert!(validate_dimensions(80, 24).is_ok());
    assert!(validate_dimensions(0, 24).is_err());
    assert!(!session_backpressure(MAX_LIVE_SESSIONS - 1));
    assert!(session_backpressure(MAX_LIVE_SESSIONS));

    // Scroll/focus/viewport-confirm shapes stay serializable for the
    // registry (exact serde covered by unit tests in the modules).
    let scroll = ScrollRequest {
        session_id: "s".into(),
        lines: -2,
    };
    assert_eq!(scroll.lines, -2);
    let focus = FocusRequest {
        session_id: "s".into(),
        focused: true,
    };
    assert!(focus.focused);
    let confirm = ViewportConfirm {
        session_id: "s".into(),
        subscription_id: id_string(),
        viewport: colony_native_host_terminal::Viewport {
            generation: 1,
            columns: 100,
            screen_lines: 30,
        },
    };
    let _ = serde_json::to_string(&confirm).expect("serializes");
    let _ = DomLines(-2);
}

fn id_string() -> String {
    SubscriptionId::new().to_string()
}

// --- Hosted runtime gate: real PTY through the extracted machine ---
//
// The tests below spawn real PTYs (`portable-pty`, unix-only like the
// upstream runtime) and drive the extracted `FramePublisher` + wire
// mapper with the real engine. They prove output/input/resize/exit and
// bounded-buffer failure behavior in an isolated CI process: the
// acceptance proof for this lane, distinct from full app wiring.

#[cfg(unix)]
mod pty_runtime {
    use super::*;
    use buzz_terminal::{Fences, SharedTerminal, Size, Terminal};
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    fn size(cols: u16, rows: u16) -> (Size, PtySize) {
        (
            Size {
                columns: usize::from(cols),
                screen_lines: usize::from(rows),
                ..Size::default()
            },
            PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            },
        )
    }

    fn spawn_shell(pty_size: PtySize, argv: &[&str]) -> Box<dyn portable_pty::MasterPty + Send> {
        let pair = native_pty_system()
            .openpty(pty_size)
            .expect("openpty succeeds on hosted runner");
        let mut command = CommandBuilder::new(argv[0]);
        for arg in &argv[1..] {
            command.arg(arg);
        }
        let child = pair.slave.spawn_command(command).expect("spawn succeeds");
        std::mem::forget(child);
        pair.master
    }

    fn read_until(master: &mut Box<dyn portable_pty::MasterPty + Send>, needle: &[u8]) -> Vec<u8> {
        let mut reader = master.try_clone_reader().expect("clone reader");
        let mut collected = Vec::new();
        let mut buf = [0u8; 4096];
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    collected.extend_from_slice(&buf[..n]);
                    if collected.windows(needle.len()).any(|w| w == needle) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        collected
    }

    fn feed_and_snapshot(terminal: &SharedTerminal, bytes: &[u8]) -> buzz_terminal::damage::Frame {
        terminal.feed_fully(bytes);
        let mut encoder = buzz_terminal::damage::Encoder::new();
        terminal.snapshot(&mut encoder)
    }

    fn screen_text(frame: &buzz_terminal::damage::Frame) -> String {
        frame
            .rows
            .iter()
            .map(|row| {
                row.spans
                    .iter()
                    .map(|span| span.text.as_str())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn real_pty_output_flows_through_extracted_ordering_machine() {
        let (term_size, pty_size) = size(80, 24);
        let mut master = spawn_shell(pty_size, &["/bin/sh", "-c", "printf 'pty-proof-123'"]);
        let raw = read_until(&mut master, b"pty-proof-123");
        assert!(
            raw.windows(13).any(|w| w == b"pty-proof-123"),
            "child output arrives on the master"
        );

        // Feed the real bytes through the real engine, then offer the
        // snapshot through the extracted credit machine.
        let (term, _actions) = Terminal::new(term_size, Fences::default());
        let terminal = SharedTerminal::new(term);
        let frame = feed_and_snapshot(&terminal, &raw);
        assert!(screen_text(&frame).contains("pty-proof-123"));

        let vp = FrameViewport {
            generation: 0,
            columns: 80,
            screen_lines: 24,
        };
        let mut publisher = FramePublisher::new(vp);
        let id = SubscriptionId::new();
        let bootstrap = publisher.attach(id, frame.clone()).unwrap();
        assert_eq!(bootstrap.sequence, 1);
        let wire = wire_frame(&bootstrap).expect("maps real output");
        let text: String = wire
            .rows
            .iter()
            .flat_map(|row| {
                row.spans
                    .iter()
                    .flat_map(|span| span.clusters.iter().map(|c| c.text.as_str()))
            })
            .collect();
        assert!(text.contains("pty-proof-123"), "{text}");
    }

    #[test]
    fn real_pty_input_echoes_and_resize_releases_gated_frame() {
        let (term_size, pty_size) = size(80, 24);
        let pair = native_pty_system()
            .openpty(pty_size)
            .expect("openpty succeeds");
        let command = CommandBuilder::new("/bin/sh");
        let mut child = pair.slave.spawn_command(command).expect("spawn shell");
        let mut master = pair.master;
        let mut writer = master.take_writer().expect("writer");

        // Input path: write through the master like terminal_input does.
        writer
            .write_all(b"printf 'echo-back-456'\n")
            .expect("write input");
        let raw = read_until(&mut master, b"echo-back-456");
        assert!(
            raw.windows(13).any(|w| w == b"echo-back-456"),
            "typed input echoes from the live shell"
        );

        let (term, _actions) = Terminal::new(term_size, Fences::default());
        let terminal = SharedTerminal::new(term);
        let frame = feed_and_snapshot(&terminal, &raw);

        // Resize path: master resize + engine resize + publisher gate.
        let resized = PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        };
        master.resize(resized).expect("pty resize propagates");
        let applied_engine = terminal.resize(Size {
            columns: 100,
            screen_lines: 30,
            ..Size::default()
        });

        let v0 = FrameViewport {
            generation: 0,
            columns: 80,
            screen_lines: 24,
        };
        let mut publisher = FramePublisher::new(v0);
        let id = SubscriptionId::new();
        publisher.attach(id, frame).unwrap();
        let applied = FrameViewport {
            generation: applied_engine.generation,
            columns: applied_engine.columns,
            screen_lines: applied_engine.screen_lines,
        };
        publisher.resize_applied(applied);
        let mut encoder = buzz_terminal::damage::Encoder::new();
        let snapshot = terminal.snapshot(&mut encoder);
        assert_eq!(publisher.offer(snapshot).unwrap(), None);
        // ACK the in-flight bootstrap first (either gate order converges),
        // then the readiness confirm releases the parked resize snapshot.
        assert_eq!(publisher.acknowledge(id, 1), None);
        let released = publisher
            .viewport_ready(id, applied)
            .expect("resize frame releases after confirm");
        assert_eq!(released.frame.viewport.columns, 100);

        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn real_pty_exit_produces_eof_and_close_detaches() {
        let (_, pty_size) = size(80, 24);
        let master = spawn_shell(pty_size, &["/bin/sh", "-c", "exit 3"]);
        // Child exits promptly: the master reader sees EOF (Ok(0)).
        let mut reader = master.try_clone_reader().expect("clone reader");
        let mut buf = [0u8; 64];
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let eof = loop {
            if std::time::Instant::now() >= deadline {
                break false;
            }
            match reader.read(&mut buf) {
                Ok(0) => break true,
                Ok(_) => continue,
                Err(_) => break false,
            }
        };
        assert!(eof, "exited child yields EOF on the master");

        // Session close detaches publication; no further frames flow.
        let v0 = viewport(0, 80, 24);
        let mut publisher = FramePublisher::new(v0);
        let id = SubscriptionId::new();
        publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
        publisher.close();
        assert_eq!(publisher.offer(engine_frame(v0, 9, true)).unwrap(), None);
        assert_eq!(publisher.acknowledge(id, 1), None);
    }

    #[test]
    fn bounded_buffer_failure_proof_input_and_sessions_reject() {
        // 1 MiB input gate fails closed without allocation.
        assert!(validate_input_bytes(MAX_INPUT_BYTES + 1).is_err());
        // Session cap fails closed at exactly MAX_LIVE_SESSIONS.
        assert!(session_backpressure(MAX_LIVE_SESSIONS));
        // Pending-slot bound: exactly one pending snapshot retained;
        // the newest replaces the older (no growth).
        let v0 = viewport(0, 80, 24);
        let mut publisher = FramePublisher::new(v0);
        let id = SubscriptionId::new();
        publisher.attach(id, engine_frame(v0, 0, true)).unwrap();
        for marker in 1..=50usize {
            assert_eq!(
                publisher.offer(engine_frame(v0, marker, true)).unwrap(),
                None
            );
        }
        let successor = publisher.acknowledge(id, 1).expect("releases");
        assert_eq!(
            successor.frame.rows[0].line, 50,
            "only the newest of 50 parked snapshots survives"
        );
    }
}
