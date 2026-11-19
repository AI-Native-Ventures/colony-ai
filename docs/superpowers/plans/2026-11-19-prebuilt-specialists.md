# Prebuilt Specialist Hiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner hire, view, and remove one approved specialist from a map job while retaining signed relay truth and the specialist, head, Scout ownership rule.

**Architecture:** Add a dedicated job-head and job-command wire family so existing function and access schemas remain closed and compatible. The relay applies job hire intent atomically with employee completion and reuses existing member lifecycle cleanup. The desktop reads a separate job-assignment query and renders a shared specialist spot surface in map windows, no-screen cards, phone map, Function screen, and part copy.

**Tech Stack:** Rust, SQLx/PostgreSQL, Nostr addressable records, Tauri 2, React 19, TanStack Query, TypeScript, Playwright.

---

## File structure

- `crates/buzz-core/src/company_jobs.rs`: signed job head, action, validation, d-tag helpers, and parser tests.
- `crates/buzz-relay/src/handlers/company_jobs.rs`: authorization, transactional writes, hire intent, reconciliation, and Postgres tests.
- `crates/buzz-relay/src/handlers/company_hires.rs`: atomic job intent and manager transitions at complete.
- `crates/buzz-relay/src/handlers/company_member_records.rs`: clears job assignments with current member cleanup.
- `desktop/src/features/cofounder/jobAssignments.ts`: strict parser, stable ids, relay actions, and React Query hooks.
- `desktop/src/features/cofounder/ui/JobAssignmentSpot.tsx`: accessible ownership pill and spot card.
- `desktop/src/features/cofounder/ui/PrebuiltHireDialog.tsx`: extracted reusable S1 flow for heads and specialists.
- `desktop/src/app/MapCanvasRouteSurface.tsx` and CSS: map-edge placement and resolved doer avatar.
- `desktop/tests/e2e/prebuilt-specialists.spec.ts`: map-shell ownership, permissions, keyboard, and geometry coverage.

### Task 1: Freeze the additive wire contract

**Files:**
- Create: `crates/buzz-core/src/company_jobs.rs`
- Modify: `crates/buzz-core/src/lib.rs`
- Modify: `crates/buzz-core/src/kind.rs`
- Modify: `crates/buzz-core/src/company_records.rs`
- Test: `crates/buzz-core/src/company_jobs.rs`

- [ ] **Step 1: Write failing wire tests**

```rust
assert_eq!(job_d_tag(CompanyFunction::Sales, "follow-ups").unwrap(),
    "company:job:sales:follow-ups");
assert!(parse_job_action(json!({"extra": true})).is_err());
```

- [ ] **Step 2: Implement bounded types and dispatch**

```rust
pub const KIND_COMPANY_JOB_HEAD: u16 = 30_682;
pub const KIND_COMPANY_JOB_ACTION: u16 = 47_071;
pub const JOB_ASSIGNMENT_EXTENSION: &str = "colony-job-assignments";
```

Define `JobHead`, `JobAction`, and `JobHireHead` with `deny_unknown_fields`.
Validate lower-case bounded `[a-z0-9-]` ids. Add only the new kinds to the
company command and record registries.

- [ ] **Step 3: Run focused core tests**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh cargo test -p buzz-core company_jobs`

Expected: job parser, tag, and compatibility tests pass.

- [ ] **Step 4: Commit**

```bash
. ./bin/activate-hermit
git add crates/buzz-core/src
git commit -s -m "feat: add signed company job records"
```

### Task 2: Make the relay authoritative and self-healing

**Files:**
- Create: `crates/buzz-relay/src/handlers/company_jobs.rs`
- Modify: `crates/buzz-relay/src/handlers/mod.rs`
- Modify: `crates/buzz-relay/src/handlers/company_records.rs`
- Modify: `crates/buzz-relay/src/handlers/company_functions.rs`
- Modify: `crates/buzz-relay/src/handlers/company_hires.rs`
- Modify: `crates/buzz-relay/src/handlers/company_member_records.rs`
- Modify: `crates/buzz-relay/src/nip11.rs`
- Test: `crates/buzz-relay/src/handlers/company_jobs.rs`

- [ ] **Step 1: Write handler-path tests**

```rust
assign(owner, sales, "outreach", specialist).await?;
replace(owner, sales, "outreach", replacement).await?;
pause(replacement).await?;
assert!(job_head(sales, "outreach").await?.assignee_pubkey.is_none());
```

Cover non-owner and non-member refusals, expected-head conflict, hire intent,
head reparenting, and head removal back to the previous Scout manager.

- [ ] **Step 2: Implement transactional helpers**

```rust
pub async fn clear_job_assignments_by_in_tx(
    tx: &mut Transaction<'_, Postgres>, tenant: &Tenant, pubkey: &str,
) -> Result<Vec<Event>, RelayError>;

