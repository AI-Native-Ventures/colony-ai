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

Duty records are tied to the existing workflow scheduler and store IANA timezone schedules. The approved duty ask atomically creates the workflow definition and duty head. A live scheduled run was later created, but it remained `waiting_agent`; the test duty was paused after observation. A completed scheduled check-in and catch-up remain unproven.

## Acceptance status

- Implemented: `buzz-agent` now supports `LLM_PROVIDER` provider selection with DeepSeek as the default and explicit provider model configuration. Per-agent `BUZZ_AGENT_PROVIDER` still takes precedence. Changes are in PR #177.
- Tested: the one authorized Sprig release build completed. Local tests were not run. Hosted CI passed on code head `27e58786b47b`; the following documentation update starts a new CI cycle.
- Visually compared: not applicable; this runtime proof changes no UI.
- Live canary: scenario 1 is proven with a correctly wired Sprig harness, a fresh owner-attested employee, and one published reply to the owner's mention. Scenarios 2 through 6 remain unproven.
- CI: pass on the current PR code head before this report update; pending for the next pushed head.
- `NEEDS_API`: automatic allowance stop based on verified source-of-funds and next-turn estimate.

## Managed runtime attempt

A first launch omitted the release directory from `PATH`, so the agent shell could not resolve the `buzz` CLI. A later DeepSeek run used the correct Buzz agent and MCP command paths, connected, received mentions, and attempted provider requests. DeepSeek returned an insufficient-balance response, so it did not answer. The direct DeepSeek path is unproven until that provider account can serve requests.

Two OpenRouter retries were invalid because they put the Buzz binaries on `PATH` but did not set `BUZZ_ACP_AGENT_COMMAND` and `BUZZ_ACP_MCP_COMMAND`; Sprig therefore used its default command configuration. They are excluded from acceptance evidence. A minimal OpenRouter request using the configured credential returned HTTP 200. The accepted fallback was then run with a fresh owner-attested identity and all three executable paths explicitly selected. The agent joined the channel, the owner assigned its position, and the owner sent one tagged mention. The relay accepted the mention and an owner query returned one message authored by that employee after it, containing the unique proof marker. This proves scenario 1 on canary. The app default remains DeepSeek; OpenRouter and the explicit model were only process-level test settings.

The correct Sprig invocation used `LLM_PROVIDER=openrouter`, `OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731`, `BUZZ_ACP_AGENT_COMMAND=<built buzz-agent personality>`, and `BUZZ_ACP_MCP_COMMAND=<built buzz-dev-mcp personality>`. It also set a 256-token output cap and disabled thinking for the short reply. No credential values, relay URLs, event IDs, public keys, or raw harness logs are included. Logs containing credential-shaped material remain outside the repository.

Sanitized command shape:

```sh
OWNER_KEY=<canary owner key from the local canary file> OUT=<temporary identity file> ~/worktrees/.lanes/tools/attest-agent
buzz channels join --channel <configured canary channel>
buzz team set-position --member <fresh attested pubkey> --title "Canary AI employee runtime proof"
LLM_PROVIDER=openrouter OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731 BUZZ_ACP_AGENT_COMMAND=<built buzz-agent personality> BUZZ_ACP_MCP_COMMAND=<built buzz-dev-mcp personality> <built buzz-acp personality>
buzz messages send --channel <configured canary channel> --content <non-side-effect acknowledgement prompt> --mention <fresh attested pubkey>
buzz messages get --channel <configured canary channel> --limit 200
```

The earlier empty read was superseded by the successful query of the accepted mention and employee reply in the correctly wired run. The next live gates are lesson proposal and approval, scheduled duty completion and catch-up, consent and revoke for a spend action, usage ingestion and allowance behavior, and employee revision history and undo.
