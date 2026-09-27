# W11 Clients and Shared Work Implementation Plan

> **For agentic workers:** Execute this plan inline in the approved W11 worktree. Steps use checkbox syntax for tracking.

**Goal:** Implement the r19 desktop client and work routes on the current relay business-record contract, with shared work references that resolve to the same records shown in chat and dedicated screens.

**Architecture:** Use the relay-authored Party, Client, and WorkItem heads as the only canonical records. Sign ClientAction, WorkItemAction, DeliverableVersion, and DeliverableApproval events through the existing Tauri signer, publish through the active relay session, and scope every query to the current client channel. Implement only fields and actions the current contract can enforce. Record every remaining r19 control that lacks an API under NEEDS_API.

## Implementation status as of 2026-09-27

- Implemented the desktop W11 routes from the inventory: R066 `clients` and R150 `work`. R067 `clients/access` belongs to W16. Money retainers belong to W18. This slice does not implement mobile routes.
- Implemented the client directory and supported client detail from relay Party, Client, channel membership, and work records. Client creation, contact and brief editing, archive, and restore are not exposed without their required contracts and recovery states.
- Implemented shared work list, board, detail, create, status and assignee edits, immutable deliverable versions, feedback history, review, approval, and changes requested. Work records stay in their exact client channel; archived client or work records are visible without mutation controls.
- Implemented the r19 work-detail share action and client-channel work-reference card. The reference resolves the latest work head from the exact client channel and coordinate, then opens the same client-scoped work route. Sharing uses a standard kind 9 event with h, p, and a tags and does not copy record fields into message content.
- Focused validation passed: 15 adapter, live-scope, and shared-fixture unit tests; the W11 Playwright spec with 11 cases; existing navigation and Workflows specs with 48 passed and one explicit skip; `pnpm build:e2e`; `pnpm exec tsc --noEmit`; Biome; `pnpm check:px-text`; and all 28 visual comparison cases. The visual matrix covers the W11 routes and chat reference at both target viewports in light and dark modes, plus the existing Sales baselines. Screenshots and exact pixel-difference metrics are in `/tmp/w11-visual-final-2026-09-27`. Side-by-side review confirmed that r19 fields without W00 support remain omitted. This proves the local UI and shared mock fixture, not a connected live relay.

**Tech Stack:** React 19, TanStack Router, React Query, NIP-29 relay events, Tauri IPC, TypeScript, Tailwind, Playwright.

---

## File map

- Add desktop/src/features/clients/lib/businessRecords.ts for typed head parsing, explicit kind and h-tag queries, action building, publication, and current-version resolution. Keep shared errors, coordinate builders, and digest functions in businessRecordErrors.ts, businessRecordCoordinates.ts, and businessRecordDigests.ts, re-exporting the stable API from businessRecords.ts.
- Add desktop/src/features/clients/lib/businessRecords.test.mjs for production-path tests of scope validation, coordinate parsing, stale-head conflicts, and digest handling.
- Add desktop/src/features/clients/useBusinessRecords.ts for channel-scoped queries and live refresh. Fence responses by relay, identity, client channel, and subscription generation.
- Add client directory, client overview, work list, work detail, deliverable, and business-reference UI under desktop/src/features/clients/ui/.
- Add route components desktop/src/app/routes/clients.tsx, clients.$clientId.tsx, work.tsx, and work.$workId.tsx.
- Modify desktop/src/app/routes.ts, desktop/src/app/AppShell.helpers.ts, desktop/src/app/AppShell.helpers.test.mjs, desktop/src/app/AppShell.tsx, desktop/src/app/navigation/useAppNavigation.ts, desktop/src/features/sidebar/ui/AppSidebar.types.ts, AppSidebar.tsx, and AppSidebarPinnedHeader.tsx to register and select the W11 destinations.
- Extend desktop/src/testing/e2eReferenceWorkspace.ts and desktop/src/testing/e2eBridge.ts with contract-shaped reference records and relay mock behavior. Do not create a second workspace fixture.
- Add desktop/tests/e2e/w11-clients-work.spec.ts. Update any existing specs whose assertions depend on the Work button currently routing to Workflows.