pub async fn assign_job_for_hire_in_tx(/* completion inputs */)
    -> Result<Option<Event>, RelayError>;
```

Take a per-function advisory lock before live head reads. Clear job assignments
in the same member lifecycle transaction as function slots. Dispatch collected
events only after commit.

- [ ] **Step 3: Advertise and test the NIP-11 capability**

Add `colony-job-assignments` to relay metadata, route `47071` through the
company record handler, and retain every existing kind and schema.

- [ ] **Step 4: Run focused relay tests**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh cargo test -p buzz-relay company_jobs`

Expected: Postgres tests pass where local infrastructure is available. CI owns
compiler and broad-suite proof.

- [ ] **Step 5: Commit**

```bash
. ./bin/activate-hermit
git add crates/buzz-relay crates/buzz-core
git commit -s -m "feat: store company specialist assignments"
```

### Task 3: Add typed desktop records and the fallback

**Files:**
- Create: `desktop/src/features/cofounder/jobAssignments.ts`
- Create: `desktop/src/features/cofounder/jobAssignments.test.mjs`
- Modify: `desktop/src/features/cofounder/prebuiltAgents.ts`
- Modify: `desktop/src/features/cofounder/companyMapAssignments.ts`
- Modify: `desktop/src/shared/constants/kinds.ts`
- Modify: `desktop/src-tauri/src/commands/workspace.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/tests/e2e/e2eBridge.ts`

- [ ] **Step 1: Write falsifiable TypeScript tests**

```js
assert.equal(prebuiltJobId(agent("prebuilt-follow-ups")), "follow-ups");
assert.deepEqual(companyMapJobDoer(filledHead, specialist), {
  kind: "specialist", pubkey: specialist,
});
assert.equal(parseJobHead(oldRelayEvent), null);
```

- [ ] **Step 2: Implement strict parsing, actions, and capability query**

`useJobAssignmentsQuery` returns no assignments against old relay data.
`useJobAssignmentCapabilityQuery` maps malformed or unavailable NIP-11 to
false. The Tauri command returns false instead of exposing transport errors.

- [ ] **Step 3: Verify compatibility boundary**

Feed a new job event to current function and access parsers and assert `null`.
Feed no job events to the new parser and assert an empty collection.

- [ ] **Step 4: Run allowed focused checks**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh pnpm --dir desktop exec biome check src/features/cofounder/jobAssignments.ts src/features/cofounder/companyMapAssignments.ts`

Expected: zero diagnostics.

- [ ] **Step 5: Commit**

```bash
. ./bin/activate-hermit
git add desktop/src desktop/tests/e2e/e2eBridge.ts
git commit -s -m "feat: read specialist job assignments"
```

### Task 4: Reuse the hire flow and render the specialist surface

**Files:**
- Create: `desktop/src/features/cofounder/ui/PrebuiltHireDialog.tsx`
- Create: `desktop/src/features/cofounder/ui/JobAssignmentSpot.tsx`
- Modify: `desktop/src/features/cofounder/ui/PrebuiltHeadHireDialog.tsx`
- Modify: `desktop/src/app/MapCanvasRouteSurface.tsx`
- Modify: `desktop/src/app/MapCanvasRouteSurface.css`
- Modify: `desktop/src/app/MapCanvasNoScreenCard.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapScreen.tsx`
- Modify: `desktop/src/features/cofounder/ui/FunctionScreen.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapPhone.tsx`

- [ ] **Step 1: Extract the existing S1 dialog without changing head behavior**

Move the proposal, persona, approval, attach, first-message, and completion
sequence into `PrebuiltHireDialog`; preserve S1 ids in the head wrapper. Add
job intent only for specialists and use `agent.job` for employee title.

- [ ] **Step 2: Add accessible ownership components**

```tsx
<button aria-controls={spotId} aria-expanded={open} onClick={toggle}>
  <EmployeeAvatar name={resolvedDoerName} />
  <span>{ownershipLine}</span>
