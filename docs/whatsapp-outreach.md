# WhatsApp outreach (official Cloud API)

Task C3-WA-RELAY-1. This is the contract between the relay, the `colony` CLI and the
desktop UI (C3-WA-UI-1). One WhatsApp Business number per company (a company is a
community, host-bound like every other relay API).

The relay is the only place that calls the Graph API. Secrets (access token, app
secret) are sealed with the relay KEK, never logged, never returned, never sent to agents.

Graph version lives in one constant: `GRAPH_API_VERSION` in
`crates/buzz-relay/src/whatsapp/graph.rs`.

## Who may do what

| Action | Owner/admin | Agent (owned by owner/admin, or Outreach channel member) | Other members |
| --- | --- | --- | --- |
| connect, disconnect | yes | no | no |
| change daily cap, sync templates | yes | no | no |
| approve, reject, edit or drop batch rows | yes | no | no |
| `send_now` on an approved test batch (at most 3 rows) | yes | no, never | no |
| add or undo an opt-out or never-contact entry | yes | no | no |
| check, mark delivered, or resend an unknown send | yes | no | no |
| create batch | yes | yes | no |
| send a message (free text in the window, follow-up template) | yes, sent at once | yes, but only as a DRAFT | no |
| approve, edit or reject an agent draft | yes | no | no |
| send a template to a NEW chat outside a batch | yes (counts to cap) | no, use a batch | no |
| read status and templates | yes | yes | yes (no secrets, no numbers) |
| read contacts, inbox, batches, drafts, threads | yes | yes | no |

The agent column covers two kinds of caller, and neither can approve or send on its own:

- **An agent owned by the owner or an admin.** The relay reads `users.agent_owner_pubkey`,
  which it records from the verified NIP-OA auth tag when the agent authenticates, and checks
  that this owner is a current owner or admin of the company. No channel membership is
  needed, so it does not matter where the owner asks from (a DM with Scout works). Display
  names are never used. It works for already connected numbers with no reconnect. An agent
  owned by a plain member, by someone outside the company, or by nobody is refused, and an
  agent loses access when its owner is demoted.
- **An active member of the company's private `Outreach` channel.** The relay creates the
  channel on connect (private, owner and admins added). Adding an agent with the normal
  channel member flow still works and is the only way for an agent that has no recorded owner.

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
| `safety_check` | `identities: [{kind: "phone"|"email"|"domain", value}]` | any member | `{ "matches": [{kind, value}] }` for caller-provided active suppressions only |
| `suppressions` | `limit` | owner/admin | `{ "suppressions": [Suppression], "businessStops": [BusinessStop] }` |
| `unknown_sends` | `limit` | owner/admin | `{ "unknownSends": [Message] }` whose result needs an owner decision |
| `contacts` | `limit`, `before` | owner/admin, Outreach member | `{ "contacts": [Contact] }` |
| `inbox` | `limit` | owner/admin, Outreach member | contacts whose latest inbound message has no reply yet |
| `thread` | `waId`, `limit`, `includeHeld` (rows still waiting for a batch approval are left out unless true, so an older app never labels them approved) | owner/admin, Outreach member | `{ "contact": Contact, "messages": [Message] }` with live delivery state |

`thread` lists every message of the conversation except dropped rows, including rows of a batch that
is still pending. A `held` or `ready` row reads `state: "queued"` (with `awaitingApproval: true` for
rows of a pending batch) and a `skipped` row reads `failed` with its reason in `errorText`, so the
state is always one of `draft rejected queued sending sent delivered read failed unconfirmed`.
`Contact.displayName` is the WhatsApp profile name, else the name given on the batch row
(`rows[].name`, only when the contact has none), else the number in E.164 form.

Every `Contact` (in `contacts`, `inbox` and `thread`) carries `outreachStatus`, one of
`waiting_for_approval` (a row of a pending batch, nothing approved), `queued` (approved, not sent),
`sent` (a row reached Meta), `replied`, `opted_out` or `none`, plus `awaitingApproval` and
`hasSentOutbound` booleans. A contact whose only row is `held` is never `sent`.

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
  "ownerPaused": false,
  "ownerPausedBy": null,
  "ownerPausedAt": null,
  "issues": [{ "code": "quality_red", "message": "...", "at": "2026-10-29T08:00:00Z" }],
  "outreachChannelId": "uuid",
  "templatesSyncedAt": "2026-10-29T08:00:00Z",
  "templates": [],
  "webhookUrl": "https://host/hooks/whatsapp/uuid"
}
```

`issues[].code` is one of `token_expired`, `number_disconnected`, `quality_yellow`,
`quality_red`, `template_paused`, `webhook_failing`. Sending stops by itself on `quality_red`.
`ownerPaused`, `ownerPausedBy` and `ownerPausedAt` describe the active manual owner/admin pause.
They are additive so installed desktop clients safely ignore them.

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
windowOpen, windowClosesAt, optedOut, paused, pauseReason, unanswered, businessOutreachStopped,
businessStopReason }`. The two business-stop fields are additive booleans/text: installed desktops
ignore them, while the safety UI can show that a reply stopped the whole business.