## Contract boundary

The current frontend and relay contract supports client display name, party link, status, and approver pubkeys; work title, status, assignees, approvers, and current deliverable pointers; immutable deliverable versions with JSON body and media digests; and exact-version approval, changes-requested, and rejected decisions. Client and work actions carry expected head ids. Relay validation enforces private client-channel membership, role rules, assignment rules, and current-version approval.

The current contract does not support client contacts, industry, brand voice, approved facts, asset collections, onboarding checklist state, service scope, recurring retainer terms, email invitations with expiry, work briefs, due dates, budgets or spend, dependencies, custom completion checklist items, or an atomic client archive cascade that pauses active work. The reserved service and invoice kind constants do not constitute implemented record handlers. Do not serialize any of these fields into a different record type.

Standalone client creation also needs a stable, retryable operation that provisions its private channel, Party head, and Client head together. The existing ClientAction requires an existing channel and a current party in the business channel. Do not present a partially provisioned client as successful. Keep that creation path under NEEDS_API until the relay exposes an idempotent provisioning contract.

## Task 1: Add the typed business-record adapter

**Files:** Add desktop/src/features/clients/lib/businessRecords.ts and businessRecords.test.mjs. Use desktop/src/shared/constants/kinds.ts, desktop/src/shared/api/tauri.ts, desktop/src/shared/api/tauriChannels.ts, and the active relayClient.

- [x] Define TypeScript inputs matching the Rust ClientAction, WorkItemAction, DeliverableVersion, and DeliverableApproval camelCase fields exactly. Keep ClientHead and WorkItemHead as parsed relay projections, not writable state.
- [x] Query only explicit head and version kinds. Add #h for each client channel id, split channel id lists at MAX_EXPLICIT_CHANNEL_VALUES, and reject events whose kind, h tag, d tag, or embedded client id disagrees with the requested coordinate.
- [x] Resolve a head by its client channel and exact d tag. Select only the latest relay-authorized replacement for that coordinate and retain the event id for the next expected-head precondition.
- [x] Build each mutation with exactly one h and one namespaced d tag. Sign with signRelayEvent(), publish with relayClient.publishEvent(), and propagate validation, permission, timeout, and revision conflict errors to the caller.
- [x] Sign a mutation once and retain the exact signed event while its dialog remains open. After an uncertain acknowledgement, query by that event id before retrying. Do not replace its id or clear the form on a failed publish.
- [x] Implement canonical JSON and sorted media digest calculation for deliverable versions using the same SHA-256 inputs as buzz-core/src/business_records.rs. Verify version and approval event coordinates against the Rust contract before publishing.
- [x] Subscribe to relevant head and version events using relayClient.subscribeLive(). Start the live subscription before the history read, merge duplicate ids, and reject callbacks from an old relay, identity, client, or generation.
- [x] Test the production adapter for wrong-client ids, stale expected-head conflicts, uncertain acknowledgement recovery by event id, live subscription scope retirement, and digest calculation.

Action inputs use this contract shape:

    export type ClientActionInput = {
      schemaVersion: number;
      clientId: string;
      action: "create" | "update" | "archive" | "restore";
      expectedHeadEventId: string | null;
      head: {
        schemaVersion: number;
        clientId: string;
        partyId: string;
        displayName: string;
        approverPubkeys: string[];
        status: string;
      };
    };

## Task 2: Build the supported client routes

**Files:** Client UI under desktop/src/features/clients/ui/, the three client route components, useBusinessRecords.ts, and the existing reference fixture.

