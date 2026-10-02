# Company Work 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add work tracking views backed by real company work heads and actions, while keeping commitment suggestions and watchdog execution unavailable until their real APIs exist.

**Architecture:** Reuse the relay-backed company work head and kind 47006 history as the sole source for timeline, thread context, and owner views. Do not infer commitments from message text, seed fixture records, or claim a watchdog save until the suggestion stream, business configuration store, and scheduled check-in delivery path are available. Show the frozen unavailable and empty states where records or APIs are absent.

**Tech Stack:** React 19, TanStack Router and Query, existing company work Nostr records, desktop Playwright, Biome.

---

### Task 1: Derive truthful company work activity

**Files:**
- Create: `desktop/src/features/company-work/companyWorkTimeline.ts`
- Test: `desktop/src/features/company-work/companyWorkModels.test.mjs`
- Modify: `desktop/src/features/company-work/hooks.ts`
- Modify: `desktop/src/features/company-work/companyWorkModels.ts`
- Modify: `desktop/src/features/company-work/ui/CompanyWorkDetailScreen.tsx`

- [ ] **Step 1: Test activity projection from real action events.** Cover create, update, status, verification, archive, restore, and a thread-root change. Assert ordering follows signed event timestamps and no entry is produced without a valid kind 47006 event.
- [ ] **Step 2: Implement a pure timeline projection.** For each history entry, produce its event time, signer pubkey, action label, and only fields carried by that action. Label a root change as a move. Do not synthesize due dates, review requests, attachments, watchdog events, or automatic verdicts.
- [ ] **Step 3: Render the timeline in work detail.** Resolve names through existing profile queries, link the current conversation using the latest head channel and root, retain the real loading/error states, and keep all action failures visible.
- [ ] **Step 4: Run desktop focused checks.** From `desktop`, run `pnpm typecheck`, `pnpm check`, and `pnpm test` one at a time.
- [ ] **Step 5: Commit the activity slice.** Activate Hermit and commit source and tests with `git commit -s -m "feat: show company work activity from relay history"`.

### Task 2: Add the conversation work panel and person commitments view

**Files:**
- Create: `desktop/src/features/company-work/ui/CompanyWorkTrackingScreens.tsx`
- Modify: `desktop/src/features/channels/ui/ChannelPane.tsx`
- Modify: `desktop/src/features/messages/ui/MessageThreadPanel.tsx`
- Modify: `desktop/src/features/company-work/hooks.ts`
- Modify: `desktop/src/app/routes/work.$screen.$resourceId.tsx`
- Modify: `desktop/src/app/navigation/useAppNavigation.ts`
- Regenerate: `desktop/src/app/routeTree.gen.ts` when `pnpm build:e2e` runs the TanStack Router Vite plugin
- Test: `desktop/tests/e2e/company-work-tracking.spec.ts`
- Modify: `desktop/playwright.config.ts` while preserving every existing project and `testMatch`

- [ ] **Step 1: Test current-thread selection.** Seed signed relay work heads in the mock bridge and assert the panel shows only records whose current `channelId` and `threadRootEventId` match the open thread. A moved record must appear only at its current root, with its old-thread reference opening the same work UUID.
- [ ] **Step 2: Test person commitments.** Seed multiple real-shaped records and assert the view filters by the assigned owner pubkey, retains status and goal details, and routes each row to its own work UUID.
- [ ] **Step 3: Implement the read models.** Derive panel and person rows from `useCompanyWorkHeadsQuery`; do not add local record arrays, hardcoded people, or counts. Resolve identities through existing profile and managed-agent lookups.
- [ ] **Step 4: Implement the frozen views.** Add the tracked-work context in the open thread panel and the owner's commitments route. Link to the existing work detail and conversation routes. Use the frozen empty and unavailable compositions when the query has no records or fails.
- [ ] **Step 5: Keep route generation authoritative.** Run `pnpm build:e2e` from `desktop` to update `routeTree.gen.ts` through the TanStack Router Vite plugin; do not hand edit generated output. Confirm `desktop/playwright.config.ts` still includes every smoke and integration spec.
- [ ] **Step 6: Run local desktop checks.** Run `pnpm typecheck`, `pnpm check`, `pnpm test`, `pnpm build:e2e`, and the new affected Playwright spec in the required Linux image, one run at a time.
- [ ] **Step 7: Commit the panel and person slice.** Commit the route, screen, tests, and generated route tree with `git commit -s -m "feat: add tracked work conversation and person views"`.

### Task 3: Record API boundaries for suggestions and watchdog

**Files:**
- Modify: `docs/company-records.md`
- Modify: `docs/business-records.md`
- Modify: `desktop/src/features/company-work/ui/CompanyWorkTrackingScreens.tsx`
- Test: `desktop/tests/e2e/company-work-tracking.spec.ts`

- [ ] **Step 1: Make the absent suggestion stream falsifiable.** Add a test proving no `Track this?` affordance appears for ordinary messages. The affordance may only render from a validated persisted suggestion supplied by an authoritative detector. Do not classify commitments by matching message text.
- [ ] **Step 2: Keep watchdog controls off without a usable backend.** Add a test proving the interface does not enable or claim to save a watchdog when business-scoped settings and scheduled check-in delivery are unavailable. Do not select or persist a timing value from a mockup example.
- [ ] **Step 3: Document the required interfaces.** Record that production suggestions need a relay-validated proposal source plus an explicit person-acceptance action, and watchdog requires company-scoped settings, explicit opt-in, owner-entered intervals, scheduling, retryable delivery, and cancellation. Record that work due dates are also absent from `CompanyWorkItemHead` and therefore are not shown.
- [ ] **Step 4: Render only approved availability states.** Route tracking suggestion and watchdog scenes to the frozen unavailable state when their query/API is absent. The watchdog remains OFF. A failed state is shown only after a real failed operation and preserves typed settings.
- [ ] **Step 5: Run affected E2E and test-selector audit.** Search `desktop/tests/e2e`, `desktop/src/**/*.test.*`, and `mobile/test` for every changed label, role, route, and test ID. Run all affected desktop specs with `pnpm build:e2e` and the required Playwright Linux image.
- [ ] **Step 6: Commit the truthful API boundary.** Commit docs, interface states, and tests with `git commit -s -m "docs: record company work tracking API boundaries"`.

### Task 4: Compare and publish WORK-2

**Files:**
- Review: `desktop/tests/e2e/company-work-tracking.spec.ts`
- Review: all WORK-2 source, tests, docs, and generated routes

- [ ] **Step 1: Compare implemented screens with v8.** Capture actual app states at 1728x1117 and 1440x900 in light and dark themes. Compare the timeline, thread panel, person view, empty, unavailable, suggestion, and watchdog states against `company-feature-review/proof/gaps/`; list every route that remains API-blocked.
- [ ] **Step 2: Run the non-Cargo local gate.** Run `pnpm typecheck`, `pnpm check`, `pnpm test`, `pnpm build:e2e`, and affected Playwright specs one at a time. Rust checks remain hosted-CI-only.
- [ ] **Step 3: Commit visual and API boundary notes.** Record implemented, tested, visually compared, CI, NEEDS_API, and NEEDS_DESIGN states without claiming unavailable behavior works.
- [ ] **Step 4: Push a coherent follow-up.** Push the signed commits to the existing draft PR branch with the required lefthook exclusions and state that Rust was verified by hosted CI only.
- [ ] **Step 5: Close the hosted gate.** Read completed failed job logs as soon as they are available, fix every branch-caused failure, and poll until all PR checks are green.
