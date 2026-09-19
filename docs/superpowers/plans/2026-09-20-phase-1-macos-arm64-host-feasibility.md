# Phase 1 macOS arm64 host feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove one isolated, packaged Electron window can bind to one headless Rust host on macOS arm64 through the bounded host protocol, including a harmless request, one lifecycle event, renderer reload/rebind, and deterministic injected failures.

**Architecture:** Electron is the only UI runtime. Electron main owns the fresh local profile, one window, the private inherited-stdio host process, frame validation, and renderer transport generations. A standalone Rust helper owns only the Stage-1 health-safe command/event skeleton; it has no Tauri dependency, no WebView, no network access, and no identity/key state. The upstream `RelayClient` remains untouched and is not treated as proven by this gate.

**Tech Stack:** Electron `44.4.3`, `@electron/packager` `20.3.0`, Node.js ESM/CommonJS, Playwright Electron support for the hosted packaged smoke, Rust 2021 with `serde` and `serde_json`, and the pinned Buzz source revision `ef2aa1ae38fadcc0bc22b8bf6ed96b35933146be`.

---

## Scope and frozen inputs

This plan covers only the first macOS arm64 feasibility slice. It does not port
the full React renderer, compile the existing Tauri crate, run relay/key/signing
flows, migrate data, import an identity, register an app name, or exercise
Windows/Linux/iOS/Android. Those remain mandatory later phase gates.

The committed input manifest is [`desktop/electron-stage0-manifest.json`](../../../desktop/electron-stage0-manifest.json). Its local-only candidate namespace is:

| Input | Frozen value | Proof rule |
| --- | --- | --- |
| App identifier | `xyz.ainative.ventures.colony.dev` | Refuse the candidate if a packaged manifest or process advertises an old Buzz/Colony identifier. |
| macOS user-data suffix | `Colony/dev/0000000000000001` | Resolve under Electron’s `app.getPath("appData")`; never open `xyz.block.buzz.app` or the preserved Colony profile. |
| Keychain service | `xyz.ainative.ventures.colony.dev.0000000000000001` | Collision probe must be negative before any runtime test; no secret value is read. |
| Helper identity | `colony-native.dev.0000000000000001` | No matching helper process may be running before the packaged test. |
| Deep-link scheme | `colony-dev://` | Registration is not performed in Stage 0; the static check only rejects `buzz://`/old Colony schemes in the candidate package. |
| Protocol | version `1`, prefix `@colony-native:`, exact limits and registry digest from the manifest | The protocol tests load the manifest and fail on drift. |
| Health-safe request | `get_default_relay_url` with `{}` | Returns the pure default/override string and performs no socket, HTTP, key, or signing operation. |
| Lifecycle event | `host_lifecycle` with `state` and monotonic `sequence` | Exactly one `ready` event per initial bind and one `rebound` event per accepted rebind; old-generation events are dropped. |

The protocol registry digest in the manifest is the SHA-256 of the canonical
registry/limits object with recursively sorted keys:
`1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49`.

## File map

The following is the complete first-slice surface. No existing Tauri command or
full renderer file is modified by the host skeleton.

