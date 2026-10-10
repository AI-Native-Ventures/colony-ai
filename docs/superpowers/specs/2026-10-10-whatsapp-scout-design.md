# Scout on WhatsApp: design spec (v1)

Status: draft for owner review. Date: 10 October 2026. Owner decisions taken in the 9 and 10 October brainstorm.

## 1. What we are building

A Colony business owner can talk to their workspace's Scout (the Chief of Staff agent) on WhatsApp, the same way Instinct users text their assistant. Scout can do anything on WhatsApp that it can do when the owner messages it in Colony, and it delegates to the other AI employees as usual.

Success for v1: an owner links WhatsApp in under a minute, sends "Scout, draft a reply to the supplier", and gets Scout's answer on WhatsApp; the whole exchange is also visible in Colony.

## 2. Decisions (owner)

| # | Decision |
|---|---|
| D1 | Only the business owner (workspace owners and admins) chats on WhatsApp. Customers are out of scope. |
| D2 | One shared official Colony WhatsApp Business number for everyone, like Instinct. The sender's phone number identifies the owner. |
| D3 | Scout only. Other agents are reached through Scout. |
| D4 | In Colony the conversation lives in a separate "Scout on WhatsApp" thread per workspace. |
| D5 | WhatsApp is a separate chat: Scout writes there only in answer to what the owner asked there. No pushed updates, no alerts, no paid template messages. |
| D6 | Each workspace has its own Scout. "switch to <workspace>" chooses which workspace the shared number talks to. |
| D7 | Text only in v1. Voice notes and photos get a polite "text only for now" reply. |
| D8 | If Scout is not running (owner's computer off), the owner is told once and Scout answers when Colony is open again. No cloud Scout in v1. |
| D9 | A WhatsApp message carries the owner's full authority with Scout. No extra confirmation in Colony. Disconnecting the phone in Colony is the safety valve. |
| D10 | The WhatsApp connection is built into the relay (no separate bridge service). |

## 3. User flows

### 3.1 Link WhatsApp to a workspace

1. In the workspace's "Scout on WhatsApp" thread the owner presses Connect WhatsApp.
2. Colony shows a QR code and a wa.me link that opens WhatsApp addressed to the Colony Scout number with the text prefilled: `Link my Colony: K7P-2Q9`.
3. The owner sends it. The code is single use, expires after 10 minutes and is bound to that owner and that workspace.
4. The relay links the phone to the owner and makes the workspace active. Scout's first reply: "Hi, I'm Scout for Acme Plumbing. Message me any time."

Sending the code from WhatsApp proves the owner holds the number (no SMS cost) and opens WhatsApp's 24 hour service window. Linking a second workspace adds it to the same phone.

Disconnect: a button in the thread, or "stop" on WhatsApp.

### 3.2 Owner sends a message

1. Meta delivers the message to the relay webhook.
2. The relay verifies Meta's signature, ignores duplicates by WhatsApp message id, and resolves the sender's phone to a linked owner and active workspace.
3. Commands are answered by the relay at once: `switch to <workspace>`, `which workspace`, `stop`, `help`.
4. Anything else is posted into the workspace's "Scout on WhatsApp" thread as a message from the owner, marked as sent via WhatsApp.
5. If Scout is offline the relay replies once per offline period: "Got it. Scout will pick this up when Colony is open on your computer."

### 3.3 Scout answers

1. Scout reads the thread like any Colony conversation and answers there, delegating as needed.
2. The relay forwards to WhatsApp only messages written by that workspace's Scout in that thread.
3. Within 24 hours of the owner's last WhatsApp message the answer is sent as normal text (split above 4,096 characters, Markdown converted to WhatsApp bold, italics and lists, links as plain URLs).
4. After 24 hours the answer waits: it is visible in the Colony thread at once and is delivered to WhatsApp, in order, right after the owner's next message.
5. Delivery failures show as a small note in the Colony thread: "Not delivered to WhatsApp: <reason>".
6. Approvals in v1 are typed "yes" or "no".

## 4. Architecture

```
Owner's WhatsApp  <-->  Meta WhatsApp Cloud API  <-->  colony-relay (/hooks/whatsapp)
                                                           |
                                         "Scout on WhatsApp" thread (Nostr events)
                                                           |
                                              Scout (managed agent on the owner's computer)
```

### 4.1 Relay module `whatsapp`

- `GET /hooks/whatsapp`: Meta's subscription handshake (verify token).
- `POST /hooks/whatsapp`: inbound messages and delivery statuses. HMAC SHA-256 signature check with the app secret (`X-Hub-Signature-256`) before any parsing. Always answer 200 quickly after durable acceptance; process asynchronously.
- Outbound sender: calls the Cloud API messages endpoint with the access token. Retries transient errors with bounded backoff; records the WhatsApp message id and status.
- Subscriber: watches "Scout on WhatsApp" threads for new messages authored by the workspace's Scout and queues them for delivery.
- Linking: creates and redeems link codes; desktop requests a code through a signed Nostr event (owner or admin of the workspace only), never a new bespoke HTTP endpoint.

### 4.2 Data (new migration, mirrored in schema/schema.sql)

| Table | Purpose | Key fields |
|---|---|---|
| `whatsapp_phone_links` | one row per linked phone | `phone_hash` (HMAC with server key, unique), `phone_enc` (encrypted), `owner_pubkey`, `active_workspace`, `last_inbound_at`, `offline_notice_sent_at`, `created_at` |
| `whatsapp_workspace_links` | which workspaces a phone may use | `phone_hash`, `workspace`, `linked_by`, `created_at` |
| `whatsapp_link_codes` | one-time codes | `code_hash`, `owner_pubkey`, `workspace`, `expires_at`, `used_at` |
| `whatsapp_messages` | dedupe and delivery journal | `wa_message_id` (unique), `direction`, `workspace`, `event_id`, `status`, `error`, `created_at` (rows kept 30 days) |
| `whatsapp_outbox` | Scout answers waiting for delivery or for the next 24 hour window | `id`, `phone_hash`, `workspace`, `event_id`, `state`, `attempts`, `next_attempt_at` |

### 4.3 Colony events

- The thread is a private channel per workspace whose members are the owner (and admins who linked) and Scout, created on first Connect, marked with a `colony:whatsapp-scout` tag in its kind 39000 metadata.
- Inbound messages are channel messages signed by the relay's bridge identity with tags `["on-behalf-of", <owner pubkey>]` and `["via", "whatsapp"]`. Scout trusts the on-behalf-of tag only on events signed by the relay bridge identity.
- Scout's instructions gain one rule: in a "Scout on WhatsApp" thread, answer every owner message there and post results of work requested there into the same thread.

### 4.4 Desktop

- Thread header card: Connect WhatsApp (QR code, prefilled link, code, countdown), linked state with masked phone (+27 ••• 1234), Disconnect.
- "via WhatsApp" marker on bridged messages; delivery failure notes.

## 5. Storage, privacy and security

- Phone numbers are stored encrypted plus an HMAC hash for lookup; Colony shows them masked.
- Links can only be created through a one-time code requested by a workspace owner or admin.
- Message text is stored only as Colony messages in the private thread. The relay keeps WhatsApp message ids for 30 days for dedupe.
- Secrets (Meta app secret, access token, verify token, phone hash key, phone encryption key) come from server environment variables only and are never logged.
- Rate limits: per phone (messages per minute), one reply per day to unknown numbers, link code requests per owner.
- Privacy policy addition: messages sent to Colony on WhatsApp are processed by Meta and by Colony; WhatsApp's end-to-end encryption ends at the business.
- Every path that removes access also removes the link: workspace deleted, owner or admin role lost, account deleted, Disconnect, "stop" (AGENTS.md rule 2, each path tested).

## 6. Failure handling

| Situation | What happens |
|---|---|
| Meta re-sends a message or the relay was down | Dedupe by message id; Meta's retries deliver it once. |
| Scout offline | One offline notice per offline period; the message waits in the thread. |
| Answer after the 24 hour window | Held in the outbox, delivered after the owner's next message. |
| Send fails | Bounded retries, then a failure note in the Colony thread. |
| Expired or used link code | "That code has expired. Get a new one in Colony." |
| Unknown number | One reply per day: "This number is for Colony owners. Connect it from your Colony app." |
| `switch to` an unknown workspace | Lists the linked workspaces. |
| Voice note, photo, other media | "I can only read text for now." |
| Access removed | Link removed; next message gets the unknown-number reply. |

## 7. Testing and proof

1. Unit: signature verification (valid, tampered, missing), dedupe, command parsing, 24 hour window, phone hashing and encryption, link code expiry and single use, Markdown to WhatsApp formatting and splitting.
2. Integration (fake Cloud API, real Postgres): link, inbound message to thread event, Scout reply to outbound call, held answer delivered after the next inbound, failure note, access removal on every path.
3. Desktop: Connect card states, masked phone, disconnect, via-WhatsApp marker, in both Playwright projects.
4. Live proof before launch: Meta's free test number with the owner's phone as an allowed recipient; a real round trip with Scout on a packaged build.

## 8. Owner setup (once)

1. Meta Business account and business verification.
2. WhatsApp Business account in Meta, display name "Colony Scout" approved.
3. A production phone number registered on the Cloud API (Meta test number for development).
4. Server secrets on the relay: `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PHONE_HASH_KEY`, `WHATSAPP_PHONE_ENC_KEY`.
5. Webhook URL registered in Meta: `https://relay.colony.ainative.ventures/hooks/whatsapp`.

## 9. Out of scope for v1

Customers chatting with a business agent; a number per workspace; voice notes and photos; tap buttons; pushed updates and alerts; an always-on cloud Scout; group chats.

## 10. Delivery phases

1. Relay: migration, webhook with signature check and dedupe, linking codes, commands, outbox and sender, fake Cloud API tests.
2. Colony thread: private "Scout on WhatsApp" channel, bridge-signed inbound events, Scout rule, forwarding of Scout's answers.
3. Desktop: Connect card, linked state, disconnect, markers.
4. Owner Meta setup, live proof on the test number, then production number.
