# Isolated audio/PCM contract (`src-native-host-audio`)

Bounded Phase 1 lane: the smallest host-neutral extraction of the upstream
Huddle/raw-PCM/audio-output transport that can be proven synthetically.

## What this package is

A standalone Cargo package with its own `[workspace]`, zero dependencies
(std-only), no Tauri/WebView, no `rodio`/`cpal`/Opus/NetEq, no relay, no
network, no microphone/speaker access. It pins:

- 48 kHz mono PCM constants (960-sample 20 ms frames, 480-sample 10 ms
  playout ticks, 50-deep send queue),
- the v2 8-byte frame header codec (wrapping `seq`, `ts_48k` +960/frame,
  `level_dbov` clamped to `-127..=0`, DTX bit 0, reserved bits ignored),
- wrapping sequence ordering, timestamp deltas, bounded-base64 validation
  (declared decoded length, 8 MiB/frame cap), device-name validation (empty =
  system default; no path smuggling), one-terminal-outcome
  pending/cancel/timeout transitions with late-completion discard, transport
  generation fencing, session backpressure at 128 in-flight, and the 960-
  sample PCM frame validator.

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
