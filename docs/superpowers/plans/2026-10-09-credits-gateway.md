# Colony credits gateway implementation plan

**Goal:** Run managed Colony Agents from their owner credit balance at returned OpenRouter cost plus twenty percent.

**Architecture:** The relay owns provider access, admission holds, decimal metering and durable recovery. Native launch authorizes each managed session, and the bundled agent signs its inference requests. Existing onboarding and settings offer credits only when the default-off flag and relay capability permit it.

**Tech stack:** Rust, Axum, SQLx/Postgres, NIP-98, bundled ACP agent, React and mock-bridge Playwright.

## Phase 1: relay PR

- [x] Commit `docs/credits-gateway.md`, including coordinator-approved concurrency and automatic recovery.
- [x] Add isolated `credits_gateway` DB and relay modules, migration 0055, desired schema and pgschema registry convergence. Leave checkout implementations unchanged.
- [x] Reserve under the existing account lock; admit four account requests and one per session while all holds fit. Settle release, usage and journal in one transaction.
- [x] Preserve exact decimal returned cost, prohibit upstream inference retries, and correct provisional charges idempotently by original journal id.
- [x] Add fake-upstream route tests and isolated PostgreSQL tests, including migration lifecycle coverage. Add `colony credits reconcile-ai` and an operations runbook.
- [ ] Push with `--no-verify`, open the PR through REST to `develop`, and fix latest-head CI until every check is successful or skipped. Never merge.

## Phase 2: managed-agent wiring PR

- [ ] Add a private credits transport to `buzz-agent`, using existing relay credentials for NIP-98 body-bound signatures and stable per-call request UUIDs. No OpenRouter key reaches the process.
- [ ] In native managed launch, authorize the owned agent session and pass its id only to the bundled Colony Agent. Revoke on shutdown, renew before expiry, and prevent stale authorization from resurrecting a stopped or replaced agent.
- [ ] Bind tests to the production transport and launcher paths: credit refusal, missing authorization, expiry, renewal races, no alternate paid-provider fallback and no inference retry after an ambiguous response.
- [ ] Open a separate PR to `develop`; GitHub CI is the gate.

## Phase 3: onboarding/settings PR

- [ ] Use existing connection storage and UI components to select Colony credits. Require native `COLONY_CREDITS_GATEWAY=1` and relay capability, preserve top-up at zero balance, and run the existing connection test before reporting readiness.
- [ ] Register production mock-bridge UI specs in BOTH smoke and integration Playwright projects. Cover flag off, unconfigured relay, positive balance, zero balance/top-up and recoverable refusal.
- [ ] Open a separate PR to `develop`; wait for strict latest-head green. Keep flags OFF and leave activation and funded live proof to the owner.

Validation boundary: no local cargo or full suites. Any focused heavy command runs alone through `/Users/mac/worktrees/.lanes/tools/heavy.sh` and is stopped at ten minutes. Progress is appended to the assigned coordinator file at each step.
