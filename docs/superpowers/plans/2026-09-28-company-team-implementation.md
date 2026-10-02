# Company Team Implementation Plan

> **For agentic workers:** Follow the task ownership and integration order supplied by the Phase 2 coordinator. Steps use checkbox syntax for tracking.

**Goal:** Add community-backed team positions, a mixed human and employee org chart, and employee pause, termination, and rehire flows.

**Architecture:** Add a member-position event contract beside the existing goals and asks contracts. The relay validates authority, exact heads, and reporting cycles in one transaction. The desktop reads real community members and managed agents, then renders the approved v7 Team routes. Employee runtime shutdown goes through the existing managed-agent stop command.

**Tech Stack:** Rust workspace (`buzz-core`, `buzz-relay`, `buzz-sdk`, `buzz-cli`), React 19, TanStack Router, React Query, Tauri IPC, Playwright.

---

## Acceptance gates

1. **Contract gate:** `docs/company-records.md`, the Rust kind registry, and desktop/mobile kind mirrors agree on the schema, tenant scope, authority, lifecycle, and cycle rules.
2. **TEAM-1 gate:** real human and employee identities appear once in the Team list; workers never enter the roster; the mixed org chart supports keyboard navigation; title and manager edits use exact-head writes.
3. **TEAM-2 gate:** pause, terminate, and rehire use the exact-head broker; paused and terminated employees stop through the existing runtime path; retained definitions and histories remain available.
4. **Proof gate:** focused Rust and desktop checks pass, mock bridge E2E covers the represented routes, one isolated real-relay journey survives reload and community switching, and reference comparisons cover 1728x1117 and 1440x900 in light and dark.
5. **Hosted gate:** the draft PR targets `codex/phase2-integration`; all GitHub checks finish green before the slice is reported complete.

## Task 1: Record the member-position contract

**Files:** `docs/company-records.md`, `crates/buzz-core/src/kind.rs`, `desktop/src/shared/constants/kinds.ts`, `mobile/lib/shared/relay/nostr_models.dart`.

- [ ] Add the member head and action kinds and the community-wide `company:member:<pubkey>` coordinate.
- [ ] Specify fields, status reasons, exact-head actions, direct authority, approval proposals, employee runtime shutdown, worker exclusion, and cycle prevention.
- [ ] Add every new kind to the shared, desktop, and mobile registries without adding mobile Team UI.
- [ ] Run `cargo test -p buzz-core` and the desktop type and formatting checks after implementation.
- [ ] Commit the completed contract slice with `git commit -s`.

## Task 2: Implement the core contract and broker

**Files:** `crates/buzz-core/src/company_members.rs`, `crates/buzz-core/src/lib.rs`, `crates/buzz-relay/src/handlers/company_member_records.rs`, `crates/buzz-relay/src/handlers/company_asks.rs`, `crates/buzz-relay/src/handlers/command_executor.rs`, `crates/buzz-relay/src/handlers/ingest.rs`, `crates/buzz-relay/src/handlers/mod.rs`.

- [ ] Add strict member action and head types, status validation, pubkey validation, and a bounded reporting-cycle check.
- [ ] Add a separate relay handler so the company work lane's `company_records.rs` dispatch stays isolated.
- [ ] Enforce owner/admin direct writes, member-backed targets, exact current head IDs, a community-scoped cycle lock, and one transactional head replacement.
- [ ] Apply approved member proposals in the ask response transaction when the proposal matches the locked member head.
- [ ] Stop employee runtime processes through the existing managed-agent path before the desktop publishes pause or termination.
- [ ] Run `cargo test -p buzz-core company_members` and focused `cargo test -p buzz-relay company_member` checks with `CARGO_BUILD_JOBS=4`.
- [ ] Commit the completed broker slice with `git commit -s`.

## Task 3: Add SDK and CLI access