</button>
```

Use one keyboard-reachable close path and Escape. Only owners receive hire or
remove. Confirm removal before the existing member-position termination path.
Calls renders approved unavailable copy and no action.

- [ ] **Step 3: Place and reuse the resolver**

Reserve window corners for the close control and job ring, place the pill under
the top edge, anchor card beneath it, and use the same resolver for map, phone,
Function screen, and part-card copy.

- [ ] **Step 4: Run touched checks**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh pnpm --dir desktop exec biome check src/features/cofounder/ui/PrebuiltHireDialog.tsx src/features/cofounder/ui/JobAssignmentSpot.tsx src/app/MapCanvasRouteSurface.tsx`

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh pnpm --dir desktop check:px-text`

Expected: zero diagnostics and only named text tokens.

- [ ] **Step 5: Commit**

```bash
. ./bin/activate-hermit
git add desktop/src
git commit -s -m "feat: hire specialists from map jobs"
```

### Task 5: Bind map-shell proof and deliver the PR

**Files:**
- Create: `desktop/tests/e2e/prebuilt-specialists.spec.ts`
- Create: `test-fixtures/company-hire/prebuilt-specialist-follow-ups.json`
- Create: `/Users/mac/colony-work/out/prebuilt-specialists/REPORT.md`
- Create: `/Users/mac/colony-work/out/prebuilt-specialists/screenshots/2026-11-19/`

- [ ] **Step 1: Add production-seam E2E cases**

Drive pointer and keyboard through the real dialog and mock relay: hire from
the pill, assert the specialist job circle while a sibling stays head-led,
remove back to fallback, hire before a head then reparent, Calls unavailable,
and member read-only actions.

- [ ] **Step 2: Add geometry and screenshots**

At `1440x900` and `1728x1117`, assert pill/card boxes do not intersect close
or job ring on both sides. Build with `pnpm build:e2e`, run only this spec on
port `4195`, await `waitForAnimations`, capture light and dark, phone, and
sidebar variants, create PbJob/PbSpotStates/PbHireNext comparison PNGs, then
assert all hashes are distinct.

- [ ] **Step 3: Validate, create draft PR, and use CI**

```bash
. ./bin/activate-hermit
git add -A
git commit -s -m "test: prove prebuilt specialist hiring"
git push -u origin colony/feat/prebuilt-specialists
GH_TOKEN="$(gh auth token -u nocodeafrica)" gh pr create -R AI-Native-Ventures/colony-ai --base develop --draft --title "feat: hire prebuilt specialists from map jobs" --body-file /tmp/prebuilt-specialists-pr.md
```

Read failed logs with `gh run view -R AI-Native-Ventures/colony-ai --log-failed`,
fix without raising ratchets, post screenshots, write REPORT, then set STATUS
to DONE only after final CI is green.

## Self-review

- Tasks 1 through 5 cover storage, atomic intent, wire compatibility, relay
  fallback, three ownership levels, lifecycle healing, manager transitions,
  board states, permission boundaries, removal, Function screen, part copy,
  phone layout, tests, geometry, screenshots, and report delivery.
- All names are defined before reuse and no work is deferred.
- Broad compilation and repository checks remain CI-owned under the coordinator
  heavy-work rules; focused commands are included only where allowed.

