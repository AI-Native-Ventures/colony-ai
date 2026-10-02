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

This record-layer-only run exercised real canary records through the release `buzz` CLI. It did not start `buzz-acp` or `buzz-agent`, invoke an LLM, publish a harness response to a mention, fire a workflow schedule, verify kind 44200 usage ingestion, or create an employee configuration revision. Later harness runs below establish scenarios 1 through 3. The remaining scenarios are detailed below.

## Existing backend boundaries

`docs/company-records.md` states that kind 44200 reports have token counts and estimated USD usage but do not establish a funding source, next-turn estimate, or verified Colony-credit execution signal. Desktop has an archive-to-ledger path that can create linked kind 30654 turn records with `sourceOfFunds: "unknown"`, but this proof did not verify a kind 44200 report or its ingestion on canary. The runtime has no verified allowance budget-stop action. An over-allowance total by itself does not stop a worker.

Duties use the existing workflow scheduler and IANA timezone schedules. The approved duty ask atomically creates the workflow definition and duty head. Scenario 3 below records a completed scheduled check-in. The scheduler was not stopped or restarted during that test, so the live catch-up behavior after downtime remains unproven.

## Acceptance status

- Implemented: `buzz-agent` supports `LLM_PROVIDER` provider selection with DeepSeek as the default and explicit provider model configuration. Per-agent `BUZZ_AGENT_PROVIDER` still takes precedence. PR #177 is merged into `codex/phase2-integration`. A separate allowance-expiry fix is implemented in PR #184 after a canary write accepted an already-expired temporary allowance; its test-first and hosted-CI state are tracked by that PR. The fix has not been deployed or live-verified.
- Tested: the one authorized Sprig release build completed. Local Rust tests and clippy were not run. The regression-only commit in PR #184 failed its Rust unit-test job as expected. The follow-up fix passed hosted Rust Lint, Rust Unit Tests, Windows Rust, and the remaining applicable checks at head `5cda5b057160c4cee355839437f52e5b8da0d2bf` on run attempt 2. Desktop Smoke shards 5 and 8 failed on attempt 1 and both passed on the same-head retry.
- Visually compared: not applicable; this runtime proof changes no UI.
- Live canary: scenarios 1 through 3 are proven with fresh owner-attested employees, the correctly wired Sprig harness, and owner-side relay reads. Scenario 3 does not prove scheduler catch-up. Scenario 4's real spend action, scenario 5's usage-to-ledger path and budget stop, and scenario 6's configuration revision and undo remain unproven as described below.
- CI: PR #177 code checks passed and PR #180 documentation checks passed; both are merged. PR #184 passed hosted CI on head `5cda5b057160c4cee355839437f52e5b8da0d2bf`. The report expansion is in PR #185; its documentation path checks passed and unrelated suites were skipped by path filtering.
- `NEEDS_API`: an executable spend action wired to the consent broker; verified per-turn funding source, next-turn estimate, and a supported runtime stop path for allowance enforcement.

## Managed runtime attempt

A first launch omitted the release directory from `PATH`, so the agent shell could not resolve the `buzz` CLI. A later DeepSeek run used the correct Buzz agent and MCP command paths, connected, received mentions, and attempted provider requests. DeepSeek returned an insufficient-balance response, so it did not answer. The direct DeepSeek path is unproven until that provider account can serve requests.

Two OpenRouter retries were invalid because they put the Buzz binaries on `PATH` but did not set `BUZZ_ACP_AGENT_COMMAND` and `BUZZ_ACP_MCP_COMMAND`; Sprig therefore used its default command configuration. They are excluded from acceptance evidence. A minimal OpenRouter request using the configured credential returned HTTP 200. The accepted fallback was then run with a fresh owner-attested identity and all three executable paths explicitly selected. The agent joined the channel, the owner assigned its position, and the owner sent one tagged mention. The relay accepted the mention and an owner query returned one message authored by that employee after it, containing the unique proof marker. This proves scenario 1 on canary. The app default remains DeepSeek; OpenRouter and the explicit model were only process-level test settings.

The correct Sprig invocation used `LLM_PROVIDER=openrouter`, `OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731`, `BUZZ_ACP_AGENT_COMMAND=<built buzz-agent personality>`, and `BUZZ_ACP_MCP_COMMAND=<built buzz-dev-mcp personality>`. The brief acknowledgement and hidden-file shell probe used a 256-token output cap and disabled thinking. The temporary test file held a random value unknown to the model prompt; the fresh employee returned the exact value, proving that the MCP shell tool read it. The successful lesson run used a 1,024-token cap. No credential values, relay URLs, event IDs, public keys, or raw harness logs are included. Temporary identities, oracle files, and captured logs were removed after each run.

Sanitized command shape:

```sh
OWNER_KEY=<canary owner key from the local canary file> OUT=<temporary identity file> ~/worktrees/.lanes/tools/attest-agent
buzz channels join --channel <configured canary channel>
buzz team set-position --member <fresh attested pubkey> --title "Canary AI employee runtime proof"
LLM_PROVIDER=openrouter OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731 BUZZ_ACP_AGENT_COMMAND=<built buzz-agent personality> BUZZ_ACP_MCP_COMMAND=<built buzz-dev-mcp personality> <built buzz-acp personality>
buzz messages send --channel <configured canary channel> --content <non-side-effect acknowledgement prompt> --mention <fresh attested pubkey>
buzz messages get --channel <configured canary channel> --limit 200
```

