# Colony company record contracts

Status: company layer batches 1, 2, and 3 contract (Asks, Goals, Company Work,
and member positions), PERM-1 standing tool permissions, secret bindings,
FACTORY-1 Factory run preview and pull request records, HIRE-1 employee hiring,
WORK-2 company work tracking APIs, DUTY-1 employee duties, LESSON-1
employee lessons, and co-founder mode settings and function slots.
Schema version: `1`. Goals, asks, work, permissions, and member positions
follow design baseline
`docs/superpowers/plans/2026-09-24-phase-2-handoff/20260927-company-v7/`
(approved 27 September 2026) and owner decisions C1 to C6 and D1 to D3.
Secret bindings follow Gap 5 in
`docs/superpowers/plans/2026-09-24-phase-2-handoff/20260928-company-v8/` and
its embedded 20260926-r19 route reference.

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

| Kind | Name | Write status | Owner |
| ---: | --- | --- | --- |
| 30634 | Shared work item head | Relay signed, replaceable | Company work |
| 30642 | Goal head | Relay signed, replaceable | Company goals |
| 30643 | Ask head | Relay signed, replaceable | Company asks |
| 30646 | Tool permission head | Relay signed, replaceable | Tool permissions |
| 30647 | Secret binding head | Relay signed, replaceable | Secrets |
| 30648 | Member position head | Relay signed, replaceable | Company team |
| 30649 | Factory run preview and pull request head | Relay signed, replaceable | Software Factory |
| 30650 | Hire head | Relay signed, replaceable | Company hiring |
| 30651 | Employee configuration revision head | Relay signed, replaceable | Company team |
| 30652 | Company work tracking head | Relay signed, replaceable | Company work |
| 30653 | Employee AI allowance head | Relay signed, replaceable | AI spend |
| 30654 | AI spend record head | Relay signed, replaceable | AI spend |
| 30655 | Employee duty head | Relay signed, replaceable | Company duties |
| 30656 | Employee lesson head | Relay signed, replaceable | Employee lessons |
| 30670 | Co-founder settings head | Relay signed, replaceable | Co-founder mode |
| 30671 | Function slot head | Relay signed, replaceable | Co-founder mode |
| 30672 | Worker run head | Relay signed, replaceable | Worker runs |
| 30673 | Plan head | Relay signed, replaceable | Co-founder plans |
| 30677 | Playbook and running copy head | Relay signed, replaceable | Co-founder playbooks |
| 30676 | Access, capability gap and slot hire head | Relay signed, replaceable | Co-founder mode |
| 30674 | Business brief head | Relay signed, replaceable | Co-founder onboarding |
| 30675 | Co-founder onboarding head | Relay signed, replaceable | Co-founder onboarding |
| 30678 | Scorecard, function goal and weekly review head | Relay signed, replaceable | Co-founder numbers |
| 47006 | Shared work item action | Brokered | Company work |
| 47031 | Goal action | Brokered | Company goals |
| 47032 | Ask action | Brokered | Company asks |
| 47033 | Ask response | Brokered, append only | Company asks |
| 47035 | Tool permission action | Brokered | Tool permissions |
| 47036 | Secret binding action | Brokered | Secrets |
| 47037 | Member position action | Brokered | Company team |
| 47038 | Factory run preview and pull request action | Brokered | Software Factory |
| 47039 | Hire action | Brokered | Company hiring |
| 47040 | Employee configuration revision action | Brokered, append only | Company team |
| 47041 | Company work tracking action | Brokered | Company work |
| 47042 | Employee AI allowance action | Brokered | AI spend |
| 47043 | AI spend record action | Brokered | AI spend |
| 47044 | Employee duty action | Brokered | Company duties |
| 47045 | Employee lesson action | Brokered | Employee lessons |
| 47060 | Co-founder settings action | Brokered | Co-founder mode |
| 47061 | Function slot action | Brokered | Co-founder mode |
| 47062 | Worker run action | Brokered | Worker runs |
| 47063 | Plan action | Brokered | Co-founder plans |
| 47067 | Playbook and running copy action | Brokered | Co-founder playbooks |
| 47066 | Access, capability gap and slot hire action | Brokered | Co-founder mode |
| 47064 | Business brief action | Brokered | Co-founder onboarding |
| 47065 | Co-founder onboarding action | Brokered | Co-founder onboarding |
| 47068 | Scorecard refresh, goal and weekly review action | Brokered | Co-founder numbers |

The Factory run record contract is in
[`factory-run-records.md`](factory-run-records.md). It extends the company
record broker without changing the native Factory run, transcript, or working
copy store.

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
- **Member positions are community-wide.** Commands and heads carry no `h`
  tag. The relay resolves the community from the host. The d-tag is
  `company:member:<pubkey>`. A position head is keyed by member pubkey.
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
- **Tool permissions are community-wide.** Permission commands and heads carry
  no `h` tag and are scoped by the relay host. The head has one `p` tag naming
  the managed agent. The d-tag is `company:permission:<permission-uuid>`.
- **Agent detection** for authority uses the authorization-grade account
  record (`users.agent_owner_pubkey`), never a client-supplied tag.
- **Search:** company kinds are excluded from full-text search (ask bodies,
  answers and secret binding metadata can be sensitive).

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
- A human direct manager may resolve an addressed general approval ask for
  their report once the member position head establishes the reporting line.
  Agent managers cannot resolve approval asks. Owner and admin authority stays
  available for every member proposal.
- Goal authority: community owners and admins create root goals and may edit,
  archive, restore, mark achieved or delete any goal. A goal's owner may edit
  it, record progress, mark it achieved and create sub-goals under it.
  Sub-goals created by a manager for their team arrive with reporting lines.

- **Member position authority:** community owners and admins may directly change
  titles, reporting lines, and employee lifecycle state. Other members can
  propose a change through an approval ask. A human direct manager may resolve
  an approval ask for their report; an agent manager cannot approve it. A
  proposal does not change the member head until the ask and member head update
  commit in one relay transaction.
- **Standing permission authority:** only community owners and admins may grant,
  edit or revoke tool permissions. Tool consent asks authorize one call after
  approval and do not create a standing permission.

