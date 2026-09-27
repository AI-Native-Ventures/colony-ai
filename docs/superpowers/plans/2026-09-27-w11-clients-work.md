# W11 Clients and Shared Work Implementation Plan

> **For agentic workers:** Execute this plan inline in the approved W11 worktree. Steps use checkbox syntax for tracking.

**Goal:** Implement the r19 desktop client and work routes on the current relay business-record contract, with shared work references that resolve to the same records shown in chat and dedicated screens.

**Architecture:** Use the relay-authored Party, Client, and WorkItem heads as the only canonical records. Sign ClientAction, WorkItemAction, DeliverableVersion, and DeliverableApproval events through the existing Tauri signer, publish through the active relay session, and scope every query to the current client channel. Implement only fields and actions the current contract can enforce. Record every remaining r19 control that lacks an API under NEEDS_API.

**Tech Stack:** React 19, TanStack Router, React Query, NIP-29 relay events, Tauri IPC, TypeScript, Tailwind, Playwright.

---

## File map

- Add desktop/src/features/clients/lib/businessRecords.ts for typed head parsing, explicit kind and h-tag queries, action building, publication, and current-version resolution.
- Add desktop/src/features/clients/lib/businessRecords.test.mjs for production-path tests of scope validation, coordinate parsing, stale-head conflicts, and digest handling.
- Add desktop/src/features/clients/useBusinessRecords.ts for channel-scoped queries and live refresh. Fence responses by relay, identity, client channel, and subscription generation.
- Add client directory, client overview, client access, work list, work detail, deliverable, and business-reference UI under desktop/src/features/clients/ui/.
- Add route components desktop/src/app/routes/clients.tsx, clients.$clientId.tsx, clients.access.tsx, work.tsx, and work.$workId.tsx.
- Modify desktop/src/app/routes.ts, desktop/src/app/AppShell.helpers.ts, desktop/src/app/AppShell.helpers.test.mjs, desktop/src/app/AppShell.tsx, desktop/src/app/navigation/useAppNavigation.ts, desktop/src/features/sidebar/ui/AppSidebar.types.ts, AppSidebar.tsx, and AppSidebarPinnedHeader.tsx to register and select the W11 destinations.
- Extend desktop/src/testing/e2eReferenceWorkspace.ts and desktop/src/testing/e2eBridge.ts with contract-shaped reference records and relay mock behavior. Do not create a second workspace fixture.
- Add desktop/tests/e2e/w11-clients-work.spec.ts. Update any existing specs whose assertions depend on the Work button currently routing to Workflows.

## Contract boundary

The current frontend and relay contract supports client display name, party link, status, and approver pubkeys; work title, status, assignees, approvers, and current deliverable pointers; immutable deliverable versions with JSON body and media digests; and exact-version approval, changes-requested, and rejected decisions. Client and work actions carry expected head ids. Relay validation enforces private client-channel membership, role rules, assignment rules, and current-version approval.

The current contract does not support client contacts, industry, brand voice, approved facts, asset collections, onboarding checklist state, service scope, recurring retainer terms, email invitations with expiry, work briefs, due dates, budgets or spend, dependencies, custom completion checklist items, or an atomic client archive cascade that pauses active work. The reserved service and invoice kind constants do not constitute implemented record handlers. Do not serialize any of these fields into a different record type.

Standalone client creation also needs a stable, retryable operation that provisions its private channel, Party head, and Client head together. The existing ClientAction requires an existing channel and a current party in the business channel. Do not present a partially provisioned client as successful. Keep that creation path under NEEDS_API until the relay exposes an idempotent provisioning contract.

## Task 1: Add the typed business-record adapter

**Files:** Add desktop/src/features/clients/lib/businessRecords.ts and businessRecords.test.mjs. Use desktop/src/shared/constants/kinds.ts, desktop/src/shared/api/tauri.ts, desktop/src/shared/api/tauriChannels.ts, and the active relayClient.

