# Batch 2 Asks Implementation Plan

> **For agentic workers:** Execute this plan inline in the assigned `codex/b2-asks` worktree. The frozen owner-approved batch 2 handoff is the product spec.

**Goal:** Implement the approved ask decision, destination, recipient, hire proposal, permission and money ask states while preserving server authority and the typed company record contracts.

**Architecture:** Extend the existing kind 47032 ask create flow and reuse kind 47033 responses, existing hire records, and existing invite and permission APIs. A new discussion with an ask is one signed ask event stored as the thread root in the broker transaction, so the thread context, ask head and optional hire head cannot be split by a failed second publish. Money asks wait for the existing spend and allowance work in PR 145 to merge.

**Tech Stack:** Rust relay and record validation, TypeScript React desktop, TanStack Router and Query, existing Nostr event builders, existing Playwright smoke and integration coverage.

---

## Contract decisions

- Decision reasons use the same channel access boundary as the ask. Kind 47033 and the current kind 30643 head are stored under the ask channel; the existing record model has no narrower reason visibility field.
- Existing-thread asks keep their current event format. New-thread asks carry a typed thread-start title and optional opening context and use the ask create event as the root event. The relay records root metadata, the ask head and any hire head in the existing transaction. This uses no new event kind, migration or permission.
- Recipients come from real channel membership and never include the current signer. Money, hire and tool resolution continues to use the relay's owner/admin checks. Invite recovery calls the existing owner/admin invitation flow. Email-bound invitation delivery is unsupported by the current invite API and remains `NEEDS_API`.
- Hire proposals reuse the existing `HireProposal`, ask broker and hire ask card. Only actual role catalog entries are selectable. Amounts and mockup identities are not defaults.
- Standing permission scope and expiry begin blank. The existing approve-once path remains available. The example-only route is not seeded into runtime data.
- Money ask work starts only after PR 145 is present on `codex/phase2-integration`; temporary allowance changes require an explicit end date and budget-stop fields come from real spend records.

## Task 1: Atomic ask thread roots and response reason contract

**Files:**

- Modify `crates/buzz-core/src/company_records.rs` for the typed thread-start payload and validation.
- Modify `crates/buzz-relay/src/handlers/company_asks.rs` and `crates/buzz-relay/src/handlers/ingest.rs` to create root thread metadata and persist the ask and optional hire head atomically.
- Modify `desktop/src/features/company-asks/askRecords.ts` and `askComposer.ts` for the typed payload.
- Modify `desktop/src/features/company-asks/ui/AskCard.tsx` only where needed to retain and display the resolution reason and root context.
- Update `docs/company-records.md` to describe the supported composer and transaction.
- Add production-seam tests in the company record and relay handler test modules, plus ask composer tests.

**Acceptance:** Existing ask creates still require a real thread root. New-thread creates require a channel member and a non-self recipient, then persist the root event, ask head, and optional hire head in one transaction. Whitespace-only or over-limit decision reasons fail. A saved reason remains on the resolved ask card.

## Task 2: Destination, recipient recovery and typed hire proposal

**Files:**

- Modify `desktop/src/app/routes/asks.new.tsx` and `desktop/src/features/company-asks/ui/AskCreateScreen.tsx` for the Needs me, channel, thread, new-thread and compose states.
- Reuse channel message readers and actual channel membership for channel and recipient choices.
- Reuse the existing invite link flow and hide it unless the current relay membership is owner or admin.
- Reuse the existing `HireProposal` model and role catalog projection for the typed hire form; preserve the selected destination and recipient across transitions and failed submissions.
- Update `desktop/src/features/home/ui/TodayScreen.tsx`, ask composer unit tests, `desktop/tests/e2e/company-asks.spec.ts`, and `desktop/tests/e2e/company-hiring.spec.ts` for changed routes and controls.

**Acceptance:** No channel or recipient is preselected. A one-member channel cannot address itself. An empty channel has a designed new-thread recovery. The opening context and typed ask submit as one event. A failed publish keeps the draft and retries the same signed event. A hire proposal creates the existing typed ask and hire head, without creating an employee or position.

## Task 3: Permission states and visual comparison

**Files:**

- Reuse `desktop/src/features/company-permissions/ui/ToolPermissionScreen.tsx` and existing permission event builders. Change them only if comparison finds a contract gap.
- Update the affected permission and ask UI tests if labels or controls change.
- Compare every implemented route and state with the frozen v9 screenshots at 1728x1117 and 1440x900 in light and dark mode. Keep new captures outside the repository.

**Acceptance:** Scope and expiry have no preselected value, save failure retains typed values, role checks remain in the relay and UI, and approve-once remains reachable. Report measured visual differences by route and state.

## Task 4: Money and budget-stop asks after PR 145

**Files:**

- Merge the current integration head after PR 145 merges, keeping both sides of shared files.
- Extend the existing company ask model and composer using the spend and allowance records and authority rules supplied by PR 145.
- Update `desktop/tests/e2e/company-asks.spec.ts` and affected spend unit tests.

**Acceptance:** Allowance and external cost are distinct typed asks. Temporary allowance requires an explicit end date. Budget-stop requests use a real triggering turn, estimate and remaining allowance. No example amount or role value becomes a default. Failed saves retain the draft.

## Validation and delivery

- Before Git commands or hooks, activate Hermit with `. ./bin/activate-hermit`.
- Run only quick local checks: desktop TypeScript, Biome, px-text, `cargo fmt`, and unit tests for files touched. Do not run Cargo builds, tests, Clippy or the full local suites.
- Use a single affected Playwright spec locally only when it finishes quickly. Let the PR smoke and integration shards run the full browser suite.
- Grep all desktop E2E and unit tests for changed text, accessible names and test IDs before pushing.
- Commit each complete sub-slice with `git commit -s`, push when it compiles and the quick checks pass, then poll only the current-head GitHub checks with `GH_TOKEN`.
- Do not merge or deploy. Validation must not issue invitations, publish, charge, or write to the production relay.
