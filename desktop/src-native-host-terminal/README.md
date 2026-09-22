# Isolated terminal/PTY contract (`src-native-host-terminal`)

Bounded Phase 1 lane: the host-neutral extraction of the upstream
terminal PTY service that can be proven without the desktop UI runtime,
Electron, or the shared host binary.

## Extraction status (read this first)

This package is an **extraction, not a reimplementation**: `publisher.rs`
is the upstream `terminal_transport.rs` `FramePublisher` state machine
operating on the real engine frame types via a path dependency on
`../src-tauri/crates/buzz-terminal`, so its tests bind the production
seam. `wire.rs` is the upstream wire-publication mapper with the
UI-runtime channel send removed (returns the frame; the host pipe owns
delivery). `scroll.rs` is the upstream crossing, unchanged. Only
the UI-runtime channel/state/command wrappers stay behind: they belong
to the native owner's integration step.

Upstream source (`origin/develop`): `terminal_runtime.rs` (sessions,
PTY spawn, reader/action threads, `MAX_LIVE_SESSIONS = 20`,
`MAX_INPUT_BYTES = 1 MiB`, non-zero dimension guard), and
`terminal_transport.rs` (credit/viewport ordering).

## What this package proves

Contract (no PTY): credit/backpressure ordering, viewport-generation
gating, attach/reattach bootstrap, resize-ack/viewport-ready
interleavings, fault/close detachment, input/resize/session bounds,
wire mapping, scroll-sign crossing. Runtime (hosted, unix): real PTY
output through the extracted machine, input echo, resize propagation
with gated release, child exit EOF with close-detach, and the
bounded-buffer failure proof (1 MiB input rejection, session-cap
rejection, exactly-one pending snapshot under 50 parked captures).

## What this package is not (explicit non-proof)

Renderer delivery, host-pipe framing, Electron main/preload wiring,
multi-session lifecycle, and shared-binary dispatch are future gates
owned by the native-owner integration step. No PTY is spawned by the
unit scope; the `pty_runtime` test module is unix-gated like upstream.

## Proof vocabulary for this lane

- **Proven here:** contract + isolated real-PTY behavior listed above,
  via the hosted narrow workflow.
- **Explicitly unproven:** everything under "is not".