- [x] Build the directory from private stream channels the current identity can access, then include only channels with a valid ClientHead. Never substitute the first available client when a selected client id is missing or unauthorized.
- [x] Build the client overview from the matching ClientHead, PartyHead, client channel, current members, and current work heads. Preserve the route's client id when loading each linked record.
- [x] Show existing client-channel membership and ClientHead approver pubkeys on supported client views. Do not substitute a reviewer-membership screen for the frozen invitation route.
- [x] Keep client records read-only in W11 until their frozen brief, contact, reviewer, and onboarding controls have backed fields. Do not expose archive while the relay cannot pause active work in the same recoverable operation.
- [x] Keep the r19 client route hierarchy and typography. Do not fill contact, brief, brand, asset, service, retainer, or onboarding fields with fixture-derived production values.
- [x] Cover unavailable client routes and exact work-client scoping in the W11 UI tests. Mutating client actions remain unexposed under the documented API boundary.

## Task 3: Build shared work list, board, detail, and deliverable flows

**Files:** Work UI under desktop/src/features/clients/ui/, work route components, useBusinessRecords.ts, and the reference fixture.

- [x] List WorkItemHead records only from valid client channels and group them by the actual status stored on the relay. Render list and board from the same filtered record set.
- [x] Create a work item with a required trimmed title, selected client channel, initial status, assignee pubkeys, and approver pubkeys. Generate one stable work id for the create attempt and use an empty expected head only for create.
- [x] Update status and assignees from the latest WorkItemHead using its exact expected event id. Do not retry a conflict by silently replacing the expected id; reload and show the current record.
- [x] Add immutable deliverable versions with a stable deliverable id, incremented version, previous version event id, canonical body digest, and sorted media digests. Retain each prior version for comparison and feedback history.
- [x] Record approval, changes requested, and rejection against the exact current version event id and digests. Refresh from the relay after publication and keep prior approvals attached to their original version.
- [x] Link the work detail to its own client channel and current client route. Preserve the requested client id when a route, chat reference, or deep link is opened.
- [x] Do not claim to enforce deadlines, budget, spend, brief fields, dependencies, arbitrary checklist items, or completion evidence without a contract. Do not set work complete until a supported acceptance condition is defined; list the exact r19 controls under NEEDS_API.
- [x] Test missing title, wrong-client work id, an unassigned member, stale work head, archived client and work boundaries, and version digest handling across adapter and W11 UI tests.

## Task 4: Share the same work record in the client conversation

**Files:** desktop/src/features/clients/ui/WorkDetailScreen.tsx, WorkItemReferenceCard.tsx, WorkItemReferenceContext.tsx, desktop/src/features/channels/ui/ChannelPane.tsx, desktop/src/features/messages/ui/MessageRow.tsx, and focused tests.

- [x] Add the r19 `Share in client channel` action to work detail. This is a direct action for that work item, not a new composer picker.
- [x] Publish a standard kind 9 message with the exact client h tag, sender p tag, and relay-authored work-head a tag. Keep the message content empty so the record remains canonical.
- [x] Resolve only the matching latest work head from the active client channel and link to `/work/$workId?client=$clientId`. Never search another client for a missing target.
- [x] Subscribe to current client work records while a valid reference is in the visible timeline or thread, using the existing relay and identity generation fences.
- [x] Run the focused flow test: share from work detail, render the record card in its client channel, and open the same client-scoped work detail.

## Task 5: Register r19 navigation and extend the shared fixture

**Files:** App routes, shell selection, sidebar files and tests, e2eReferenceWorkspace.ts, e2eBridge.ts, and the W11 Playwright spec.

- [x] Register /clients, /clients/$clientId, /work, and /work/$workId and add the corresponding selected-view handling.
- [x] Add Clients and Work under the reference Business section only after the routes resolve. Keep the existing Workflows route reachable under Build & automate and update its existing sidebar label and tests.
- [x] Seed only contract-valid record events for the reference clients and work in e2eReferenceWorkspace.ts. Keep sample contacts, service scope, budget, and retainer data out of the production contract fixture.
- [x] Teach the E2E relay mock to store and query business event kinds by explicit kind, h, and d filters, preserve expected-head conflict behavior, and emit matching live events.
- [x] Extend the shared fixture with the r19 client-channel work-reference card and query its addressable a tag in the E2E mock.
- [x] Assert that removing the production scope and conflict checks causes the adapter tests to fail. Keep every new action label, role, test id, route, and sidebar assertion aligned with the r19 reference.
- [x] Compare all W11 routes and the work-reference card to frozen r19 at 1728 by 1117 and 1440 by 900 in light and dark modes. Use referenceWorkspace: true; do not edit or regenerate the frozen reference package.

