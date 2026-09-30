# Duties and Lessons implementation plan

Status: approved implementation slice for DUTY-1 followed by LESSON-1.
Contract: [company-records.md](../../company-records.md#duties) and its
Lessons section. Binding visual references are the read-only 20260927-company-v7
and 20260928-company-v8 packages in the external Phase 2 handoff.

## Acceptance gates

### Gate 1: record and authority contract

- Register kinds 30655/47044 for duties and 30656/47045 for lessons in Rust,
  desktop, and mobile.
- Validate typed payloads, namespaced d-tags, global scope, relay-only heads,
  and command kinds.
- Pass pure unit tests for schedule parsing, lesson validation, and authority.

### Gate 2: duties use the existing workflow engine

- Duty proposals travel through the existing channel ask lane and require an
  owner or admin decision.
- A successful approval creates the duty head and versioned workflow
  definition in one transaction. Rejection or a failed write creates neither.
- A duty has exactly one employee owner. Updates use exact-head checks. Pause,
  resume, and delete update the engine and duty head atomically.
- Next run is computed from the persisted recurrence and IANA timezone. Missed
  schedule occurrences coalesce into one real engine run with accurate skipped
  count and interval in its persisted trigger context.
- Relay integration coverage exercises invalid payloads, authority, conflict,
  rollback, and the injected-clock catch-up path.

### Gate 3: lessons and CLI

- Lesson evidence references resolve to real community events. Evidence count,
  confidence, and helpful/harmful counts come only from recorded data.
- Approval actor/time are persisted, an edit returns a lesson to candidate,
  and owners/admins approve all lessons while no approved sensitivity control
  exists.
- CLI commands create, inspect, update, approve, deprecate, and restore lessons
  and duties. The CLI inventory test covers the new surfaces. The existing
  memory command and kind 30174 remain unchanged.

### Gate 4: desktop profile journey

- Replace the current Duties and Lessons placeholder panels in place, preserve
  the frozen layout and existing Memory section, and load records from relay
  events.
- The duty journey covers propose, resolve, inspect, edit, pause/resume, delete,
  run history, and reload. The lesson journey covers propose, inspect, edit,
  approve, deprecate, and reload.
- Update every dependent test assertion in the same change series. No mock
  record becomes a shipped default.

### Gate 5: delivery proof

- Run only the allowed quick local checks and the affected focused tests.
- Push the branch, open an early draft PR against codex/phase2-integration, and
  treat hosted GitHub CI as the Rust, full desktop, and mobile integration gate.
- Finish only when checks for the current head SHA are green. Report implemented,
  locally tested, visually compared, CI head SHA, and any NEEDS_DESIGN or
  NEEDS_API items as separate evidence.

## Scope and constraints

- Do not change the frozen handoff or its example records.
- Use the existing WF-2 versioned definitions, exact-version approvals, run
  table, and schedule engine. Do not create another scheduler.
- Keep workflow permissions effective for every duty run. The employee owner
  field is assignment only and grants no tools, spend, secrets, or channel
  authority.
- Keep lesson memory separate from structured lessons. No relay or client
  heuristic learns from activity.
- The frozen lesson form lacks controls for confidence and evidence assessment.
  Store explicit API values and show unassessed values honestly. Do not add UI
  controls before a frozen design exists.
- The frozen duty editor has no timezone control. Use the signed-in account's
  configured timezone, require a valid value, and never copy the reference's
  Johannesburg timezone or schedule examples into defaults.
- Do not use em dashes in code, copy, documentation, commits, or reports.
