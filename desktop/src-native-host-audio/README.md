# Isolated audio/PCM contract (`src-native-host-audio`)

Bounded Phase 1 lane: the smallest host-neutral extraction of the upstream
Huddle/raw-PCM/audio-output transport that can be proven synthetically.

## Extraction status (read this first)

This package is an **independent reimplementation verified against upstream
fixture vectors, not a code extraction**: the header codec, relay-frame
parser, and dBov ports are rewritten here in dependency-free Rust and pinned
by tests that replay the exact vectors from `wire.rs@origin/develop`
(round-trip `seq 0xABCD / ts 0x12345678`, network-byte-order bytes, `0x7F`
level clamp, silence/full-scale/sine level checks, peer-prefix rules).
Direct extraction (moving `wire.rs` out of the Tauri crate) is deferred to
the native owner because it touches the shared crate; until that move,
vector equivalence is the proof, and any divergence fails closed here.

## What this package is

A standalone Cargo package with its own `[workspace]`, zero dependencies
(std-only), no Tauri/WebView, no `rodio`/`cpal`/Opus/NetEq, no relay, no
network, no microphone/speaker access. It pins:

- 48 kHz mono PCM constants (960-sample 20 ms frames, 480-sample 10 ms
  playout ticks, 50-deep send queue, 100 KB IPC batch cap mirroring
  `push_audio_pcm`, 4000-byte Opus packet bound mirroring the upstream
  encoder buffers),
- the v2 8-byte frame header codec (wrapping `seq`, `ts_48k` +960/frame,
  `level_dbov` clamped to `-127..=0`, DTX bit 0, reserved bits ignored),
  relay-frame parsing (peer prefix, non-empty payload), and the dBov /
  speaker-normalization ports,
- wrapping sequence progression and ordering, timestamp stepping,
  bounded-base64 validation (declared decoded length, 8 MiB transport
  ceiling, 100 KB audio profile), PCM batch caps with the upstream
  accept-at-IPC / skip-at-encode `%4` rule, upstream-faithful device-name
  pass-through (opaque string, empty = default; upstream imposes no
  content rules), one-terminal-outcome pending/cancel/timeout transitions
  with late-completion discard, transport generation fencing, session
  backpressure at 128 in-flight, and the 960-sample PCM frame validator.

Key transport finding (grounds the framing choice): the microphone lives
in the renderer. Upstream `push_audio_pcm` receives raw f32-LE IPC bodies
up to 100 KB per batch and fans out to STT plus best-effort relay
encoding; remote playout stays host-side (`rodio`), reaching the renderer
only as `huddle-active-speakers` / `huddle-speaker-levels` events. So the
host pipe carries renderer-to-host PCM batches (bounded base64 with
declared length, 100 KB profile cap) and control RPC; media never needs a
new framing, and no per-frame RPC streaming is introduced.

## What this package is not (explicit non-proof)

Passing `cargo test` here proves the synthetic contract only. It does not
prove microphone capture, speaker playout, Opus encode/decode, NetEq jitter
buffering, relay audio WebSocket behavior, TTS/STT pipelines, companion-
window behavior, renderer/Electron playback, signing/identity, or any live
user audio flow. No audio device is opened by any test in this package.

## Proof vocabulary for this lane

- **Proven here:** synthetic PCM/contract behavior listed above, via hosted
  `cargo test` on the isolated package.
- **Unproven after this lane:** real audio capture/playout, Huddle relay
  interop, runtime device behavior, Electron/JS playback wiring, and any
  performance/latency claim. Those need the subsequent hosted gates named in
  the lane ticket artifact (`phase-1-design/audio-parity-step`).

## Integration (proposal only, not applied)

Wiring this contract into the shared host (`src-native-host/src/main.rs`),
the capability registry/manifest, or Electron main/preload/JS is owned by
the native lane (`bc9add6f`) and the JS lane (`64fa923d`) after root
approves the exact patch. The proposed patch text lives in the lane ticket
artifact; this package deliberately contains no shared-file edits.

## Local verification (shared Mac)

Static/format only, matching the `native-host-step` precedent:

```bash
cargo fmt --manifest-path desktop/src-native-host-audio/Cargo.toml -- --check
git diff --check
```

No local `cargo build`, `cargo test`, native compilation, broad checks, or
device access. Hosted CI owns compilation and test execution.
