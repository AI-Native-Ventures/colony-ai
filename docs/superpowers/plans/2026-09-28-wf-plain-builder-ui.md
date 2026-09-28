# Colony Plain Workflow Builder Implementation Plan

> **For agentic workers:** Execute this plan inline in the authorized WF-1 slice. Keep the frozen company v7 reference read-only.

**Goal:** Implement the frozen plain-language workflow builder on top of the versioned workflow engine, preserving active versions until explicit publication.

**Architecture:** Add a typed plain-workflow model that converts only supported schedule, agent, and approval concepts to and from engine definitions. Add Tauri draft, publish, lifecycle, and dry-preview commands, then mount a route-addressable builder in the existing Workflows surface. Keep the technical editor behind an admin-only Advanced action and treat definitions the mapper cannot express as read-only.

**Tech Stack:** React 19, TanStack Router, Tauri commands, Rust Nostr event builders, `buzz-workflow` preview, Playwright, Vitest/Node unit tests.

---

## Files and responsibilities

- `desktop/src/features/workflows/ui/plainWorkflowModel.ts`: supported plain model, deterministic schedule conversion, engine mapping, and unsupported detection.
- `desktop/src/features/workflows/ui/plainWorkflowModel.test.mjs`: falsifiable mapping tests in both directions.
- `desktop/src-tauri/src/events/workflows.rs`: signed kind:30623 draft, kind:30620 publish, and kind:46021 lifecycle event builders.
- `desktop/src-tauri/src/commands/workflows.rs`: query and save drafts, publish a draft, pause or resume, and invoke pure engine preview.
- `desktop/src-tauri/src/lib.rs`: register the new commands.
- `desktop/src/shared/api/tauriWorkflows.ts` and `workflowTypes.ts`: typed frontend wire APIs for the versioned operations.
- `desktop/src/features/workflows/ui/PlainWorkflowBuilder.tsx`: reference-aligned plain create, edit, preview, activation review, detail, and pause screens.
- `desktop/src/app/routes/workflows.tsx`, `workflows.$workflowId.tsx`, and `WorkflowsRouteScreen.tsx`: address builder states without changing AppSidebar.
- `desktop/tests/e2e/workflows.spec.ts` and a focused workflow builder spec: update old editor journeys and cover the new smoke and integration journeys.
- `crates/buzz-workflow/README.md`: document the builder-supported schema where clarification is needed.

## Task 1: Plain model and mapping tests

Add a model for blank/example workflows, weekly/daily/manual timing, channel, and ordered agent/approval steps. Convert local Johannesburg time to the engine's UTC schedule. Reject unsupported trigger and action shapes instead of silently dropping fields. Test both round trips, daylight-independent UTC conversion, and `canExpress` failure for webhooks, filters, conditions, and unsupported actions.

Run: `cd desktop && pnpm exec tsx --test src/features/workflows/ui/plainWorkflowModel.test.mjs`

## Task 2: Versioned Tauri workflow API

Add focused event builders and Tauri commands for reading and saving kind:30623 drafts, publishing the draft as kind:30620 with the current active revision fence, pausing or resuming via kind:46021, and calling `buzz_workflow::executor::preview_workflow` without an action sink. Preserve the active event when a draft is edited. Add command helper tests for event tags and stale active revisions. Register every command explicitly.

Run: `CARGO_BUILD_JOBS=4 cargo test --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --features electron-host workflows`

## Task 3: Plain builder create and edit screens

Replace the normal create/edit entry with the route-addressable plain flow from the frozen reference. Support the designed blank/example choice, workflow name and description, weekly/daily/manual start choices, day/time/channel, and ordered `ask_agent` and `request_approval` steps. Chips open the selected member profile. Do not add an event trigger, social scheduling action, requested-changes loop, or a generic human task where no supported design/API exists.

Run the focused desktop typecheck and workflow mapping tests before continuing.

## Task 4: Preview, review, publication, and lifecycle

Render the labelled sample outcomes from engine preview data and never send side effects. Require the designed review confirmation before publication. After publication, keep edits in the separate draft, expose the active version in detail, and publish draft changes only through the review step. Pause and resume through the status command while retaining the active definition. Add mutation failure states that preserve the draft.

## Task 5: Advanced editor and unsupported workflow handling

Gate Advanced behind the actual relay owner/admin role. Route supported workflows to the existing technical editor only from that action. Keep workflows that fail plain mapping read-only and state why the plain builder cannot represent them. Update existing workflow tests that depend on editor labels or entry points.

## Task 6: Acceptance evidence

Update Playwright mock-bridge journeys for create from example, edit/reorder/remove, preview, review and activate, pause, and live draft edit without active-version mutation. Run the affected smoke and integration specs in the prescribed Playwright Linux image with two CPUs, one run at a time, including `pnpm build:e2e`. Run the real-relay workflow journey and compare the frozen v7 routes at 1728x1117 and 1440x900 in light and dark themes. Verify keyboard operation for every control, including step reordering. Push only after focused local checks pass, then wait for every hosted PR check to pass.
