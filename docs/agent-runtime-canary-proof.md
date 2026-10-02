# Managed Agent Runtime Canary Proof

Date: 2026-10-02

## Scope and credential handling

This proof targets the canary relay and its throwaway owner, channel, and test agents. Private keys, owner attestations, API key values, and credentialed URLs are not included here. Fresh attested-agent files remain outside this repository under the local canary directory.

The 2026-10-02 record-layer run used the supplied canary file through the existing `cp8-agent-live.py` helper. Command shape, with no credential values:

```sh
python3 "$HOME/worktrees/.lanes/tools/cp8-agent-live.py" "$HOME/.colony-canary/canary-ui.json"
```

Its output was captured and reduced to check names and pass or fail states before display. The helper reported 42/42 assertions passed. Its expired temporary allowance probe was logged as a note rather than an assertion, and the canary accepted that write. This is a confirmed defect, not a passing expiry check.

## Launch path investigation

The normal Desktop path starts a managed agent from the Desktop Tauri host:

1. The `start_managed_agent` Tauri command in `desktop/src-tauri/src/commands/agents.rs` chooses a local runtime or remote provider target.
2. The local runtime reaches `start_managed_agent_process` in `desktop/src-tauri/src/managed_agents/runtime.rs`.
3. `spawn_agent_child` resolves the saved ACP command, creates `std::process::Command` for that executable, and supplies the managed identity, relay URL, selected model, provider, and layered runtime environment.
4. `buzz-acp` then spawns the configured ACP agent over stdio through `AcpClient::spawn` in `crates/buzz-acp/src/acp.rs`.

Sprig is a packaging option, not the Desktop launcher. `crates/sprig/src/main.rs` dispatches the `buzz-acp`, `buzz-agent`, and `buzz-dev-mcp` executable personalities to the same crate entry points. The Desktop path resolves its configured ACP command and does not invoke Sprig by its `sprig` personality name.

Source references:

- [commands/agents.rs](/Users/mac/worktrees/colony-p2-l-agent/desktop/src-tauri/src/commands/agents.rs:826)
- [managed_agents/runtime.rs](/Users/mac/worktrees/colony-p2-l-agent/desktop/src-tauri/src/managed_agents/runtime.rs:454)
- [managed_agents/runtime.rs spawn](/Users/mac/worktrees/colony-p2-l-agent/desktop/src-tauri/src/managed_agents/runtime.rs:520)
- [buzz-acp/acp.rs](/Users/mac/worktrees/colony-p2-l-agent/crates/buzz-acp/src/acp.rs:463)
- [sprig/main.rs](/Users/mac/worktrees/colony-p2-l-agent/crates/sprig/src/main.rs:16)

## Provider baseline

Before code changes, `buzz-agent` selected providers from `BUZZ_AGENT_PROVIDER`. It read API credentials for Anthropic, OpenAI-compatible, OpenRouter, and optional Databricks token flows. It did not read `LLM_PROVIDER` or `DEEPSEEK_API_KEY`, and an unset `BUZZ_AGENT_PROVIDER` returned a configuration error. As a result, an environment with only the owner's configured DeepSeek key could not run the standalone managed-agent harness.

Source references:

- [buzz-agent/config.rs provider setup](/Users/mac/worktrees/colony-p2-l-agent/crates/buzz-agent/src/config.rs:631)
- [buzz-agent/config.rs provider resolution](/Users/mac/worktrees/colony-p2-l-agent/crates/buzz-agent/src/config.rs:922)
- [buzz-agent/config.rs provider tests](/Users/mac/worktrees/colony-p2-l-agent/crates/buzz-agent/src/config.rs:1289)

## Canary record-layer result

The run created a fresh owner-attested managed identity. The owner joined it to the throwaway channel and assigned its employee position. The canary relay accepted the position, a temporary allowance with a future expiry, lesson proposal and approval transitions, duty proposal and approval transitions, explicit-scope standing permission creation and revocation, and a tool-consent ask followed by owner approval. A stale consent decision was refused. The employee history command responded and an undo to an unknown revision was refused.

Two limits were visible:

- An already-expired temporary allowance was accepted. The current relay path validates timestamp syntax but does not require the submitted expiry to be in the future. The helper reported this as a note and still exited successfully.
- A managed-agent allowance or external-cost write was rejected during tag validation because the NIP-OA attestation adds a tag before the owner/admin authority check. The operation remained refused, but the refusal reason did not reach the intended authority boundary.

This run exercised real canary records through the release `buzz` CLI. It did not start `buzz-acp` or `buzz-agent`, invoke an LLM, publish a harness response to a mention, fire a workflow schedule, emit kind 44200 usage, or create an employee configuration revision. Those outcomes remain unproven.

## Existing backend boundaries

`docs/company-records.md` states that kind 44200 reports have token counts and estimated USD usage but do not establish a funding source, next-turn estimate, or verified Colony-credit execution signal. The current runtime therefore has no verified allowance budget-stop action. An over-allowance total by itself does not stop a worker. The budget-stop portion is `NEEDS_API` until those runtime signals and a supported stop path exist.

Duty records are tied to the existing workflow scheduler and store IANA timezone schedules. The approved duty ask atomically creates the workflow definition and duty head. This canary record-layer run approved and removed a test duty, but it did not wait for a scheduled workflow run or exercise catch-up.

## Acceptance status

- Implemented: no code changes yet.
- Tested: canary record-layer helper reported 42/42 assertions passed; the expired-expiry defect was independently visible as an accepted canary write but was not counted as a failed assertion by that helper.
- Visually compared: not applicable; this runtime proof changes no UI.
- Live harness: not yet run.
- CI: not yet run.
- `NEEDS_API`: automatic allowance stop based on verified source-of-funds and next-turn estimate.