- [ ] Define TypeScript inputs matching the Rust ClientAction, WorkItemAction, DeliverableVersion, and DeliverableApproval camelCase fields exactly. Keep ClientHead and WorkItemHead as parsed relay projections, not writable state.
- [ ] Query only explicit head and version kinds. Add #h for each client channel id, split channel id lists at MAX_EXPLICIT_CHANNEL_VALUES, and reject events whose kind, h tag, d tag, or embedded client id disagrees with the requested coordinate.
- [ ] Resolve a head by its client channel and exact d tag. Select only the latest relay-authorized replacement for that coordinate and retain the event id for the next expected-head precondition.
- [ ] Build each mutation with exactly one h and one namespaced d tag. Sign with signRelayEvent(), publish with relayClient.publishEvent(), and propagate validation, permission, timeout, and revision conflict errors to the caller.
- [ ] Sign a mutation once and retain the exact signed event while its dialog remains open. After an uncertain acknowledgement, query by that event id before retrying. Do not replace its id or clear the form on a failed publish.
- [ ] Implement canonical JSON and sorted media digest calculation for deliverable versions using the same SHA-256 inputs as buzz-core/src/business_records.rs. Verify version and approval event coordinates against the Rust contract before publishing.
- [ ] Subscribe to relevant head and version events using relayClient.subscribeLive(). Start the live subscription before the history read, merge duplicate ids, and reject callbacks from an old relay, identity, client, or generation.
- [ ] Test the production adapter for wrong-client ids, missing and duplicate h/d tags, unsupported kinds, concurrent expected-head conflict, old subscription completion after a scope switch, and exact-version approval invalidation after a new version.

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

- [ ] Build the directory from private stream channels the current identity can access, then include only channels with a valid ClientHead. Never substitute the first available client when a selected client id is missing or unauthorized.
- [ ] Build the client overview from the matching ClientHead, PartyHead, client channel, current members, and current work heads. Preserve the route's client id when loading each linked record.
- [ ] Build the access route from getChannelMembers() and ClientHead.approverPubkeys. Allow reviewer selection only from joined channel members and save the exact new approver list with the expected ClientHead event id.
- [ ] Allow supported name, reviewer, status, and restore changes only through ClientAction and existing relay permissions. Keep archive history intact. Do not expose archive while the relay cannot pause active work in the same recoverable operation; list that control under NEEDS_API.
- [ ] Keep the r19 client route hierarchy and typography. Do not fill contact, brief, brand, asset, service, retainer, or onboarding fields with fixture-derived production values.
- [ ] Add adapter-backed tests for an absent client id, wrong client channel, stale ClientHead, unauthorized reviewer mutation, restoring an archived record, and refusing the unsupported archive action.

## Task 3: Build shared work list, board, detail, and deliverable flows

**Files:** Work UI under desktop/src/features/clients/ui/, work route components, useBusinessRecords.ts, and the reference fixture.

- [ ] List WorkItemHead records only from valid client channels and group them by the actual status stored on the relay. Render list and board from the same filtered record set.
- [ ] Create a work item with a required trimmed title, selected client channel, initial status, assignee pubkeys, and approver pubkeys. Generate one stable work id for the create attempt and use an empty expected head only for create.
- [ ] Update status and assignees from the latest WorkItemHead using its exact expected event id. Do not retry a conflict by silently replacing the expected id; reload and show the current record.
- [ ] Add immutable deliverable versions with a stable deliverable id, incremented version, previous version event id, canonical body digest, and sorted media digests. Retain each prior version for comparison and feedback history.
- [ ] Record approval, changes requested, and rejection against the exact current version event id and digests. Refresh from the relay after publication and keep prior approvals attached to their original version.
- [ ] Link the work detail to its own client channel and current client route. Preserve the requested client id when a route, chat reference, or deep link is opened.
- [ ] Do not claim to enforce deadlines, budget, spend, brief fields, dependencies, arbitrary checklist items, or completion evidence without a contract. Do not set work complete until a supported acceptance condition is defined; list the exact r19 controls under NEEDS_API.
- [ ] Test missing title, wrong-client work id, unauthorized assignee, stale work head, stale deliverable approval, and version digest mismatch at the production adapter seam.

## Task 4: Share the same work record in the client conversation

**Files:** New business-reference components under desktop/src/features/clients/ui/, desktop/src/features/messages/ui/MessageComposer.tsx, MessageComposerToolbar.tsx, MessageRow.tsx, and focused message tests.

