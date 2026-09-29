# Company Work Tracking API Implementation Plan

> **For agentic workers:** Use this plan task by task. Keep the frozen handover package read only.

**Goal:** Add durable company work suggestions, watchdog check-ins, and due dates to the existing company work records and frozen WORK-2 screens.

**Architecture:** Keep company work as kind 30634 with kind 47006 actions. Add the assigned kind 30652 and 47041 pair for persisted suggestions and per-work watchdog configuration. Broker each state change with relay validation and an exact-head transaction. Suggestion acceptance also creates the ordinary company work head in that transaction. Store watchdog delivery scheduling and retry state in PostgreSQL and post check-ins as normal messages in the work thread.

**Tech Stack:** Rust, PostgreSQL, Nostr events, `buzz-sdk`, `buzz-cli`, React, TanStack Query, desktop Playwright.

---

## Design note

The frozen company v8 routes at `work/tracking/*` remain the UI contract. The suggestion route renders only a stored suggestion with a validated source message. Track this accepts it; Not now dismisses it. No component classifies ordinary message text. The watchdog route saves only a relay-confirmed configuration, starts OFF, and has no selected interval until the user chooses one. A saved check-in is a normal reply in the work thread and never changes status. The existing work context and timeline show the persisted due date and its signed set, change, or clear action.

Due dates use the current company work record. `acceptedAt` is stamped by the relay on creation. `dueAt` uses an RFC 3339 UTC timestamp ending in `Z` and must be later than `acceptedAt`; changing an existing date may record a past date relative to now as long as it remains after acceptance. Existing heads without `acceptedAt` remain valid. Older clients that omit `dueAt` from a generic update preserve the current date.

Suggestions and watchdog settings share kind 30652 but have separate `recordType` values and d-tag prefixes. Suggestion heads and actions use the source channel. Watchdog heads and actions use the work item's current channel and are isolated by the relay community plus work UUID. If a work item moves, its watchdog head and pending schedule move in the same transaction. Migration `0053_company_work_watchdog.sql` is the next available migration after `0052_company_records_fts_exclusion.sql`.

## Files and responsibilities

- `docs/company-records.md`: canonical kind registration and company work contract.
- `crates/buzz-core/src/business_records.rs`: due date fields, actions, and validation for kind 47006.
- `crates/buzz-core/src/company_work_tracking.rs`: typed kind 30652 heads, kind 47041 actions, coordinates, and payload validation.
- `crates/buzz-relay/src/handlers/business_records.rs`: company work due-date actions and cross-head acceptance transaction.
- `crates/buzz-relay/src/handlers/company_work_tracking.rs`: source and actor validation, suggestion lifecycle, watchdog configuration writes.
- `crates/buzz-db/src/store/company_work_watchdog.rs` and `migrations/0053_company_work_watchdog.sql`: durable schedule claims, delivery journal, retry, cancellation, and terminal failure.
- `crates/buzz-relay/src/handlers/company_work_watchdog_worker.rs`: injected-clock scheduling and thread-message delivery.
- `crates/buzz-sdk/src/company_work_tracking.rs` and `crates/buzz-cli/src/commands/work.rs`: agent-first commands.
- `desktop/src/shared/constants/kinds.ts`, `mobile/lib/shared/relay/nostr_models.dart`, and `crates/buzz-core/src/kind.rs`: one kind registry across clients.
- `desktop/src/features/company-work/companyWorkModels.ts` and `hooks.ts`: validated typed reads and writes.
- `desktop/src/features/company-work/ui/CompanyWorkDetailScreen.tsx` and `CompanyWorkTrackingScreens.tsx`: due date display, persisted suggestion actions, watchdog configuration.
- `crates/buzz-test-client/tests/e2e_company_work.rs`, Rust unit tests, `crates/buzz-cli/src/lib.rs`, `desktop/tests/e2e/company-work.spec.ts`, and `desktop/tests/e2e/company-work.live.spec.ts`: protocol, authority, retry, UI, CLI inventory, and reload coverage.

## Tasks

### Task 1: Land the contract before implementation

**Files:** `docs/company-records.md`, this plan.

- [x] Register kinds 30652 and 47041 once and specify due date, suggestion, watchdog, authority, and retry semantics.
- [x] Record the migration slot and frozen screen mapping.
- [ ] Re-run `python3 verify.py` from `20260926-r19` and preserve the package as read only.
- [ ] Activate Hermit, sign off the documentation commit, push `codex/work-api`, and open a draft PR against `codex/phase2-integration`.

### Task 2: Extend company work with due dates

