# WhatsApp outreach (official Cloud API)

Task C3-WA-RELAY-1. This is the contract between the relay, the `colony` CLI and the
desktop UI (C3-WA-UI-1). One WhatsApp Business number per company (a company is a
community, host-bound like every other relay API).

The relay is the only place that calls the Graph API. Secrets (access token, app
secret) are sealed with the relay KEK, never logged, never returned, never sent to agents.

Graph version lives in one constant: `GRAPH_API_VERSION` in
`crates/buzz-relay/src/whatsapp/graph.rs`.

## Who may do what

| Action | Owner/admin | Outreach channel member (agent) | Other members |
| --- | --- | --- | --- |
| connect, disconnect | yes | no | no |
| change daily cap, sync templates | yes | no | no |
| approve, reject, edit or drop batch rows | yes | no | no |
| create batch | yes | yes | no |
| send a message (free text in the window, follow-up template) | yes, sent at once | yes, but only as a DRAFT | no |
| approve, edit or reject an agent draft | yes | no | no |
| send a template to a NEW chat outside a batch | yes (counts to cap) | no, use a batch | no |
| read status and templates | yes | yes | yes (no secrets, no numbers) |
| read contacts, inbox, batches, drafts, threads | yes | yes | no |

"Outreach channel member" means an active member of the company's private `Outreach`
channel. The relay creates it on connect (private, owner and admins added). The owner
adds agents to it with the normal channel member flow.

## HTTP (NIP-98 authed, same as `/discovery/search`)

HTTP is used only where an event cannot work: secret intake, and role filtered reads of
relay owned private tables (opt-out state and phone numbers must not fan out as events
to every member).

### `POST /api/whatsapp/connect` (owner/admin)

```json
{ "accessToken": "...", "phoneNumberId": "...", "wabaId": "...", "appSecret": "..." }
```

The relay checks the token against Graph (`GET /{phone-number-id}?fields=display_phone_number,verified_name,quality_rating,status`),
stores the token and app secret sealed, points the number's webhook at
`https://<relay host>/hooks/whatsapp/<connectionId>` (override callback URI plus a random
verify token), subscribes the app to the WABA, creates the Outreach channel if missing and
syncs approved templates. Response: the status object below. Errors carry `code`:
`whatsapp_not_configured` (503, relay has no KEK), `whatsapp_invalid_input` (400),
`whatsapp_token_rejected` (502), `whatsapp_graph_unavailable` (502),
`whatsapp_already_connected` (409, disconnect first).

### `POST /api/whatsapp/disconnect` (owner/admin)

Removes the webhook override, deletes the sealed secrets, marks the connection
disconnected. History stays. Response: status object.

### `POST /api/whatsapp/query`

Body `{ "what": "<name>", ... }`. Every response is JSON.

| `what` | extra fields | roles | result |
| --- | --- | --- | --- |
| `status` | none | any member | status object |
| `templates` | `refresh` (bool, owner/admin only) | any member | `{ "templates": [Template] }` |
| `batches` | `state` optional | owner/admin, Outreach member | `{ "batches": [BatchSummary] }` |
| `batch` | `batchId` | owner/admin, Outreach member | `BatchDetail` |
| `drafts` | `limit` | owner/admin, Outreach member | `{ "drafts": [Message + to, params] }` pending agent drafts, oldest first |
| `contacts` | `limit`, `before` | owner/admin, Outreach member | `{ "contacts": [Contact] }` |
| `inbox` | `limit` | owner/admin, Outreach member | contacts whose latest inbound message has no reply yet |
| `thread` | `waId`, `limit` | owner/admin, Outreach member | `{ "contact": Contact, "messages": [Message] }` with live delivery state |

Status object:

```json
{
  "connected": true,
  "connectionId": "uuid",
  "displayPhoneNumber": "+27 ...",
  "verifiedName": "Horizon Labs",
  "quality": "GREEN",
  "phoneStatus": "CONNECTED",
  "dailyNewChatCap": 30,
  "newChatsSentToday": 4,
  "sendingPaused": false,
  "pauseReason": null,
  "issues": [{ "code": "quality_red", "message": "...", "at": "2026-10-29T08:00:00Z" }],
  "outreachChannelId": "uuid",
  "templatesSyncedAt": "2026-10-29T08:00:00Z",
  "templates": [],
  "webhookUrl": "https://host/hooks/whatsapp/uuid"
}
```

`issues[].code` is one of `token_expired`, `number_disconnected`, `quality_yellow`,
`quality_red`, `template_paused`, `webhook_failing`. Sending stops by itself on `quality_red`.

Template: `{ title, name, proposedTitle, titleCustom, language, category, status, body, slots,
buttons: [{type, text}] }`.

* `title` is the Colony display title. **Agents and the UI show and use the title.** `name` is
  the Meta template name (`hl_vb`): it stays the send key and belongs in a details view only.
