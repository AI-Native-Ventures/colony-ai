# RelayV2 Transport Contract Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-derive PR26's JavaScript transport doubles and helper caller from the current native RelayV2 source, then record the native derivation SHA in PR26.

**Architecture:** Keep the adapter over the caller-owned child seam. Make mock responses and lifecycle events use the native v1 `@colony-native:` envelope carrier, while the RelayV2 operation context remains version 2 inside the native dispatcher. The interop harness will send and classify the same framed outer envelopes as the native D0 caller.

**Tech Stack:** Node.js test runner, ECMAScript modules, Rust native-host protocol source, GitHub CLI.

---

### Task 1: Bind mock doubles to the current native envelope

**Files:**
- Modify: `desktop/src-electron/relay-transport.test.mjs`
- Modify: `desktop/src-electron/relay-transport.mjs`

- [x] Add native binding constants and a response-envelope builder containing `type`, outer `protocolVersion: 1`, `profileId`, `sessionId`, `generationId`, echoed `requestId`, `outcome`, and the native optional `payload`/`error` fields.
- [x] Change the mock lifecycle vector to deliver an outer native `EVENT` whose `event: "relay_message"` payload contains the validated `{connectionId,generation,messageType,payload}` inner envelope.
- [x] Teach the adapter to unwrap that native relay-message event while retaining generation fencing and inner RelayV2 validation.
- [x] Keep malformed-response and disposal vectors on the same full native envelope builder so removing any required envelope field is falsifiable.
- [x] Re-derive close and signing response fixtures from the native operation dispatcher, including whole-connection close identity and operation-specific event kind/content/tags.

### Task 2: Align the real-helper caller with native D0

**Files:**
- Modify: `desktop/src-electron/relay-transport.interop.mjs`

- [x] Send `@colony-native:` plus JSON plus newline on stdin and strip that prefix before parsing stdout.
- [x] Use outer `protocolVersion: 1`, omit the native-unrecognized inbound registry digest and REQUEST-only build/deadline fields, retain the required HELLO `buildId` plus descriptor with exactly `relayUrl`, `authorityRef`, `userDataRoot`, and `flavor`, and default/helper-spawn with `--relay-v2`.
- [x] Classify unsolicited outer `EVENT` frames and continue waiting for the matching `RESPONSE` request id, as the native connect path emits lifecycle events before its response.

### Task 3: Verify and hand off

**Files:**
- Modify: GitHub PR #26 body via `gh`

- [x] Run the focused adapter suite once after the patch and record exact test counts; run the interop file without a helper only to record its explicit skip.
- [x] Run syntax/format/diff checks for changed JavaScript files.
- [x] Update PR26 with the exact current native derivation SHA `f95b3e93b1f3acc28448c7bfde26c4d68f4d1840`, the corrected outer-v1/inner-v2 contract, and the expected pre-PR24 three-OS red.
- [x] Commit all source/plan changes with `git commit -s`; do not merge, rebase, or arm auto-merge.