Suppression: `{ id, identityKind: "phone"|"email"|"domain", identityValue, scope:
"opt_out"|"never_contact", reason, matchedRule, source, createdAt, undoneAt }`.
`BusinessStop` is `{ businessId, sourceWaId, reason, matchedRule, createdAt }`.

Message: `{ id, waId, direction: "in"|"out", kind: "text"|"template"|"media"|"button", text,
templateName, state: "draft"|"rejected"|"queued"|"sending"|"sent"|"delivered"|"read"|"failed"|"unconfirmed",
errorCode, errorText, eventId, senderPubkey, createdAt, sendsAt }`. `text` is the current text (after an owner edit).
`sendsAt` is an ISO time, set only for an approved row waiting to go out (otherwise `null`): the
moment the owner released it with `send_now`, else the start of the next send window for a new
chat (the pacing gap and the daily cap can still delay it a little), else the next sender pass.
Older apps ignore it.

A message that carries media also has `media` (additive; older apps ignore it):
`{ type: "image"|"video"|"audio"|"voice"|"document"|"sticker"|"location"|"contacts",
state: "stored"|"pending"|"failed"|"gone"|"none", url, mime, size, opaque, caption, filename,
animated, error, canRetry, description }` plus `latitude`, `longitude`, `name`, `address` for a
location and `contacts: [{ name, phones }]` for a contact card. `url` is set when `state` is
`stored`; it is a file on the company's own media host, read with the same member authorization as
any other file. `none` means there is nothing to download (location, contact card). `failed` with
`canRetry: true` offers Retry; `too_large` and a missing media id cannot be retried; `gone` means
Meta no longer has the file. `opaque: true` means the exact bytes were kept as a download because
the media checks refused them, so show a file card, not a picture. `description` is one plain
sentence for agents (`Customer sent a sticker`); the same `thread` query is what `colony whatsapp
thread` prints.

BatchSummary: `{ batchId, status: "pending"|"approved"|"rejected"|"completed",
createdBy, template, language, rows: {total, ready, sent, failed, dropped}, createdAt }`.
BatchDetail adds `rows: [{ idx, to, leadId, params, preview, state, skipReason, sendsAt }]`
(`sendsAt` as on Message) and `materialLinks`.

Polling the `thread` query is how the UI sees delivery state; the Colony message event
for an outbound message is immutable.

`safety_check` is deliberately narrower than the owner safety ledger. It canonicalizes at most
500 caller-supplied candidate identities and echoes only the values that match an active
suppression. It never reveals a suppression reason, source, or an identity the caller did not
submit. Discovery and list preparation use it before creating outreach work.

## Webhook `GET|POST /hooks/whatsapp/{connectionId}`

* `GET`: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Echoes the challenge
  only when the token matches the stored verify token (constant time).
* `POST`: body capped at 256 KiB. `X-Hub-Signature-256: sha256=<hex>` is the HMAC of the raw
  body with the app secret, compared in constant time; wrong or missing signature is `401`
  and nothing is stored. Messages are deduped by WhatsApp message id.
* The company is bound from the request host, then the connection id must belong to it.
* **Inbound media.** Every inbound type is kept, never reduced to a placeholder: `image`, `video`,
  `audio` and `voice`, `document` (with file name), `sticker` (with `animated`), `location`
  (coordinates, name, address) and `contacts` (names and numbers, at most ten cards). Reactions
  are not messages and are ignored; a button or list reply is the reply text; anything else is
  `[unsupported message]`. For a file, the Meta media id, MIME type and caption are stored on the
  message row (`whatsapp_messages.media`), and the relay downloads the bytes with the connection's
  token while the webhook is open (20 s at most), then keeps them in the company's own media store
  (host bound, 25 MiB cap, metadata stripped from JPEG and WebP, kept as a plain download when a
  media check refuses the bytes). The Colony message carries a `wa-media` tag (`kind`, `state`)
  and, once stored, an NIP-92 `imeta` tag and a markdown link in its text. A download that does
  not finish leaves a durable record (`media_state = pending`, `media_attempts`,
  `media_retry_at`): the sender loop retries it, 30 s doubling to 1 h, eight times, then marks it
  `failed` for the owner to retry. A file Meta no longer has (404, or code 100) is `gone`; a file
  over the cap is `failed` with `too_large`. When a file arrives after its message was posted, one
  follow-up message in the thread adds the link (`wa-media-of` names the message). The access
  token is never logged, and it is only sent to Meta's media hosts.

