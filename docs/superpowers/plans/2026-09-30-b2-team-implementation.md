# Batch 2 Team Implementation Plan

> **For agentic workers:** Follow the assigned Phase 2 team slice. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved b2 Team profile, work recovery, member status and human profile states using real company records.

**Architecture:** Reuse the company team and work queries, member-position event readers and existing agent-management authority. Keep work recovery inside its profile section. Do not create a member-proposal destination or runtime-link record that the current design and backend do not provide.

**Tech Stack:** React 19, TanStack Query, Nostr relay reads and writes, Playwright E2E.

---

## Acceptance gates

1. Work shows loading, real empty results, current assigned records, and a retryable read failure without replacing the rest of the profile.
2. Message rows show paused or terminated employee status and its reason only when a verified current member-position head says so.
3. Human profiles expose Overview and History, with no AI configuration or salary tabs. History uses real member-position actions.
4. Unlinked positions show their real company record and do not invent a local runtime association.
5. Any route requiring a conversation thread remains unreachable until the approved design supplies a destination flow. Report that exact gap as NEEDS_DESIGN.
6. Focused desktop checks pass, every implemented state is compared to the frozen v9 reference, and the draft PR checks are green.

## Task 1: Add section-level work recovery

**Files:** `desktop/src/features/company-team/ui/EmployeeProfileScreen.tsx`, `desktop/src/features/company-team/ui/TeamMemberScreen.tsx`, `desktop/src/features/company-work/hooks.ts` only if a narrow retry helper is needed, and `desktop/tests/e2e/company-team.spec.ts`.

- [ ] Treat channel-query failure and work-head failure as unavailable work data.
- [ ] Show the designed loading, empty, loaded, and failed treatments inside Doing now.
- [ ] Retry channel discovery and current work-head reads from the section button.
- [ ] Add a regression assertion that query failure does not render the empty message and retry remains available.

## Task 2: Add verified employee status to message rows

**Files:** `desktop/src/features/company-team/teamRelay.ts`, `desktop/src/features/messages/ui/MessageAuthorWithIndicators.tsx`, and a focused desktop E2E spec using a signed mock relay head.

- [ ] Query the current signed member-position head by the author coordinate with a bounded, community-scoped React Query key.
- [ ] Render the designed Paused or Terminated status and persisted reason only for a verified employee head.
- [ ] Keep absent, human, active, and failed reads from being presented as paused or terminated.
- [ ] Verify the production message-header component exposes the status once and with one accessible label owner.

## Task 3: Implement human and unlinked position details

**Files:** `desktop/src/features/company-team/teamRelay.ts`, `desktop/src/features/company-team/teamModels.ts`, `desktop/src/features/company-team/ui/TeamMemberScreen.tsx`, `desktop/src/features/company-team/ui/EmployeeProfileScreen.tsx`, and `desktop/tests/e2e/company-team.spec.ts`.

- [ ] Add a bounded member-position history reader for the human History tab.
- [ ] Show the actual member title, manager, status, assigned work and shared record history.
- [ ] Hide AI configuration and salary controls for human members.
- [ ] Render the designed unlinked position details from real records.
- [ ] Keep agent linking unreachable if no supported persisted link operation exists; document it as NEEDS_API.
- [ ] Add focused assertions for human tabs, real history, and the unlinked recovery detail.

## Task 4: Resolve the member-proposal submission boundary

**Files:** existing ask code and `desktop/src/features/company-team/ui/TeamMemberScreen.tsx` only if the frozen handoff and current route provide a real selected conversation and thread.

- [ ] Preserve owner and admin direct edits through the existing member-position broker.
- [ ] Confirm the ask builder carries `subject: { kind: "companyMember", id }` and an exact-head `memberProposal`.
- [ ] Do not submit an ask with an implicit channel or fabricated thread root.
- [ ] If the team entry supplies no approved destination, stop that subflow and report the missing destination design as NEEDS_DESIGN.

## Task 5: Validate and deliver

- [ ] Search all desktop tests for changed labels, roles, test IDs and message header text.
- [ ] Run only the permitted quick desktop checks and touched-file unit or widget tests.
- [ ] Compare each implemented state to the v9 reference at 1728x1117 and 1440x900 in light and dark; save captures outside the repository.
- [ ] Commit each completed sub-slice with signoff, push, and wait for the current PR head checks to finish green.
