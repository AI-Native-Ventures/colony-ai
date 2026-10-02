# Company Work 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-data owner and goal filters plus an authorized, same-audience work-thread move that preserves one company work item and its history.

**Architecture:** Filter the current relay-backed work heads using stable owner pubkeys and the real company goal tree. Reuse the exact-head kind 47006 update for a move, with the relay deriving the destination channel from the selected root message and checking source authority, destination membership, active channels, and identical audience membership before replacing the relay-signed kind 30634 head. Keep the work UUID and d-tag fixed; query action history only across channels the viewer can currently access.

**Tech Stack:** Rust (`buzz-core`, relay broker), Nostr event builders and `buzz-cli`, React 19, TanStack Router and Query, Playwright, Biome.

---

### Task 1: Correct work thread validation and document move invariants

**Files:**
- Modify: `crates/buzz-core/src/business_records.rs`
- Test: `crates/buzz-core/src/business_records.rs`
- Modify: `desktop/src/features/company-work/companyWorkModels.ts`
- Test: `desktop/src/features/company-work/companyWorkModels.test.mjs`
- Modify: `docs/company-records.md`
- Modify: `docs/business-records.md`

- [ ] **Step 1: Add falsifiable validation cases.** Add one core case proving an update may retain `sourceEventId` while changing `threadRootEventId`, including standalone work where source is absent, and one rejection proving create still requires a source and root together. Add matching parser fixtures for a relay head with a moved root and no source.
- [ ] **Step 2: Implement the create/update distinction.** Create continues to require both source and root or neither. Update requires a root whenever its immutable source exists, but permits a root for standalone work. In the desktop head parser, reject only `sourceEventId` without `threadRootEventId`.
- [ ] **Step 3: Record the exact contract.** Document that a move changes only the root and channel scope of the relay head, keeps the original source message and stable d-tag, is authorized as an edit, and is denied if the destination changes the source channel audience.
- [ ] **Step 4: Format without a Cargo build.** Run `cargo fmt --all -- --check` from the repository root. Rust unit tests are verified by hosted CI only.
- [ ] **Step 5: Commit the contract slice.** Activate Hermit, stage only the listed paths, and commit with `git commit -s -m "fix: allow company work thread moves"`.

### Task 2: Enforce exact-audience moves in the relay transaction

**Files:**
- Modify: `crates/buzz-relay/src/handlers/business_records.rs`
- Test: `crates/buzz-relay/src/handlers/business_records.rs`
- Test: `crates/buzz-test-client/tests/` existing relay integration suite

- [ ] **Step 1: Add relay regression cases.** Exercise a move within the same channel, a move between channels with identical active member sets, a move that would widen or narrow the audience, an archived or missing destination, a non-owner/requester/admin actor, a concurrent stale head, and a retry with the original expected head. Assert the item identifier and every non-location field remain stable.
- [ ] **Step 2: Resolve and lock destination scope.** For a changed non-empty root, load its stream message and channel in the action transaction. Lock the source and destination channel rows and active member rows in stable channel UUID order. Reject when either channel is inactive, the root is not a message root in the destination channel, the audience sets differ, or required owner/requester memberships do not survive.
- [ ] **Step 3: Preserve one atomic write.** Keep the kind 47006 action in its source `h` scope. Sign and replace the exact kind 30634 head under the same company-wide d-tag with the destination `h` and new root inside the existing transaction. Do not create a second work item or a separate move receipt.
- [ ] **Step 4: Run formatting only for Rust.** Run `cargo fmt --all -- --check`. Do not run local Cargo tests, builds, clippy, or check; hosted CI is the Rust gate.
- [ ] **Step 5: Commit the relay slice.** Activate Hermit and commit the core, relay, and integration-test changes with `git commit -s -m "feat: move company work within an unchanged audience"`.

### Task 3: Add stable owner and hierarchical goal filters

**Files:**
- Modify: `desktop/src/features/company-work/companyWorkModels.ts`
- Test: `desktop/src/features/company-work/companyWorkModels.test.mjs`
- Modify: `desktop/src/features/company-work/ui/CompanyWorkScreen.tsx`
- Create or modify: `desktop/src/features/company-work/ui/CompanyWorkFilters.tsx`
- Modify: `desktop/src/app/routeTree.gen.ts` only by the route generator if new routes are added
- Test: `desktop/tests/e2e/company-work.spec.ts`

- [ ] **Step 1: Test filter intersection and descendants.** Add model tests for owner and status intersection, parent-goal inclusion of descendants, sub-goal inclusion of its descendants, chip removal, clearing all filters, and an empty result without fabricated counts.
- [ ] **Step 2: Implement pure record filtering.** Use owner pubkeys, goal UUIDs, status values, and the fetched goal parent chain. Keep filters in list query state and keep existing status behavior when person and goal are unset.
- [ ] **Step 3: Implement the three adjacent accessible selectors.** Separate people from AI employees using profile/agent classification, search stable identities by displayed name or role, label parent goals as including sub-goals, and return focus to each selector after choose or dismiss. Render chips with independent clear actions and a Clear all action.
- [ ] **Step 4: Update affected mock E2E journeys.** Cover combined filters, parent goal descendants, owner search and keyboard selection, one-chip clear, Clear all, and no-match recovery using seeded mock relay records. Preserve every unrelated Playwright project and spec.
- [ ] **Step 5: Run desktop focused checks.** From `desktop`, run `pnpm typecheck`, `pnpm check`, and `pnpm test` one at a time. Run `pnpm build:e2e`, then the affected spec in the required Playwright Linux image.
- [ ] **Step 6: Commit the filter slice.** Commit the model, UI, tests, and generated route tree together with `git commit -s -m "feat: filter company work by owner and goal"`.