## Events (member signed commands, handled by the relay)

**Kind block.** This feature owns actions `47048` to `47055` (seven used: `47048` to `47054`) and,
if relay-signed heads are ever needed, `30660` to `30667` (none used today). `47046` and `47047` are
reserved for the business profile and team computer actions. Co-founder mode owns
`30670` to `30679` and `47060` to `47069`. A compile-time assert in `kind.rs` keeps the
WhatsApp kinds inside `47048..=47055`.

The commands are requests, not stored events: the relay validates them and records the
result in its own tables (batch, message and contact rows), and posts a short notice in the
Outreach channel (`batch_pending`, `batch_approved`, ...). They carry no `h` tag (the CLI sends
none). The ingest result `message` carries the plain refusal reason when an event is
rejected (`restricted: ...` or `invalid: ...`); a repeat of an idempotent command is
accepted with a `duplicate: ...` message. Content is JSON, `"v": 1`.

### `47048` `KIND_WHATSAPP_BATCH` (owner/admin or Outreach member)

```json
{
  "v": 1,
  "batchId": "uuid chosen by the sender",
  "template": "intro_offer",
  "language": "en",
  "rows": [
    { "to": "+27821234567", "leadId": "uuid or null", "name": "optional contact name", "params": ["Thabo", "Horizon Labs"] }
  ],
  "materialLinks": ["https://..."],
  "note": "optional text for the approver"
}
```

The relay validates the template (approved, slot count matches), normalises numbers to E.164,
re-renders every preview itself and stores the batch as `pending`. A pending batch never sends.
Opted-out, paused, never-contact, or whole-business-stopped numbers are refused at create time
with a clear reason per row.
Maximum 500 rows. Re-sending the same `batchId` is an idempotent no-op.

### `47049` `KIND_WHATSAPP_BATCH_DECISION` (owner/admin only): decides a batch OR one draft

```json
{
  "v": 1,
  "batchId": "uuid",
  "decision": "approve" | "reject" | "send_now",
  "dropRows": [3, 7],
  "editRows": [{ "idx": 2, "params": ["Naledi", "Horizon Labs"] }]
}
```

Edits and drops apply to a pending batch only, before the decision. Approve makes the
remaining rows `ready`. Reject is final.
Before approving, the relay refreshes the template list from Meta (falling back to the last sync if
Meta does not answer). If the batch's template is gone or no longer approved the approval is refused
with `template_missing: ...`, the batch stays `pending`, nothing is sent, and the Outreach channel
gets a `template_missing` notice. Reject the batch and prepare a new one.

`send_now` (owner/admin only, never an agent, owned or not) releases an ALREADY APPROVED batch
that has at most 3 rows in total (dropped rows count): a test, not a blast. Its `ready` rows skip
the 08:00 to 18:00 Africa/Johannesburg window and the pacing gap and are sent at the next sender
pass (every 5 seconds), all of them in one pass. Nothing else relaxes: each row is still at most
one Graph send (at-most-once), still counts to the daily new-chat cap (and waits when the cap is
used up), is still skipped for an opted-out or paused contact, and nothing goes while sending is
stopped (quality RED). It takes no `dropRows` or `editRows`. Refused with the plain reason for a
batch that is pending, rejected or completed, unknown, larger than 3 rows, or with no row left
waiting. A repeat keeps the first release moment. The relay marks released rows durably in
`whatsapp_messages.send_after` (the release time); the sender treats a set value as the release
flag. The Outreach channel gets a `batch_send_now` notice. Older apps never send it and ignore
`sendsAt`.

To decide one agent draft (see `47050`) send `draftId` instead of `batchId`:

```json
{ "v": 1, "draftId": "<message id>", "decision": "approve" | "reject",
  "text": "edited text (text draft only)", "params": ["edited", "params (template draft only)"] }
```

Approve can be one tap in the thread (no edit fields). Approval re-checks every send rule at that
moment (opted out, never-contact, whole-business stop, paused, quality stop, 24 hour window for
free text, one message in a row); a
refused approval leaves the draft pending with the plain reason. A draft can be decided once: a
repeat is answered `duplicate: this draft was already decided`.

