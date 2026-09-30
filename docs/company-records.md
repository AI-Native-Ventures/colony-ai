# Colony company record contracts

Status: company layer batches 1, 2, and 3 contract (Asks, Goals, Company Work,
and member positions), PERM-1 standing tool permissions, secret bindings,
FACTORY-1 Factory run preview and pull request records, HIRE-1 employee hiring,
WORK-2 company work tracking APIs, DUTY-1 employee duties, and LESSON-1
employee lessons.
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
| 30655 | Employee duty head | Relay signed, replaceable | Company duties |
| 30656 | Employee lesson head | Relay signed, replaceable | Employee lessons |
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
| 47044 | Employee duty action | Brokered | Company duties |
| 47045 | Employee lesson action | Brokered | Employee lessons |

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
The existing catalog records do not yet expose these fields, so HIRE-1 adds the
metadata to those real records and their existing catalog projections. Catalog
entries without `companyRole` metadata are not presented as hire role packs.

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
`company:hire:<hire-uuid>`. The `create` action has no
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
An owner approval can record the ask resolution and founder approval in the
same transaction. `approve` and `complete` name the exact current
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
marker so a retry cannot publish a duplicate. `complete` verifies the real
agent and introduction event, then atomically advances the hire head and creates
the employee member-position head. The profile opens with the configured title,
manager, channel, and runtime values after that transaction succeeds.

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

NEEDS_DESIGN: the frozen role-picker and configure screens do not specify the
empty role-catalog state or what to show when no supported runtime, provider,
or model is available. The flow uses live catalog records and does not invent
fallback roles or models; these states need design before they can be handled
in the UI.

NEEDS_DESIGN: the existing `CommunityCatalogDialog` and `AgentDialog` do not
expose a role-pack editor for `companyRole`, and this repository has no shipped
role-pack values. The hire picker can show only real catalog entries that
already contain valid metadata. Designing how owners curate those fields is
required before the catalog can be populated through the app.

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

## Proof boundaries

Kind registration and typed content live in `buzz-core`; relay, SDK, CLI, and
desktop implementation each have their own proof gates. Relay integration
tests cover authority, exact-head races, due-date lifecycle, suggestion
acceptance atomicity, and watchdog retry and cancellation using an injected
clock. Desktop E2E covers suggestion acceptance, watchdog saved and failed
states, timeline activity, reload, and community switching, with visual
comparison against the approved baseline routes.