| File | Responsibility |
| --- | --- |
| `desktop/electron-stage0-manifest.json` | Frozen local namespace, protocol, Electron, and fault-injection inputs; already added in this baseline setup. |
| `desktop/src-native-host/Cargo.toml` | Standalone helper package; no workspace edge to `desktop/src-tauri` and no `tauri` dependency. |
| `desktop/src-native-host/src/main.rs` | Stdio process lifecycle, one handshake/session loop, health-safe request, lifecycle event, bounded shutdown. |
| `desktop/src-native-host/src/protocol.rs` | Typed envelope definitions, binding validation, size/depth/ID checks, and response/error classification. |
| `desktop/src-native-host/tests/stdio_contract.rs` | Contract-level host vectors; assert observable frames and terminal outcomes rather than internal helper functions. |
| `desktop/src-electron/host-protocol.mjs` | Main-process envelope parser/validator and protocol constants loaded from the manifest. |
| `desktop/src-electron/native-host.mjs` | Child-process spawn, private stdio framing, pending-call deadlines, fail-closed teardown, and host fault modes. |
| `desktop/src-electron/renderer-host.mjs` | Trusted-main renderer-generation fence, `REHELLO` serialization, `REBOUND` barrier, and stale response/event dropping. |
| `desktop/src-electron/main.mjs` | Isolated Electron profile, one `BrowserWindow`, host startup, origin/navigation policy, and packaged lifecycle. |
| `desktop/src-electron/preload.cjs` | Context-isolated allowlist exposing only health request, event subscription, and read-only binding state. |
| `desktop/src-electron/feasibility/index.html` | Minimal static renderer harness with stable `data-testid` markers; it does not import the Buzz React bundle. |
| `desktop/src-electron/feasibility/renderer.mjs` | Calls the allowlisted request, renders the lifecycle event, and waits for the rebind acknowledgement before retrying a health-safe call. |
| `desktop/src-electron/host-protocol.test.mjs` | Node contract tests for frame vectors, limits, duplicate IDs, stale bindings, and parser failures. |
| `desktop/scripts/check-electron-stage0.mjs` | Static no-Tauri/no-fallback/package-isolation guard. |
| `desktop/scripts/stage-electron-stage0.mjs` | Creates a disposable package staging directory containing only the Electron harness and host binary. |
| `desktop/package.json` and `pnpm-lock.yaml` | Pin Electron/packager and add narrow Stage-0 scripts; keep existing Tauri scripts intact. |
| `desktop/tests/electron-host-feasibility.spec.ts` | Hosted packaged-app smoke for startup, request/event, reload/rebind, and four injected failures. |
| `desktop/playwright.electron.config.ts` | Electron-only hosted test project; not included in shared-Mac browser runs. |
| `.github/workflows/electron-host-feasibility.yml` | Dedicated macOS arm64 hosted lane that builds the helper/package and runs only the narrow smoke. |
| `.gitignore` | Ignore disposable `desktop/.stage0-package` and `desktop/dist-electron` output. |

## Task 1: Validate and enforce the Stage-0 boundary

**Files:**
- Modify: `desktop/electron-stage0-manifest.json`
- Create: `desktop/scripts/check-electron-stage0.mjs`
- Test: `desktop/src-electron/host-protocol.test.mjs`

- [ ] **Step 1: Add manifest validation.** Read the JSON manifest with Node and assert the pinned source revision, `protocol.version === 1`, all numeric limits, the registry digest, the four fault names, and the exact namespace strings. Exit non-zero with the field name on mismatch.

- [ ] **Step 2: Add the static target guard.** Make `check-electron-stage0.mjs` scan only the Stage-0 entry files and the generated staging directory. Reject `@tauri-apps/`, `__TAURI_INTERNALS__`, `tauri::Builder`, `AppHandle`, `Webview`, `InvokeRequest`, `src-tauri`, `tauri.conf.json`, `buzz://`, and any fallback spawn of a Tauri binary. Reject a package that contains a second UI entry or more than one host executable.

- [ ] **Step 3: Run the narrow guard.**

  ```bash
  cd /Users/mac/.traycer/worktrees/ai-native-ventures__colony/port-phase1-stage0-baseline
  . ./bin/activate-hermit
  node desktop/scripts/check-electron-stage0.mjs
  ```

  Expected: PASS while the package is absent or contains only the approved
  Stage-0 files; FAIL with the offending path/token when a forbidden Tauri or
  old-namespace fixture is injected.

- [ ] **Step 4: Add contract vectors, not implementation snapshots.** In `host-protocol.test.mjs`, assert that valid `HELLO`, `READY`, `REHELLO`, `REBOUND`, `REQUEST`, `RESPONSE`, `EVENT`, and `CANCEL` envelopes round-trip; malformed JSON, invalid prefix, oversized frame, depth `33`, unknown capability, duplicate request ID, stale generation, and wrong session/profile are rejected deterministically. Keep the expected values as the manifest’s literal fields.

## Task 2: Build the standalone headless Rust host

**Files:**
- Create: `desktop/src-native-host/Cargo.toml`
- Create: `desktop/src-native-host/src/main.rs`
- Create: `desktop/src-native-host/src/protocol.rs`
- Test: `desktop/src-native-host/tests/stdio_contract.rs`

