# P3 preparation: Rust and Codex app-server integration

Prepared on `feat/chatgpt-signin-p3`, stacked on P2 head
`6291d43a55b4a5fc68df594e3701bd735fd0b6a5`. P2 is PR 261. Do not open a
P3 PR until 261 is merged. The coordinator owns merges in order 256, 255, 261.
Do not rebase P2 until 255 is merged. Preserve its browser broker and P2's
ChatGPT runtime when resolving `desktop/electron/main.mjs`.

This phase follows the existing relay decision. It adds native runtime
integration, with no new owner-visible control. `COLONY_CHATGPT_PLAN` stays off
by default. No real account operation, local Rust execution, runtime install,
packaged build, release or merge is part of preparation.

## First source checkpoint

`electron_host/private.rs` prepares the native-to-main request half of the P2
transport. Requests and replies use stdio directly. It is not a Tauri command,
event or renderer bridge. The transport installs a process-scoped broker before
ready, dispatches private replies on its existing reader thread, and closes
pending requests on every reader exit.

Admission is capped at 16 pending requests and a 16-frame writer queue. Frames
are limited to 64 KiB including their newline. IDs are strictly increasing and
never exceed JavaScript's safe integer range. Allocation and enqueue share one
lock. One dedicated writer handles pipe backpressure; callers have a 65-second
deadline, after the parent's 60-second deadline. Cancelled or expired queued
requests are discarded. No child or parent failure text is returned verbatim.

Rust regression tests exercise the broker and wire parser. They cover reply
correlation, null results, redaction, capacity, ID exhaustion, cancellation,
timeout, late replies, shutdown, malformed payloads and oversized replies.
These tests have been authored, not compiled or run. No managed agent uses the
new request seam yet. This checkpoint is not a working Codex integration.

`electron/chatgpt/plan-launch-broker.mjs` prepares the matching main-process
receipt lifecycle on top of P2's actual launch helper and relay. Its focused
Node gate passed 24 tests, including the existing native transport tests. Tests
use the fake OpenAI server and exercise grant expiry, commit/release,
generation fencing, capacity reservation, entitlement, late cancellation,
default-off behavior and typed error redaction. The initial run exposed five
incorrect HTTP-status expectations in the new tests; the relay correctly
denies retired capabilities with 403. The corrected gate passed.

The final broker-only gate passed all 11 tests, followed by touched Biome. It
also covers account retirement across explicit same-account reconnection and
late writes to the stable private Codex home. A retired prepare retains its
scope and capacity slot until its handler exits, so it cannot overwrite a
successor's startup config. One preceding gate was stopped before ten minutes,
including more than seven minutes in the shared heavy-command queue. The final
successful Node run took three seconds; no local Rust command was run.

The broker requires a trusted resolver that verifies the Colony runtime bundle;
the resolver and exact binary integrity manifest are not implemented yet. Test
paths are fixtures, not installed runtimes. Main boot does not wire this broker
until that resolver exists. Node proof does not cover Rust dispatch or actual
adapter/app-server execution.

## Launch ownership and lifecycle

Electron main owns account selection, OAuth credentials, authorization leases,
model entitlement, relay grants and private Codex homes. Native receives only a
local relay capability and trusted launch configuration. It must never receive
an OpenAI bearer or refresh token.

Use a dedicated main-only launch broker with three private methods:

- `plan_prepare`: require local backend, explicit community/agent/account,
  spawn generation and selected model. Validate exact bundled runtime versions,
  account readiness and model entitlement before creating a grant. Return a
  receipt containing pinned executable paths, sealed env, clientInfo and a
  random lease ID. Never accept child-provided paths, env, provider config or
  app version.
- `plan_commit`: acknowledge the receipt after a successful spawn, binding the
  same scope and spawn generation. Unacknowledged receipts expire after a
  finite deadline and revoke their relay grants. This prevents a lost or late
  private reply from leaving a usable orphan capability.
- `plan_release`: revoke on spawn failure, adapter initialization failure,
  cancellation, agent stop, replacement or community teardown. A released
  generation cannot revoke its successor. Repeated release is idempotent.

Use `handlePrivateRequest` as the `NativeHost.onPrivateRequest` callback. Its
result envelope is `{ok:true,result}` or `{ok:false,code}`. Only a fixed set of
recovery codes may leave main; unexpected exception text becomes
`plan_launch_failed`. Native validates and deserializes that envelope rather
than treating a transport-level failure as account readiness.

Cap outstanding and active receipts at 64, matching the existing relay cap.
Main shutdown revokes all receipts before native shutdown. An aborted prepare
must revoke even if private config persistence finishes after cancellation.
Rust cleanup must not depend only on a best-effort future in `Drop`: explicitly
await release on normal paths, with main's expiry/replacement fencing as the
fallback for process death. Persistent Codex homes contain no OpenAI secrets.

Store the selected account as an internal launch binding, separate from ambient
account selection. A changed selected account must not redirect an existing
agent. Restore uses the saved binding and refuses disconnected accounts.
Remote deployment is rejected before any credential or config work. Renderer
records, status events, logs and restart-diff labels must not contain the
receipt, local key, private route or environment values.

## Native and ACP launch seams