**Files:** `crates/buzz-sdk/src/company_members.rs`, `crates/buzz-sdk/src/lib.rs`, `crates/buzz-cli/src/commands/team.rs`, `crates/buzz-cli/src/lib.rs`, `crates/buzz-cli/src/commands/mod.rs`.

- [ ] Add documented builders for member actions and team-head filters.
- [ ] Add `buzz team list`, `set-title`, `set-manager`, `pause`, `terminate`, and `rehire` subcommands using the same relay client and structured errors as goals.
- [ ] Test JSON parsing, d-tag coordinates, exact-head actions, and write results through the production command handlers.
- [ ] Run `cargo test -p buzz-sdk` and the focused `cargo test -p buzz-cli team` check with `CARGO_BUILD_JOBS=4`.
- [ ] Commit the completed CLI slice with `git commit -s`.

## Task 4: Build the desktop Team routes

**Files:** `desktop/src/features/company-team/`, `desktop/src/app/routes.ts`, generated `desktop/src/app/routeTree.gen.ts`, `desktop/src/features/sidebar/ui/SidebarCompanyGroup.tsx`, and the existing profile and message identity components where approved by the frozen routes.

- [ ] Read member heads from the active relay and join them to relay membership and the managed-agent directory by normalized pubkey.
- [ ] Keep one row per identity, classify human and employee from authoritative membership data, and exclude worker sessions.
- [ ] Match the approved Team list, org chart, member detail, edit, pause, and terminate screens in Manrope.
- [ ] Keep the member name sourced from the existing profile and update only title and reporting line.
- [ ] Preserve failed form values, expose honest query and write errors using existing approved company patterns, and never report a save before relay acceptance.
- [ ] Use the existing managed-agent stop mutation before publishing employee pause or termination.
- [ ] Keep the out-of-scope Hire action and unrepresented ask and message-status UI out of the new route until the coordinator supplies design approval.
- [ ] Run `pnpm typecheck`, `pnpm check:px-text`, `pnpm exec biome check` on changed desktop files, and focused desktop unit tests.
- [ ] Commit the completed Team route slice with `git commit -s`.

## Task 5: Add mock bridge and relay-backed proof

**Files:** `desktop/src/testing/e2eBridge.ts`, `desktop/tests/e2e/company-team.spec.ts`, `desktop/tests/e2e/company-team.live.spec.ts`, and contract test modules under the crates above.

- [ ] Add production-bound mock bridge records and actions for real-membership joins, member head writes, cycle rejection, and runtime stop invocation.
- [ ] Cover Team list, mixed org chart, title and manager edits, pause with reason, terminated employee review and rehire, reload, and community switch.
- [ ] Keep assertions that protect product behavior and update selectors only for the new frozen design.
- [ ] Run `pnpm build:e2e`, then the affected smoke and integration specs one at a time in `mcr.microsoft.com/playwright:v1.60.0-noble` with two CPUs.
- [ ] Run the focused crate tests one at a time with `CARGO_BUILD_JOBS=4`.
- [ ] Commit the test slice with `git commit -s`.

## Task 6: Compare and open the draft PR

**Files:** no production source changes unless comparison finds a mismatch; screenshots stay under `/tmp` or `desktop/output/playwright`.

- [ ] Compare each represented route at 1728x1117 and 1440x900 in light and dark against the v7 preview.
- [ ] Verify keyboard access and screen-reader semantics on the org chart.
- [ ] Push `codex/company-team` against `origin/codex/phase2-integration` with the Rust-wide pre-push lanes excluded as authorized by the task.
- [ ] Open or update the draft PR and report implemented, locally tested, visually compared, hosted CI, and remaining design/API evidence separately.
- [ ] Poll `gh pr checks` until all hosted checks finish; fix branch-caused failures before reporting completion.

## Known design boundary

The approved Team list includes a Hire employee button although HIRE-1 is out of scope. The Team routes do not show a member-change ask composer or a paused employee badge and reason in message rows. Those elements remain unimplemented pending an approved placement and behavior. The represented profile pause banner and Team status states remain in scope.