A viewer without authority sees the ask or goal with a reason ("Only company
owners and admins can decide spending"), never an enabled control that fails on
submit.

## Standing permissions

A standing permission allows one managed agent to perform one always-ask action
inside one exact scope until a UTC expiry time. The relay stores every grant,
scope or expiry edit, and revoke as a member-authored command and advances a
relay-signed replaceable head in the same transaction. Permissions are
community-scoped and are never inferred from client state.

The allowed actions are `spend_money`, `message_outsider`, `delete_data`, and
`publish_publicly`. The scope is exactly one of:

| Scope kind | `id` value | Match rule |
| --- | --- | --- |
| `thread` | 64 lowercase hex event id | Exact canonical NIP-10 thread root |
| `channel` | Lowercase canonical channel UUID | Exact channel |
| `customer` | Lowercase canonical customer UUID | Exact customer record id supplied by the tool request |

Customer display names never match by substring or fuzzy search. A tool request
without enough context to produce an exact scope does not match a standing
permission. An expired or revoked head never authorizes a call. Reads are
community-scoped; only owners and admins can grant, edit or revoke.

### Permission action, kind 47035

`ToolPermissionAction` fields: `schemaVersion`, `permissionId`, `action`,
`expectedHeadEventId`, and `permission` (grant or update) or `reason` (revoke).

- `grant` omits `expectedHeadEventId` and creates a new permission id.
- `update` names the exact current head and changes only `scope` and
  `expiresAt`; the managed agent and action are immutable.
- `revoke` names the exact current head and requires a reason. It retains the
  head with status `revoked` for audit.
- The `permission` payload contains `schemaVersion`, `permissionId`,
  `agentPubkey`, `action`, `scope: { kind, id }`, and `expiresAt`.
- `action` is an exact label or stable key, 1 to 180 characters. Sensitive
  actions use the stable keys `spend_money`, `message_outsider`,
  `delete_data`, and `publish_publicly`. Other exact action labels can be
  listed and edited, but they do not widen the harness's always-ask classifier.
- `expiresAt` is an RFC 3339 UTC timestamp later than command acceptance.
  Expiry is derived from the timestamp and does not require a scheduled write.
- The caller must be a community owner or admin and must not use a
  channel-scoped token. Every mutation locks the exact community, relay signer,
  kind and d-tag head coordinate, checks the expected event id, and stores the
  command plus relay-signed head atomically.

The relay emits kind 30646 `ToolPermissionHead` with the permission fields,
`status` (`active` or `revoked`), `grantedByPubkey`, `changedByPubkey`,
`updatedAt`, and `sourceActionEventId`. A permission is effective only when its
status is `active`, its expiry is in the future, its agent and action match,
and its scope matches exactly. Clients and the ACP harness query the current
relay head for each tool call, so a revoke applies to the next call without a
local cache invalidation window.

## Employee configuration history

Employee configuration history is community-wide and append-only. The relay
stores every kind 47040 member action and advances one kind 30651 relay-signed
head per employee in the same transaction. Its d-tag is
`company:employee-history:<employee-pubkey>`. Each action carries that same
d-tag and one `p` tag for the employee. Neither kind carries an `h` tag.

The typed snapshot is an explicit allowlist containing only `instructions`,
`provider`, `model`, and `runtime`. Instructions are limited to 20,000
characters. Provider, model, and runtime identifiers are each limited to 256
characters. The schema rejects unknown fields. Private keys, auth tags,
environment variables, backend configuration, permission records, secret
binding metadata, and secret values are never part of a snapshot.

A `record` action contains `schemaVersion`, `employeePubkey`, `action`,
`expectedHeadEventId`, `previousRevisionEventId`, `before`, and `after`. The
expected head and prior revision are omitted only when no revision head exists.
The `before` snapshot must exactly match the current head when one exists.
`undoOfEventId` is omitted for a record action.
An `undo` action contains those fields plus `undoOfEventId`, the event id of
the earlier action being reverted. Its `after` snapshot must equal that
action's `before` snapshot. The prior revision event id links each immutable
action to its predecessor so clients can reconstruct order independent of
client clocks. Undo never edits or deletes an earlier event; it stores a new
action and head.

The head contains `schemaVersion`, `employeePubkey`, `revisionEventId`,
`previousRevisionEventId`, `snapshot`, `actorPubkey`, `updatedAt`, and
`sourceActionEventId`. Revision event ids are the signed kind 47040 event ids.
The actor is the authenticated action signer. `updatedAt` is relay acceptance
time in RFC 3339 UTC. Readable actor and time values for older revisions come
from their immutable signed action events.

Only a community owner, admin, or the employee's direct manager in the current
member-position head may record or undo a revision. A direct manager must be an
active human member. The target must have a current employee position. Every
write locks the company member tree and employee history coordinate, checks
authority and the exact expected head, then stores the action and replaces the
head atomically. History is excluded from full-text search.

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
  - `type`: `approval`, `tool_consent`, `question`, `choice`, `checklist`, or
    `verdict`
  - `category`: `general`, `money`, `hire`, `tool`, or `secret`
  - `title` (1 to 180 characters) and optional `body` (markdown, up to 4000)
  - `threadRootEventId`: the root of the thread the card belongs to
  - optional `addresseePubkey`
  - optional `decideBy` timestamp
  - `options` for `choice` (2 to 8 items of `{ id, label }`), `items` for
    `checklist` (1 to 20 items of `{ id, label }`), omitted otherwise
  - optional `subject`: `{ kind: "goal" | "workflowRun" | "workItem" | "companyMember", id }`
  - optional `memberProposal`: an exact-head `MemberPositionAction`, only for
    an approval ask whose subject is the same company member
  - `toolConsent` for `tool_consent`: `{ action, actionPreview }`, where
    `action` is one of the four standing-permission action values and
    `actionPreview` is the exact preview shown to the resolver, 1 to 4000
    characters
- The asker is the signer. Any human member or managed agent of the channel may
  create a `general` ask. `money`, `hire`, `tool` and `secret` asks may be
  created by members and agents but only resolved per [Authority](#authority).
- A `tool_consent` ask must have category `tool`, an exact `toolConsent`
  preview, a deadline, no addressee, and a valid thread root. Only a managed
  agent may create it. Owners and admins resolve it with `approved` or
  `rejected`; approval authorizes this tool call once and never creates a
  standing permission. Agents cannot resolve it. The harness refuses the call
  on rejection, expiry, relay failure, or its bounded timeout.
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
| tool_consent | `approved`, `rejected` | `reason` (1 to 1000 characters) |
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
Open `tool_consent` asks appear for community owners and admins and link to the
thread containing the exact action preview.

## Secret bindings

A secret binding names a credential, its employee and tool scope, and the store
that holds the value. The value is never part of a Nostr event, tag, audit row,
log, error, test fixture or CLI output. `SecretBindingSpec` intentionally has no
value field. Its global d-tag is `company:secret:<binding-uuid>`.

Kind 47036 commands are member signed and brokered by the relay. The relay
accepts only community owners and admins, validates that the target employee is
a current community member, stores the command and replaces the relay-signed
kind 30647 head in one transaction. A create starts as `pending`; activation
requires the exact current head; revocation is an explicit command that moves
the head to `revoked`. A consumer must read the current head before every use
and deny a missing, pending or revoked binding. No expiry or rotation policy is
defined here.

The `device` store sends the entered value only to the desktop native command,
which uses the existing OS credential store. The webview receives only a
success or generic failure result. The relay has no encrypted secret store, so
`server` actions are rejected and the desktop keeps that choice unavailable.

Secret asks use category `secret`, type `question`, and a non-secret
`secretRequest` object with `toolName`, optional `clientName` and `allowedUse`.
A secret ask cannot be
resolved with a free-text answer. The secure entry flow creates pending
metadata, writes the value to device storage, then activates the binding. The
relay activates the binding and resolves its linked ask with `secretBound` and
the binding UUID in the same transaction. The binding's `sourceAsk` coordinate
must point to that open ask, whose requester must match `employeePubkey` and
whose tool and allowed-use fields must match the binding. Only owners and
admins can perform these actions; managed agents cannot.

NEEDS_API: This relay has no encrypted server secret store. It also has no
agent/tool use path that reads the current binding head and supplies a
device-stored value to the selected local worker. Until that consumer exists,
the binding is an access record and the saved device value is not exposed to an
agent or tool. Revocation therefore changes the shared status record only and
cannot yet enforce a deny on the next runtime use.

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

## Member positions

Every community member may have one relay-signed kind 30648 head, addressed by
`company:member:<lowercase-pubkey>`. The relay determines the community from the
request host. Kind 47037 commands and kind 30648 heads carry no `h` tag and are
community-wide. The kind integers are mirrored in the Rust, desktop, and mobile
registries. This batch does not add mobile Team screens.

`MemberPosition` contains `schemaVersion`, `pubkey`, `title`, optional
`managerPubkey`, `kind` (`human` or `employee`), `status` (`active`, `paused`,
or `terminated`), and optional `reason`. Pubkeys are 64 lowercase hex
characters. A manager must be another active member in the same community. A
member cannot report to themself, and reporting lines cannot contain cycles.
The relay verifies the target against real community membership and derives
human or employee kind from authoritative account and managed-agent data.

`MemberPositionAction` contains `schemaVersion`, `pubkey`, `action`,
`expectedHeadEventId`, and only the action's payload:

| `action` | Payload | Rule |
| --- | --- | --- |
| `set_title` | `title` | Create-only when no position head exists; otherwise names the exact current head. |
| `set_manager` | `managerPubkey` | Names the exact current head. JSON null clears the manager. |
| `set_position` | `title` and/or `managerPubkey` | One atomic save when the edit form changes both fields. |
| `pause` | `reason` | Employee only. Reason is required. |
| `terminate` | `reason` | Employee only. Reason is required. Definition, lessons, and history remain. |
| `rehire` | none | Employee only. Restores terminated status after the retained profile has been reviewed. |

`set_title` and `set_position` may create an initial head only when
`expectedHeadEventId` is absent and no head exists. Every later mutation must
name the exact current head. The relay rejects stale heads and commits the
action event and replacement head in one transaction. Position, manager, kind,
status, and reason are preserved or changed as one snapshot.

The relay serializes manager changes under one community-scoped advisory lock.
It checks the complete reporting chain while holding that lock, then applies
the exact-head precondition and replacement in the same transaction. A cycle or
a race rejects the action without changing the head.

Pause and termination keep the managed-agent definition and event history.
Desktop actions stop a managed AI employee through the existing
`stop_managed_agent` path before publishing the position action. If stopping
fails, the position action is not published. Rehire restores active status
after the retained definition and history have been reviewed.

The Team list joins current relay membership with the managed-agent directory
by pubkey and removes duplicates. Workers are not employees and never appear in
the list, org chart, or member counts. Existing relay roles remain owner,
admin, member, guest, and bot. The company position `kind` is not a membership
role and does not grant spending, credential, or administrative authority.

Human and employee profile overviews derive Direct reports from member-position
heads in the same community. A report row opens that member's own profile:
humans use the human profile and employees use the existing agent profile.
Managed-agent workers stay invisible in both views.

An approval ask for a member change uses ask type `approval`, subject kind
`companyMember`, the target pubkey as its subject id, and a typed
`memberProposal` containing the exact-head action. A termination or rehire
proposal uses category `hire` and is addressed to an owner or admin. Other
proposals use category `general` and are addressed to the human direct manager,
or an owner when there is no human manager. A human direct manager may resolve
a general proposal for their report. The relay applies an approved proposal in
the same transaction as the ask response and member head update. Rejected,
stale, or failed proposals change neither head.

NEEDS_API: the frozen Team overviews show assigned work under "Doing now" for
human and employee profiles. The member-position and managed-agent read models
do not currently project company work items by assigned member. Do not copy the
reference fixture rows into the app. The work-item lane must provide that
projection before the Team overview can show real assigned work. The reference
also defines "No current commitments." for a member with no assigned work, but
the app cannot distinguish that state from unavailable work data without the
projection.

NEEDS_DESIGN: the frozen Team routes do not define how "Doing now" should look
when its work source is unavailable or fails. Do not invent a fallback for that
state.

NEEDS_API: the frozen `hire/review` route used for reviewed rehire requires the
retained employee package, including allowance, worker and tool scope, lessons,
and history. The current member-position and managed-agent reads do not expose
that complete review record. HIRE-1 implements new hires. Reviewed rehire stays
out of this slice until the retained employee package is available.

NEEDS_DESIGN: the frozen Team routes do not show where a non-owner starts a
member-change approval ask, or how a paused employee's status and reason appear
on message rows. Those surfaces remain unimplemented until their placement and
behavior are approved. The Hire employee action starts the new hire flow; the
existing ask surface handles typed employee proposals.

## Hiring

Hiring uses the actual persona and team catalogs. A role pack is a catalogued
agent definition with `companyRole` metadata for its job, skills, tools, and
`defaultAllowance`. Each listed tool carries a descriptive risk label. The role
picker never creates role data from prototype fixtures. The worker menu comes
from the currently available ACP runtime and provider catalog; saved model
identifiers are resolved through that catalog and are never hard-coded in the
role pack. `defaultAllowance` is null for HIRE-1. The founder enters an amount
during configuration, and the chosen value is kept with the hire record.

`companyRole` is optional metadata on the real persona and team catalog
projections, not a new event kind. It contains a job title, skill labels, tool
names with a risk label of `low`, `medium`, or `high`, and an optional
allowance field. These labels describe the role and do not grant permission.
Authorized owners and admins curate this metadata through the existing
Community Catalog and persona editor. Catalog entries without valid
`companyRole` metadata are not presented as hire role packs.

The hire head is community-wide at `company:hire:<hire-uuid>`. Its content
contains `schemaVersion`, `hireId`, the immutable role-pack coordinate and
metadata snapshot, the configured employee name and title (separate from the
role-pack title), reporting manager,
home channel, selected runtime/provider/model, configured allowance and period,
founder approver, optional ask coordinate, optional employee pubkey recorded
after founder approval, optional introduction event id, status (`proposed`, `awaiting_founder`, `approved`,
`hired`, or `denied`), timestamps, and `sourceActionEventId`. Catalog metadata
is copied into the hire head so later catalog edits do not rewrite the scope
that was approved. Runtime and provider values are validated against the live
catalog when the client prepares the employee; the relay stores the selected
identifiers as part of the approved snapshot.

Hire heads and hire actions carry no `h` tag. The d-tag is
`company:hire:<hire-uuid>`. Once an employee is attached, the hire head also
carries one `p` tag naming the employee pubkey, so clients can find an
employee's hire by `#p`. The `create` action has no
`expectedHeadEventId`; `approve`, `attach_employee`, `complete`, and `deny`
name the exact current head.
The ask action remains kind 47032 and remains a channel thread item. A hire
proposal ask carries a typed `hireProposal` snapshot and subject kind `hire`.
The relay writes its kind 30643 ask head and kind 30650 proposed hire head in
one transaction. The ask response remains kind 47033 and advances both heads
in one transaction. If an administrator approves, the hire head waits for the
owner's `approve` action. If the owner approves, the ask and hire heads record
the decision and founder signature together.

The member-signed hire action supports `create`, `update`, `approve`,
`attach_employee`, `complete`, and `deny`. `create` stores a proposed hire
record. `update` replaces the proposal while it is still proposed and names
the exact current hire head. A community
owner or admin may prepare a direct hire proposal, but only the owner may sign
its final founder approval. Managers and employees cannot create a hire head directly. They
propose a hire through an approval ask in the existing
channel thread. The existing ask action uses category `hire`, links the hire
UUID, and carries the proposed configuration. The ask head and proposed hire
head commit together. Only community owners and admins may resolve a hire ask
under D2. An admin approval moves the hire to `awaiting_founder`; it does not
activate an employee until the community owner signs the final hire approval.
The admin's reason stays with the ask resolution. A founder reviewing a
referred hire supplies a separate reason on the owner-only `approve` action;
the relay records it as `founderApprovalReason` on the hire head. An owner
approval that resolves an open hire ask records the ask reason and founder
approval in the same transaction. Sign-off does not create an employee or
position. `approve` and `complete` name the exact current
`expectedHeadEventId`. Rejection marks the hire denied and never creates a
persona, managed agent, member position, channel membership, tool grant, or
introduction. After founder approval, the owner records the managed employee
pubkey with `attach_employee` before adding it to the selected channel or
posting its introduction. This keeps the employee coordinate on the approved
hire head so reloads can resume without creating a second identity. The
introduction uses the message marker
`company-hire:<hire-uuid>:introduction`; a retry reads the existing marked event
before sending again. `complete` records the introduction event and employee
position together after the relay verifies the employee is owned by the
founder and the introduction is a post by that employee in the selected
channel.

The relay checks the trimmed, case-insensitive employee name against current
company member profiles and other pending or active hire records before
accepting a hire. Name checks are serialized under a company-scoped lock. A
second check before completion catches a profile that was created after the
hire began.
The employee identity is created through the existing `CommunityCatalogDialog`
and `AgentDialog` path, using the selected real persona and the available ACP
runtime and model catalog. The hire remains recoverable until the managed agent
has been created, joined to the selected channel, and posted its introduction.
The app sends the introduction as the managed employee and uses an idempotent
marker so a retry cannot publish a duplicate. `complete` verifies the real agent and introduction event, then atomically
advances the hire head and creates the employee member-position head. When the
action carries `timeZone`, it also creates the hire records described below.
The profile opens with the configured title,
manager, channel, and runtime values after that transaction succeeds.

Role packs may carry optional v2 fields: `owns` (the outcome the role owns,
1 to 500 characters), `channel` (default home conversation name, 1 to 80
characters of `a-z`, `0-9` and `-`), `duties` (at most 8 routines, each with a
`title`, a readable `scheduleText` and `instructions`), `onHire` (`sources` to
study, at most 8, and `planHorizonDays`, 1 to 30, default 14), `askBefore` (at
most 16 actions that always need a person) and `home` (the role's desk in the
app). A pack without them keeps its exact shape. The owner's signature on the
hire approves the role's routines.

`complete` may carry the owner's IANA `timeZone`; no other hire action may.
Its presence opts in to the new engine behavior. A Complete without `timeZone`
keeps the shipping 1.0.7 behavior: only the hired head and member position are
written, with no goal, routines, workflows or kickoff. The new engine always
sends `timeZone`. With it, in the same transaction as the hired head and the
member position, the relay writes:

- the employee's root goal at `company:goal:<hire-uuid>`: title from `owns`
  (cut at a word to 180 characters) or the hire title, done condition `owns`
  or "Plan approved and delivered", owned by the employee and linked to the
  introduction channel;
- one routine (duty head) per role-pack duty plus the built-in "Plan check"
  routine (`Every Monday at 09:00`), each in the introduction channel, in
  the supplied `timeZone`, with `sourceHireId`, approved by the owner, and each with
  its schedule workflow owned by the owner;
- one relay-signed kind 9 on-hire kickoff in the introduction channel with
  `p` tags for the owner and the employee, `buzz:workflow`,
  `buzz:workflow-owner` (owner), `buzz:workflow-mention` (employee) and
  `["colony:on-hire", <hire-uuid>]`. It is stored with its mention index and
  fanned out after commit, so an employee that starts later still finds it.

Any failure rejects an engine `complete` and stores none of these records: a goal
already at the hire id, an employee or owner that is not a member of the
introduction channel, or a time zone the schedule engine does not know. A
replayed `complete` returns the stored duplicate result, and a second
`complete` on a hired head is rejected, so each record exists once per hire.

Member goal-create commands reject an id that already belongs to a hire head,
so a goal cannot take a pending hire's reserved goal coordinate. A goal that
predates the hire is preserved and causes the engine completion to roll back.

The owner signature is the founder approval. Admins may prepare a hire and
resolve hire asks, but an admin-only approval cannot transition the hire to an
active employee. The screen confirmation is an explicit action, and relay role
checks remain authoritative. The hire ask links to the existing ask card, whose
open, resolved, denied, and failed states remain driven by the signed ask head
and the current command result. A failed response does not update either head;
the open ask and its review remain retryable.

NEEDS_API: the hire head stores the configured allowance, but the current
runtime and tool-permission APIs do not enforce a per-employee weekly budget.
The UI and record must not describe the value as an enforced spend cap until a
company budget API and runtime enforcement path exist.

NEEDS_DESIGN: the frozen company v8 package defines the employee-proposed hire
decision card, but not an employee-facing composer for creating its typed
`hireProposal`. The existing ask composer cannot create that record. Do not add
a hire proposal composer until its route and content are designed.

NEEDS_DESIGN: the hire decision card permits owners and administrators to
review an ask, while the frozen `hire/review` route requires founder sign-off.
The relay supports an administrator decision that waits for the founder, but
the handoff from that decision to a founder review is not designed. The desktop
approval action is restricted to the owner until that handoff is specified.

Role catalog empty, loading, unavailable, denied, save-failed, and runtime,
provider, and model recovery states use the approved Batch 2 design. New role
packs contain no seeded allowance, worker menu, runtime, provider, or model.
Creation does not start or hire an agent. Edits retain the existing
`companyRole.defaultAllowance` value when one has been configured.

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
`sourceActionEventId`, optional `acceptedAt`, and optional `dueAt`.
`acceptedAt` is set by the relay when a new work item is accepted. `dueAt` is an
RFC 3339 UTC timestamp ending in `Z`. If supplied at creation it must be later
than `acceptedAt`. A later due-date change must also be later than the
immutable `acceptedAt`; it may be in the past relative to the change, so an
overdue date can be recorded honestly. Existing heads without `acceptedAt`
remain valid and receive format validation when a due date is set.
`sourceEventId` is the original message when the item is created from a
conversation. When the item is created from the approved
standalone Work form, `sourceEventId` and `threadRootEventId` are absent because
that form selects a conversation but has no source-message or thread picker.
If a chat message is the source, both values are required and the relay checks
that the source and thread are in the tagged channel. Once set, `sourceEventId`
is immutable. `threadRootEventId` may change when the item moves to another
thread.

A move is an exact-head company work `update`. The signed action carries the
source channel in `h`; the relay resolves the destination channel from the
selected root message, rechecks source and destination state, and emits the
replacement kind 30634 head with the destination `h`. The work UUID, `d` tag,
original `sourceEventId`, goal link, owner, requester, done condition, status,
evidence and prior action events remain attached to the same item. The relay
allows the move only when the actor is the work owner, requester, community
owner or admin, is a member of both active channels, and the source and
destination have the same active membership set. A different audience is
rejected; the move never grants channel membership or widens visibility. The
action event remains in the source channel, and clients query history only from
channels the viewer can currently access.

An optional `goalId` must resolve to a non-deleted, non-archived goal in the
same community. Goal deletion is refused while any company work head still
references that goal, including an archived work item. The work form filters
out archived and deleted goals.

Linking or unlinking work uses the existing exact-head `update` action and
changes only that item's `goalId`. The goal detail selector sends one kind
47006 action per changed work item, in sequence. These actions are independent:
an accepted link remains saved if a later action fails. The client reports each
item's result, keeps failed desired selections available for retry, and reports
the operation as incomplete until every requested change succeeds.

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

Due dates use the existing company work head and action kinds. A create may
include `dueAt`. Later edits use the exact-head `set_due_date` or
`clear_due_date` action, each stored as kind 47006 and attributed to its
signing member and event time. Generic work edits preserve the current due date
so older clients cannot clear it by omitting a field. The timeline derives
"Due date set", "Due date changed", and "Due date cleared" from this action
history. Due dates do not change work status.
The frozen Work create and edit forms do not show a due-date input, so this
slice keeps date changes on the agent-first CLI and displays saved dates in the
existing work context and timeline.

### Work tracking records, kinds 30652 and 47041

Kind 30652 is the relay-signed replaceable head for either a persisted
commitment suggestion or a watchdog configuration. Its typed content includes
`recordType`, and the coordinate distinguishes the records:

- Suggestions use `company:work-suggestion:<suggestion-uuid>` and the `h` tag
  of the source message's channel.
- Watchdog configurations use `company:work-watchdog:<work-item-uuid>` and the
  `h` tag of the work item's current channel. The community derived from the
  relay host is the business boundary. The configuration belongs to that
  business and work item, never to a user's local preferences.

Kind 47041 stores member-signed propose, accept, dismiss, expire, configure,
and disable actions. Actions carry the same `h` and `d` coordinates as their head.
Mutations name the exact current head event id, except initial creation. Relay
authorization and head replacement are checked and committed in one database
transaction.

A commitment suggestion is an explicit proposal by a channel member or a
managed agent. It stores the source message id, the proposed company work
fields, proposer pubkey, status, and source action id. The relay verifies that
the source event and thread root exist in the same community and channel, and
that the proposed requester and owner are channel members. Managed-agent
identity comes from the authorization-grade account record, never a client tag.
No relay or client text heuristic creates a suggestion or work item.

Only a human community owner or admin, or a human member of the source channel,
may accept a proposed suggestion. Acceptance names a new work-item UUID and
uses the existing company work create validation and identity rules. In one
transaction, the relay stores the kind 47041 accept action, advances the
suggestion head to `accepted`, and writes the relay-signed kind 30634 work
head. The new work head points to the original source message and uses the
accept action as `sourceActionEventId`. The work timeline includes that accept
action with its real signer and timestamp. Dismissal and expiry are explicit
exact-head actions. If `expiresAt` is present, the relay rejects expiry before
that time. Expiry is never inferred from message text or silently applied by a
client.

Watchdog configuration is absent and therefore OFF until explicitly saved.
Enabling it requires an explicit positive check-in interval in the action;
there is no selected interval, code default, documentation default, or
production fixture interval. Test configurations supply their chosen interval
in the test itself. The configuration records the selected recipients and any
explicit escalation interval. The work item owner, requester, or a community
owner or admin may configure it, subject to the existing channel membership
and work authority rules.

The watchdog worker uses a durable database schedule and delivery journal. It
posts check-ins as ordinary messages in the work item's current thread. A
check-in never changes the work status and never retries a failed work action.
Disabling the watchdog, archiving or completing the work, or moving the work
cancels or updates pending deliveries transactionally. Delivery retries have
bounded attempts and backoff; exhausted rows remain in a terminal failure
state with the last error for recovery. The worker receives a clock dependency
so scheduling, retry, and cancellation behavior can be tested without sleeps.

### Work tracking availability boundary

The desktop timeline is a projection of signed kind 47006 actions, kind 47041
suggestion acceptance actions, current kind 30634 heads, and verified thread
messages. It may show only fields carried by those records. Suggestions are
shown only when a validated persisted suggestion exists for that source
message. An ordinary message alone never receives a `Track this` affordance.
The timeline does not synthesize attachments, review requests, automatic
verdicts, or watchdog events. A watchdog check-in appears as its actual message
in the thread; its durable delivery state is read from the watchdog record and
delivery journal.

### Employee AI allowances and AI spend records, kinds 30653 through 30654 and 47042 through 47043

Kinds 30653 and 30654 are relay-signed replaceable heads. Kinds 47042 and
47043 are member-signed broker actions. All four kinds are community-wide and
carry a `d` tag without an `h` tag. Their public content contains financial
metadata and estimates only, never provider credentials or secret values.

| Kind | Name | Write status | Owner |
| ---: | --- | --- | --- |
| 30653 | Employee AI allowance head | Relay signed, replaceable | AI spend |
| 47042 | Employee AI allowance action | Brokered | AI spend |
| 30654 | AI spend record head | Relay signed, replaceable | AI spend |
| 47043 | AI spend record action | Brokered | AI spend |

An allowance is keyed by `company:employee-allowance:<employee-pubkey>`.
Its head stores the current permanent allowance, its explicitly selected
period (`day`, `week`, or `month`), an optional temporary allowance and its
`expiresAt`, the selected ordered funding source labels, actor, update time,
and source action id. Amounts use integer USD cents. Funding labels are
owner-entered identifiers until a source registry can validate and report
their live status. An unset allowance stays unset; there is no
implicit amount or period. Used-to-date is derived from metered spend records
in the applicable period, not copied into the allowance head. A temporary
allowance takes effect before its end timestamp and the permanent value is
effective at and after that timestamp. Reversion is derived from the timestamp
and does not require a scheduled write. A permanent change clears the temporary
value.

Every allowance action names the employee and exact current head event id,
except initial creation. Only a community owner or admin may commit an
allowance or funding-order change. An employee or agent request for an
allowance change is represented by an existing company ask with category
`money`, a typed spend proposal, and a thread root. Only a community owner or
admin may resolve that ask. The approved ask and new allowance head commit in
one transaction. Agents cannot resolve money asks.

AI spend records use `company:ai-spend:<record-id>`. A turn usage record id is
derived from its source kind 44200 event id; an external cost record id is a
UUID. Each head has a `recordType` of `agent_turn` or `external_cost` and a
status of `active` or `removed`. Agent turn records refer to exactly one
kind 44200 event, name the employee, optionally retain its reported model,
record an integer `estimatedAmountNanoUsd` when the source report has a cost,
set `isEstimate` to true, and carry a
`sourceOfFunds` value of `colony_credits`, `provider_subscription`,
`provider_api_key`, or `unknown`. A missing cost remains missing and never
becomes zero. The source event id makes ingestion idempotent. Relay validation
requires the referenced event to exist in the same community, be authored by
the named managed agent, and be owner-addressed to the signing member. The
relay cannot decrypt the private report, so the amount and source claim are
explicit owner-attributed evidence, not provider invoices.

External cost records contain provider, plan or description, type
(`subscription` or `credit_top_up`), integer actual cash cost in USD cents,
and the recorded renewal or purchase date. They do not contain or imply a
purchase instruction. Removing one changes its record status only and does not
cancel a provider subscription or reverse a provider top-up. Cash costs and
API-equivalent usage remain separate values and totals.

Spend actions are exact-head operations. A first write creates the record;
edits and removal name the exact head event id. The relay validates every
field, ensures the event author is a human member with owner or admin role,
and stores the action and relay-signed head atomically. No action in this
contract calls a payment provider or sends money. Colony-credit ledger debits
are permitted only after the runtime provides verifiable per-turn
source-of-funds evidence that the turn used Colony credits. Unknown and
provider-funded turns never debit Colony credits.

### AI spend availability boundary

Existing kind 44200 harness reports contain token counts and an estimated USD
cost, but do not identify whether a turn used a provider subscription, a
provider API key, or Colony credits. The current runtime also has no persisted
funding-order source status, no next-turn cost estimate, and no verified
per-turn Colony-credit execution signal. Until those runtime capabilities
exist, such records display an unknown funding source, source live-status and
capacity are unavailable, and no Colony-credit debit or budget-stop runtime
action is reachable. The UI must preserve the explicit unavailable states in
the frozen spend screens. No fixture amount, source, status, or forecast is a
default.

An over-allowance total may be derived from active per-turn estimates and the
effective allowance. Deriving that total does not stop a worker. Budget-stop
approval cards may be created only when an actual next-turn estimate and a
thread root are available; the relay does not synthesize either value.

### AI spend proof boundaries

Relay tests cover authority, event ownership, exact-head replacement,
idempotent turn ingestion, removal semantics, money-ask approval and integer
minor-unit validation. Ledger math tests inject the clock for period boundaries
and temporary reversion. Desktop tests cover the employee allowance and AI
spend journeys through a reload. Visual review compares the relevant power,
employee salary, allowance edit, spend record, and budget-stop routes with the
frozen company v7 and v8 references.


## Duties

Duties are community-wide employee records. A duty head has no h tag, uses
d-tag company:duty:<duty-uuid>, and has one p tag for employeePubkey. The head
is relay-signed kind 30655. The employee pubkey is the only duty owner; the
member who proposed or administers it is recorded separately. A duty points to
one existing workflow definition whose ID is the duty UUID. The workflow engine
remains the only scheduler and runner.

A duty proposal is a typed ask in the conversation where it came up. The ask
uses category duty, subject kind duty, and a dutyProposal snapshot. Any active
human member or managed agent in the channel may propose it. Only community
owners and admins may approve or reject it. Approval creates the active duty
head and its versioned workflow definition atomically with the ask response.
The workflow is owned by the approving owner or admin for the existing
workflow-engine authority checks. A failed transaction changes neither ask nor
duty. A rejected proposal leaves no active duty head.

A duty head names exactly one source: `sourceAskId` with `sourceAskChannelId`
for a duty approved through an ask, or `sourceHireId` for a routine created
when its hire completed.

The frozen employee profile editor can select a channel but does not identify an
originating conversation root. The duty contract requires the proposal ask to
live in the conversation where the need came up. Profile-originated submission
therefore stays unavailable until the design specifies how that editor chooses
or establishes the ask thread root. This is a NEEDS_DESIGN boundary; do not
silently create a separate root message or choose one from channel history.

The proposal snapshot contains schemaVersion, dutyId, employeePubkey, title,
scheduleText, scheduleCron, timeZone, channelId, and instructions. The schedule
text is retained verbatim for display. The parsed schedule is a recurring
calendar schedule in the supplied IANA timezone. The current frozen editor has
no timezone control, so the desktop supplies the signed-in account timezone;
an absent or invalid timezone blocks submission. The relay validates the
timezone and the supported readable-schedule grammar before it creates a
workflow definition with the existing schedule trigger. No mock schedule,
sample instruction, watchdog interval, or catch-up timing is a default.

Duty actions use kind 47044 and include schemaVersion, dutyId, action,
expectedHeadEventId, and action-specific payload. Update, pause, resume, and
delete require an exact current head and owner or admin authority. Update
replaces the complete duty snapshot and workflow definition as one transaction.
Pause disables the existing workflow; resume enables it; delete writes a
tombstone and disables the workflow while retaining run history. Status is
active, paused, or deleted. The head carries sourceActionEventId, createdAt,
updatedAt, and schedule/workflow references. Last run and next run are derived
from stored workflow runs and the real schedule, never copied from a prototype
fixture.

The workflow definition uses the existing versioned-definition and
exact-version-approval contract. Every duty run records the workflow definition
version and hash used. The schedule engine evaluates the stored schedule and
timezone. After downtime, one catch-up run is created for the latest missed
occurrence. Its run trigger context records the first and latest missed
occurrence and the exact count of earlier occurrences skipped. Ordinary runs
record zero skipped occurrences. The employee profile history reads actual
workflow runs; an unavailable run query is an error state, not an empty history.

## Lessons

Lessons are community-wide records attached to one employee, with no h tag,
d-tag company:lesson:<lesson-uuid>, one p tag for employeePubkey, and
relay-signed kind 30656 heads. Member-signed kind 47045 actions include
schemaVersion, lessonId, action, expectedHeadEventId, and a typed snapshot or
decision. IDs are stable UUIDs. A lesson contains its text and explicit
evidence references to existing events; the relay verifies every reference is
present in the same community. Evidence count is derived from those references.
The relay and clients do not infer or generate lessons from activity.

The frozen lesson detail also shows a prose evidence summary and a last-validated
date. The current lesson record has no curated summary or validation record;
`updatedAt` is an edit timestamp and cannot stand in for validation. These fields
remain unavailable until the record contract has backing data. This is a
NEEDS_API boundary; do not generate the summary from referenced event content or
label the edit timestamp as validation.

Lifecycle states are candidate, approved, and deprecated. Create and every
edit produce candidate state. An edit to an approved lesson clears the current
approval while the append-only action history preserves the previous decision.
Approval stores approvedByPubkey and approvedAt. Deprecate and restore as
candidate name the exact current head. Sensitive policy changes must be
approved by an owner or admin. The frozen editor has no reliable control for
classifying a lesson as touching tools, spending, or secrets, so all lesson
approvals require an owner or admin until that scope has an approved design.

Confidence is an explicit recorded value, not a score guessed by the relay or
client. New lessons begin unassessed. Evidence may carry an explicit helpful or
harmful assessment; counts are derived from assessed evidence only. The frozen
lesson form has no confidence or evidence-assessment controls, so the desktop
does not invent them. The CLI and broker can store an explicit confidence and
assessment. UI states display unassessed records as such. A future desktop
control for setting confidence or assessing evidence is NEEDS_DESIGN. The
frozen candidate detail includes an Approve lesson action but has no confidence
input. That action cannot approve an unassessed record without substituting the
prototype's sample confidence. Approval from an unassessed desktop record stays
unavailable until the confidence input has a frozen design.

Agent memory kind 30174 and the existing buzz memory CLI remain a separate
Memory section within Lessons. Memory entries are not lesson records and are
not changed by lesson create, edit, approval, deprecation, or restore actions.

## Co-founder settings

One community-wide record per company, with no h tag, the fixed d-tag
`company:cofounder`, and a relay-signed kind 30670 head. A member-signed kind
47060 action carries `schemaVersion`, the full `settings` and
`expectedHeadEventId` (omitted only while no head exists). Every change
replaces the whole record.

`settings` holds `enabled` (boolean), `moneyPreference` (`cheapest_first` or
`best_option`) and `approvalSwitches` (`approveEveryHire`,
`approvePlaybookChanges`, `approveEveryDiscoveryCampaign`, all booleans). A
company with no head reads as the defaults: disabled, `cheapest_first`, all
switches off. Co-founder mode is off until an owner or admin turns it on.

Only a community owner or admin can write the record. A member or a managed
agent is refused with `only the owner or an admin can change co-founder mode`.
A stale `expectedHeadEventId` is a write conflict (CLI exit code 5). The head
adds `updatedByPubkey` and `updatedAt`. `updatedAt` is Unix seconds, not an RFC
3339 string, because the record is read as a number by the desktop map.

CLI: `colony cofounder get` prints the head, or the defaults with
`"exists": false`; `colony cofounder set --enabled true|false` reads the
current head and writes the change against it.

## Function slots

Each company has five functions, in this fixed order: `sales`, `operations`,
`customer_success`, `finance`, `brand` (shown as Sales, Operations, Customer
Success, Finance, Brand). Every function has one community-wide record with no
h tag, d-tag `company:function:<id>` and a relay-signed kind 30671 head. A
function with no head reads as an empty slot.

A member-signed kind 47061 action carries `schemaVersion`, `function`, `kind`,
`leadPubkey` and `expectedHeadEventId`. `kind` is one of:

| `kind` | `leadPubkey` | Head state after |
| --- | --- | --- |
| `assign_lead` | required, 64 hex | `filled` with that lead |
| `cover_by_scout` | not allowed | `covered_by_scout`, no lead |
| `clear` | not allowed | `empty`, no lead |

A lead must be a member or a managed agent of this company; otherwise the relay
refuses with `the lead must be a member or an agent of this company`. Only an
owner or admin can write function slots. The head adds `updatedByPubkey` and
`updatedAt` (Unix seconds).

A slot whose lead later leaves the team still holds the old pubkey. Readers must
treat a lead who is no longer on the team as an empty slot instead of showing a
broken avatar.

CLI: `colony functions list`, `get <function>`, `assign <function> --lead
<pubkey>`, `cover <function>` and `clear <function>`.
## Business brief

What the company sells, to whom, at what price and how it talks. Scout reads
what Colony already knows and plays the brief back; the owner confirms or
corrects it. One community-wide record, no h tag, d-tag `company:brief`, relay
signed kind 30674 head. A company with no head has no brief yet.

The head holds `confirmed` (what the owner confirmed or wrote) and `pending` (a
revision Scout proposed that the owner has not decided on), each with
`whatYouSell`, `whoBuys`, `howYouTalk`, optional `prices` (absent means Scout
found none) and up to eight `sources`. It also carries `revision`,
`confirmedByPubkey`, `confirmedAt`, `updatedByPubkey` and `updatedAt` (Unix
seconds). Every text is 1 to 600 characters.

A member-signed kind 47064 action carries `schemaVersion`, `kind`, `content` and
`expectedHeadEventId`:

| `kind` | `content` | Effect | Who |
| --- | --- | --- | --- |
| `propose` | the brief | sets `pending`, `confirmed` is untouched | a managed agent, only while co-founder mode is on, or an owner or admin |
| `confirm` | none | promotes `pending` to `confirmed` (refused when nothing is pending) | owner or admin |
| `edit` | the brief | sets `confirmed` and drops `pending` | owner or admin, even while the mode is off |
| `discard` | none | drops `pending` | owner or admin |

A plain member is refused, and an agent that tries `confirm`, `edit` or
`discard` is refused with `only the owner or an admin can confirm, edit or
discard the business brief`. While co-founder mode is off an agent proposal is
refused with `co-founder mode is off for this company`. A stale
`expectedHeadEventId` is a write conflict (CLI exit code 5).

CLI: `colony brief get`, `propose`, `confirm`, `edit` and `discard`.

## Co-founder onboarding

Where onboarding stands when co-founder mode is switched on: which steps are
done, the one open question, the accounts Scout asked the owner to connect and
the proposed company map. One community-wide record, no h tag, d-tag
`company:onboarding`, relay signed kind 30675 head. The answers themselves live
in their own records: the brief in `company:brief` and the money setting and
approval switches in `company:cofounder`.

The head carries `status` (`in_progress` or `complete`), `leadPubkey` (Scout,
the agent that wakes go to), all five `steps` in order (`brief`, `money`,
`approvals`, `accounts`, `map`, each `todo`, `asked`, `done` or `skipped`), the
single open `question`, `accounts`, the proposed `map` (five entries in function
order, each `scout`, `empty` or `existing_agent` with a `leadPubkey`, plus
`firstFunction` and `approved`), `startedAt`, `resumedAt`, `resumeCount`,
`completedAt`, `updatedByPubkey` and `updatedAt`. Optional keys are absent, not
null.

A member-signed kind 47065 action carries `schemaVersion`, `kind`,
`expectedHeadEventId` and only the keys its kind needs:

| `kind` | Needs | Effect | Who |
| --- | --- | --- | --- |
| `start` | an owner or admin also sends `leadPubkey` | creates the head, or resumes it without losing progress | agent, or owner or admin, only while the mode is on |
| `ask` | `step`, `text` (at most 200 characters), `account` on the accounts step | opens ONE question; refused while another is open or the step is answered | agent, only while the mode is on |
| `withdraw` | nothing | takes the open question back | agent |
| `propose_map` | `map` | needs brief, money and approvals settled and no open question | agent |
| `answer` | `step`, optional `skipped`, `moneyPreference` or `approvalSwitches` | settles the open question's step | owner or admin |
| `approve_map`, `reject_map` | nothing | records the owner's decision on the proposed map | owner or admin |
| `complete` | nothing | needs brief, money, approvals and map settled and no open question | agent |

An `answer` is checked against saved records the relay reads itself. The brief
answer needs a confirmed brief. The money and approvals answers must equal the
co-founder settings that are already saved, so the owner saves the setting
first (action 47060) and then answers; every prefix of those two writes is
consistent and a retry is safe. `approve_map` records the decision only; slots
are filled by the function slot action. A lead given to `start` must be a managed
agent of the company.

Switching co-founder mode off and on does not restart onboarding: `start` on an
existing head only raises `resumeCount` and sets `resumedAt`; steps, answers and
a `complete` status stay. While the mode is off Scout's actions are refused
(`co-founder mode is off for this company`), while the owner's `answer` and map
decisions are always accepted.

CLI: `colony onboarding get`, `start`, `ask`, `withdraw`, `propose-map`,
`complete`, `answer`, `approve-map` and `reject-map`.

## Wakes for Scout

Scout moves work forward without being mentioned. The relay queues a wake in the
`cofounder_wakes` table for: co-founder mode switched on (`mode_on`), a daily
start (`daily_start`, from 06:00 UTC, 08:00 in Johannesburg), a WhatsApp reply
(`inbound_reply`), a worker run that finished or failed (`worker_finished`), an
approval given (`approval_given`) and a work item due within a day
(`deadline_near`). A wake is not a record and is not readable through the relay.

- **Off does nothing.** Nothing is queued while co-founder mode is off, and a wake
  queued before it went off is closed unsent.
- **Deduplicated.** Each wake has a key (`daily:<date>`, `worker:<id>`,
  `approval:<ask id>`, `reply:<message id>`, `deadline:<work item>:<due time>`,
  `mode_on:<head event id>`) and a key queues once, ever.
- **No storms.** A worker turns all pending wakes of a company into ONE
  relay-signed message in the direct message between Scout and its owner, at most
  every five minutes and listing at most ten reasons.
- **Bounded.** A failed delivery backs off (1, 2, 4 ... minutes, at most an hour)
  and ends after eight attempts. A wake older than a day is closed as stale.
- **Safe text.** A wake carries a reason and ids only, never a contact's name or
  message, so a stranger cannot put instructions in front of Scout through it.
- **The Friday review** uses the `daily_start` reason with the key
  `weekly:<Friday date>` and the detail `weekly-review:<Friday date>`, so the
  reason list of the table did not change. The delivery worker words it on its
  own line (see Numbers) and tags the message `weekly_review`.

Scout is the `leadPubkey` of the onboarding record, or the one active Chief of
Staff on the team while onboarding has not started. The message tags `p` for the
owner and Scout, `buzz:workflow`, `buzz:workflow-owner`, `buzz:workflow-mention`
(the same provenance a scheduled duty carries) and `buzz:cofounder-wake` with the
reasons, so a client can show it as a quiet system line.

## Worker runs

A worker run is a one-shot, tool-less model call an employee starts for
research, drafts or variations. It is a company record, not a team member: it
has no pubkey, position or managed agent and never appears in the team list.
Records are community-wide (no `h` tag), d-tag `company:worker:<worker-uuid>`,
one `p` tag naming the employee that started the run. Action kind 47062 carries
`schemaVersion`, the full `run` and `expectedHeadEventId`; the relay-signed head
(kind 30672) carries the run, `updatedByPubkey`, `updatedAt` and
`sourceActionEventId`.

- **Lifecycle.** The employee writes one `running` record with no expected head,
  then one ending record (`done`, `failed` or `cancelled`) naming the exact head.
  An ended run never changes. Identity, label, model, start and deadline are
  fixed once the run starts.
- **Authority.** The signer must be the employee named in `parentPubkey`, or an
  owner or admin. A worker write creates no member, position, user row or
  managed agent.
- **Budgets.** The deadline is at most 900 seconds after the start. Output is at
  most 16384 bytes; longer output is cut by the launcher and ends with
  `[output cut, full text in <path>]`. A `done` record must finish no later than
  30 seconds after its deadline.
- **Readers.** A `running` record past `deadlineAt` reads as failed
  (`worker_effective_status`), so a crashed launcher never leaves a run alive.
- **Not in `CompanyCommand`.** The record carries a floating point cost, which
  `CompanyCommand` (an `Eq` type) cannot hold, so the relay decodes
  `WorkerRunAction` directly.

## Plans

A plan is a typed proposal the owner approves, edits or rejects. It is its own
record, not an ask category: a desktop that predates co-founder mode fails a
whole ask list on an unknown category, so plans use kinds 30673 and 47063.
Records are community-wide (no `h`, no `p` tag), d-tag `company:plan:<uuid>`.
Plans only exist while co-founder mode is on; switching it off stops new
proposals, revisions and approvals, while approved work in flight finishes.

The relay-signed head (kind 30673) carries `schemaVersion`, `planId`,
`status` (`proposed`, `approved`, `completed`, `rejected`, `cancelled`),
`revision`, the `plan`, `proposedByPubkey`, `proposedAt`, `updatedByPubkey`,
`updatedAt`, `approvals` and `sourceActionEventId`. `plan` holds `title`,
`summary`, `function`, `currency`, `budgetCents`, `decideBy`, `targetLabel`,
`timingLabel` and 1 to 24 `steps`. A step holds `stepId`, `title`, `detail`,
`owner` (`function`, `lead_agent`, `worker` or `owner`, the last being a
prepared human-only step), `tools`, `costLabel`, `costEstimateCents`,
`whenLabel`, an optional `approvalPoint` (`outreach`, `spend`, `taste`, `hire`
or `other`, with a one-line prompt), `status` and `note`.

A member-signed kind 47063 action carries `schemaVersion`, `planId`, `kind`,
and the fields that kind needs:

| `kind` | Who | Carries | Effect |
| --- | --- | --- | --- |
| `propose` | any member or agent | `plan`, no expected head | new plan, `proposed`, revision 1 |
| `revise` | proposer, owner or admin | `plan`, expected head | replaces a proposed plan, revision + 1; an owner or admin edit is recorded |
| `approve` | owner or admin | `revision`, expected head | `approved`; recorded |
| `reject` | owner or admin | `revision`, `note` | `rejected`; recorded |
| `cancel` | proposer, owner or admin | `note` | `cancelled`; recorded |
| `request_step_approval` | step doer | `stepId` | step waits at its approval point |
| `approve_step` / `reject_step` | owner or admin | `stepId`, `note` | step `approved`, or `skipped`; recorded |
| `update_step` | step doer, owner or admin | `stepId`, `stepStatus`, `note` | step moves along; plan becomes `completed` when every step ended |

Rules enforced by the relay (`buzz_core::company_plans::apply_plan_action`):

- A managed agent never approves or rejects, whatever role row it has. A person
  who is not an owner or admin does not either.
- Approve and reject name the `revision` the person looked at; an edited plan
  makes an older approval conflict.
- A step with an approval point cannot start until the owner approved that
  point. Approving a plan records the owner's intent. It never sends or pays:
  outreach and spending stay gated where Colony runs them (see
  `docs/cofounder-hard-rules-audit.md`).
- A step that spends needs an approval point or fits inside `budgetCents`. A
  worker step can never spend or carry an outreach or spend approval point.
- The doers of a step are the proposer, the step's agent, the lead of the
  step's function and owners or admins. A step for a person is only moved by an
  owner or admin.

The head keeps an append-only approval record (`approvals`, at most 200):
`scope` (`plan` or `step`), `stepId`, `decision` (`approved`, `rejected`,
`edited` or `cancelled`), `actorPubkey`, `at`, `revision`, `note` and
`actionEventId`. It answers who approved what, and when.

CLI: `colony plans propose|list|show|revise|step|request-approval|approve|reject|cancel|approve-step|reject-step|approvals`.
## Access list, capability gaps and slot hires

One head kind, 30676, and one action kind, 47066, carry three community-wide
record families (no h tag), told apart by d-tag. They are new records, so a
desktop that predates them keeps loading every older list. No key was added to
an existing record, including the hire proposal.

| d-tag | Record | Head content |
| --- | --- | --- |
| `company:access:<id>` | One tool or account Scout and agents can use | `AccessHead` |
| `company:capgap:<gap uuid>` | A capability gap and its plan | `CapabilityGapHead` |
| `company:slot-hire:<hire uuid>` | The function slot a hire proposal is for | `SlotHireHead` |

A kind 47066 action carries `schemaVersion`, `op`, the ids and payload that op
needs (anything else is refused) and `expectedHeadEventId`. The d-tag is the
record the op changes (the gap, for `gap_complete`).

| `op` | Who | Effect |
| --- | --- | --- |
| `grant` | owner or admin | access entry becomes `active` |
| `revoke` | owner or admin | access entry becomes `revoked`; takes effect at once |
| `gap_propose` | any member or agent, co-founder mode on | gap `proposed` |
| `gap_approve` | owner or admin | gap `approved`, the exact chosen cost is recorded |
| `gap_decline` | owner or admin | gap `declined` |
| `gap_done` | owner or admin | gap `human_done` (the human step was done) |
| `gap_complete` | the proposer, owner or admin | gap `completed` and the access entry is created `active` in the same write |
| `slot_hire_set` | the hire's proposer, owner or admin | records the function the hire is for |

**New access only through the gap flow.** An agent can never create an access
entry: `grant` is owner or admin only, and `gap_complete` needs the owner's
approval of the stated cost and the human step. A gap carries up to five
`options`, each with its stated cost and whether it works. The pick (`chosen`)
must be an option that works and must be the cheapest that works, otherwise the
gap must carry a `chosenReason` (the "best option" money setting). `pageUrl`,
when present, is an `https` address the owner's built-in browser opens.

**Revoke takes effect where the relay acts.** WhatsApp, Discovery and credits
have one fixed access id each (`whatsapp`, `discovery`, `credits`), exist before
anyone grants them and are active until revoked. While revoked: WhatsApp batches
and sends by anyone but the owner or an admin are refused, Discovery searches by
anyone but the owner or an admin are refused, and the credits gateway refuses
agent AI requests. Other entries (browser logins, connected accounts) are
informational for the relay; agents are told to treat a revoked entry as off
limits.

**Hiring into a slot.** A hire proposal cannot carry the function (older
desktops fail on unknown keys). Instead the proposer writes `slot_hire_set`
while the hire is waiting for a decision (`proposed` or `awaiting_founder`) and
the slot has no lead. When the owner completes the hire, the relay fills that
slot with the new employee in the same transaction. A slot that gained another
active lead meanwhile keeps that lead and the hire still completes.

**A slot never keeps a lead who cannot work.** A lead who is paused or
terminated (the member position action) is removed from every slot in the same
commit. A lead who leaves the relay, is removed by an admin or has their
identity archived is removed from every slot straight after, and any later slot
write or `slot_hire_set` heals a slot whose lead is no longer active.

CLI: `colony access list`, `grant`, `revoke <id>`, and
`colony access gap propose|list|show|approve|decline|done|complete`;
`colony asks propose-hire ... --function <function>` and
`colony functions hire-slot <hire-id> <function>` record the slot.

## Playbooks

A playbook is a business's routine, designed with the founder: ordered steps,
each with an owner, inputs, outputs, tools and an optional approval point. It
is versioned: Scout proposes, the owner approves, and a change waits until the
owner approves it. A playbook runs once per client job as a **running copy**
that shows its current step. Two record families share one head kind (30677)
and one action kind (47067); the d-tag tells them apart. Records are
community-wide (no `h`, no `p` tag). Proposing a playbook, proposing a change,
revising one, approving one and starting a job need co-founder mode on; step
updates, hand-offs, cancelling, rejecting and withdrawing still work with it
off (approved work in flight finishes).

| d-tag | Family |
| --- | --- |
| `company:playbook:<uuid>` | playbook |
| `company:playbook-job:<uuid>` | running copy for one client job |

### Playbook head (relay signed, kind 30677)

Content is camelCase; unknown keys are refused by the relay and by readers.
Optional keys are omitted when empty.

```json
{
  "schemaVersion": 1,
  "playbookId": "uuid",
  "status": "proposed | active | archived | rejected",
  "version": 2,
  "current": { "title": "Delivery playbook", "summary": "", "function": "operations",
    "steps": [{ "stepId": "brief", "title": "Client brief and assets", "detail": null,
      "owner": { "kind": "function | lead_agent | worker | owner", "function": "operations",
                 "agentPubkey": "hex", "workerType": "site_build" },
      "inputs": ["signed agreement"], "outputs": ["brief"], "tools": ["WhatsApp"],
      "approvalPoint": { "kind": "outreach | spend | taste | hire | other", "prompt": "You say go live" } }] },
  "pending": { "content": { "...same shape as current..." }, "changeSummary": "Add a logins checklist to step 2",
               "proposedByPubkey": "hex", "proposedAt": 1793000000, "revision": 1 },
  "records": [{ "decision": "approved | rejected | edited | published | withdrawn | archived", "version": 2,
                "revision": 1, "actorPubkey": "hex", "at": 1793000000, "note": null,
                "changeSummary": null, "proposedByPubkey": "hex", "actionEventId": "hex" }],
  "createdByPubkey": "hex", "createdAt": 1793000000,
  "updatedByPubkey": "hex", "updatedAt": 1793000000, "sourceActionEventId": "hex"
}
```

- `version` is 0 until the first approval; `current` is the approved content of
  `version` (absent while `version` is 0). `pending` is at most one proposal
  waiting for the owner: a whole new playbook (then `status` is `proposed`) or a
  change to the approved one (then `status` stays `active`). The approved
  version never moves until the owner approves.
- `status`: `proposed` never approved; `active` has an approved version and jobs
  can start; `archived` retired (running jobs finish, no new jobs); `rejected`
  the first proposal was rejected or withdrawn.
- Step `owner` rules as in plans: `function` names a function, `lead_agent`
  names an `agentPubkey`, `worker` names a `workerType`, `owner` is the founder.
  A step can hand to another function by naming it as owner. A worker step never
  carries an outreach or spend approval point.
- `records` is the append-only decision record (at most 200): `version` is the
  version in effect after the decision, `revision` the proposal revision decided.
  "Last change approved by you on 2 Nov" is the last `approved` or `published`
  record.
- 1 to 24 steps, `stepId` 1 to 32 characters of `[a-z0-9_-]` and unique,
  title at most 160, up to 6 inputs, outputs and tools of at most 120.

### Playbook action (member signed, kind 47067, d-tag `company:playbook:<uuid>`)

Content: `{ schemaVersion: 1, playbookId, kind, content?, changeSummary?, revision?, note?, expectedHeadEventId? }`.
Every kind except `propose` names the exact current head event id.

| `kind` | Who | Carries | Effect |
| --- | --- | --- | --- |
| `propose` | agent, owner or admin, mode on | `content`, no expected head | new playbook, `proposed`, pending revision 1 |
| `propose_change` | agent, owner or admin, mode on | `content`, `changeSummary` (required) | sets `pending` on an `active` playbook; refused when one waits or `content` equals the current version |
| `revise` | the proposer, owner or admin, mode on | `content`, optional `changeSummary` | replaces `pending`, revision + 1; an owner or admin edit is recorded `edited` |
| `withdraw` | the proposer, owner or admin | optional `note` | drops `pending`; recorded `withdrawn`; a first proposal becomes `rejected` |
| `approve` | owner or admin only, mode on | `revision` of `pending` | `pending` becomes `current`, `version` + 1, `active`; recorded `approved` |
| `reject` | owner or admin only | `revision`, optional `note` | drops `pending`; recorded `rejected`; a first proposal becomes `rejected` |
| `edit` | owner or admin only | `content`, optional `changeSummary` | writes the next version directly (drops `pending`); recorded `published` |
| `archive` | owner or admin only | optional `note` | `archived`; recorded |

A plain member never proposes. A managed agent never approves, rejects, edits or
archives, whatever role row it has. A stale `revision` conflicts. Refusals the
UI can show verbatim: `co-founder mode is off for this company, so ...`,
`only the owner or an admin can approve a playbook or a change to one`,
`only an agent or the owner or an admin can propose a playbook`,
`a change is already waiting for the owner; revise or withdraw it first`,
`the proposal changed since you looked: it is now revision N`. A stale
`expectedHeadEventId` is a write conflict (`conflict: playbook changed; current head is <id>`).

The `approvePlaybookChanges` switch in the co-founder settings does not weaken
this: every change to an approved playbook waits for the owner (spec section 8).

### Running copy head (relay signed, kind 30677, d-tag `company:playbook-job:<uuid>`)

```json
{
  "schemaVersion": 1,
  "jobId": "uuid", "playbookId": "uuid", "playbookVersion": 2, "playbookTitle": "Delivery playbook",
  "title": "Plane Tree Guesthouse",
  "status": "running | completed | cancelled",
  "currentStepId": "build",
  "steps": [{ "stepId": "build", "title": "Website build", "owner": { "...as above..." },
              "inputs": [], "outputs": [], "tools": [], "approvalPoint": null,
              "status": "pending | waiting_approval | approved | in_progress | done | blocked | skipped",
              "note": null, "progressLabel": "Round 1 of 2", "statusAt": 1793000000 }],
  "approvals": [{ "stepId": "approval", "decision": "approved | rejected", "actorPubkey": "hex", "at": 1793000000, "note": null, "actionEventId": "hex" }],
  "handoffs": [{ "stepId": "launch", "from": { "...owner..." }, "to": { "...owner..." }, "byPubkey": "hex", "at": 1793000000, "note": null, "actionEventId": "hex" }],
  "startedByPubkey": "hex", "startedAt": 1793000000, "endedAt": null,
  "updatedByPubkey": "hex", "updatedAt": 1793000000, "sourceActionEventId": "hex"
}
```

- The steps are copied from the playbook version the job started from, so a
  later version never rewrites a job in flight.
- `currentStepId` is the first step that is not `done` or `skipped`; absent once
  the job completed or was cancelled. Steps run in order: only the current step
  moves. The job becomes `completed` when every step is `done` or `skipped`.
- A step with an approval point cannot start until the owner approved it
  (`pending` or `waiting_approval` then `approved` then `in_progress`). The
  doer asks with `request_step_approval` (`waiting_approval`), which is a Needs
  you "approve" item; a founder step with an approval point is at its point as
  soon as it is current. Rejecting skips the step. `blocked` needs a note and
  can resume to `in_progress`; a gated step cannot be blocked around its
  approval. A prepared founder step with no approval point goes `pending` to
  `done` ("Do" in Needs you).
- `progressLabel` is a free short line the doer sets on a step update.

### Running copy action (member signed, kind 47067, d-tag `company:playbook-job:<uuid>`)

Content: `{ schemaVersion: 1, jobId, kind, playbookId?, playbookVersion?, title?, stepId?, stepStatus?, progressLabel?, handOffTo?, note?, expectedHeadEventId? }`.
Every kind except `start` names the exact current head event id.

| `kind` | Who | Carries | Effect |
| --- | --- | --- | --- |
| `start` | agent, owner or admin, mode on | `playbookId`, `title`, optional `playbookVersion` | new running copy of the approved version; refused for an unapproved or archived playbook, or a moved `playbookVersion` |
| `update_step` | step doer, owner or admin | `stepId`, `stepStatus` (`in_progress`, `done`, `blocked`, `skipped`), `note`, `progressLabel` | moves the current step |
| `request_step_approval` | step doer | `stepId`, optional `note` | `waiting_approval` |
| `approve_step` / `reject_step` | owner or admin only | `stepId`, optional `note` | `approved`, or `skipped`; recorded |
| `hand_off` | step doer, owner or admin | `stepId`, `handOffTo` (an owner as above), optional `note` | changes the step's owner (another function, a lead agent, a worker type or the founder); recorded; refused for an ended step, the same owner, or a worker with an outreach or spend point |
| `cancel` | whoever started it, owner or admin | optional `note` | `cancelled` |

Step doers: the starter, the step's agent, the lead of the step's function,
owners and admins. A step for the founder is only moved by an owner or admin.
Refusals: `this step waits for the owner's approval before it can run`,
`step X is not the current step; the job is at step Y`,
`you are not the doer of this step`,
`that playbook has no approved version yet; the owner has to approve it first`.

### CLI (agents and owner)

`colony playbooks propose --file playbook.json [--playbook <id> --summary "..."]`
(new playbook, prints `playbookId`; with `--playbook` a change),
`list [--status proposed|active|archived|rejected]`, `show <playbookId>`,
`revise <playbookId> --file ... [--summary ...]`, `withdraw <playbookId>`,
owner only: `approve|reject <playbookId> [--revision N] [--note ...]`,
`edit <playbookId> --file ...`, `archive <playbookId>`;
jobs: `start <playbookId> --title "Plane Tree Guesthouse" [--version N]` (prints `jobId`),
`jobs [--playbook <id>] [--status running|completed|cancelled]`, `job <jobId>`,
`step <jobId> <stepId> --status in_progress|done|blocked|skipped [--note ...] [--progress "Round 1 of 2"]`,
`request-approval <jobId> <stepId>`, owner only: `approve-step|reject-step <jobId> <stepId>`,
`hand-off <jobId> <stepId> --function <fn> | --agent <hex> | --worker <type> | --founder`,
`cancel <jobId>`, `approvals [--playbook <id>]` (the durable decision record).
The Scout nest skill (version 20) teaches designing playbooks with the founder
in chat, one short question at a time, only while co-founder mode is on.

Desktop read model: `desktop/src/features/cofounder/playbook*.ts`. Mock bridge seeds: `desktop/src/testing/cofounderPlaybookFixtures.ts`.

## Numbers: scorecard, goals and the weekly review

One relay-signed head kind (30678) and one member action kind (47068) carry
three community-wide record families (no `h` or `p` tag), told apart by d-tag.
They are new records, so a desktop that predates them keeps loading every older
list. No key was added to an existing record.

| d-tag | Record | Head content |
| --- | --- | --- |
| `company:scorecard` | The live scorecard of the five functions and the approved goals' progress | `ScorecardHead` |
| `company:fngoal:<uuid>` | One goal of one function | `GoalHead` |
| `company:review:<YYYY-MM-DD>` | The weekly review of the week that ended that Friday | `ReviewHead` |

**The relay counts every number.** No caller writes a figure. A scorecard and a
review get theirs from `buzz_relay::numbers_inputs`, which reads the company's
own records, and `buzz_core::company_numbers::compute_scorecard` turns them into
numbers. An agent writes words only: a goal proposal, the wins and misses of a
review and the decisions the owner must make.

A scorecard looks at the seven days before `asOf` and compares them with the seven
days before that, so a change is always between two equally long periods. Windows
are half open, `[start, end)`, in Unix seconds.

| Function | Number (`metric`) | What is counted |
| --- | --- | --- |
| Sales | `leads_found` | prospects whose first accepted `create` action (kind 47034) is in the window |
| Sales | `contacted` | WhatsApp new chats whose first message the provider accepted in the window |
| Sales | `replied` | contacts whose first inbound message after their new chat arrived in the window |
| Sales | `quotes` | proposals whose first version (revision 1, kind 47003) was written in the window |
| Sales | `won` | proposals accepted (kind 47004) in the window, once per proposal |
| Operations | `workers_started` | worker runs started in the window |
| Operations | `workers_done` / `workers_failed` | runs that ended well, or failed or ran past their deadline, in the window |
| Operations | `plans_approved` | whole-plan approvals in the window |
| Customer Success | `active_clients` | clients that are active now (no previous value) |
| Finance | `cash_in` | payment evidence (kind 47027) received in the window; refunds are not netted off |
| Finance | `invoiced` | issued invoices (not drafts, not void) issued in the window |
| Finance | `owed` | what issued invoices still owe now (no previous value) |
| Finance | `worker_cost` | cost of worker runs started in the window, in US dollar cents |
| Brand | `cost_per_win` | worker cost of the window divided by the proposals won in it, rounded half up; `null` when nothing was won |

A number that cannot be stated is `null`, never zero. Numbers the spec names that
Colony has no record of yet (`calls`, `jobs_in_progress`, `days_to_deliver`,
`revisions`, `renewals`, `referrals`, `recurring`) are listed in the function's
`notTracked` and shown as "not tracked yet". Money is stated in one currency, the
one most of the company's payments and invoices use (`ZAR` when there are none);
facts in another currency are left out and counted in `otherCurrencyFacts`.

A kind 47068 action carries `schemaVersion`, `op` and only the fields that op
takes (anything else is refused), plus `expectedHeadEventId` where the op changes
an existing head. The d-tag is the record the op changes.

| `op` | Who | Carries | Effect |
| --- | --- | --- | --- |
| `goal_propose` | any member or agent, co-founder mode on | `goalId`, `function`, `title`, `metric`, `target`, `period`, `reason` | new goal, `proposed` |
| `goal_approve` / `goal_reject` | owner or admin | `goalId`, `note`, expected head | goal `approved` or `rejected`; recorded |
| `goal_retire` | the proposer, owner or admin | `goalId`, `note`, expected head | goal `retired` |
| `scorecard_refresh` | any member or agent, co-founder mode on | nothing | the relay recounts and replaces `company:scorecard`; a scorecard younger than a minute is not recounted |
| `review_annotate` | owner, admin or an agent | `reviewDate`, `wins`, `misses`, `decisions`, expected head | words replace the review's words; numbers never change; final once the owner answered a decision |
| `review_decide` | owner or admin | `reviewDate`, `decisionId`, `choice` (`approved`, `declined`, `deferred`), `note`, expected head | the decision is answered once |

Rules enforced by the relay (`buzz_core::company_numbers`):

- A managed agent never approves or rejects a goal or answers a decision, whatever
  role row it has. A person who is not an owner or admin does not either.
- A goal measures a number of its own function (Sales: `won`, Finance: `cash_in`).
  Its `period` is `week` (the latest seven days) or `month` (the calendar month so
  far, in Johannesburg). A company keeps at most 50 open goals.
- Only approved goals are tracked in `company:scorecard`'s `goals` with `current`
  and `percent` (at most 1000).
- Switching co-founder mode off stops new goals, approvals, refreshes and review
  words; nothing already written changes.

**The Friday review.** The relay wake sweep writes `company:review:<Friday>` once,
after Friday 14:00 UTC (16:00 in Johannesburg) and until Monday 14:00 UTC, with the
numbers of the seven days up to that Friday cut and the seven days before it. It
then queues the wake `weekly:<Friday>`; Scout reads the review with
`colony numbers review show <Friday>`, writes the wins, misses and up to five
decisions with `colony numbers review write <Friday> --file -`, and posts one short
message linking `colony://numbers/review/<Friday>`. Each open decision shows in
Needs you (decide); the owner answers with `review_decide`. The review head is
`createdAt` at the time the relay wrote it and is never rewritten by the relay.

CLI: `colony numbers scorecard [--function <function>] [--no-refresh]`,
`colony numbers goals list|propose|approve|reject|retire` and
`colony numbers review list|show|write|decide`.

## Proof boundaries

Kind registration and typed content live in `buzz-core`; relay, SDK, CLI, and
desktop implementation each have their own proof gates. Relay integration
tests cover authority, exact-head races, due-date lifecycle, suggestion
acceptance atomicity, and watchdog retry and cancellation using an injected
clock. Desktop E2E covers suggestion acceptance, watchdog saved and failed
states, timeline activity, reload, and community switching, with visual
comparison against the approved baseline routes.