### `47050` `KIND_WHATSAPP_SEND_REQUEST` (owner/admin or Outreach member)

```json
{ "v": 1, "requestId": "uuid", "to": "+27821234567", "text": "..." }
```

or `"threadRoot": "<hex event id>"` instead of `to`, and `"template": { "name", "language", "params" }`
instead of `text`. Rules the relay enforces:

1. Contact opted out, never-contact, whole-business-stopped, or paused: refused with the reason.
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
`ready` rows. An owner or admin approves, edits or rejects it with `47049`. A message the owner or an
admin sends themselves is the approval: it is `queued` and sent at once. One draft at a time per
contact (a pending draft counts toward rule 4). Free text still only inside the 24 hour window.

The request is stored durably and sent by the relay worker. `requestId` is the idempotency
key: one request is at most one Graph send.

### `47051` `KIND_WHATSAPP_SETTINGS` (owner/admin; agents may only propose a title)

```json
{ "v": 1, "dailyNewChatCap": 30 }
{ "v": 1, "sendingPaused": true }
{ "v": 1, "syncTemplates": true }
{ "v": 1, "templateTitle": { "template": "hl_vb", "language": "en", "title": "Voice note offer", "propose": false } }
```

Cap range 0 to 1000. Takes effect immediately. Default 30.
`sendingPaused` is sent on its own to pause or resume all WhatsApp sending.
`templateTitle` with `propose: false` renames (owner/admin only, max 80 characters, kept across
syncs). With `propose: true` any owner, admin or Outreach member can suggest a title; nothing
changes until an owner or admin renames. A `template_title_proposed` notice is posted in Outreach.

### `47052` `KIND_WHATSAPP_CONTACT_UPDATE` (owner, admin, their agents such as Scout, Outreach members)

```json
{ "v": 1, "waId": "27821234567", "stage": "call_booked" }
{ "v": 1, "waId": "27821234567", "label": "Plane Tree Hotel" }
{ "v": 1, "waId": "27821234567", "label": null }
{ "v": 1, "waId": "27821234567", "retryMedia": "<message id>" }
```

`retryMedia` (sent on its own) restarts the download of an inbound file whose download gave up
(`state: "failed"`, `canRetry: true`); the sender loop picks it up on its next pass. A file marked
`too_large` or `gone`, or another contact's message id, is refused or reports nothing to retry.

Sets the contact's pipeline stage and/or its label (owner's name, shown instead of the WhatsApp
profile name; `null` clears it; 1 to 120 characters). Same access as replying (`Access::can_send`);
a plain member is refused. A stage a person may set: `contacted`, `replied`, `wants_call`,
`call_booked`, `quote_sent`, `client`, `no_thanks`. `stopped` and `not_on_whatsapp` are facts and
are never accepted; a contact that opted out or is not on WhatsApp refuses a stage change.
Every change is appended to the audit log (`whatsapp_contact_updated`). Marking `call_booked`
also adds a `CallBooked` milestone (kind `47069`) to the contact's customer record when
co-founder mode is on, the record exists and the caller may write it; the milestone is named by
the command, so a retry never adds a second one.

**Stage** (computed by the relay, returned on every Contact): `none`, `contacted`, `replied`,
`wants_call`, `call_booked`, `quote_sent`, `client`, `no_thanks`, `stopped`, `not_on_whatsapp`.
Order of precedence: opted out (`stopped`, or `no_thanks` when the reason is `no_thanks`); latest
send failed with Meta `131026` (`not_on_whatsapp`); a manual stage unless a newer fact implies a
strictly later stage; then derived, latest first: `client` (customer record is a client, or the
linked lead is won), `quote_sent` (record has QuoteDrafted/QuoteAccepted), `call_booked` (record
has CallBooked), `no_thanks` (lead lost), `wants_call` (tap on the template's first quick-reply
button), `replied`, `contacted`. Opt-out reasons are stored as `stop` or `no_thanks`; older rows
(`asked to stop`) read as `stopped`.