## Task 6: Focused validation, commits, and hosted gate

**Files:** W11 code, tests, and this plan.

- [x] Run focused unit tests, Biome on changed files, TypeScript, and pnpm check:px-text one command at a time. Do not run full local CI or a full workspace Cargo build.
- [x] Run pnpm build:e2e, then w11-clients-work.spec.ts and every affected existing spec one at a time inside mcr.microsoft.com/playwright:v1.60.0-noble with Docker --cpus=2.
- [x] Grep changed labels and test ids across desktop/tests/e2e, desktop/src/**/*.test.*, and mobile/test. Update dependent tests in the same commit series.
- [ ] Activate Hermit before Git operations. Commit each coherent implementation step with git commit -s. Push only after local focused checks and visual comparison pass.
- [ ] Open a draft PR against codex/phase2-integration, document supported contract behavior and NEEDS_API items, then poll its GitHub checks until every check finishes green. Never use gh auth commands.

## NEEDS_API and NEEDS_DESIGN

Keep these states explicit in the PR report:

- NEEDS_API: Standalone client create needs atomic, idempotent private-channel, PartyHead, and ClientHead provisioning.
- NEEDS_API: Client access invitations, invitation expiry/revocation, contacts, named reviewer details, and the required client profile fields do not exist in the W00 client contract.
- NEEDS_API: Contact, industry, brand facts/assets, client brief, service scope, retainer recurrence, onboarding checklist, portal invitation with email/expiry/revocation, work brief/deadline/budget/spend/dependency, custom acceptance checklist, completion evidence, and archive cascade.
- NEEDS_API: The r19 `Review completion` action needs a work-level acceptance gate across checklist completion and approved deliverables. W00 only records approval per deliverable version, so the W11 UI never marks a work item complete. The r19 `Record a blocker` action also needs a durable reason/dependency field that W00 lacks.
- NEEDS_API: Client archive must pause active work in the same recoverable server operation. Until that exists, do not report the designed pause behavior as implemented.
- NEEDS_DESIGN: r19 defines the successful work-share action and card, but not the card state for a missing, archived, unauthorized, or cross-client work target. The card therefore appears only when the exact client-scoped work head resolves; no fallback target or replacement message is shown.
- NEEDS_DESIGN: The reference does not define how a failed or uncertain work-share publish should recover after leaving or restarting the detail screen. The current action retains its signed event while mounted, checks the relay for an existing reference before sharing, and surfaces relay errors through the standard toast. Cross-session retry recovery remains unproven.
- NEEDS_DESIGN: The frozen reference has no client restore screen, blocked-archive recovery state, or retry state for a partially provisioned standalone client. Do not invent those screens or copy.
- Scope note: clients/access is assigned to W16 in the route inventory and is an invitation-management screen. W11 may show existing client-channel membership and approver data, but must not replace that screen with a different flow. Portal invitation remains W16 and NEEDS_API.

## Self-review

- Client list, supported client overview, work list, board, detail, deliverable versions, feedback, review, and exact-version approval have dedicated tasks.
- Relay scope, permissions, concurrent edits, archive boundaries, and no-fallback routing have production-seam tests.
- The r19 success path links the work detail to the same client-channel work head. Unsupported and unresolved target states remain under NEEDS_DESIGN above.
- All unsupported r19 fields and side effects are listed rather than serialized into another record.
- The current ClientAction create path is excluded until provisioning can be retried without orphaning or duplicating client channels.
