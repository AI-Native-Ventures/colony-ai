# Colony company record contracts

Status: company layer batch 1 contract (Asks, Goals) plus the batch 2 company
work item contract. Schema version: `1`. Design baseline:
`docs/superpowers/plans/2026-09-24-phase-2-handoff/20260927-company-v7/`
(approved 27 September 2026) and owner decisions C1 to C6 and D1 to D3.

Company records follow the brokered pattern of [business records](business-records.md):
a member signs a command event, the relay validates scope, content and authority,
stores the command, and emits a relay-signed replaceable head in the same
transaction. Typed content rejects unknown fields so an older relay fails closed
on a future schema. All property names are camel case. UUIDs are lowercase
canonical strings. Event IDs and pubkeys are 64 lowercase hex characters.
Timestamps are RFC 3339 UTC strings. Every request carries `schemaVersion: 1`.

Nothing in these records is derived from the design prototype's fixtures. Record
identity is the UUID chosen at create time and never changes through updates.

## Kind registry

The same integers are registered in `crates/buzz-core/src/kind.rs`, exposed by
`crates/buzz-sdk`, mirrored in `desktop/src/shared/constants/kinds.ts`, and
mirrored in `mobile/lib/shared/relay/nostr_models.dart`.

| Kind | Name | Write status |
| ---: | --- | --- |
| 30642 | Goal head | Relay signed, replaceable |
| 30643 | Ask head | Relay signed, replaceable |
| 30634 | Shared work item head | Relay signed, replaceable |
| 47031 | Goal action | Brokered |
| 47032 | Ask action | Brokered |
| 47033 | Ask response | Brokered, append only |
| 47006 | Shared work item action | Brokered |

## Scope and storage

- **Goals are community-wide.** Goal commands and heads carry no `h` tag. The
  kinds are global-only (`is_global_only_kind`), so every authenticated member
  of the community can read them and channel-scoped tokens cannot write them.
  The d-tag is `company:goal:<goal-uuid>`. The relay resolves the community
  from the host. Goal commands are brokered by their own handler, not the
  business-record broker, which requires a channel.
- **Asks are channel-scoped.** Ask commands carry exactly one `h` tag (the
  channel of the thread) and one d-tag
  `channel:<channel-uuid>:ask:<ask-uuid>`. Reading follows channel access.
- **Asks sit in their thread.** The asker-signed `create` action (kind 47032)
  carries NIP-10 `e` tags to the thread root and is stored with thread
  metadata inside the broker transaction, so it takes its place in the thread,
  counts as a reply and is fanned out like a message. Kind 47032 joins the
  desktop and mobile thread timeline kinds; a `cancel` action is stored without
  thread metadata and never appears as a timeline item. The card renders the
  current kind 30643 head looked up by d-tag, so resolution updates the card in
  place. There is no relay-authored message in the thread.
- **Heads are relay-signed** with the relay keypair and replace by (community,
  kind, relay pubkey, d-tag), exactly like business heads. Clients reject heads
  not signed by the relay.
- **Agent detection** for authority uses the authorization-grade account
  record (`users.agent_owner_pubkey`), never a client-supplied tag.
- **Search:** company kinds are excluded from full-text search (ask bodies and
  answers can be sensitive).

## Authority

Owner decision D2 (27 September 2026):

- **Humans with authority** are community owners and admins. Only they may
  resolve asks whose `category` is `money`, `hire`, `tool` or `secret`, and
  agents never may.
- An ask with an `addresseePubkey` and category `general` may be resolved by
  that addressee. An agent addressee may resolve only `question` and `verdict`
  asks; `approval`, `choice` and `checklist` asks addressed to an agent are
  rejected at create time.
- An ask with no addressee and category `general` may be resolved by any human
  member of the ask's channel.
- Managers resolving asks for their direct reports is reserved until reporting
  lines exist (company layer batch 3). The `resolverPolicy` value `manager` is
  rejected until then.
- Goal authority: community owners and admins create root goals and may edit,
  archive, restore, mark achieved or delete any goal. A goal's owner may edit
  it, record progress, mark it achieved and create sub-goals under it.
  Sub-goals created by a manager for their team arrive with reporting lines.