The earlier empty read was superseded by the successful query of the accepted mention and employee reply in the correctly wired run.

## Scenario 2: lesson proposal and owner approval

A second fresh owner-attested employee posted a unique evidence message. The owner-side raw event query confirmed that the message was kind 9 and authored by that employee. The owner then mentioned the employee with a `buzz lessons create` command containing a lesson about grounding its command reports in observed tool output. The record cited the employee's real evidence event and started with `unassessed` confidence.

The relay showed the lesson as a candidate with the expected employee and evidence reference. The owner approved it with `moderate` confidence, and a follow-up `buzz lessons get` read showed approved status and the saved confidence. Sanitized ACP status classification confirmed a shell tool call started and completed, with an allow-once decision and no failed tool update. Stream logging was disabled; the raw log was removed.

An earlier attempt with a 256-token output cap produced no candidate and no employee reply. The same flow passed with the 1,024-token cap. This was a constrained test attempt, not evidence of a product defect or missing API.

## Scenario 3: approved duty check-in

A third fresh owner-attested employee joined the throwaway canary channel and received its employee position. An approved one-off duty was scheduled for `03:59 Africa/Johannesburg` (`2026-10-02T01:59:00+00:00`), with an explicit 1,024-token output cap and thinking disabled for the harness run. The ACP harness launched with the same explicit executable configuration as the earlier scenarios and the per-process OpenRouter test override.

The owner-side channel read found a kind 9 check-in authored by that fresh employee. It contained the unique test marker, rendered the real trigger context, and did not contain literal template placeholders. The duty run record reported `active` then `completed`, with `workflow_completed=true`, `missed_occurrences=1`, and `skipped_occurrences=0`. The one-off duty was deleted after the result was captured to prevent another scheduled run.

These observations prove that an approved duty fired on its configured schedule and the managed agent posted its check-in. No scheduler outage or delayed restart was induced. The observed `missed_occurrences` field by itself does not establish catch-up behavior after downtime; that part of the requested scenario remains unproven.

Sanitized command shape: the owner approved a one-off duty proposal in the throwaway channel; the harness was launched with `LLM_PROVIDER=openrouter`, `OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731`, explicit `BUZZ_ACP_AGENT_COMMAND` and `BUZZ_ACP_MCP_COMMAND`, and a 1,024-token cap; the owner read the duty run history and channel messages, then deleted the test duty. The temporary duty JSON, identity, marker, and raw harness log were removed after the proof.

## Scenario 4: consent for a spend action

The record-layer probe created a real canary tool-consent ask, the owner approved it, and a stale consent decision was refused. This proves the ask and decision records can be written and read. It does not prove that the running agent requested consent for a spend operation, waited for the decision, or stopped after a revoke.

The ACP broker classifies sensitive `session/request_permission` calls for `SpendMoney` (`crates/buzz-acp/src/tool_permissions.rs:33-62, 130-145`). The configured `buzz-dev-mcp` server exposes shell, file, image, and todo tools, but no payment or spend executor (`crates/buzz-dev-mcp/src/lib.rs:40-124`). There is no real spend action for the broker to gate in this harness. This scenario is `NEEDS_API`: add a supported spend executor integrated with the consent broker and an observable execute/no-execute seam for approval and revocation. No payment was attempted.

## Scenario 5: turn usage, allowance, and budget stop

This Sprig-only live run did not establish that an agent emitted an owner-addressed kind 44200 report, that Desktop ingested it as a linked kind 30654 record, or that the resulting amount counted against the employee allowance. Desktop has an archive reader and idempotent ledger writer for this flow (`desktop/src/features/power/spendRelay.ts:172-285, 306-332`), but its canary behavior was not exercised here.

The current company-record contract explicitly says that kind 44200 lacks verified funding-source evidence, a next-turn cost estimate, and a per-turn Colony-credit execution signal (`docs/company-records.md:861-877`). Unknown sources must remain unknown, and no budget stop is reachable from an over-allowance total alone. The budget-stop portion is `NEEDS_API`: provide verified per-turn source-of-funds, a real next-turn estimate, and a supported runtime stop path. No spend action or payment was executed.

The same record-layer probe found that the relay accepted an already-expired temporary allowance. PR #184 adds a production-path validator regression and rejects an expiry at or before the current time while preserving readability of naturally expired heads. Its fix is implemented but not yet live-verified on canary.

## Scenario 6: employee configuration revision and undo

The Desktop employee profile has a producer that records instruction changes as employee revisions (`desktop/src/features/company-team/ui/EmployeeProfileScreen.tsx:328-430`), and the CLI exposes `buzz agents history` and `buzz agents undo` (`crates/buzz-cli/src/lib.rs:443-457`; `crates/buzz-cli/src/commands/employee_history.rs:18-117`). The record-layer probe read history and confirmed that an unknown revision is refused, but it did not create a real instruction or model change and restore it. This scenario remains unproven, not `NEEDS_API`; a live run through the Desktop revision producer and CLI undo path is still required.

The remaining live gates are scheduler catch-up after a missed run and a real Desktop-created employee revision followed by history and undo. Scenarios 4 and 5 have the `NEEDS_API` gaps listed above.