### Task 4: Implement the move picker, confirmation, retry, and thread references

**Files:**
- Create: `desktop/src/features/company-work/ui/CompanyWorkMoveScreen.tsx`
- Modify: `desktop/src/features/company-work/ui/CompanyWorkDetailScreen.tsx`
- Modify: `desktop/src/features/company-work/hooks.ts`
- Modify: `desktop/src/features/company-work/companyWorkModels.ts`
- Modify: `desktop/src/app/navigation/useAppNavigation.ts`
- Modify: `desktop/src/app/routes/work.$screen.$resourceId.tsx`
- Regenerate: `desktop/src/app/routeTree.gen.ts` when `pnpm build:e2e` runs the TanStack Router Vite plugin
- Test: `desktop/tests/e2e/company-work.spec.ts`
- Test: `desktop/tests/e2e/company-work.live.spec.ts`

- [ ] **Step 1: Add falsifiable mock journeys.** Cover authority-gated move entry, current-thread disabled, a same-audience destination, a different-audience destination disabled, cancel with unchanged head/history, one failed update retaining the selection, retry success once, stable work ID, old-thread moved reference, and new-thread live work card.
- [ ] **Step 2: Discover eligible roots from real accessible channels.** Query signed-in accessible stream messages, derive only actual thread roots, include channel name and root preview, and compare known member pubkey sets. Do not build a destination from a label or a scripted list.
- [ ] **Step 3: Implement the move screen.** Match the frozen picker, selected, confirmation, failed, unavailable, completed, old-thread, and new-thread states. Confirmation names source and destination, audience equality, and the fields that remain. Failed writes retain the selected destination and expose retry. Keep source messages and attachments unchanged.
- [ ] **Step 4: Reuse the exact-head mutation.** Submit one kind 47006 update signed with the current/source `h`, `company:work:<uuid>` d-tag, the current expected head, and the selected root. Do not change goal, owner, requester, status, done condition, evidence, source event, or work UUID.
- [ ] **Step 5: Preserve access-scoped history and thread markers.** Query action events over the viewer's current active stream memberships and the work d-tag, validating each action's own `h`. Render a moved reference in the old thread and the single current work card in the new thread; both routes open the same UUID.
- [ ] **Step 6: Keep routing and tests complete.** Run `pnpm build:e2e` from `desktop` to let the TanStack Router Vite plugin regenerate `routeTree.gen.ts`; inspect `playwright.config.ts` and retain all projects and `testMatch` entries. Add a real-relay journey for move, reload, and community switch.
- [ ] **Step 7: Run focused desktop gates.** Run `pnpm typecheck`, `pnpm check`, `pnpm test`, `pnpm build:e2e`, and affected Playwright specs one at a time in the required Linux image. Capture 1728x1117 and 1440x900 comparison screenshots in both themes.
- [ ] **Step 8: Commit the move UI slice.** Commit UI, route generation, tests, and any resulting docs with `git commit -s -m "feat: move company work between eligible threads"`.

### Task 5: Review and publish the coherent WORK-3 slice

**Files:**
- Review: `desktop/tests/e2e/`, `desktop/src/**/*.test.*`, `mobile/test/`
- Review: all changes in the WORK-3 commits

- [ ] **Step 1: Check every changed selector and copy.** Search the listed test trees for each changed label, role, test ID, and text; update every dependent assertion without weakening it.
- [ ] **Step 2: Run the frozen-reference check.** Compare owner/goal filters and all move states against `20260928-company-v8/company-feature-review/proof/work-addendum/` at 1728x1117 and 1440x900 in light and dark themes. Record implementation screenshots separately from frozen prototype screenshots.
- [ ] **Step 3: Run quick local gates.** Run `cargo fmt --all -- --check`, `pnpm typecheck`, `pnpm check`, `pnpm test`, `pnpm build:e2e`, and affected E2E specs one at a time. Do not run Cargo build, test, clippy, or check locally.
- [ ] **Step 4: Commit documentation and proof notes.** Include honest implemented, tested, visually compared, and unverified boundaries, including Rust hosted-CI-only verification and any NEEDS_DESIGN or NEEDS_API.
- [ ] **Step 5: Push and open or update the draft PR.** Push `codex/company-work-3` against `codex/phase2-integration` with the required lefthook exclusions. State in the PR that Rust is verified by hosted CI only.
- [ ] **Step 6: Close the hosted gate.** Read each completed failed job log immediately, fix branch-caused failures, and poll until every PR check is green. Do not report success with red or pending checks.