* When a template is first synced its title defaults to the first six words of the body with the
  `{{n}}` slots left out (falls back to the Meta name with spaces). An owner or admin can rename it;
  a renamed title (`titleCustom: true`) survives every later sync, an untouched default follows the body.
* An agent can propose a better title; it shows as `proposedTitle` and changes nothing until an
  owner or admin renames (which clears the proposal).
* Anywhere a template is named (batch `template`, send `template.name`, rename `template`) the
  relay accepts the Meta name or the title (case insensitive, same language). An ambiguous title
  (two templates share it) is refused: use the Meta name.
* `body` keeps `{{1}}` style slots; `slots` is the highest slot number.
* `buttons` keeps each template's buttons from Meta (quick replies included) on every sync.

Contact: `{ waId, e164, displayName, leadId, ownerPubkey, threadRootEventId, lastInboundAt,
windowOpen, windowClosesAt, optedOut, paused, pauseReason, unanswered }`.

Message: `{ id, waId, direction: "in"|"out", kind: "text"|"template"|"media"|"button", text,
templateName, state: "draft"|"rejected"|"queued"|"sending"|"sent"|"delivered"|"read"|"failed"|"unconfirmed",
errorCode, errorText, eventId, senderPubkey, createdAt }`. `text` is the current text (after an owner edit).

BatchSummary: `{ batchId, status: "pending"|"approved"|"rejected"|"completed",
createdBy, template, language, rows: {total, ready, sent, failed, dropped}, createdAt }`.
BatchDetail adds `rows: [{ idx, to, leadId, params, preview, state, skipReason }]` and
`materialLinks`.

Polling the `thread` query is how the UI sees delivery state; the Colony message event
for an outbound message is immutable.

## Webhook `GET|POST /hooks/whatsapp/{connectionId}`

* `GET`: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Echoes the challenge
  only when the token matches the stored verify token (constant time).
* `POST`: body capped at 256 KiB. `X-Hub-Signature-256: sha256=<hex>` is the HMAC of the raw
  body with the app secret, compared in constant time; wrong or missing signature is `401`
  and nothing is stored. Messages are deduped by WhatsApp message id.
* The company is bound from the request host, then the connection id must belong to it.

## Events (member signed commands, handled by the relay)

The commands are requests, not stored events: the relay validates them and records the
result in its own tables (batch, message and contact rows), and posts a short notice in the
Outreach channel (`batch_pending`, `batch_approved`, ...). They carry no `h` tag (the CLI sends
none). The ingest result `message` carries the plain refusal reason when an event is
rejected (`restricted: ...` or `invalid: ...`); a repeat of an idempotent command is
accepted with a `duplicate: ...` message. Content is JSON, `"v": 1`.

### `47046` `KIND_WHATSAPP_BATCH` (owner/admin or Outreach member)

```json
{
  "v": 1,
  "batchId": "uuid chosen by the sender",
  "template": "intro_offer",
  "language": "en",
  "rows": [
    { "to": "+27821234567", "leadId": "uuid or null", "params": ["Thabo", "Horizon Labs"] }
  ],
  "materialLinks": ["https://..."],
  "note": "optional text for the approver"
}
```

The relay validates the template (approved, slot count matches), normalises numbers to E.164,
re-renders every preview itself and stores the batch as `pending`. A pending batch never sends.
Opted-out or paused numbers are refused at create time with a clear reason per row.
Maximum 500 rows. Re-sending the same `batchId` is an idempotent no-op.

### `47047` `KIND_WHATSAPP_BATCH_DECISION` (owner/admin only): decides a batch OR one draft

```json
{
  "v": 1,
  "batchId": "uuid",
  "decision": "approve" | "reject",
  "dropRows": [3, 7],
  "editRows": [{ "idx": 2, "params": ["Naledi", "Horizon Labs"] }]
}
```

Edits and drops apply to a pending batch only, before the decision. Approve makes the
remaining rows `ready`. Reject is final.

To decide one agent draft (see `47048`) send `draftId` instead of `batchId`:

```json
{ "v": 1, "draftId": "<message id>", "decision": "approve" | "reject",
  "text": "edited text (text draft only)", "params": ["edited", "params (template draft only)"] }
```

Approve can be one tap in the thread (no edit fields). Approval re-checks every send rule at that
moment (opted out, paused, quality stop, 24 hour window for free text, one message in a row); a
refused approval leaves the draft pending with the plain reason. A draft can be decided once: a
repeat is answered `duplicate: this draft was already decided`.

### `47048` `KIND_WHATSAPP_SEND_REQUEST` (owner/admin or Outreach member)

```json
{ "v": 1, "requestId": "uuid", "to": "+27821234567", "text": "..." }
```

or `"threadRoot": "<hex event id>"` instead of `to`, and `"template": { "name", "language", "params" }`
instead of `text`. Rules the relay enforces:

1. Contact opted out or paused: refused with the reason.
2. `text` only inside the 24 hour window after the contact's last inbound message.
3. Outside the window only a template. A template to a NEW chat needs an approved batch,
   unless the sender is owner/admin (then it counts to the daily cap).
4. More than one outbound message in a row without a reply is refused (`one message at a time`).
5. Quality RED or paused connection: refused.

**Who approves what (owner decision, 29 Oct):** approving a batch approves ONLY the first message
of each row. EVERY later outbound message from an agent (reply inside the window, follow-up
template, files, links) is a DRAFT: the request is stored with state `draft`, mirrored into the
contact's thread with tags `wa-draft` and `wa-msg` (the message id), and the answer is
`draft pending approval: <id>`. A draft never reaches Graph; the sender only reads `queued` and
`ready` rows. An owner or admin approves, edits or rejects it with `47047`. A message the owner or an
admin sends themselves is the approval: it is `queued` and sent at once. One draft at a time per
contact (a pending draft counts toward rule 4). Free text still only inside the 24 hour window.

The request is stored durably and sent by the relay worker. `requestId` is the idempotency
key: one request is at most one Graph send.

### `47049` `KIND_WHATSAPP_SETTINGS` (owner/admin; agents may only propose a title)

```json
{ "v": 1, "dailyNewChatCap": 30 }
{ "v": 1, "syncTemplates": true }
{ "v": 1, "templateTitle": { "template": "hl_vb", "language": "en", "title": "Voice note offer", "propose": false } }
```

Cap range 0 to 1000. Takes effect immediately. Default 30.
`templateTitle` with `propose: false` renames (owner/admin only, max 80 characters, kept across
syncs). With `propose: true` any owner, admin or Outreach member can suggest a title; nothing
changes until an owner or admin renames. A `template_title_proposed` notice is posted in Outreach.

## Sending, pacing, cap

* Approved batch rows send between 08:00 and 18:00 Africa/Johannesburg, one every 3 to 6
  minutes (deterministic jitter per row), never past the daily cap of NEW chats
  (a new chat is a template send to a contact with no open window). Unsent rows roll to
  the next day automatically.
* Replies and follow-ups inside an open window are not capped and are not paced, but an agent's
  reply or follow-up waits for its own owner/admin approval (draft) before it is sent.
* One row = at most one Graph send. A row moves `ready -> sending -> sent`. A crash between
  the Graph call and the record leaves it `sending`; after the lease expires it becomes
  `unconfirmed` and is NEVER resent automatically. The owner is told in the Outreach channel.

## Buttons and opt-out

A tap on a template quick-reply button arrives from Meta as a `button` (or interactive reply)
message. The relay treats it as the contact's reply: the button text becomes the message text in
the thread, it opens the 24 hour window and wakes the owning agent like any reply.

Inbound `stop`, `unsubscribe`, `no thanks`, `not interested` (trimmed, case insensitive,
trailing punctuation ignored) and a button whose text means the same (`Not interested`,
`Stop promotions`, `Unsubscribe`, `Opt out`) mark the contact
opted out. Every later send is refused: `contact opted out on <date>`. A Meta block or spam
error code on send pauses the contact and posts a notice in the Outreach channel.

## Outreach channel

One private channel named `Outreach`. Each contact has ONE thread:

* Root: relay signed kind 9 message, tags `h`, `["wa", "<waId>"]`, `["wa-name", "<name>"]`.
* Inbound: relay signed kind 9 reply in that thread, tags `h`, `e` (root), `["wa", "<waId>"]`,
  `["wa-dir", "in"]`, `["wamid", "<id>"]`, optional `["lead", "<leadId>"]`, and
  `["p", "<owning agent>"]` so the agent is woken. The UI shows the contact as the author
  (the `wa-name` tag), not the relay.
* Outbound: same shape with `["wa-dir", "out"]`, `["wa-sender", "<pubkey>"]` and `["wa-msg", "<message id>"]`.
  An agent draft also carries `["wa-draft", "<message id>"]` and appears here when it is drafted
  (before it is sent); read its live state and current text from the `thread` query.
* Notices (token expired, quality change, template paused, contact paused, unconfirmed
  send, batch decisions): relay signed kind 9 in the channel with a `["wa-notice", "<code>"]` tag.

## CLI

`colony whatsapp drafts | draft approve | draft reject` (owner/admin decide), `status | templates | template-title | batch create | batch list | batch show |
batch approve | batch reject | send | contacts | inbox | thread | cap`. `templates` prints the title first
and the Meta name second; `template-title --template <title or Meta name> --title "..."` renames
(owner/admin) or, with `--propose`, suggests a title (agents). Help text and the colony skill carry the rules:
templates first, short human replies, never more than one message in a row without a reply,
stop words honored.