- [ ] Add the r19 business-record picker to the composer only when the active channel is a verified client channel. Populate it from current ClientHead and WorkItemHead events in that channel.
- [ ] Publish a standard kind 9 stream message with the destination h tag and an addressable a tag for the selected relay-authored client or work head. Do not copy record fields into chat text as a second source of truth.
- [ ] Render a reference message by resolving the same current head from its kind, author, d tag, and h channel. Show a route link to that record and treat a missing, archived, or unauthorized target as unavailable without switching to another client.
- [ ] Subscribe to record updates while a reference card is visible so the card and dedicated page converge on the same latest head. Keep generation fencing and relay reconnect backfill.
- [ ] Test a record reference publishing to the selected client channel, rendering in its timeline, opening the same work detail, refreshing after a head update, and refusing a wrong-client coordinate.

## Task 5: Register r19 navigation and extend the shared fixture

**Files:** App routes, shell selection, sidebar files and tests, e2eReferenceWorkspace.ts, e2eBridge.ts, and the W11 Playwright spec.

- [ ] Register /clients, /clients/$clientId, /clients/access, /work, and /work/$workId and add the corresponding selected-view handling.
- [ ] Add Clients and Work under the reference Business section only after the routes resolve. Keep the existing Workflows route reachable under Build & automate and update its existing sidebar label and tests.
- [ ] Seed only contract-valid record events for the reference clients and work in e2eReferenceWorkspace.ts. Keep sample contacts, service scope, budget, and retainer data out of the production contract fixture.
- [ ] Teach the E2E relay mock to store and query business event kinds by explicit kind, h, and d filters, preserve expected-head conflict behavior, and emit matching live events.
- [ ] Assert that removing the production scope and conflict checks causes the adapter tests to fail. Keep every new action label, role, test id, route, and sidebar assertion aligned with the r19 reference.
- [ ] Compare screenshots to frozen r19 at 1728 by 1117 and 1440 by 900 in light and dark modes. Use referenceWorkspace: true; do not edit or regenerate the frozen reference package.

## Task 6: Focused validation, commits, and hosted gate

**Files:** W11 code, tests, and this plan.

- [ ] Run focused unit tests, Biome on changed files, TypeScript, and pnpm check:px-text one command at a time. Do not run full local CI or a full workspace Cargo build.
- [ ] Run pnpm build:e2e, then w11-clients-work.spec.ts and every affected existing spec one at a time inside mcr.microsoft.com/playwright:v1.60.0-noble with Docker --cpus=2.
- [ ] Grep changed labels and test ids across desktop/tests/e2e, desktop/src/**/*.test.*, and mobile/test. Update dependent tests in the same commit series.
- [ ] Activate Hermit before Git operations. Commit each coherent implementation step with git commit -s. Push only after local focused checks and visual comparison pass.
- [ ] Open a draft PR against codex/phase2-integration, document supported contract behavior and NEEDS_API items, then poll its GitHub checks until every check finishes green. Never use gh auth commands.

## NEEDS_API and NEEDS_DESIGN

Keep these states explicit in the PR report:

- NEEDS_API: Standalone client create needs atomic, idempotent private-channel, PartyHead, and ClientHead provisioning.
- NEEDS_API: Contact, industry, brand facts/assets, client brief, service scope, retainer recurrence, onboarding checklist, email invite and expiry, work brief/deadline/budget/spend/dependency, custom acceptance checklist, completion evidence, and archive cascade.
- NEEDS_API: Client archive must pause active work in the same recoverable server operation. Until that exists, do not report the designed pause behavior as implemented.
- NEEDS_DESIGN: The frozen reference has no blocked-archive recovery state or retry state for a partially provisioned standalone client. Do not invent those screens or copy.
- Scope note: clients/access is also assigned to W16 in the route inventory. W11 may show existing client-channel membership and approver data. Email portal invitation remains W16 and NEEDS_API.

## Self-review

- Client list, supported client overview, access membership review, work list, board, detail, deliverable versions, feedback, review, and exact-version approval have dedicated tasks.
- Relay scope, permissions, concurrent edits, archive boundaries, and no-fallback routing have production-seam tests.
- Chat and dedicated UI share one relay head through an addressable record reference.
- All unsupported r19 fields and side effects are listed rather than serialized into another record.
- The current ClientAction create path is excluded until provisioning can be retried without orphaning or duplicating client channels.
