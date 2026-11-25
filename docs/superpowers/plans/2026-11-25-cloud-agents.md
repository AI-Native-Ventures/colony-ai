# Cloud Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any managed agent can be flipped between "This Mac" and "Cloud"; a cloud agent runs `buzz-acp` + Colony Agent on its own Fly Machine, woken by the relay, paid from the owner's Colony credits.

**Architecture:** The relay owns cloud agents: an owner-signed placement command produces a relay-signed placement head; the relay stores each agent's sealed key and config snapshot, fences agent authentication by placement generation, starts one Fly Machine per cloud agent through a `CloudHost` layer when a message arrives, and mints that machine's AI session. The machine boots with a one-time token, fetches its secrets from the relay, and runs the normal harness. The desktop shows and flips placement, never starts a local copy of a cloud agent, and uploads keys and config ahead of time.

**Tech Stack:** Rust (buzz-core, buzz-relay, buzz-db, buzz-acp, buzz-agent), Postgres migrations + `schema/schema.sql`, Fly Machines REST API, Docker (Sprig base), Tauri 2 + React 19 + TanStack Query desktop, Vitest, Playwright (mock bridge).

**Spec:** `docs/superpowers/specs/2026-11-25-cloud-agents-design.md` (read it first; this plan argues from it).

## Global Constraints

- PRs into `develop` only. Workers never merge. Commit with `git commit -s`.
- No `unsafe`; no new `unwrap()`/`expect()` in production paths; doc comments on new public API.
- Rust builds and tests run on GitHub CI (owner rule: no local cargo build/test/clippy, no full local suites). Locally: `cargo fmt`, `tsc`, biome, `pnpm check:px-text`, and Vitest for touched files only. Heavy local jobs only through `/Users/mac/worktrees/.lanes/tools/heavy.sh`.
- Falsifiability: every test tagged **[red-proof]** gets a throwaway draft PR with the guard removed, the named test seen failing in CI on a lint-clean branch, then the PR closed.
- Relay feature flag `COLONY_CLOUD_AGENTS` defaults to `off`. Values: `off` | `allowlist` | `on`. Allowlist var: `COLONY_CLOUD_AGENTS_ALLOWLIST` (comma-separated verified account emails, at most 64, same parsing as `COLONY_FREE_AI_ACCOUNTS` in `crates/buzz-relay/src/api/credits_gateway_limits.rs`).
- Caps: `COLONY_CLOUD_AGENTS_MAX_PER_ACCOUNT` default `2`; `COLONY_CLOUD_AGENTS_MAX_MACHINES` default `100`.
- Idle sleep: `BUZZ_ACP_EXIT_AFTER_INACTIVITY=600` on every cloud machine.
- Unanswered pickup window: 24 hours (`86400` s). Answered = the agent published a reply to the message. Reactions are progress, never an answer.
- Machine: Fly app `COLONY_CLOUD_FLY_APP` (default `colony-agents`), region `COLONY_CLOUD_FLY_REGION` (default `iad`), `shared-cpu-1x`, `COLONY_CLOUD_MACHINE_MEMORY_MB` default `1024`, volume `COLONY_CLOUD_VOLUME_GB` default `1` mounted at `/data`, restart policy `no`, image `COLONY_CLOUD_AGENT_IMAGE` (must be digest-pinned `...@sha256:...`), API token `COLONY_CLOUD_FLY_API_TOKEN`, API base `https://api.machines.dev/v1`.
- The agent Fly app is on its own isolated network (never the relay's or the databases' private network). Machines reach the relay only at its public `wss://`/`https://` origin.
- Secrets never written into Fly machine config: only `COLONY_CLOUD_BOOT_URL` and a single-use `COLONY_CLOUD_BOOT_TOKEN` (expires 300 s). Owner keys, `OPENROUTER_MASTER_KEY`, payment secrets and own-provider keys never reach a machine.
- Cloud model is configuration, never hardcoded: default from relay var `COLONY_CLOUD_DEFAULT_MODEL` (owner will set `deepseek/deepseek-v4.1-flash`); must be in `COLONY_CREDITS_ALLOWED_MODELS`.
- Starter credit: `1_000_000_000` nanoUSD ($1) once per account, on its first cloud placement.
- User-facing copy, exact (no em-dashes anywhere):
  - Header chip: `Working on: This Mac` / `Working on: Cloud`; menu items `This Mac`, `Cloud`.
  - Statuses: `Asleep`, `Waking`, `Working`, `Could not start`, `Out of AI credit`.
  - Settings section title: `Where {name} works`.
  - Not cloud-ready: `Open Colony on your Mac once to make {name} cloud-ready.`
  - Mac-off card: `{name}'s Mac is off. Move {name} to the cloud?` action `Move to the cloud`.
  - Out-of-credit card: `Out of AI credit.` actions `Top up`, `Move to This Mac`.
  - Start failure: `{name} could not start in the cloud.` actions `Try again`, `Move to This Mac`.
  - Cap reached: `You can have {n} agents in the cloud during the beta.`
