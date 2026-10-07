# Agent Browser Implementation Plan

**Goal:** Complete launch phases 4 and 5 as separate PRs to develop, retaining the broker history and the frozen dock architecture.

**Architecture:** Electron main owns tabs, CDP, grants, policy and secrets. A private authenticated socket connects a narrow Colony MCP server. Only the trusted main app may approve sites and consequential actions; page text is data. Everything remains default off behind COLONY_BROWSER_AGENT=1 until slices 1 through 3 pass and the owner enables it.

**Tech Stack:** Electron WebContentsView, Node ESM, React/TypeScript, ACP Rust through CI, Playwright.

Owner directive, 7 Oct: this is part of launch; reputation is already damaged. Open the first PR within 90 minutes. Do not merge. GitHub CI is the gate. No local cargo, full suites or packaged builds. Keep separate implementation, focused tests, CI, packaged adoption and live proof.

## Slice 1: Electron main broker integration

- [x] Fetch develop, create feat/agent-browser and merge origin/codex/105-browser-broker preserving history. Restore ACP files to develop for the separate slice 2.
- [x] Rerun the imported pure broker tests: node --test --test-timeout=30000 desktop/electron/browser-broker/*.test.mjs. Baseline: 223 passing.
- [ ] Add internal browser-host adapter, synchronous will-frame-navigate/will-redirect and explicit navigation/history gates, document/closure notifications, and grant-aware takeover.
- [ ] Compose Electron driver and broker in desktop/electron/browser-broker/electron-host.mjs. Install the per-profile pinning proxy before grant issuance, force loopback through it, close pooled connections, and fence ownership/profile changes.
- [ ] Wire desktop/electron/main.mjs and preload.cjs with trusted main-frame IPC; expose typed browserBroker.ts without tokens or socket secrets.
- [ ] Add falsifiable Node tests at those production seams and a single fixture-site Electron Playwright spec: allowed actions, redirects/cross-origin denial, private/file denial, revoke during wait and explicit submit confirmation. Local runs use heavy.sh, a free COLONY_E2E_PORT, and vite build --mode e2e.
- [ ] Push meaningful steps, open PR to develop, watch with pr-watch.sh, fix CI failures, report DONE PR with exact status.

## Slice 2: ACP and Colony agent tools

- [ ] Branch from newly fetched develop after coordinator integration of slice 1. Recover the original ACP patch from 1731a77a6, preserving Colony agent-facing naming.
- [ ] Bind the narrow colony-browser MCP server into managed runtime only when the main-owned broker environment exists; scrub broker secrets from agent environments. Add connect/download metadata tools to existing strict descriptors and broker dispatch as required.
- [ ] Node tests bind MCP stdio/socket production dispatch and tools disappear on revoke. Brand guard and Rust validation run in CI only. PR and CI gate before UI.

## Slice 3: Frozen dock safety UI

- [ ] Plug into workAreaTypes.ts, workAreaTabRegistry.tsx and existing dock browser controls. Keep missing reference controls minimal with existing tokens and identify this in PR.
- [ ] Add per-task/per-site grants, named controller, Stop, Take over, redacted bounded log, accessible confirm/reject controls for sends, purchases, posts and permission changes.
- [ ] Gate: takeover fences pending actions; credentials absent from log; malicious page text cannot issue grants. Register mock-bridge specs in BOTH smoke and integration. Focused local checks plus CI.

## Slice 4: Packaged real-run proof

- [ ] Extend desktop/tests/real-run harness with fixture browser workflow and proof output. Coordinator runs the CI packaged app in a throwaway profile, not the owner profile.
- [ ] Gate: actual packaged MCP launch and grant-controlled real Chromium actions, owner Stop/takeover, confirmation and denied destinations. Record observed evidence separately from CI and fake-driver proof. Owner alone flips the default-off feature.