Additive Contact fields: `stage`, `stageSetBy` (`auto` or the setter's hex pubkey),
`stageChangedAt`, `lastContactedAt`, `lastReplyAt`, `label`, `profileName`, `lastOutboundState`
(`sent`, `delivered`, `read`, `failed` or null), and, when the contact is linked to a lead,
`businessName` and `website`. `displayName` is the label when one is set.

### `47053` `KIND_WHATSAPP_SAFETY_ACTION` (owner/admin only)

```json
{ "v": 1, "action": "never_contact_add", "waId": "+27821234567", "reason": "owner privacy request" }
{ "v": 1, "action": "never_contact_undo", "waId": "+27821234567" }
{ "v": 1, "action": "opt_out_undo", "waId": "+27821234567" }
```

The action is written to a durable suppression ledger and every effective add or undo is appended
to the audit log as `whatsapp_outreach_safety_changed`. A never-contact decision immediately
skips queued rows for that number, is checked by batch/list creation and direct-send preflight,
and is checked again by the final atomic lease claim. An opt-out undo retains history; it does not
remove a separate whole-business stop created by the inbound reply.

### `47054` `KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY` (owner/admin only)

```json
{ "v": 1, "action": "check_status", "messageId": "uuid", "confirm": false }
{ "v": 1, "action": "mark_delivered", "messageId": "uuid", "confirm": true }
{ "v": 1, "action": "resend", "messageId": "uuid", "confirm": true }
```

`check_status` records that the owner reviewed the relay's last known state. It does not invent a
provider result or send anything. `mark_delivered` changes only an unresolved `unconfirmed` row.
`resend` leaves that original row unconfirmed and creates exactly one new queued message after an
explicit confirmation. A repeat resend is rejected rather than creating another replacement.
Every recovery action is audited as `whatsapp_unknown_send_recovery`.

## Sending, pacing, cap

* Approved batch rows send between 08:00 and 18:00 Africa/Johannesburg, one every 3 to 6
  minutes (deterministic jitter per row), never past the daily cap of NEW chats
  (a new chat is a template send to a contact with no open window). Unsent rows roll to
  the next day automatically. The owner's `send_now` on an approved batch of at most 3 rows
  skips the window and the gap (see `47049`); the cap still holds.
* Replies and follow-ups inside an open window are not capped and are not paced, but an agent's
  reply or follow-up waits for its own owner/admin approval (draft) before it is sent.
* An owner or admin can set `sendingPaused` through the settings command. The relay stores that
  manual source as `owner paused`, records who paused and when, and appends an audit entry.
  Quality RED and automatic account incidents have independent pause sources. Recovering one of
  those sources cannot clear an active owner pause, and clearing the owner pause cannot resume
  sending while another source remains active.
* One row = at most one Graph send. A row moves `ready -> sending -> sent`. A crash between
  the Graph call and the record leaves it `sending`; after the lease expires it becomes
  `unconfirmed` and is NEVER resent automatically. The owner is told in the Outreach channel and
  must explicitly check, mark delivered, or confirm one new replacement through `47054`.

## Buttons and opt-out

A tap on a template quick-reply button arrives from Meta as a `button` (or interactive reply)
message. The relay treats it as the contact's reply: the button text becomes the message text in
the thread, it opens the 24 hour window and wakes the owning agent like any reply.

Inbound opt-outs are deterministic phrase data, not an AI classification call. English,
Afrikaans, Zulu and Xhosa recognize bare `STOP`, `unsubscribe`, `no thanks`, and their
unambiguous equivalents, including a complete phrase inside a longer reply. The matching rule is
stored with the contact-scoped opt-out. The Afrikaans, Zulu and Xhosa lists need native-speaker
review before a wider language rollout.

Every inbound reply from a contact linked to a business also creates a whole-business hold: every
current and future number linked to that business is skipped at once and refused by the final
atomic lease claim. This is separate from the contact-scoped opt-out, so an owner can audit or
undo a number's opt-out without accidentally releasing the business hold. A reply that contains
both an opt-out and a complaint or legal signal still opts out and raises an owner notice.

An owner or admin can add a never-contact phone entry with a reason, then undo it later. The
schema supports phone, email and domain identities so later channels can share the ledger without
a migration. Discovery saves and list preparation use the privacy-limited safety preflight to skip
matching candidates before outreach work is created. A Meta block or spam error code on send
pauses the contact and posts a notice in the Outreach channel.

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
batch approve | batch reject | send | safety list | safety never-contact | safety undo-never-contact |
safety undo-opt-out | unknown-send list | unknown-send check | unknown-send mark-delivered |
unknown-send resend | contacts | inbox | thread | cap`. `templates` prints the title first
and the Meta name second; `template-title --template <title or Meta name> --title "..."` renames
(owner/admin) or, with `--propose`, suggests a title (agents). Help text and the colony skill carry the rules:
templates first, short human replies, never more than one message in a row without a reply,
stop words honored.