**Files:** `crates/buzz-core/src/business_records.rs`, `crates/buzz-relay/src/handlers/business_records.rs`, `crates/buzz-sdk/src/business_records.rs`, `crates/buzz-cli/src/commands/work.rs`, `desktop/src/features/company-work/companyWorkModels.ts`, `hooks.ts`, `CompanyWorkDetailScreen.tsx`, and timeline tests.

- [ ] Add relay-owned `acceptedAt`, optional `dueAt`, and `set_due_date` and `clear_due_date` actions to company work. Keep client work payloads unchanged.
- [ ] Validate UTC RFC 3339 values, acceptance-time ordering, exact-head edits, current authority, and history event signer/time. Preserve due dates when older generic update clients omit them.
- [ ] Add CLI due-date set and clear operations. Display saved dates and action history in the existing work context and timeline. Do not add an editor because the frozen Work forms do not define a due-date input.
- [ ] Add falsifiable tests for malformed timestamps, before-acceptance dates, set/change/clear attribution, unauthorized changes, and legacy update preservation.
- [ ] Run `cargo fmt --all -- --check`; leave Rust build and tests to hosted CI.

### Task 3: Add persisted commitment suggestions

**Files:** `crates/buzz-core/src/company_work_tracking.rs`, `crates/buzz-relay/src/handlers/company_work_tracking.rs`, relay event dispatch, `crates/buzz-sdk/src/company_work_tracking.rs`, `crates/buzz-cli/src/commands/work.rs`, desktop company-work hooks and tracking screens, and relay plus desktop tests.

- [ ] Validate source message, thread root, channel scope, proposal fields, member or managed-agent proposer, and human acceptor authority.
- [ ] Implement propose, accept, dismiss, and expire as exact-head actions. Reject expiry before an explicitly stored `expiresAt`.
- [ ] On accept, run the existing work create validation and write the accepted suggestion head and new kind 30634 work head with the kind 47041 action in one transaction.
- [ ] Update the work timeline to project a real suggestion acceptance event. Render Track this and Not now only for persisted suggestions. Keep ordinary messages free of suggestion controls.
- [ ] Add CLI commands and extend its work command inventory test. Add relay tests for source provenance, agent identity, member authority, and all-or-nothing acceptance.
- [ ] Update every affected desktop selector and assertion in the same commit series.

### Task 4: Add persisted watchdog configuration and scheduler

**Files:** `migrations/0053_company_work_watchdog.sql`, `crates/buzz-db/src/store/company_work_watchdog.rs`, `crates/buzz-relay/src/handlers/company_work_tracking.rs`, `company_work_watchdog_worker.rs`, `main.rs`, CLI watchdog commands, desktop tracking screens, and scheduler tests.

- [ ] Treat an absent config as OFF. Require an explicit positive interval to enable; do not introduce a production default or preselected form value.
- [ ] Store configuration, scheduled jobs, delivery event identity, attempts, lease state, last error, cancellation, and terminal failures durably. Keep config isolated by community and work item.
- [ ] Deliver check-ins as idempotent relay-authored messages with the existing channel and thread tags. Update thread counters and persistent fan-out through the production message path.
- [ ] Cancel or reschedule pending jobs when configuration changes, work is paused, archived, completed, or moved. Revalidate work and configuration immediately before delivery.
- [ ] Use finite retries with backoff and terminal failure. Inject a clock and test success, retry, exhaustion, cancellation, move, and reload without sleeping.
- [ ] Wire real watchdog settings and saved states to relay data. Preserve failed input for retry and never claim a save before relay confirmation.
- [ ] Update all changed labels, roles, and test ids in desktop specs in the same commit series.

### Task 5: Close local, hosted, and visual proof gates

**Files:** all changed Rust, CLI, desktop, mobile kind, test, and documentation files.

- [ ] Audit changed UI copy, roles, routes, and test ids across `desktop/tests/e2e`, `desktop/src/**/*.test.*`, and `mobile/test`.
- [ ] Run only quick local gates: desktop typecheck, Biome, px-text, Cargo formatting, and focused desktop unit tests. Run Dart formatting and Flutter analysis only if mobile source beyond the kind registry changes.
- [ ] Capture the existing WORK-2 routes at 1728x1117 and 1440x900 in light and dark themes, and compare timeline, persisted suggestion, watchdog saved, and watchdog failed states to company v8.
- [ ] Push one coherent change per hosted CI cycle. Read each failed job as soon as it finishes, fix branch-caused failures, and poll the current head until every required check is green.
- [ ] Report implemented, tested, visually compared, CI and head SHA separately, plus every remaining `NEEDS_API` or `NEEDS_DESIGN` item.
- [ ] Report the due-date editor as `NEEDS_DESIGN`; the desktop displays persisted dates while the agent-first CLI provides set and clear actions.