A viewer without authority sees the ask or goal with a reason ("Only company
owners and admins can decide spending"), never an enabled control that fails on
submit.

## Asks

An ask is a card posted into a channel thread that needs an answer. It is not a
workflow, a ticket or a notification; it lives in the conversation where the need
came up.

### Ask action, kind 47032

`AskAction` fields: `askId`, `action`, `expectedHeadEventId`, and `ask`
(create only) or `reason` (cancel).

- `action` is `create` or `cancel`. Create omits `expectedHeadEventId`; cancel
  names the exact current head.
- `ask` contains:
  - `schemaVersion`, `askId`
  - `type`: `approval`, `question`, `choice`, `checklist`, or `verdict`
  - `category`: `general`, `money`, `hire`, `tool`, or `secret`
  - `title` (1 to 180 characters) and optional `body` (markdown, up to 4000)
  - `threadRootEventId`: the root of the thread the card belongs to
  - optional `addresseePubkey`
  - optional `decideBy` timestamp
  - `options` for `choice` (2 to 8 items of `{ id, label }`), `items` for
    `checklist` (1 to 20 items of `{ id, label }`), omitted otherwise
  - optional `subject`: `{ kind: "goal" | "workflowRun" | "workItem", id }`
- The asker is the signer. Any human member or managed agent of the channel may
  create a `general` ask. `money`, `hire`, `tool` and `secret` asks may be
  created by members and agents but only resolved per [Authority](#authority).
- Cancel is allowed to the asker and to owners and admins while the ask is open,
  and requires a `reason`.

The relay emits kind 30643 `AskHead`: every create field plus `askerPubkey`,
`status` (`open`, `resolved`, `cancelled`), `createdAt`, the optional
`resolution`, `sourceActionEventId` and `h` and `e` tags for the channel and
thread root.

**Overdue is derived, never stored:** an ask is overdue while it is `open` and
`decideBy` is in the past. Nothing is applied automatically when an ask becomes
overdue; it stays open and keeps its deadline.

### Ask response, kind 47033

`AskResponse` fields: `schemaVersion`, `askId`, `expectedHeadEventId`,
`outcome`, and the outcome's payload:

| Ask type | `outcome` | Required payload |
| --- | --- | --- |
| approval | `approved`, `rejected`, `revision_requested` | `reason` (1 to 1000 characters) |
| question | `answered` | `answer` (1 to 4000 characters) |
| choice | `chosen` | `optionId` from the ask's options |
| checklist | `confirmed` | `checkedItemIds` equal to every item id |
| verdict | `pass`, `fail` | `reason` (1 to 1000 characters) |

The response must name the exact current head, the ask must be `open`, and the
signer must satisfy [Authority](#authority). The relay stores the response and
advances the head to `resolved` with `resolution` `{ outcome, payload,
resolvedByPubkey, resolvedAt, responseEventId }` in one transaction. A second
response to a resolved ask is rejected with the current head so the client can
show who resolved it and when.

A failed submission changes nothing. Clients keep the typed payload and offer
retry.

### Workflow approvals

Existing workflow approvals (kinds 46010 to 46012 and 46030/46031, table
`workflow_approvals`) remain the workflow engine's contract. Clients present an
open workflow approval addressed to the viewer as an `approval` ask in Needs me
and resolve it with the existing `grant_approval` / `deny_approval` commands,
so there is one approval inbox. The workflow engine does not write kind 30643.

### Needs me

Needs me lists, for the signed-in user, open asks where the user is the
addressee or, for asks without an addressee, where the user has authority to
resolve them, plus open workflow approvals addressed to them. It is sorted by
`decideBy` (earliest first, asks without a deadline last), marks overdue asks,
groups by channel when there are many, and links each row to its thread.

## Goals

Goals are company-wide. Every goal has a done condition in plain words.
The d-tag is `company:goal:<goal-uuid>`; the relay resolves the community from
the host and scopes records there. Clients do not include a community UUID in
goal coordinates.

Reaching a numeric target or completing linked work never changes goal status.
Only a person selecting `achieved` in an explicit progress or status action can
mark a goal achieved.

NEEDS_API: There is no authoritative company profile record for a mission yet.
Goals do not display a mission line until that record exists.

### Goal action, kind 47031

`GoalAction` fields: `goalId`, `action`, `expectedHeadEventId`, and the
action's payload:

| `action` | Payload | Rule |
| --- | --- | --- |
| `create` | `goal` | Root goal: owner or admin. Sub-goal: owner, admin, or the parent's owner. |
| `update` | `goal` | Owner, admin, or the goal's owner. |
| `progress` | `progress`; optional `status` | Owner, admin, or the goal's owner. `evidence` required. A selected status is saved in the same head update as progress. |
| `set_status` | `status`, `reason` | `active`, `off_pace` or `achieved`. Owner, admin, or the goal's owner. |
| `archive` | optional `reason` | Owner, admin, or the goal's owner. A supplied reason must be non-empty and at most 1000 characters. Sub-goals stay active. |
| `restore` | none | Owner or admin. Restores to `active`. |
| `delete` | optional `reason` | Owner or admin. A supplied reason must be non-empty and at most 1000 characters. Rejected while the goal has non-deleted sub-goals or linked work; the error lists them. |

`goal` contains `schemaVersion`, `goalId`, optional `parentGoalId`, `title`
(1 to 180 characters), `ownerPubkey`, optional `dueDate` (`YYYY-MM-DD`),
`doneCondition` (1 to 1000 characters), optional `target`
`{ value, unit }` (value is a decimal string, unit 1 to 24 characters and
required with a value), and `linkedChannelIds`.

`progress` contains `current` (decimal string, required when the goal has a
target), `evidence` (1 to 2000 characters) and optional `evidenceRefs` (event
IDs or `buzz://` links).

Rules enforced by the relay:

- A parent must exist, be in the same community and not be deleted.
- Changing `parentGoalId` must not create a cycle; the relay walks the parent
  chain under the goal-tree lock.
- `create` and `update` never set `status`. `progress` may carry an explicit
  `status` with its required evidence, and the progress and status are persisted
  together in one head update. `set_status` changes status without recording
  progress and requires a reason. Nothing marks a goal achieved automatically.

The relay emits kind 30642 `GoalHead`: the `goal` fields plus `status`
(`active`, `off_pace`, `achieved`, `archived`, `deleted`), the latest
`progress` with `recordedByPubkey` and `recordedAt`, `sourceActionEventId`, and
a `history` pointer (the relay keeps every action event; the head does not
inline history). A deleted goal keeps a minimal head (`goalId`, `title`,
`status: deleted`) so references render "Deleted goal" instead of failing.

### References in conversation

A goal reference is the link `buzz://goal/<goalId>`. The composer inserts it as
a chip (the same mechanism as existing `buzz://message`, `pr` and `project`
links) and messages render it as a card that opens that exact goal, sub-goals
included. A reference to a deleted goal renders the deleted marker; a reference
the viewer may not read renders "Goal unavailable".

## Company work items

Company work items are commitments inside conversations. They use the same
work item head and action kinds as client work (30634 and 47006); they do not
create a second work record. Client work keeps its `clientId` field and
`client:<channel-uuid>:work:<work-item-uuid>` coordinate.

Company work uses `company:work:<work-item-uuid>`. The relay derives the
community from the host, as it does for goals. Each company work head and
action has exactly one `h` tag containing the channel UUID where the commitment
lives. The `h` tag controls channel access. Moving an item to another
conversation changes `threadRootEventId`, never `workItemId` or the `d` tag.

The company work head contains the shared work item fields `schemaVersion`,
`workItemId`, `title`, `status`, `assignedPubkeys`, `approverPubkeys`, and
`deliverables`, plus `requesterPubkey`, `doneCondition`, optional `goalId`,
`sourceEventId`, optional `threadRootEventId`, `evidence`, and
`sourceActionEventId`. `sourceEventId` is the original message when the item is
created from a conversation. When the item is created from the approved
standalone Work form, `sourceEventId` and `threadRootEventId` are absent because
that form selects a conversation but has no source-message or thread picker.
If a chat message is the source, both values are required and the relay checks
that the source and thread are in the tagged channel. Once set, `sourceEventId`
is immutable. `threadRootEventId` may change when the item moves to another
thread.

An optional `goalId` must resolve to a non-deleted, non-archived goal in the
same community. Goal deletion is refused while any company work head still
references that goal, including an archived work item. The work form filters
out archived and deleted goals.

Company work statuses are `active`, `paused`, `blocked`, `done_unverified`,
`done_verified`, and `archived`. The assigned owner may set an item to
`active`, `paused`, `blocked`, or `done_unverified`. A status action cannot set
`done_verified`. Verification is a distinct action against the exact current
head. It is allowed to a community owner or admin, or to the item's requester,
and requires `verdict` (`pass` or `revision_requested`), a non-empty `reason`,
and non-empty evidence. `pass` sets `done_verified`; `revision_requested`
returns the item to `active`. The relay records the signed reviewer and the
verification evidence on the next kind 30634 head.

Company work actions require channel membership and an exact current head for
every action except create. The relay stores the member action and emits the
relay-signed kind 30634 head in one transaction. Client work validation and
W11 behavior remain unchanged.

## Proof boundaries

This document is the batch 1 contract. Kind registration, typed content and
validation live in `buzz-core` with unit tests. The relay brokers, desktop
screens and mobile follow in the batch 1 lanes, each with its own proof gates:
relay integration tests for authority and exact-head races, desktop E2E
journeys with reload and community switching, and visual comparison against the
approved baseline routes.