- [ ] **Step 1: Define a standalone package.** Use a bare package/workspace in `desktop/src-native-host/Cargo.toml` with Rust 2021, `serde` derive, and `serde_json`. Do not add `tauri`, `tauri-build`, `wry`, or any path dependency on `desktop/src-tauri`.

- [ ] **Step 2: Implement the initial handshake.** Read newline-delimited `@colony-native:` frames from stdin with a buffer capped at `frameLimitBytes`; reject invalid UTF-8, invalid JSON, missing fields, wrong protocol/profile/session, and an unknown frame before dispatch. Accept only `HELLO` in `UNBOUND`; reply with `READY` carrying the same profile/session/generation and the manifest digest, then emit the first `EVENT` (`host_lifecycle`, `state: ready`, `sequence: 1`).

- [ ] **Step 3: Implement the health-safe request.** Accept only `REQUEST` with capability `health-safe`, method `get_default_relay_url`, an empty object payload, the current binding, and a unique request ID. Return one `RESPONSE` with `outcome: ok` and the trimmed non-empty `BUZZ_RELAY_URL` value or `ws://localhost:3000`; never open a socket or inspect identity/key storage.

- [ ] **Step 4: Implement same-host rebind.** Accept only a trusted-main-shaped `REHELLO` with the same profile/session and `generationId = current + 1`. Retire old-generation pending requests/subscriptions/events, emit one terminal `renderer_rebound`/`outcome_unknown` result for an in-flight request as applicable, reply `REBOUND`, then emit one `host_lifecycle` event with the new generation and `sequence: 2`. Reject stale/future generations and duplicate IDs without resetting twice.

- [ ] **Step 5: Implement bounded faults and shutdown.** Drive the manifest fault names through `COLONY_STAGE0_FAULT`: `host-unavailable` is handled by Electron spawn failure, `exit-before-ready` exits with code `17`, `malformed-frame` writes a non-JSON prefixed line, and `delay-response` holds the health response until the test-triggered reload. `CANCEL` is best-effort and never retries the request. `shutdown` exits after at most `shutdownGraceMs`.

- [ ] **Step 6: Prove the host contract in isolation.**

  ```bash
  cd /Users/mac/.traycer/worktrees/ai-native-ventures__colony/port-phase1-stage0-baseline
  . ./bin/activate-hermit
  cargo test --manifest-path desktop/src-native-host/Cargo.toml
  ```

  Expected: focused Rust tests pass for initial bind, health response, event
  ordering, same-host rebind, duplicate/stale IDs, malformed/oversized input,
  early exit, delayed response, and bounded shutdown. No Tauri crate appears in
  `cargo tree --manifest-path desktop/src-native-host/Cargo.toml`.

## Task 3: Add the Electron main/preload/rebind seam

**Files:**
- Create: `desktop/src-electron/host-protocol.mjs`
- Create: `desktop/src-electron/native-host.mjs`
- Create: `desktop/src-electron/renderer-host.mjs`
- Create: `desktop/src-electron/main.mjs`
- Create: `desktop/src-electron/preload.cjs`

- [ ] **Step 1: Load and validate the manifest.** `host-protocol.mjs` must load the packaged manifest copy, expose immutable constants, and validate every frame against version/profile/session/generation before it reaches a pending call or renderer.

- [ ] **Step 2: Spawn exactly one host.** `native-host.mjs` must spawn the one packaged `colony-native-host` executable with inherited stdio only, swallow native stderr rather than logging payloads, enforce frame/pending/queue/deadline bounds, reject all pending work once on EOF/exit/malformed frame, and never attempt a Tauri or old Colony fallback.

- [ ] **Step 3: Fence renderer generations in trusted main.** `renderer-host.mjs` owns `generationId`, stops forwarding old calls/events synchronously on navigation, sends `REHELLO` over the existing pipe, serializes rebinds, and exposes a barrier that resolves only after `REBOUND`. A reload changes the transport generation only; it does not create a second host or relay session manager.

- [ ] **Step 4: Restrict the preload surface.** `preload.cjs` must expose no raw `ipcRenderer`, pipe, filesystem, process, or generic `invoke`. The only methods are `health.getDefaultRelayUrl()`, `onLifecycle(callback)`, and read-only `bindingState()`, each returning structured values or bounded error classes.