Add small helpers rather than growing grandfathered files:

1. `desktop/src-tauri/src/managed_agents/chatgpt_plan.rs` validates and holds a
   typed receipt. Hook `spawn_agent_child` in `managed_agents/runtime.rs` after
   effective harness/provider resolution and before process spawn. Apply the
   trusted plan environment after descriptor env, runtime defaults, model
   overrides and normal Codex policy. Bypass ordinary Codex CLI login discovery
   only for this explicit plan launch. Missing or wrong pinned runtime is a
   readiness failure, never an automatic npm/global-runtime fallback.
2. `crates/buzz-acp/src/chatgpt_plan.rs` validates the internal receipt and
   reapplies its sealed config after `build_codex_config_env` and the existing
   operator-wins loop in `AcpClient::spawn_with_process_group`. Remove inherited
   API keys, Codex bearer variables, auth requests, base URLs and provider/home
   overrides. Do not globally change precedence for other providers.
3. For this launch only, `build_initialize_params` sends clientInfo name and
   title `Colony`, with the trusted app version. The pinned adapter forwards
   that attribution to app-server. Ordinary ACP initialization is unchanged.
4. Keep `CODEX_HOME` stable for the community/agent/account. Renew the local
   capability on restart. Send both startup TOML and session `CODEX_CONFIG`,
   including explicit `MODEL_PROVIDER=colony_chatgpt_plan` for thread resume.
   Do not reuse a saved relay port/key. Preserve the adapter's actual thread ID.

The relay renews OAuth per request, so ordinary token rotation does not restart
the adapter. Only a completed Codex turn is success. A failed/interrupted turn,
including a failure after deltas or tool activity, must remain a failure.

## Account circuit and prompt outcome

Read the main-owned, credential-free `plan-runtime.json` account state at the
production prompt admission and failure seams. Validate account binding and
schema; an unreadable state cannot report ready. Stop before upstream work when
the account has a usage-limit or backoff circuit. Main persists a discovered
limit before returning the terminal failure.

Integrate with the existing `provider_failure` notice path and
`handle_prompt_result`. Plan-limit, revoked permission and usage-unavailable
must not enter the generic retry/dead-letter loop as completed work. Keep
pending work durable or propagate a terminal failure that can be explicitly
retried; do not discard a journal merely because its retry is paused. A stream
failure must not replay a tool that already ran. Emit one plain existing-status
notice, with the agreed plan-limit wording and no invented reset time.
No paid API fallback or CLI-login instruction may be triggered for this path.

## Exact runtime and integration gate

Pin `@agentclientprotocol/codex-acp` to `2.1.1` and `@openai/codex` to `0.159.1`,
including platform payload versions and registry integrity. Both are Apache-2.0.
The adapter's published dependency range must not choose a newer Codex version.
Resolve only the Colony bundle, never a PATH executable selected by a renderer
or inherited `CODEX_PATH`. Runtime installation and actual execution are CI
only. No SIWC devkit package or asset is used.

The published adapter entry point is `dist/index.js`. Native must run it with
Colony's trusted bundled Node runtime and explicit arguments, rather than rely
on its shebang or a PATH Node. The bundle resolver must supply this invocation
before main is wired. An `adapterPath` fixture alone is not an executable or a
cross-platform launch proof. Published package metadata and integrity values
were saved in the preparation lane; no tarball or runtime was downloaded.

The P3 acceptance gate needs CI running the actual pinned adapter and app-server
through the production launch helper against the fake OpenAI server:

- Initialize attribution reaches app-server as `Colony` and the app version.
- The first Responses request invokes a harmless local file tool. The second
  request includes its real output and completes the turn. A stub RPC driver
  is not evidence for this gate.
- No real OAuth credential occurs in child env, argv, startup/session config,
  renderer events or captured logs. Adversarial parent/persona env cannot
  replace the sealed provider, capability, home or executable.
- Refresh before dispatch succeeds without an app-server restart. One rejected
  bearer is replayed once before bytes; partial streams/tools are not replayed.
- HTTP and streamed usage limits fence two agents sharing an account, while a
  different account remains usable. Availability errors preserve credentials
  and apply bounded backoff. No implicit billing fallback occurs.
- Restart obtains a new capability, resumes the actual saved thread with the
  explicit provider, and retains local history without contacting a stale port.
- Disabled builds create no plan listener/home/grant or child process. Remote
  launches, wrong bundle versions, cancelled prepares and failed spawns leave
  no usable capability or leaked process tree.

Run native formatting, Clippy and Rust tests only in CI. Run focused Node tests
and touched Biome through `heavy.sh`, one command at a time, stopping before
10 minutes. Review the whole workflow and every check at the final PR head;
cancelled/pending checks do not count as green. P3 still does not prove packaged
runtime adoption, real sign-in, plan eligibility or a live owner tool round trip.

## Public source contract

The public custom-provider documentation supports app-server's local tool loop,
Colony client attribution and local history. Supplying an OAuth bearer directly
is documented; substituting it in Colony's private relay is an inference from
that contract and remains a separate vendor/owner proof.

- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery

The preview header remains P2's removable compatibility setting, not an
official requirement. No new owner-visible control or feature enablement is
authorized by this preparation.
