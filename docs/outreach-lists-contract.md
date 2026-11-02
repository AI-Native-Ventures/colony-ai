# Outreach lists and shared Discovery campaigns (contract)

Status: contract v1 for OL-RELAY (server, CLI, agent skill) and OL-UI (desktop). OL-UI builds
against this file. Design: `docs/superpowers/specs/2026-11-02-outreach-lists-mentions-design.md`
(branch `docs/outreach-lists-admin`), including "Owner answers (2 Nov 2026)".

Owner answers that shape this contract:

- Lists are visible and editable by everyone with Sales access, people and agents alike.
- Scout may create and name a list on its own when it helps, and says so. Sending still always
  needs the owner's approval.
- Templates are mentioned and picked by NAME only. There is no "template 1" numbering anywhere.

The relay deploy must go out before the desktop release that uses these kinds (a desktop that
publishes 47075 to an old relay is refused as an unknown kind).

## 1. Kinds

Checked free on `origin/main` (2 Nov 2026). 30680 is `KIND_COFOUNDER_LEAD_HEAD` (#669). Money
rails (#668) took 30686, 30687, 47077, 47078, so this block is 30684, 30685, 47075, 47076.

| Kind | Constant | Author | What |
|---|---|---|---|
| 30684 | `KIND_OUTREACH_LIST_HEAD` | relay only | Addressable head of one outreach list. |
| 47075 | `KIND_OUTREACH_LIST_ACTION` | member or agent | One change to a list. |
| 30685 | `KIND_DISCOVERY_CAMPAIGN_HEAD` | relay only | Addressable head of one Discovery campaign. |
| 47076 | `KIND_DISCOVERY_CAMPAIGN_ACTION` | member or agent | One change to a campaign. |

Both pairs are business-record kinds: they ride the business broker
(`crates/buzz-relay/src/handlers/business_records.rs`) exactly like leads (30644 and 47034), so
channel scoping, replay protection, atomic head writes and the community write fence are
inherited, not re-implemented.

## 2. Scope, tags, ids

- Every action and every head carries `["h", <business channel uuid>]` and one `["d", ...]`.
  The business channel is the registered Sales channel (`get_business_channel_id`); an action
  aimed at any other channel is refused.
- d tags (same namespace rule as leads, `business:<community uuid>:<type>:<uuid>`):
  - list: `business:<community>:outreach_list:<listId>`
  - campaign: `business:<community>:discovery_campaign:<campaignId>`
- `listId` is a UUID the author mints. `campaignId` is the UUID the desktop already mints for a
  Discovery campaign (the `campaign:<id>` external id on its leads), so existing leads join
  their campaign unchanged.
- Heads are signed by the relay key. Readers query `{"kinds":[30684],"authors":[<relay self>]}`
  (relay `self` comes from the NIP-11 document) and keep the newest per `d` tag.
- All JSON is camelCase with `deny_unknown_fields`. `schemaVersion` is `1`.

## 3. Permissions

| Caller (role in the business channel) | Create / rename / add / remove / set default template | Archive / unarchive |
|---|---|---|
| owner, admin, member | yes | yes |
| bot (agent with Sales access) | yes | no (only people archive) |
| guest, not a channel member | no | no |

A token scoped to other channels cannot write (same rule as leads). Opted-out contacts may be
list members; every WhatsApp batch skips them, as today.

Campaign actions: `create`, `progress`, `finish`, `rename` by owner, admin, member or bot
(the desktop publishes as a run moves; an agent that runs `colony discovery search --save`
publishes for its own run); `archive` by people only.

## 4. Outreach list

### 4.1 Action (kind 47075), content

```json
{
  "schemaVersion": 1,
  "listId": "uuid",
  "op": "create | rename | add_members | remove_members | set_default_template | archive | unarchive",
  "expectedHeadEventId": "64 hex, absent only for create",
  "name": "Melville guesthouses, Nov",
  "note": "optional text",
  "leadIds": ["uuid", "..."],
  "source": { "kind": "manual | campaign | agent", "campaignId": "uuid, only for campaign" },
  "defaultTemplate": { "name": "meta_template_name", "language": "en" }
}
```

Field use per op (fields not listed for an op must be absent, otherwise `invalid`):

| op | needs | effect |
|---|---|---|
| `create` | `name`, `source`, optional `note`, optional `leadIds`, optional `defaultTemplate` | New list. No `expectedHeadEventId`. |
| `rename` | `name` and/or `note` (empty note clears it) | Changes the title and note. |
| `add_members` | `leadIds` (1 to 500) | Appends the ids not yet in the list, in order. Ids already present are ignored. |
| `remove_members` | `leadIds` (1 to 500) | Drops the ids. Ids not present are ignored. |
| `set_default_template` | optional `defaultTemplate` (absent clears) | Sets or clears the default template. |
| `archive` / `unarchive` | nothing | Flips `status`. Archived lists accept only `unarchive`. |

Rules:

- `name`: 1 to 80 characters after trimming, no control characters. `note`: at most 500.
- A list holds at most 500 distinct leads. An `add_members` or `create` that would pass 500 is
  refused whole with `invalid: a list holds at most 500 leads`.
- Every id in `leadIds` must be a lead (kind 30644 head) in the same business channel when it
  is added, otherwise the whole action is refused with `invalid: unknown lead <id>`. Lists hold
  lead ids only, never copies of lead data. A lead that is later deleted or merged stays in
  `members`; readers show it as "no longer exists" (the CLI lists it under `missing`).
- Non-create ops may carry `expectedHeadEventId`. When present it must equal the current head
  or the action is refused with `conflict`. When absent the relay applies the op to the current
  head inside the same transaction (membership edits commute, so agents and people do not have
  to fence). A race with another writer still surfaces as `conflict`; the CLI re-reads and
  retries up to 3 times.
- The same event id replayed is accepted once (`duplicate: already processed`).

### 4.2 Head (kind 30684), content

```json
{
  "schemaVersion": 1,
  "listId": "uuid",
  "name": "Melville guesthouses, Nov",
  "note": "optional text or null",
  "status": "active | archived",
  "source": { "kind": "manual | campaign | agent", "campaignId": "uuid or null" },
  "defaultTemplate": { "name": "meta_template_name", "language": "en" },
  "members": [
    { "leadId": "uuid", "addedBy": "pubkey hex", "addedByAgent": false, "addedAt": 1762000000 }
  ],
  "createdBy": "pubkey hex",
  "createdByAgent": true,
  "createdAt": 1762000000,
  "updatedBy": "pubkey hex",
  "updatedAt": 1762000100,
  "sourceActionEventId": "64 hex"
}
```

`members` keeps add order. `defaultTemplate` and `note` are `null` when unset.
`createdByAgent` and `addedByAgent` are decided by the relay from the caller's role (`bot`), not
claimed by the caller, so the UI can say "Created by Scout" truthfully.

### 4.3 Errors (relay `OK false` message prefixes)

`forbidden:` caller role or channel scope. `conflict:` stale `expectedHeadEventId`, create of an
existing list, edit of an archived list, a race. `invalid:` bad shape, name, caps, unknown lead.
Messages are plain English and safe to show.

## 5. Discovery campaign

### 5.1 Action (kind 47076), content

```json
{
  "schemaVersion": 1,
  "campaignId": "uuid",
  "op": "create | progress | finish | rename | archive",
  "expectedHeadEventId": "64 hex, absent only for create",
  "name": "Restaurants prospects, Johannesburg",
  "audience": "businesses | people",
  "industryName": "Food and drink",
  "verticalId": "restaurants",
  "verticalName": "Restaurants",
  "pickedTags": ["fine dining"],
  "query": "optional free-text search phrase",
  "area": "Johannesburg, South Africa",
  "target": 50,
  "found": 12,
  "skippedDuplicates": 3,
  "status": "running | paused | complete | cancelled | failed",
  "endNote": "plain-words reason or null",
  "runBy": { "kind": "person | agent", "pubkey": "hex" }
}
```

| op | needs |
|---|---|
| `create` | `name`, `audience`, `industryName`, `verticalId`, `verticalName`, `area`, `target` (1 to 500), `status`; optional `pickedTags` (at most 20), `query`, `runBy` |
| `progress` | `found`, `skippedDuplicates`, optional `status` (`running` or `paused`) |
| `finish` | `status` (`complete`, `cancelled` or `failed`), `found`, `skippedDuplicates`, optional `endNote` |
| `rename` | `name` |
| `archive` | nothing (people only) |

`progress` and `finish` never lower `found` or `skippedDuplicates`. Text limits: `name` 1 to 120,
`area`, `query`, `endNote` at most 300, tags at most 60 each. Prospect ids are NOT stored on the
campaign: a campaign's leads are the lead heads whose party external ids contain
`campaign:<campaignId>` (the existing rule), so the set can never go stale.

### 5.2 Head (kind 30685), content

The same fields as the action minus `op` and `expectedHeadEventId`, plus
`schemaVersion`, `status`, `found`, `skippedDuplicates`, `createdBy`, `createdByAgent`,
`createdAt`, `updatedAt`, `archived` (bool), `sourceActionEventId`.

### 5.3 Backfill (OL-UI)

On the first launch after the update, a desktop publishes one `create` for each campaign in its
local store, keeping the id, then one `finish` or `progress` to bring `found`, `status` and
`endNote` current. A `create` for an id that already has a head is answered `conflict:`; treat
that as done. The local store stays a cache of the shared record afterwards.

## 6. Entity links (what a message contains)

A mention is plain text in the message body, so any agent reads it with no client:

| Thing | Link | Notes |
|---|---|---|
| list | `buzz://list/<listId>` | |
| campaign | `buzz://campaign/<campaignId>` | |
| template | `buzz://template/<url-encoded Meta template name>?lang=<code>` | By NAME. `lang` is optional (defaults to the template's only language, or `en`). The chip shows the Colony title. |
| lead | `buzz://lead/<leadId>` | Unchanged. |

`buzz://` is what clients write (like `lead_link`), `colony://` is read as the same thing.
Links carry no credentials, port or fragment. A list or campaign link takes no query; a template
link takes only `lang`. Anything else is refused by the CLI with a usage error.

Template mention form: the Meta template name is the stable key (a Colony title can be renamed
by the owner), so the chip stores the Meta name and displays the current Colony title. The
picker and every agent command also accept the Colony title or the Meta name as typed text
(case-insensitive); an ambiguous title is refused with the matching names listed. No number
form exists.

A stale link (list archived or never existed, template removed) resolves to a calm
"no longer available" chip in the UI; the CLI says exactly why (`list <id> was archived`).

## 7. CLI

All commands return the normal JSON contract: reads are JSON arrays or objects, writes are
`{event_id, accepted, message}` plus the entity id and `reference`.

```
colony lists list [--query <text>] [--archived] [--limit N]
colony lists get <id|link>
colony lists create --name <text> [--lead <id|link>]... [--from-campaign <id|link>]
                    [--note <text>] [--template <name|title|link>] [--language <code>]
colony lists add <list> --lead <id|link>...
colony lists remove <list> --lead <id|link>...
colony lists rename <list> [--name <text>] [--note <text>]
colony campaigns list [--query <text>] [--archived] [--limit N]
colony campaigns get <id|link>
colony whatsapp templates get <name|title|link>
colony whatsapp batch create --list <id|link> --template <name|title|link> ... (existing flags)
```

`lists list` row: `{listId, reference, name, note, status, size, source, defaultTemplate,
updatedAt}`.

`lists get`:

```json
{
  "listId": "uuid", "reference": "buzz://list/<id>", "name": "...", "note": null,
  "status": "active", "source": {"kind": "agent", "campaignId": null},
  "defaultTemplate": {"name": "built_a_site", "language": "en"},
  "createdByAgent": true, "updatedAt": 1762000100, "size": 12,
  "members": [{
    "leadId": "uuid", "reference": "buzz://lead/<id>", "name": "Rosebank Guest House",
    "stage": "new", "phone": "+27 82 000 0000", "website": "https://...", "contactName": null,
    "whatsapp": { "status": "none | queued | waiting_for_approval | sent | replied | opted_out | null",
                  "optedOut": false },
    "addedByAgent": false, "addedAt": 1762000000
  }],
  "missing": ["uuid of a member whose lead no longer exists"]
}
```

`whatsapp` is matched by phone number and is `null` for a lead with no phone or when the caller
cannot read WhatsApp contacts. Membership in `members` is never filtered by it.

`campaigns get` returns the campaign head fields plus `reference`, `leadCount` and `leads`
(`[{leadId, reference, name, stage, phone}]`, from the `campaign:<id>` external id).

`colony whatsapp templates get` returns `{name, title, language, category, status, body, slots,
buttons, reference}` for one template, or a usage error naming the matches when ambiguous.

`whatsapp batch create --list` takes the rows from the list's active members. Members without a
phone, opted out, or whose lead no longer exists are not sent; they are printed as `skipped`
with a reason, and the batch still waits for owner approval. `--list` cannot be combined with
`--lead` or `--stage`.

## 8. Agent skill

`desktop/src-tauri/src/managed_agents/nest_skill.md` gets a "Lists, campaigns and templates"
section: resolve every `buzz://list|campaign|template|lead` link with the matching `get` before
answering, "these" after a list chip means that list's members, never ask for ids, a list may be
created when it helps (say so in the reply and give the link), research then update lead records,
a batch for a list always waits for the owner.

## 9. Acceptance (OL-RELAY)

- Relay Postgres tests: permissions (member, admin, owner, bot, guest, wrong channel), create
  and every op, caps, unknown lead, archive rules, replay, expected-head conflict, head content.
- CLI parse and output tests, link and template resolution tests.
- Skill tests for the new section.
- Red proof PR `redproof/ol-relay` (base main) failing on the intended assertion.