- [ ] **Step 5: Create one Electron window and fresh profile.** `main.mjs` must set the frozen user-data suffix before `whenReady`, create one visible window with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, validate the trusted app origin, load only `feasibility/index.html`, and close the host on app exit. It must not call Tauri APIs or launch a Tauri/WebView process.

## Task 4: Add the static feasibility renderer

**Files:**
- Create: `desktop/src-electron/feasibility/index.html`
- Create: `desktop/src-electron/feasibility/renderer.mjs`

- [ ] **Step 1: Render observable markers.** Include stable markers `stage0-ready`, `stage0-event`, `stage0-result`, `stage0-binding`, and `stage0-error`; do not import the existing Buzz React bundle or `@tauri-apps/*`.

- [ ] **Step 2: Exercise the safe path.** On load, wait for the preload binding, render the `READY` binding, subscribe before requesting, assert the first `host_lifecycle/ready` event, call `getDefaultRelayUrl()`, and render the exact returned string. Do not contact the relay.

- [ ] **Step 3: Exercise post-rebind ordering.** When main signals the renderer reload/rebind barrier, wait for `REBOUND`, render generation `2`, bind one fresh subscription, and make one new health-safe request. Assert no old-generation event or response reaches the new renderer.

## Task 5: Package only the feasibility candidate

**Files:**
- Modify: `desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `desktop/scripts/stage-electron-stage0.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Pin packaging dependencies.** Add exact `electron@44.4.3` and `@electron/packager@20.3.0` dev dependencies, set the package entry to `src-electron/main.mjs`, and add scripts named `electron:stage0:stage`, `electron:stage0:package`, and `electron:stage0:check`.

- [ ] **Step 2: Stage a minimal package.** Copy only the manifest, main/preload/protocol/host/rebind modules, feasibility HTML/renderer, package metadata, and the release host binary into `desktop/.stage0-package`; fail if any `desktop/src`, `desktop/src-tauri`, old manifest, or second host file would be copied.

- [ ] **Step 3: Produce the arm64 app bundle.** Use the exact commands below on the designated hosted runner after the helper has been compiled:

  ```bash
  cd /Users/mac/.traycer/worktrees/ai-native-ventures__colony/port-phase1-stage0-baseline
  . ./bin/activate-hermit
  cargo build --manifest-path desktop/src-native-host/Cargo.toml --release --target aarch64-apple-darwin
  node desktop/scripts/stage-electron-stage0.mjs
  pnpm exec electron-packager desktop/.stage0-package "Buzz Stage0" \
    --platform=darwin --arch=arm64 --out=desktop/dist-electron \
    --overwrite --asar \
    --extra-resource=desktop/src-native-host/target/aarch64-apple-darwin/release/colony-native-host
  node desktop/scripts/check-electron-stage0.mjs desktop/dist-electron
  ```

  Expected: exactly one `Buzz Stage0.app` is produced; package inspection
  finds one Electron entry, one host binary, the frozen manifest, no Tauri
  runtime/source, no old profile paths, and no old deep-link scheme.

## Task 6: Add the narrow packaged regression proof

**Files:**
- Create: `desktop/playwright.electron.config.ts`
- Create: `desktop/tests/electron-host-feasibility.spec.ts`

- [ ] **Step 1: Prove normal startup/request/event.** Launch the packaged `.app`, wait for `stage0-ready`, assert one visible Electron window and one helper process, assert the `ready` event precedes the health result, and assert the result is `ws://localhost:3000` with no network request.

- [ ] **Step 2: Prove host-unavailable.** Point the isolated candidate at a nonexistent helper path. Assert a bounded `host_unavailable` state, one terminal error per pending call, no second process, and no hidden Tauri process.

- [ ] **Step 3: Prove early exit.** Set `COLONY_STAGE0_FAULT=exit-before-ready`. Assert the renderer never reports `READY`, receives a deterministic unavailable error within `defaultDeadlineMs`, and the app does not retry or start a fallback.