- Desktop text uses rem tokens only (`text-sm`, `text-xs`, `text-2xs`); visuals reuse existing Colony 3.0 components (dropdown menu, badge, notice card). One owner per actionable label; keyboard path for the switch menu.
- Kind numbers below must be re-checked as free in `crates/buzz-core/src/kind.rs` at merge time; desktop mirror in `desktop/src/shared/constants/kinds.ts`, mobile mirror in `mobile/lib/shared/relay/nostr_models.dart`.

## Contracts (shared by all slices)

**Kinds**
- `KIND_AGENT_PLACEMENT_ACTION: u32 = 47071` (owner-signed command, brokered, like `KIND_WORKER_RUN_ACTION`).
- `KIND_AGENT_PLACEMENT_HEAD: u32 = 30682` (relay-signed addressable, `d` = agent pubkey hex).

**Placement action content** (`buzz_core::agent_placement::PlacementAction`, serde `camelCase`):
```json
{"schema":1,"agent":"<hex>","op":"setHome","home":"cloud","expectedGeneration":3,"cloudModel":null}
```
`op`: `setHome` | `retryWake` | `setCloudModel`. `home`: `mac` | `cloud` (required for `setHome`). `expectedGeneration`: compare-and-swap; mismatch is rejected with `generation_conflict`. `cloudModel`: required for `setCloudModel`, must be allowlisted.

**Placement head content** (`PlacementHead`):
```json
{"schema":1,"agent":"<hex>","owner":"<hex>","home":"cloud","generation":4,"cloudReady":true,"configVersion":7,"cloudModel":"deepseek/deepseek-v4.1-flash","status":"asleep","updatedAt":1764072000}
```
`status`: `asleep` | `waking` | `working` | `failed` | `outOfCredit` | `notCloudReady` | `null` (null when `home` is `mac`). Absence of a head = `home: mac`, generation 0.

**HTTP (secret paths only; everything else is events)**
- `GET /api/cloud-agents/capabilities` (NIP-98 owner) → `{"enabled":bool,"allowed":bool,"maxPerAccount":2,"models":["..."],"defaultModel":"..."}`.
- `PUT /api/cloud-agents/{agentPubkey}/bundle` (NIP-98 owner, body ≤ 256 KiB) body `{"nsec":"nsec1...","authTag":"<json tag or null>","config":{...},"configVersion":7}` → `204`. Rejects non-owner (403), pubkey/nsec mismatch (400), stale `configVersion` (409).
- `POST /api/cloud-agents/boot` header `Authorization: Bearer <boot token>` → `200 {"env":{...}}` once; second use or expiry → `401`. `env` contains exactly: `BUZZ_PRIVATE_KEY`, `NOSTR_PRIVATE_KEY`, `BUZZ_RELAY_URL`, `BUZZ_AUTH_TAG` (if any), `COLONY_HOME=cloud`, `COLONY_PLACEMENT_GENERATION`, `COLONY_CLOUD_HOME_TOKEN`, `COLONY_CREDITS_GATEWAY=1`, `COLONY_CREDITS_SESSION_ID`, `COLONY_CREDITS_MODEL`, `BUZZ_AGENT_PROVIDER=colony-credits`, `BUZZ_AGENT_MODEL`, `BUZZ_ACP_MODEL`, `BUZZ_ACP_AGENT_COMMAND=buzz-agent`, `BUZZ_ACP_EXIT_AFTER_INACTIVITY=600`, `BUZZ_ACP_WAKE_LEDGER=/data/ledger.json`, `HOME=/data/home`, plus the snapshot's runnable settings mapped to the same env names `spawn_agent_child` uses (`desktop/src-tauri/src/managed_agents/runtime.rs:640-890`).

**Config snapshot** (`buzz_core::agent_placement::CloudConfigSnapshot`): `name`, `systemPrompt`, `teamInstructions`, `respondTo`, `respondToAllowlist`, `parallelism`, `idleTimeoutSeconds`, `maxTurnDurationSeconds`, `subscribeMode`, `envVars` (paid-provider keys and `*_API_KEY`/`*_TOKEN`/`*_SECRET` names stripped by the desktop and rejected by the relay), `effortLevel`.

**Home fence tag** in the harness's NIP-42 AUTH event: `["colony_home", "<home token>"]` (cloud only).

**Notice tag** on a harness system message: `["colony_notice", "outOfCredit" | "dailyLimit"]`.

**Harness exit code** when placement moves away: `75`.

## Review Focus

1. A mention sent 0 to 5 seconds before or after a flip is answered exactly once, by the new home (Task 9 test `mention_around_flip_answered_once`, Task 13 test `catch_up_skips_relay_answered`).
2. An older Colony app (no placement support) still running on the Mac while the agent is in the cloud cannot answer anything (Task 3 test `auth_without_home_token_rejected_when_cloud` **[red-proof]**).
3. The Fly API is down or slow during a wake: at most 3 attempts with backoff 0/10/30 s, status becomes `failed`, no loop, the next message or `Try again` starts fresh (Task 8 test `wake_gives_up_after_three_attempts`).
4. An agent or its owner's account is deleted while its machine runs: machine and volume destroyed, sealed key row deleted (Task 7 test `agent_delete_destroys_machine_and_key`).
5. Out of credit mid-turn: one `outOfCredit` notice per turn, no retry loop; after a top-up the next message is answered (Task 14 test `out_of_credit_posts_one_notice`).

