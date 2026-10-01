# Managed Agent Canary Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the managed-agent runtime against canary and record every supported path, defect, and API gap without claiming a mock or record-only run is a live AI workflow.

**Architecture:** Desktop owns the normal local managed-agent process and starts the ACP harness through its Tauri host. Sprig is the packaged multicall form of the ACP harness, agent, and developer MCP. Canary tests will use a fresh owner-attested identity and the release CLI, while code fixes stay on the production seams exercised by those tests.

**Tech Stack:** Rust, the `buzz` CLI, `buzz-acp`, `buzz-agent`, Sprig, Nostr events, and the canary relay.

---

### Task 1: Record the launch and provider baseline

**Files:**
- Create: `docs/agent-runtime-canary-proof.md`
- Read only: `desktop/src-tauri/src/managed_agents/runtime.rs`
- Read only: `desktop/src-tauri/src/commands/agents.rs`
- Read only: `crates/sprig/src/main.rs`
- Read only: `crates/buzz-agent/src/config.rs`

- [x] Trace the Desktop Tauri command through `start_managed_agent_process` to the child process spawn.
- [x] Trace Sprig's personality dispatch and compare it with the Desktop path.
- [x] Record the exact provider variables currently read and the absent `LLM_PROVIDER` and DeepSeek paths.
- [x] Record the canary record-layer baseline with credentials and keys excluded.

### Task 2: Add dynamic DeepSeek selection to buzz-agent

**Files:**
- Modify: `crates/buzz-agent/src/config.rs`
- Modify: `crates/buzz-agent/src/llm.rs`
- Test: `crates/buzz-agent/src/config.rs`
- Test: `crates/buzz-agent/src/llm.rs`
- Modify: `crates/buzz-agent/README.md`

- [ ] Add a falsifiable provider-selection test for per-agent provider precedence, `LLM_PROVIDER`, and the DeepSeek default.
- [ ] Add a test that resolves DeepSeek only with its own key and resolves its model and API base from explicit DeepSeek configuration.
- [ ] Route DeepSeek through the existing OpenAI-compatible chat transport, while retaining its provider identity in config and selecting Chat Completions explicitly.
- [ ] Preserve provider-specific model override behavior and return actionable missing-key or missing-model errors without exposing values.
- [ ] Run only the one permitted release Sprig build after code changes. Do not run local Cargo tests or another Cargo build.
- [ ] Commit the provider test before its implementation, then commit the implementation and documentation.

### Task 3: Recheck the temporary allowance expiry defect

**Files:**
- Modify: `crates/buzz-core/src/company_spend.rs`
- Test: `crates/buzz-core/src/company_spend.rs`
- Read only: `crates/buzz-relay/src/handlers/company_spend.rs`

- [ ] Add a regression test proving an already-expired temporary allowance is rejected by the same validator called from the relay.
- [ ] Make the validator compare expiry with an injected current time; keep the public validator bound to the real current time.
- [ ] Preserve temporary allowance evaluation and reversion for valid future expiries.
- [ ] Commit the test before the fix and validate the final head through hosted CI.

### Task 4: Exercise the real canary harness

**Files:**
- Modify: `docs/agent-runtime-canary-proof.md`
- Runtime data: canary only, no repository credential files

- [ ] Build or reuse the single authorized Sprig release binary and invoke its `buzz-acp` and `buzz-agent` personalities.
- [ ] Use one fresh owner-attested agent for each proof run; keep its private key and attestation outside the repository and never print them.
- [ ] Prove mention and reply, lesson proposal and owner approval, an approved duty firing and missed-run catch-up, and tool consent through the real harness.
- [ ] Capture kind 44200 usage from the harness and test whether it can be recorded against an explicit allowance.
- [ ] Attempt a real instruction or model revision and verify `buzz agents history` and `buzz agents undo` restore it.
- [ ] Mark the allowance stop as `NEEDS_API` if the required estimate and funding evidence are unavailable. Do not simulate a stop.
- [ ] Record each pass, failure, command shape, event or run reference when safe, and the exact unproven boundary.

### Task 5: Push and pass hosted CI for each defect PR

**Files:**
- Create or update: draft PRs against `codex/phase2-integration`

- [ ] Keep each defect class in its own PR and include the current proof document.
- [ ] Push after the focused local static checks and the single authorized Sprig build are complete.
- [ ] Poll only the current PR head, read any finished failed job log immediately, and fix failures caused by the branch.
- [ ] Report implemented, locally tested, visually compared, CI, and live-canary proof separately. The coordinator merges.
