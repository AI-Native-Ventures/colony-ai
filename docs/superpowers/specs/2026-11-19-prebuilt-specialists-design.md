# Prebuilt specialists from map jobs

## Context and product fit

The approved S2 boards extend the released prebuilt-head flow: every map job
has one honest doer, in this order: its specialist, the part head, then Scout.
The design preserves Colony's signed company-record model and makes the map a
safe place to begin hiring. It advances the product vision by turning an
abstract role into a visible colleague with one clear first action.

The approved boards are the design decision for this slice. The coordinator
also instructed workers not to pause for routine choices, so the decisions
below are recorded here rather than sent back for another review.

## Decision

Use a new, additive company-job record family instead of adding fields to
function slots or storing a browser-only assignment.

- `30682` is an addressable job head. Its `d` tag is
  `company:job:<function-id>:<stable-job-id>`.
- `47071` is a signed job command. It supports `assign`, `clear`, and
  `hire_set` actions.
- Stable job ids are derived once from the approved specialist ids by removing
  the `prebuilt-` prefix, for example `prebuilt-follow-ups` becomes
  `follow-ups`. A unit test freezes every mapping against `agents.json`.
- A distinct job-hire intent head uses
  `company:job-hire:<hire-id>`. The completion transaction consumes it and
  writes the job assignment in the same database transaction as the employee
  hire.

This avoids changing the existing closed `FunctionHead`, `FunctionAction`, and
access-record schemas. Older desktop builds ignore unknown kinds, while older
relays receive no new command because the new desktop checks the NIP-11
`colony-job-assignments` extension first.

## Relay behavior

Only the same owner or administrator who may assign a part lead may send a job
command. Assignment validates that the assignee is an active company member or
registered employee. A per-job advisory lock and expected-head comparison make
replacement and clearing deterministic.

The relay owns all cleanup. Pausing or terminating an employee clears both
their function slots and job assignments in the existing transaction. Archive,
leave, and administrative removals use the same reconciliation path that clears
inactive function heads. Job hire intent completion, job assignment, and the
employee's first position are one transaction.

When a prebuilt specialist completes, the relay resolves its manager from the
live part head, otherwise the proposed Scout manager. When a part head
completes, the relay updates each active specialist in that part to report to
the new head in the same completion transaction. When a head is removed, the
relay reparents its specialists to the head's previous manager, which is Scout
for the prebuilt-head flow; an absent predecessor manager becomes no manager
rather than a fabricated identity.

The release note is: "Relay support for signed per-job specialist assignments,
including atomic hire intent completion and automatic cleanup when a company
member leaves or is paused."

## Desktop behavior

The desktop loads job heads independently from function slots and applies one
pure function everywhere: specialist, then head, then Scout. The map desktop,
phone presentation, Function screen, and part-card copy share that result.

Opening a job keeps the established map canvas window. A left-edge ownership
pill is placed below the top edge, clear of both the close control and the
ringed job marker on left and right windows. It toggles an anchored spot card.
The no-screen job card renders the same spot-card content inline. The phone
map uses a compact ownership line because its job sheet has no safe equivalent
of the desktop window edge.

The spot card gives owners the appropriate prebuilt hire, open, message, and
confirmed remove actions. It gives members a read-only view. Calls remains
clearly unavailable using the approved reason, with no hire action. The
existing S1 dialog becomes a generic prebuilt-hire dialog, retaining the three
remembered AI choices and one-action progression. Specialist proposals use the
approved `firstMessage`, include the job-hire intent, title the employee by
job, and use the live head or Scout as manager.

## Compatibility and safety

Against a relay without the NIP-11 extension, the current app renders the
specialist spot as clearly unavailable: "Specialist hiring needs a relay
update." It sends no job commands and does not fail the surrounding map. An
old app sees only its known function and member records. An old relay sees no
unknown event from a new app until it advertises support.

The wire types deny unknown fields within their new family, but existing wire
types are untouched. Tests feed new job events to old function and access
parsers, then feed an empty old-relay query result to the new job parser.

## Deliberate scope boundaries

The slice omits Make your own, Add a job, Tell me when it is ready, Needs you,
Budget, Operations stages, and Settings rows. It does not invent sample names,
money, or non-approved specialist copy. Operations has no specialist records
and therefore receives no specialist offer.