---

## Slice A (PR 1): core types, placement broker, storage, fence

### Task 1: Placement types and validation in buzz-core

**Files:**
- Create: `crates/buzz-core/src/agent_placement.rs`
- Modify: `crates/buzz-core/src/kind.rs` (two consts near `KIND_COFOUNDER_LEAD_HEAD`), `crates/buzz-core/src/lib.rs` (module)
- Modify: `desktop/src/shared/constants/kinds.ts`, `mobile/lib/shared/relay/nostr_models.dart` (mirror consts only)

**Interfaces:**
- Produces: `PlacementAction`, `PlacementOp`, `Home { Mac, Cloud }`, `PlacementHead`, `PlacementStatus`, `CloudConfigSnapshot`; `validate_placement_action(&PlacementAction) -> Result<(), PlacementError>`; `validate_config_snapshot(&CloudConfigSnapshot) -> Result<(), PlacementError>`; `placement_d_tag(agent_hex: &str) -> String`.

- [ ] **Step 1: Write failing tests** in the module: `set_home_requires_home`, `set_cloud_model_requires_model`, `rejects_unknown_schema` (schema != 1), `snapshot_rejects_secret_env_names` (env keys `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `X_SECRET` each → `Err`), `head_round_trips_camel_case` (serialize the head JSON from Contracts, parse back, equal).
- [ ] **Step 2: Implement** types with `#[serde(rename_all = "camelCase", deny_unknown_fields)]` and the validators.
- [ ] **Step 3: Push; CI `Rust unit` green for `agent_placement::`.**
- [ ] **Step 4: Commit** `feat(core): agent placement types and validation`.

### Task 2: Storage (migration, schema, store)

**Files:**
- Create: `migrations/0069_cloud_agents.sql` (next free number at merge), `crates/buzz-db/src/store/cloud_agents.rs`
- Modify: `schema/schema.sql`, `crates/buzz-db/src/store/mod.rs`
- Test: `crates/buzz-db/src/store/cloud_agents.rs` (`#[cfg(test)]` Postgres tests, same harness as `store/credits_gateway.rs`)

**Interfaces:**
- Produces table `cloud_agents` (`community_id`, `agent_pubkey`, `owner_pubkey`, `home`, `generation BIGINT`, `cloud_model`, `status`, `wrapped_dek`, `sealed_nsec`, `nonce`, `kek_id`, `auth_tag`, `config JSONB`, `config_version BIGINT`, `fly_machine_id`, `fly_volume_id`, `home_token_hash BYTEA`, `boot_token_hash BYTEA`, `boot_token_expires_at`, `wake_attempts INT`, `last_wake_at`, `last_error`, timestamps; PK `(community_id, agent_pubkey)`), table `cloud_agent_ops` (durable Fly operation journal: `id`, `community_id`, `agent_pubkey`, `op` in `ensure|start|stop|destroy`, `generation`, `attempt`, `next_attempt_at`, `status` in `pending|done|failed`, `last_error`), table `cloud_starter_grants` (`account_id` PK, `granted_at`).
- Produces store fns: `upsert_bundle(&self, BundleRow) -> Result<UpsertOutcome>` (rejects lower `config_version`), `set_home_cas(community, agent, expected_gen, home) -> Result<CasOutcome>` (one transaction, returns new generation), `get(community, agent)`, `issue_boot_token(community, agent, hash, expires_at)`, `consume_boot_token(hash) -> Option<CloudAgentRow>` (single use, atomic), `enqueue_op(..)`, `claim_due_ops(limit) -> Vec<OpRow>` (row locks), `count_cloud_for_owner(owner) -> i64`, `count_machines() -> i64`, `delete_agent(community, agent)`.

- [ ] **Step 1: Write failing tests**: `cas_rejects_stale_generation`, `boot_token_single_use` (second consume → `None`), `boot_token_expires`, `bundle_rejects_lower_config_version`, `delete_agent_removes_ops_and_secrets`.
- [ ] **Step 2: Write migration + matching `schema/schema.sql`**; any storage parameter or seed pgschema drops goes into `scripts/reconcile-schema-after-pgschema.sql` with an assertion (CLAUDE.md gotcha 7).
- [ ] **Step 3: Implement store fns.**
- [ ] **Step 4: Push; CI Postgres lane green for `cloud_agents`.**
- [ ] **Step 5: Commit** `feat(db): cloud agent registry, op journal, starter grants`.

### Task 3: Placement broker + NIP-42 fence + config flag

**Files:**
- Create: `crates/buzz-relay/src/handlers/agent_placement.rs`, `crates/buzz-relay/src/cloud_agents/mod.rs`, `crates/buzz-relay/src/cloud_agents/config.rs`, `crates/buzz-relay/src/cloud_agents/fence.rs`
- Modify: `crates/buzz-relay/src/handlers/ingest.rs` (route `KIND_AGENT_PLACEMENT_ACTION` like `KIND_WORKER_RUN_ACTION` at `:776`), `crates/buzz-relay/src/handlers/auth.rs` + `crates/buzz-relay/src/connection.rs:860` (call fence after NIP-42 verify), `crates/buzz-relay/src/config.rs` (load `CloudAgentsConfig`)

**Interfaces:**
- Consumes: Task 1 types, Task 2 store.
- Produces: `CloudAgentsConfig { mode: CloudMode, allowlist, max_per_account, max_machines, fly: Option<FlyConfig>, default_model }` with `CloudAgentsConfig::from_env(lookup) -> Result<Self, ConfigError>`; `fence::check_agent_auth(state, community, agent_pubkey, home_tag: Option<&str>) -> Result<(), FenceRefusal>`; broker `handle(tenant, state, event, auth) -> Result<IngestResult, IngestError>` that writes the action and a relay-signed head in one transaction; `disconnect_agent_connections(state, community, agent, keep: HomeMatch)` invoked after a `setHome` commit.
- Broker rules: signer must equal the agent's owner (`users.agent_owner_pubkey`, same lookup the credits gateway uses at `crates/buzz-db/src/store/credits_gateway.rs:251-262`); `setHome cloud` requires `cloud_agents` row with a bundle (else head `status: notCloudReady`, home unchanged), flag allows the owner's account, `count_cloud_for_owner < max_per_account` (else reject with `cloud_limit:{n}`); `setHome` revokes the agent's open credits sessions; `setHome cloud` enqueues `ensure`; `setHome mac` enqueues `stop`; starter grant inserted on first `setHome cloud` (Task 11 ledger write).

- [ ] **Step 1: Write failing tests** (relay integration style used by `handlers/company_workers.rs` tests): `non_owner_cannot_flip`, `flip_without_bundle_reports_not_cloud_ready`, `flip_respects_per_account_cap`, `stale_generation_rejected`, `auth_without_home_token_rejected_when_cloud` **[red-proof]**, `stale_cloud_token_rejected_when_mac` **[red-proof]**, `mac_auth_unchanged_when_no_head`, `flag_off_rejects_all_cloud_flips`.
- [ ] **Step 2: Implement config, fence, broker.** Fence compares `sha256(token)` to `home_token_hash` for the current generation in constant time.
- [ ] **Step 3: Push; CI green; open red-proof draft PRs for the two fence tests.**
- [ ] **Step 4: Commit** `feat(relay): agent placement broker and home fence`.

### Task 4: Capabilities, bundle upload, boot endpoints

**Files:**
- Create: `crates/buzz-relay/src/api/cloud_agents.rs`, `crates/buzz-relay/src/cloud_agents/boot.rs`
- Modify: `crates/buzz-relay/src/router.rs` (mount `/api/cloud-agents` next to `/api/credits-gateway` at `:56-59`)

**Interfaces:**
- Consumes: Task 2 store; `seal_nsec` / `open_nsec` from `crates/buzz-relay/src/api/accounts/crypto.rs:83,121` with `config.account_kek()`; NIP-98 verification used by `crates/buzz-relay/src/api/credits_gateway.rs:256-301`.
- Produces: the three routes in Contracts; `boot::issue(state, community, agent, generation) -> Result<Zeroizing<String>, BootError>` (random 32 bytes, stores hash, 300 s expiry); `boot::redeem(state, token) -> Result<BootEnv, BootError>` (builds the env map; mints the cloud credits session via Task 10 `mint_cloud_session`; issues and stores a fresh home token for the current generation).

- [ ] **Step 1: Write failing tests**: `bundle_rejects_nsec_pubkey_mismatch`, `bundle_rejects_non_owner`, `bundle_rejects_secret_env`, `boot_token_works_once`, `boot_env_has_no_owner_or_master_secrets` (assert env keys are exactly the Contracts list), `capabilities_reports_allowlist_membership`.
- [ ] **Step 2: Implement routes** (bundle body cap 256 KiB; `Zeroizing` for nsec in memory; never log bodies).
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(relay): cloud agent bundle and boot endpoints`.

## Slice B (PR 2): cloud runtime on Fly, doorbell, AI session, paid models

### Task 5: CloudHost trait, fake host, Fly host

**Files:**
- Create: `crates/buzz-relay/src/cloud_agents/host.rs`, `crates/buzz-relay/src/cloud_agents/fly.rs`, `crates/buzz-relay/src/cloud_agents/fake_host.rs` (`#[cfg(any(test, feature = "test-fakes"))]`)

**Interfaces:**
- Produces:
```rust
#[async_trait::async_trait]
pub trait CloudHost: Send + Sync {
    async fn ensure(&self, spec: &MachineSpec) -> Result<MachineRef, HostError>;
    async fn start(&self, machine: &MachineRef, boot: &BootEnvelope) -> Result<(), HostError>;
    async fn stop(&self, machine: &MachineRef) -> Result<(), HostError>;
    async fn destroy(&self, machine: &MachineRef) -> Result<(), HostError>;
    async fn state(&self, machine: &MachineRef) -> Result<MachineState, HostError>;
    async fn list(&self) -> Result<Vec<MachineRef>, HostError>;
}
```
`MachineSpec { agent_pubkey, image, memory_mb, volume_gb, region }`; `MachineRef { machine_id, volume_id }`; `BootEnvelope { boot_url, boot_token }` (the only env a machine config ever gets); `MachineState { Started, Stopped, Suspended, Destroyed, Unknown }`; `HostError { Transient(String), Permanent(String) }`.
- Fly impl: volume create, machine create with `config.restart.policy = "no"`, mount `/data`, `metadata.colony_agent = <pubkey>`; `start` updates only the two boot env vars then starts; respects the Machines API rate limit (one call in flight per machine, 429 → `Transient`). Reqwest timeout 15 s.

- [ ] **Step 1: Write failing tests** against a local mock HTTP server: `fly_create_sets_restart_no_and_volume`, `fly_start_sets_only_boot_env`, `fly_429_is_transient`, `fly_404_on_destroy_is_ok` (idempotent).
- [ ] **Step 2: Implement** trait, fake (records calls, scripted failures), Fly impl.
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(relay): cloud host layer with Fly Machines implementation`.

### Task 6: Op journal worker

**Files:**
- Create: `crates/buzz-relay/src/cloud_agents/ops.rs`
- Modify: relay startup where background workers spawn (same place `cofounder_wake` is started)

**Interfaces:**
- Consumes: Task 2 `claim_due_ops`, Task 5 `CloudHost`.
- Produces: `spawn_ops_worker(state) -> JoinHandle<()>`; runs every 5 s, claims ≤ 8 due ops, executes, marks `done` or reschedules with backoff 10 s, 30 s, 120 s (max 3 attempts; then `failed`, head `status: failed`, `last_error` set). An op whose `generation` is older than the agent's current generation is marked `done` without running (fence by generation).

- [ ] **Step 1: Write failing tests** with the fake host: `stale_generation_op_is_skipped` **[red-proof]**, `transient_failure_retries_with_backoff`, `permanent_failure_marks_failed_status`, `op_survives_worker_restart` (claim, drop worker, new worker completes it).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(relay): durable cloud agent op journal`.

### Task 7: Lifecycle edges and reconcile

**Files:**
- Modify: `crates/buzz-relay/src/cloud_agents/ops.rs`, agent deletion and account deletion paths (find with `git grep -n "delete_agent\|delete_account" crates/buzz-relay/src`)
- Create: `crates/buzz-relay/src/cloud_agents/reconcile.rs`

**Interfaces:**
- Produces: on agent removal or owner account deletion → enqueue `destroy` and call store `delete_agent` after destroy succeeds (journal keeps the destroy op if Fly is down); `reconcile::run(state)` every 60 s: machines in `host.list()` with no registry row → `destroy`; started machines whose agent has `home: mac` → `stop`; started machines with no presence for 15 min → `stop`; flag mode `off` → `stop` every started machine (kill switch); head `status` synced (`asleep` when stopped); one `info` log line per UTC day with machines created, awake hours, wakes, failures.

- [ ] **Step 1: Write failing tests**: `agent_delete_destroys_machine_and_key`, `orphan_machine_destroyed`, `flag_off_stops_all_machines`, `mac_placed_running_machine_stopped`, `status_becomes_asleep_after_stop`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(relay): cloud agent lifecycle reconcile`.

### Task 8: Doorbell (wake on message)

**Files:**
- Create: `crates/buzz-relay/src/cloud_agents/doorbell.rs`
- Modify: the post-store fan-out in `crates/buzz-relay/src/handlers/event.rs` (after a message is stored)

**Interfaces:**
- Consumes: presence read (`crates/buzz-pubsub/src/presence.rs`), Task 2, Task 4 `boot::issue`, Task 6 journal.
- Produces: `doorbell::on_stored(state, community, &StoredEvent)`; wakes a cloud-placed agent when the event is kind 9 or 40002 with a `p` tag for it, any message in a DM channel it is a member of, or a workflow approval or reminder addressed to it; skips when the agent has presence, a wake started < 60 s ago, or `count_machines() >= max_machines` (head `status: failed`, `last_error: "capacity"`). Wake = head `status: waking`, issue boot token, enqueue `ensure` then `start`. Up to 3 attempts per wake (0/10/30 s); then `failed`. `retryWake` op and every new message reset attempts.

- [ ] **Step 1: Write failing tests**: `mention_wakes_sleeping_cloud_agent`, `dm_message_wakes_member_agent`, `no_wake_when_present`, `wake_debounced_within_60s`, `wake_gives_up_after_three_attempts`, `capacity_cap_blocks_wake`.
- [ ] **Step 2: Implement** (never blocks message storage; doorbell runs on its own task).
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(relay): wake cloud agents on incoming messages`.

### Task 9: End-to-end relay test with fake host and stub harness

**Files:**
- Test: `crates/buzz-test-client/tests/e2e_cloud_agents.rs`

**Interfaces:**
- Consumes: everything in Slices A and B; a stub "machine" that, when the fake host starts it, redeems the boot token, connects with the home tag, replies to unanswered mentions, and exits.

- [ ] **Step 1: Write tests**: `flip_to_cloud_then_mention_is_answered`, `mention_around_flip_answered_once` (mentions at -5, -1, +1, +5 s around a `setHome cloud`, then flip back to mac with a stub Mac harness; each mention gets exactly one reply), `old_client_cannot_answer_cloud_agent`.
- [ ] **Step 2: Run via `gh workflow run "CI full suite" --ref <branch>`** (relay e2e runs only there); green.
- [ ] **Step 3: Commit** `test(e2e): cloud agent flip and wake`.

### Task 10: Cloud credits session

**Files:**
- Modify: `crates/buzz-relay/src/api/credits_gateway.rs` (session creation `:256-301`), `crates/buzz-db/src/store/credits_gateway.rs`

**Interfaces:**
- Produces: `mint_cloud_session(state, community, agent_pubkey, generation) -> Result<CloudSession, GatewayError>` (no owner NIP-98; authority = current placement head says `cloud` at that generation and the ownership record exists; TTL 24 h; bound to the agent signer and host like today); `revoke_agent_sessions(state, agent_pubkey)` (used by Task 3 on every `setHome`). A harness that gets `Unauthorized` exits; the next wake mints a new session.

- [ ] **Step 1: Write failing tests**: `cloud_session_requires_cloud_placement` **[red-proof]**, `cloud_session_rejected_for_stale_generation`, `flip_revokes_sessions`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(gateway): relay-minted sessions for cloud agents`.

### Task 11: Paid model for cloud sessions + starter credit

**Files:**
- Modify: `crates/buzz-relay/src/api/credits_gateway_upstream.rs` (`ordered_chain` `:343-372`, request path `:524`), `crates/buzz-relay/src/api/credits_gateway.rs`, `crates/buzz-db/src/store/credits_gateway.rs` (ledger grant)

**Interfaces:**
- Produces: session field `paid_allowed: bool` (true only for cloud sessions of accounts not in `COLONY_FREE_AI_ACCOUNTS`); request path calls `ordered_chain(selected, !session.paid_allowed)`; free accounts' cloud sessions use the configured free chain (selected model ignored, no refusal). `grant_cloud_starter(account_id) -> Result<bool>` writes one `+1_000_000_000` nanoUSD ledger row and a `cloud_starter_grants` row in one transaction; returns `false` when already granted.
- Global primary model and free chain unchanged; Mac sessions unchanged.

- [ ] **Step 1: Write failing tests**: `paid_model_allowed_for_paying_cloud_session`, `paid_model_refused_for_mac_session` (still `model_not_free`), `free_account_cloud_session_uses_free_chain`, `paid_request_charges_cost_plus_20_percent`, `starter_grant_once_per_account`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.** Update `docs/credits-gateway-operations.md` with the cloud-session and starter-grant rules in the same commit.
- [ ] **Step 4: Commit** `feat(gateway): paid models for cloud sessions and starter credit`.

## Slice C (PR 3): harness (buzz-acp, buzz-agent)

### Task 12: Cloud boot and home tag

**Files:**
- Create: `crates/buzz-acp/src/cloud_boot.rs`
- Modify: `crates/buzz-acp/src/config.rs` (read `COLONY_HOME`, `COLONY_PLACEMENT_GENERATION`, `COLONY_CLOUD_HOME_TOKEN`), `crates/buzz-acp/src/relay.rs` (`do_connect` `:4009`: add `["colony_home", token]` to the AUTH event when set), `crates/buzz-acp/src/main.rs` or startup in `lib.rs`

**Interfaces:**
- Produces: `cloud_boot::fetch_env(boot_url: &str, token: &str) -> Result<BTreeMap<String, Zeroizing<String>>, BootError>`; when `COLONY_CLOUD_BOOT_TOKEN` is set at startup, the harness fetches, applies env to its own config, clears the boot vars, and continues as a normal harness.

- [ ] **Step 1: Write failing tests**: `boot_env_applied_before_connect`, `boot_failure_exits_nonzero` (no retry loop: one attempt plus one retry after 2 s), `auth_event_carries_home_tag_only_when_cloud`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(acp): cloud boot and home tag`.

### Task 13: Placement watch and relay-answered catch-up

**Files:**
- Create: `crates/buzz-acp/src/placement.rs`, `crates/buzz-acp/src/answered.rs`
- Modify: `crates/buzz-acp/src/relay.rs` (subscribe `kinds:[30682], #d:[self]`), `crates/buzz-acp/src/wake_ledger.rs` (replay candidates filtered by `answered`)

**Interfaces:**
- Produces: `placement::should_exit(own_home: Home, own_gen: u64, head: &PlacementHead) -> bool` (true when `head.generation > own_gen` or `head.home != own_home`); on true: stop taking new mentions, finish the current turn, publish offline presence, exit `75`. `answered::unanswered_since(relay, agent, since_secs: 86400) -> Vec<EventId>` (mentions with no agent reply; reactions ignored, same rule as `desktop/src/features/agents/unansweredMentions.ts`); startup replay set = ledger candidates ∪ `unanswered_since`, minus relay-answered.

- [ ] **Step 1: Write failing tests**: `exits_on_newer_generation`, `exits_on_home_change`, `finishes_current_turn_before_exit`, `catch_up_skips_relay_answered` **[red-proof]**, `reaction_is_not_an_answer`, `fresh_volume_picks_up_last_24h`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(acp): placement watch and relay-answered catch-up`.

### Task 14: Out-of-credit notice

**Files:**
- Modify: where `buzz-acp` posts a turn failure from `buzz-agent` (`crates/buzz-agent/src/credits_gateway.rs:29-62` error kinds → find the post site with `git grep -n "OutOfCredits" crates/buzz-acp crates/buzz-agent`)

**Interfaces:**
- Produces: on `OutOfCredits` or `DailyLimit`, one system message per turn with tag `["colony_notice","outOfCredit"|"dailyLimit"]`, content `Out of AI credit.`; no automatic retry; when `COLONY_HOME=cloud` the relay sets head `status: outOfCredit` on seeing the tagged message (small handler hook in Task 3's broker module).

- [ ] **Step 1: Write failing test**: `out_of_credit_posts_one_notice`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(acp): tagged out-of-credit notice`.

## Slice D (PR 4): agent image and Fly app

### Task 15: Colony agent image and CI publish

**Files:**
- Create: `Dockerfile.colony-agent` (from `Dockerfile.sprig` stages; adds `colony` symlink to the CLI, `jq`; `HOME=/data/home`, `WORKDIR /data/workspace`; entrypoint `buzz-acp`), `.github/workflows/colony-agent-image.yml` (build on `develop` merges touching sprig crates or the Dockerfile; push to `registry.fly.io/${COLONY_CLOUD_FLY_APP}`; print the digest in the job summary), `deploy/fly/agents/README.md` (one-time setup: create app on an isolated network `fly apps create colony-agents --network colony-agents-isolated`, token scoped to that app, the relay secrets list, how to roll the image digest, kill switch)

**Interfaces:**
- Produces: a digest-pinned image reference for `COLONY_CLOUD_AGENT_IMAGE`.

- [ ] **Step 1: Add a CI smoke job**: run the image with no boot token → exits non-zero with `missing COLONY_CLOUD_BOOT_TOKEN`; run `buzz-acp --version` and `colony --version` inside it.
- [ ] **Step 2: Write Dockerfile, workflow, README.**
- [ ] **Step 3: Push; workflow green on the PR (build + smoke, no push from PRs).**
- [ ] **Step 4: Commit** `feat(deploy): colony agent image`.

Known gap (spec 5.3, not in v1): no headless browser in the image; the Colony Agent's web reach is shell `curl`. Recorded on the proof page NOT-verified list.

## Slice E (PR 5): desktop

### Task 16: Placement read model and start gating

**Files:**
- Create: `desktop/src/features/agents/placement/placementQueries.ts`, `desktop/src/features/agents/placement/placementTypes.ts`, `desktop/src-tauri/src/managed_agents/placement_cache.rs`
- Modify: `desktop/src-tauri/src/managed_agents/runtime.rs` (`start_managed_agent_process` `:1013` refuses when cache says cloud), `desktop/src-tauri/src/commands/agents.rs:853`, `desktop/src/features/agents/mentionReconciler.ts`, `desktop/src/features/messages/ui/useDetachedAgentStart.ts`, `desktop/src/features/communities/useCommunityInit.ts` (`resetCommunityState()` resets the placement cache singleton)

**Interfaces:**
- Produces: `usePlacements(agentPubkeys: string[]): Map<string, AgentPlacement>` (subscribes kind 30682 `#d`); `AgentPlacement { home: "mac" | "cloud"; generation: number; status: PlacementStatus | null; cloudReady: boolean; cloudModel: string | null }`; Tauri command `set_placement_cache(entries: Vec<PlacementCacheEntry>)`; Rust error string `agent placed in the cloud`. When a head flips to `cloud`, the desktop stops the local harness (existing stop); when it flips to `mac`, it starts it (existing start).

- [ ] **Step 1: Write failing tests**: Vitest `reconciler_skips_cloud_agents`, `detached_start_skips_cloud_agents`; Rust `start_refused_for_cloud_placed_agent`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Vitest for touched files locally; push; CI green.**
- [ ] **Step 4: Commit** `feat(desktop): read agent placement and gate local starts`.

### Task 17: Background key and config upload

**Files:**
- Create: `desktop/src-tauri/src/managed_agents/cloud_bundle.rs`, `desktop/src-tauri/src/commands/agent_cloud.rs`, `desktop/src/features/agents/placement/useCloudBundleSync.ts`
- Modify: `desktop/src-tauri/src/lib.rs` (register commands), the agent update command path (`desktop/src-tauri/src/commands/agent_models_update.rs`) to bump `configVersion` and re-upload

**Interfaces:**
- Produces: Tauri `get_cloud_capabilities() -> CloudCapabilities`, `upload_cloud_bundle(pubkey: String) -> Result<(), String>` (reads nsec from keyring via `storage.rs`, builds `CloudConfigSnapshot` from `ManagedAgentRecord` stripping secret env names, signs NIP-98 with the owner key, PUTs); `useCloudBundleSync()` uploads every owned agent whose head lacks `cloudReady` or has a lower `configVersion`, when capabilities say `allowed`.

- [ ] **Step 1: Write failing tests**: Rust `snapshot_strips_secret_env`, `upload_skipped_when_not_allowed`; Vitest `sync_uploads_only_stale_agents`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Push; CI green.**
- [ ] **Step 4: Commit** `feat(desktop): upload agent bundles for cloud readiness`.

### Task 18: The switch (header + settings) and cards

**Files:**
- Create: `desktop/src/features/agents/placement/AgentHomeSwitch.tsx`, `desktop/src/features/agents/placement/AgentHomeNotices.tsx`, `desktop/src/features/agents/placement/publishPlacement.ts`
- Modify: `desktop/src/features/channels/ui/ChannelScreenHeader.tsx:365-367` (owned agents: switch replaces `AgentRuntimeHeaderStatus`), `desktop/src/features/agents/ui/AgentInstanceEditDialog.tsx` (section `Where {name} works` with radio + cloud model select from capabilities), the message list item that renders system notices (render `colony_notice` cards)
- Test: `desktop/tests/e2e/cloud-agent-switch.spec.ts` (register in `playwright.config.ts` smoke project), Vitest beside each component

**Interfaces:**
- Consumes: Task 16 `usePlacements`, Task 17 capabilities.
- Produces: `publishPlacement(agent: string, op: PlacementOp, expectedGeneration: number, home?: Home, cloudModel?: string): Promise<void>`; on `generation_conflict` it refetches and shows the current home (no silent overwrite). Cards: Mac-off card shown when `home === "mac"`, the agent has no presence, an unanswered mention is older than the existing stalled window (60 s, `agentStartWatch.ts`), and this device has no local record for the agent or its local start failed; out-of-credit card on `colony_notice` messages (`Top up` opens the existing money dialog); start-failure card when `status === "failed"` (`Try again` publishes `retryWake`).

- [ ] **Step 1: Write failing tests**: Vitest `switch_shows_current_home_and_status`, `flip_publishes_cas_action`, `conflict_refetches`, `not_cloud_ready_message`, `cap_message_shows_limit`, `keyboard_opens_menu_and_selects` (Enter/Space/Arrow keys), `one_accessible_name_per_action`; Playwright `cloud-agent-switch.spec.ts` (mock bridge: flip in header, status badge, out-of-credit card) run in smoke and integration projects.
- [ ] **Step 2: Implement** with existing 3.0 components and exact copy from Global Constraints.
- [ ] **Step 3: Vitest + the one spec locally (`pnpm build:e2e` first); push; CI green.**
- [ ] **Step 4: Screenshots** with `just desktop-screenshot` at 390 and 1440 widths for header menu, settings section, each card; distinct hashes (`shasum -a 256`); post with `scripts/post-screenshots.sh`.
- [ ] **Step 5: Commit** `feat(desktop): agent home switch and cloud notices`.

## Follow-ups (not in this plan)

- Own provider key for cloud agents (spec 5.4 item 5): key stored on the relay, used by the gateway upstream, never on the machine.
- Headless browser in the cloud image.
- Mobile switch (the placement action already works from any client).
- Monthly hiring fee and "Always available" machines (22 Oct decision).

## Proof gate (coordinator, after all five PRs are merged to develop)

Prerequisites the owner must do: pay the Fly invoice; create the `colony-agents` app per `deploy/fly/agents/README.md`; set relay secrets on `colony-relay-canary` (`COLONY_CLOUD_AGENTS=allowlist`, `COLONY_CLOUD_AGENTS_ALLOWLIST=<owner email>,<test account>`, `COLONY_CLOUD_FLY_API_TOKEN`, `COLONY_CLOUD_AGENT_IMAGE=<digest>`, `COLONY_CLOUD_DEFAULT_MODEL`, and add that model to `COLONY_CREDITS_ALLOWED_MODELS` after the terms review).

1. Deploy relay from develop to canary; install a desktop build from the CI artifact.
2. Owner account: flip Scout to Cloud from the header; quit Colony; message Scout from a second device or `colony` CLI as owner; answer arrives, measure seconds from an asleep start.
3. Flip back to This Mac from settings; next answer comes from the Mac runtime; every message answered exactly once (count replies per mention on the relay).
4. Paying test account on DeepSeek: balance drops by the reply cost; zero-balance account sees the out-of-credit card.
5. Fly dashboard: machine stopped after 10 idle minutes; no orphan machines after deleting a test agent.
6. Proof page (390 then 1440, real screenshots, NOT-verified list incl. no browser in cloud, mobile switch not built, PayFast live mode).