- [ ] **Step 4: Prove malformed frame.** Set `COLONY_STAGE0_FAULT=malformed-frame`. Assert the parser closes the session before dispatch, the renderer shows one `malformed_frame` error, no request side effect occurs, and no payload is logged.

- [ ] **Step 5: Prove reload/rebind.** Set `COLONY_STAGE0_FAULT=delay-response`, start one health request, trigger a trusted main-frame reload, and assert: the old call ends once as `renderer_rebound` or `outcome_unknown`; one monotonic `REHELLO` and one `REBOUND` occur on the same host session; no command is accepted before `REBOUND`; a fresh subscription/request succeeds after the acknowledgement; and the delayed old response/event is absent from the new renderer.

- [ ] **Step 6: Run only the focused hosted test.**

  ```bash
  cd /Users/mac/.traycer/worktrees/ai-native-ventures__colony/port-phase1-stage0-baseline
  . ./bin/activate-hermit
  pnpm exec playwright test --config desktop/playwright.electron.config.ts desktop/tests/electron-host-feasibility.spec.ts
  ```

  Expected: all five focused scenarios pass. This command is hosted-CI-only for
  Stage 0; do not run it on the shared Mac.

## Task 7: Wire the hosted macOS arm64 lane

**Files:**
- Create: `.github/workflows/electron-host-feasibility.yml`

- [ ] **Step 1: Require a real arm64 runner.** Use `macos-latest`, print `uname -m` and `rustc -vV`, and fail unless the host reports `arm64`/`aarch64`; do not silently cross-compile and call that a packaged runtime proof.

- [ ] **Step 2: Keep the lane isolated.** Checkout the exact branch commit, activate Hermit, install the locked JS dependencies, build only `desktop/src-native-host`, stage/package the candidate, run the static guard, and execute the focused Electron test. Upload the unsigned `.app` and redacted test report as artifacts only; do not sign, notarize, publish, dispatch a release, or access a preserved identity.

- [ ] **Step 3: Record the CI destination prerequisite.** The public `block/buzz` repository currently exposes reusable macOS and mobile workflows, including `.github/workflows/_ci-desktop-macos.yml` and `signed-macos-canary.yml`, but this branch has no authorized public destination. The private `squareup/buzz-releases` metadata and self-hosted runner inventory were not observable with the current token. The coordinator must name the authorized repository/lane before this workflow is expected to run.

## Acceptance gate and handoff

Stage 0/Stage 1 passes only when all of these are evidenced by the focused
hosted run:

1. Local baseline is still the exact upstream commit and the package contains
   no carried Colony code or Tauri/WebView runtime.
2. One visible Electron UI and one headless Rust host bind through versioned,
   bounded frames; the health-safe request performs no network/key operation.
3. The lifecycle event is ordered and cleaned up; no duplicate listener or
   orphan helper remains after exit.
4. Host-unavailable, early-exit, malformed-frame, and renderer-reload cases
   fail closed with bounded, deterministic outcomes.
5. `REHELLO`/`REBOUND` preserves one host session while fencing old pending
   calls, subscriptions, and low-level events; the new renderer can bind a
   valid post-ACK subscription without replaying an effectful command.
6. Hosted runner architecture and package artifact are explicitly recorded;
   no local native compilation, whole-app typecheck, full test suite, browser
   suite, relay run, release, or deployment is counted as proof in this step.

The next implementation task is therefore precise: create the standalone
`desktop/src-native-host` protocol/test skeleton and the focused Electron
transport modules from Tasks 2–4, then prove them with the hosted lane before
touching the full upstream renderer or any identity/relay path.

## Self-review

- **Spec coverage:** baseline pin, isolated profile, no-Tauri/no-fallback,
  harmless request, lifecycle event, HELLO/READY, REHELLO/REBOUND, old-
  generation fencing, four failure cases, hosted macOS arm64 packaging, and
  explicit all-platform follow-on scope each map to a task and acceptance
  criterion.
- **Placeholder scan:** every implementation step names its target files and
  commands; unresolved hosted private-lane access is called out as an
  observable prerequisite rather than a presumed failure.
- **Type/contract consistency:** the same manifest names, protocol limits,
  event, request, generation, profile, session, and error outcomes are used in
  the Rust, Electron, renderer, package, and CI tasks.
