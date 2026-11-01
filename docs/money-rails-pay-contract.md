# Money rails: payment links (relay contract)

Task MR-PAY-RELAY. This is the contract between the relay (this PR), the `colony pay`
CLI that Scout uses, and the desktop UI (MR-PAY-UI). The UI worker builds against this
document with the mock bridge first, then wires to the real events.

Authority: spec `docs/superpowers/specs/2026-11-01-cofounder-money-rails-design.md` on
branch `docs/cofounder-money-rails` (head 335df2972), sections 5, 6.1 to 6.6, 7, 10, 11,
12, 13, 14 and 17. Boards: Claude Design canvas "Colony 3.0", page "Money rails".

Status of this file: first push of the contract. Anything marked **OPEN** is a builder
finding the coordinator should answer. Everything else is what the relay will implement;
if the UI needs a different shape, say so in the PR before the relay code lands.

## 1. Hard rules and where each one is enforced

| Rule | Enforced by | Proven by |
| --- | --- | --- |
| Scout can only ask for money. A recipe or browser step that refunds, pays out, transfers, withdraws or moves balance is refused, whatever was approved. | `buzz_core::money_rails::refusal` runs at recipe propose, at recipe approve, at every recipe run and at every browser step check. | Postgres test `refund_recipe_is_refused_even_when_approved`; red proof. |
| Nothing reaches a client before the owner approves the card. Approve is one atomic relay command that re-checks amount, currency, recipient and message against the card head. Edit after approval voids it. | Kind 47070 `approve` under the head row lock; the sender and the recipe runner read the approval digest, never the action. | `approve_after_edit_is_refused_and_edit_voids_the_approval`; red proof. |
| Provider keys are pasted in a Colony dialog only, sealed at the relay (KEK + community + connection id as AAD), locked to the provider API host(s), never returned in any response, event, log or agent output, and responses are scrubbed by exact match. | `money_rails::vault` (same envelope as `whatsapp::secrets`), `money_rails::runner` host lock and scrub. | `vault_key_never_appears_in_any_output` greps every response, event and captured log line for the key. |
| A payment notice alone never marks Paid. Only an HMAC-verified notice, a matching API lookup, or the owner's tick does. Otherwise "Payment reported, check". | `money_rails::notices::classify` is the only writer of `paid`. | `unverified_notice_never_marks_paid`, `spoofed_and_replayed_notices_are_not_paid_and_a_signed_one_is_paid_once`, `a_signed_notice_for_another_amount_is_a_report_not_a_payment`; red proof. |

## 2. Event kinds

Added to `crates/buzz-core/src/kind.rs`. All four are free on main `a3490b3b0`.
Money rails owns heads 30680 to 30689 and actions 47070 to 47079. This PR uses only the
payment ones; signing (30681, 47071, 47072) and booking (30682, 47073) are reserved for
their own PRs and are NOT defined here.

| Kind | Const | Who writes | Notes |
| --- | --- | --- | --- |
| 30680 | `KIND_PAYMENT_LINK_HEAD` | relay only | One per card. d tag `paylink:<linkId>`. Parameterized replaceable. |
| 47070 | `KIND_PAYMENT_LINK_ACTION` | member or owned agent | Commands of section 6. d tag `paylink:<linkId>`. |
| 30683 | `KIND_MONEY_CONNECTION_HEAD` | relay only | One per connection. d tag `payconn:<connectionId>`. Never holds a secret value, a notice address or a recipient. |
| 47074 | `KIND_MONEY_CONNECTION_ACTION` | member or owned agent | Commands of section 4. d tag `payconn:<connectionId>`. |

Both action kinds and both head kinds are community-wide company records: global only,
no `h` tag, scope `messages:write`, no channel-scoped tokens, same as kinds 30679 and 47069.
Wired in `is_global_only_kind`, `required_scope_for_kind`, the company-record router and
`COMPANY_RECORD_KINDS`.

Reused unchanged: invoices 30641/47026, payment evidence 47027, adjustments 47028, customer
record 30679/47069. Secret bindings 30647/47036 are NOT used: connection metadata lives in
30683 only and the sealed values live in the relay table (decision for the builder item in
spec section 10).

## 3. Roles

| Action | Owner or admin | Agent owned by an owner or admin (Scout) | Other members |
| --- | --- | --- | --- |
| connect, replace a secret, disconnect | yes | no | no |
| propose a recipe or notice map | yes | yes | no |
| approve or revoke a recipe or notice map, set default | yes | no, never | no |
| draft, edit, submit a card | yes | yes | no |
| approve, reject, retry, mark sent, dismiss a report, confirm payment (tick) | yes | no, never | no |
| cancel a card | yes (any state) | only its own card, before approval | no |
| run an approved recipe on an approved card | yes | yes | no |
| record a created link (browser route), report a payment | yes | yes | no |
| read connections and cards (heads) | yes | yes | yes (heads are company records and carry no secret, address or notice URL) |
| read notice address, full recipient, notices | yes | no | no |

"Owned agent" is resolved exactly like WhatsApp: `users.agent_owner_pubkey` (from the
verified NIP-OA tag) is a current owner or admin. Display names are never used. A managed
agent never counts as owner or admin. (Spec coordinator call 1.)

## 4. Connections (kind 30683 head, 47074 actions, HTTP intake)

A connection is one payment provider for one business. Any number per business.

### 4.1 Head content (30683)

```json
{
  "schemaVersion": 1,
  "connectionId": "uuid",
  "provider": "stripe",
  "label": "Stripe",
  "route": "api",
  "status": "connected",
  "isDefault": true,
  "apiHosts": ["api.stripe.com"],
  "browserHosts": ["dashboard.stripe.com"],
  "authScheme": "basic",
  "recipes": [
    {
      "recipeId": "create-payment-link",
      "title": "Create payment link",
      "purpose": "create_link",
      "method": "POST",
      "host": "api.stripe.com",
      "path": "/v1/payment_links",
      "plain": "Creates a payment link for the amount on an approved card.",
      "status": "approved",
      "recipeHash": "hex sha256",
      "proposedBy": "pubkey hex",
      "approvedBy": "pubkey hex",
      "approvedAt": 1793000000
    }
  ],
  "refusedRecipes": [
    { "recipeId": "refund-x", "reason": "refund_path" }
  ],
  "hasApiKey": true,
  "hasSigningSecret": true,
  "noticeAddressSet": true,
  "noticeMap": { "status": "approved", "mapHash": "hex" },
  "lastUsedAt": 1793000500,
  "createdAt": 1793000000,
  "version": 3,
  "sourceEventId": "hex"
}
```

* `route`: `api` (relay runs recipes with the sealed key) or `browser` (Scout works the
  provider's site in the built-in browser; no API key).
* `status`: `connected`, `needs_attention` (a secret failed to open, or the last 3 runs
  failed), `disconnected` (head kept for history, secrets deleted).
* `authScheme`: `bearer` (`Authorization: Bearer <key>`), `basic` (key as user, empty
  password, Stripe style) or `header:<Header-Name>`.
* `recipes[].status`: `proposed`, `approved`, `revoked`, `refused`. Only `approved`
  recipes ever run. `recipeHash` pins the exact recipe body that was approved.
* The head NEVER carries: the key, the signing secret, the notice address, the signature
  header name, the full recipe bodies. Those come from the HTTP query (section 9).

### 4.2 Intake over HTTP (secrets travel here and only here)

`POST /api/money-rails/connect` (NIP-98, owner or admin). The UI sends this straight
from the Settings dialog; the key is never put in chat and never in an event.

```json
{
  "provider": "stripe",
  "label": "Stripe",
  "route": "api",
  "apiKey": "sk_...",
  "apiHosts": ["api.stripe.com"],
  "authScheme": "basic",
  "browserHosts": ["dashboard.stripe.com"],
  "signingSecret": "whsec_...",
  "signature": {
    "header": "stripe-signature",
    "encoding": "hex",
    "prefix": null,
    "signedPayload": "timestamp.body",
    "timestampField": "t",
    "signatureField": "v1",
    "toleranceSecs": 300
  }
}
```

* `route: "browser"` needs `browserHosts` and no `apiKey`. `route: "api"` needs `apiKey`
  and `apiHosts` (host names only, no scheme, no path, lower case, no IP literals, no
  `localhost`, no port). Browser hosts follow the same rules.
* `signingSecret` and `signature` are optional on both routes. Without them every notice
  stays "Payment reported, check" until an API lookup or the owner's tick confirms it.
* `signature.signedPayload` is `body` (HMAC-SHA256 over the raw body) or `timestamp.body`
  (HMAC-SHA256 over `<t>.<body>`, with the timestamp and signature read from the
  `key=value,key=value` header, as Stripe does). `encoding` is `hex` or `base64`.
  `prefix` (for example `sha256=`) is stripped before comparing. Comparison is constant
  time. A timestamped signature older than `toleranceSecs` (max 600) is invalid.
* Response `200`: the connection summary of section 9 plus
  `noticeAddress: "https://<business-host>/hooks/pay/<noticeId>"`. The key and signing secret
  are not in the response. Errors carry `code`: `money_not_configured` (503, relay has no
  KEK), `money_invalid_input` (400), `money_host_not_allowed` (400),
  `money_already_connected` (409, same provider label and route), `money_forbidden` (403).
* `POST /api/money-rails/secret` `{ "connectionId", "field": "apiKey"|"signingSecret", "value" }`
  replaces one secret. `POST /api/money-rails/disconnect` `{ "connectionId" }` deletes both
  sealed secrets at once and marks the head `disconnected`. Cards already made stay.

The vault is `money_rails::vault`, the same AES-256-GCM envelope as
`whatsapp::secrets`, AAD `colony-money-v1:<community>:<connectionId>:<field>`, plaintext in
`Zeroizing`. A sealed value cannot be moved to another connection or community.

### 4.3 Actions (47074)

Content: `{ "schemaVersion": 1, "op": "...", "connectionId": "uuid", "expectedHeadEventId": "hex|null", ... }`.

| `op` | Extra fields | Result |
| --- | --- | --- |
| `add_browser` | `provider`, `label`, `browserHosts` | Creates a browser route connection (no secret, so no HTTP needed). |
| `propose_recipe` | `recipe` (section 5) | Adds the recipe as `proposed`, or `refused` with a reason if it fails the refusal list or the host lock. |
| `approve_recipe` | `recipeId`, `recipeHash` | Atomic: re-runs the refusal list and host lock, compares `recipeHash` with the stored body, then approves. A changed body needs a new proposal. |
| `revoke_recipe` | `recipeId` | Sets `revoked`. |
| `propose_notice_map` | `noticeMap` (section 8.2) | Stores the map as `proposed`. |
| `approve_notice_map` | `mapHash` | Atomic approve of the exact map. |
| `set_default` | none | Makes this connection the default for new cards. |
| `rename` | `label` | |
| `disconnect` | none | Same effect as the HTTP disconnect (secrets deleted in the same transaction as the head). |

## 5. Request recipes (API route)

A recipe is a named request shape Colony runs for Scout. Scout never calls the provider.

```json
{
  "recipeId": "create-payment-link",
  "title": "Create payment link",
  "purpose": "create_link",
  "method": "POST",
  "host": "api.stripe.com",
  "path": "/v1/payment_links",
  "query": [],
  "headers": [{ "name": "Content-Type", "value": "application/x-www-form-urlencoded" }],
  "bodyEncoding": "form",
  "body": "line_items[0][price_data][currency]={{currency_lower}}&line_items[0][price_data][unit_amount]={{amount_minor}}&line_items[0][price_data][product_data][name]={{purpose}}&line_items[0][quantity]=1&metadata[colony_ref]={{card_ref}}",
  "extract": {
    "url": "/url",
    "reference": "/id",
    "amount": { "pointer": "/line_items/data/0/price/unit_amount", "scale": "minor" },
    "currency": "/line_items/data/0/price/currency"
  }
}
```

* `purpose`: `create_link` (POST, runs only inside an approved card) or `lookup_payment`
  (GET, read only, may run for a sent card to confirm a payment).
* Only `POST` for `create_link` and `GET` for `lookup_payment`. `PUT`, `PATCH`, `DELETE` are
  refused outright.
* `host` must be one of the connection's `apiHosts`, https only, default port. A redirect
  to another host is a failure and no key is sent after a redirect.
* `path` is a template, `/` rooted, no `..`, no `//`, no `@`, no `\`.
* Placeholders, all substituted by the relay from the card head and never from Scout:
  `{{amount_minor}}`, `{{amount_decimal}}`, `{{currency}}`, `{{currency_lower}}`,
  `{{purpose}}` (what the payment is for), `{{card_ref}}` (short id, goes into provider
  metadata so notices can be matched), `{{invoice_number}}`, `{{recipient_name}}`,
  `{{expires_at_unix}}`; for `lookup_payment` also `{{provider_reference}}`.
  Any other `{{...}}` makes the recipe invalid. Values are encoded for the declared
  `bodyEncoding` (`json`, `form`, `none`) so a purpose line cannot break out of the body.
* `extract` is mandatory for `create_link`: `url`, `reference`, `amount` and `currency`
  (RFC 6901 JSON pointers into the JSON response). `amount.scale` is `minor` or `decimal`
  (decimal is multiplied by 10^exponent of the currency, ISO 4217 table, default 2). The
  relay compares the extracted amount and currency with the card; a mismatch stops the
  flow (section 6.3). `lookup_payment` extracts `reference`, `amount`, `currency`, and
  optionally `paid` (`{ "pointer": "/status", "equals": "succeeded" }`).
* Response handling: the body is read through a response cap of 64 KiB and parsed; the key
  value is removed by exact match from every string the relay keeps or returns (the link,
  the reference, an excerpt of a provider error). What reaches Scout is never the raw body:
  `colony pay run` for a create recipe answers with where the card is (`{ ok, state, link?,
  failure? }`), for a lookup recipe with `{ ok, reference, amountMinor, currency, paid }`.
  A provider error shows on the card as `provider_rejected` with a scrubbed one line excerpt.

### 5.1 The refusal list (fail closed)

`buzz_core::money_rails::refusal::check_recipe` and `check_step`.

1. Lower-case the title, `purpose` id, path, query names and values, header values and
   body template. Make a second copy with every non-alphanumeric character removed.
2. If either copy contains `refund`, `payout`, `transfer`, `withdraw`, `disburse`,
   `reversal`, `chargeback` or `remit`, refuse with `refund_path`, `payout_path`,
   `transfer_path`, `withdraw_path` and so on (one code per word).
3. If the recipe is not a `GET` and either copy contains `balance`, refuse with
   `balance_path`. (A read only `GET` on a balance is allowed because it moves nothing.)
4. Refuse any method other than `POST` (create_link) and `GET` (lookup_payment) with
   `method_not_allowed`.
5. Refuse a path that names another host, an absolute URL, or a different scheme with
   `host_not_allowed`.

The same check runs on a browser step (section 7): the step label, button text and URL
path are the input. The word list is one constant, `FORBIDDEN_WORDS`, so the UI can show it.

## 6. Payment link cards (kind 30680 head, 47070 actions)

### 6.1 States

`draft`, `needs_you`, `creating_link`, `sent`, `payment_reported`, `paid`, `expired`,
`cancelled`, `failed`. These are the section 7 states of the spec, in snake case.

| State | Meaning | Who moves it out |
| --- | --- | --- |
| `draft` | Saved but not ready (a field is missing or the invoice is not issued). `waitingFor` says why. | agent or owner: `edit` until complete, then `submit` |
| `needs_you` | The card the owner sees in the chat and in Needs you. | owner: `approve` or `reject`; drafter: `edit`; owner: `cancel` |
| `creating_link` | Approved. The relay (API route) or Scout (browser route) is creating the link, then the relay sends the message. | the relay (job) or Scout (`record_created`); owner: `cancel` |
| `sent` | The link exists, was checked, and the one approved message went out (or the owner marked it sent). | notice, lookup, owner tick, expiry, cancel |
| `payment_reported` | A notice or a report says it was paid but nothing verified it. "Payment reported, check". | owner: `confirm_payment` or `dismiss_report`; a later verification |
| `paid` | Verified. Payment evidence 47027 exists. Terminal. | none |
| `expired` | `expiresAt` passed with no payment. Terminal. | none |
| `cancelled` | Owner cancelled, or rejected (`cancelReason` is the rejection text Scout reads). Terminal. | none |
| `failed` | Something failed; `failure` says what and whether Try again is possible. | owner: `retry` |

Transitions the relay allows, everything else is refused with `conflict`:

```
draft -> needs_you (submit) | cancelled
needs_you -> creating_link (approve) | needs_you (edit) | cancelled (reject, cancel)
creating_link -> sent | failed | needs_you (amount mismatch, approval voided) | cancelled
sent -> payment_reported | paid | expired | cancelled
payment_reported -> paid | sent (dismiss_report) | expired | cancelled
failed -> creating_link (retry, approval still valid) | needs_you (approval voided) | cancelled
```

Every failure leaves a durable record and a visible state (review-proven rule 1). A job
that dies half way is picked up again by the sweeper (section 6.5).

### 6.2 Head content (30680)

```json
{
  "schemaVersion": 1,
  "linkId": "uuid",
  "cardRef": "PL-7F3K9Q",
  "version": 4,
  "state": "sent",
  "partyId": "customer record party id",
  "clientId": "uuid",
  "invoiceId": "uuid",
  "invoiceNumber": "INV-0012",
  "customerName": "Plane Tree Cafe",
  "amountMinor": 375000,
  "currency": "ZAR",
  "purpose": "Deposit for the shopfront refit",
  "connectionId": "uuid",
  "providerLabel": "Stripe",
  "route": "api",
  "recipientRef": "uuid",
  "recipientChannel": "whatsapp",
  "recipientName": "Thandi",
  "recipientDisplay": "+27 82 *** 4521",
  "message": "Hi Thandi, here is your deposit link: {link}",
  "messageHash": "hex sha256",
  "expiresInDays": 14,
  "expiresAt": 1794200000,
  "waitingFor": null,
  "draftedBy": "pubkey hex",
  "draftedAt": 1793000000,
  "approval": {
    "approvedBy": "pubkey hex",
    "approvedAt": 1793000100,
    "digest": "hex sha256 of the canonical facts",
    "headEventId": "hex"
  },
  "approvalVoided": false,
  "browserGrant": null,
  "link": {
    "url": "https://buy.stripe.com/test_x",
    "providerReference": "plink_123",
    "createdAt": 1793000120,
    "shownAmountMinor": 375000,
    "shownCurrency": "ZAR",
    "checkedAt": 1793000121
  },
  "delivery": { "channel": "whatsapp", "state": "sent", "sentAt": 1793000130 },
  "payment": null,
  "failure": null,
  "cancelReason": null,
  "updatedAt": 1793000130,
  "sourceEventId": "hex"
}
```

* The head carries no phone number, no email and no key. `recipientRef` is an opaque id
  of the private row that holds the address; `recipientDisplay` is the masked form shown on
  the card. Any recipient change makes a new `recipientRef`.
* `message` is the exact text, with `{link}` once. It is shown on the card because the
  approval covers it (spec section 7 step 3).
* `approval.digest` is SHA-256 over this canonical JSON string (keys in this order, no
  spaces): `linkId`, `invoiceId`, `amountMinor`, `currency`, `connectionId`, `recipientRef`,
  `messageHash`, `expiresInDays`. The recipe runner, the sender and the browser step check
  recompute it from the current head and refuse on mismatch.
* `payment` when set: `{ "state": "reported"|"verified", "source": "hmac"|"lookup"|"owner_tick"|"report",
  "reference": "...", "amountMinor": n, "currency": "ZAR", "at": unix, "noticeId": "uuid|null",
  "paymentId": "uuid|null", "evidenceEventId": "hex|null", "mismatch": null|"amount"|"currency" }`.
* `failure` when set: `{ "code": "...", "reason": "plain words for the owner", "retryable": true, "at": unix }`.
  Codes: `no_issued_invoice`, `amount_exceeds_outstanding`, `currency_mismatch`,
  `provider_rejected`, `provider_unreachable`, `host_not_allowed`, `recipe_missing`,
  `recipe_refused`, `amount_mismatch`, `currency_shown_mismatch`, `browser_grant_expired`,
  `browser_step_refused`, `message_window_closed`, `message_failed`, `evidence_pending`,
  `key_unavailable`.

### 6.3 Actions (47070)

Content: `{ "schemaVersion": 1, "op": "...", "linkId": "uuid", "expectedHeadEventId": "hex|null", ... }`.
Every op after `draft` names the head it saw. A stale head is refused with `conflict`.

| `op` | Fields | Notes |
| --- | --- | --- |
| `draft` | `partyId`, `invoiceId`, `amountMinor`, `currency`, `purpose`, `connectionId?` (default connection, else the only one, else refused), `recipient { channel, address, name }`, `message`, `expiresInDays?` | Creates the card. `needs_you` if complete, `draft` with `waitingFor` otherwise. Checks: the invoice exists, `amountMinor` > 0, `currency` equals the invoice currency, `amountMinor` is at most the outstanding balance. |
| `edit` | any of the draft fields | Allowed in `draft`, `needs_you`, and before the link exists in `creating_link` and `failed`. If the card was approved, the approval is voided and the card returns to `needs_you` with `approvalVoided: true`. Refused once a link exists (`cancel` and draft a new card). |
| `submit` | none | `draft` to `needs_you` when nothing is missing. |
| `approve` | `facts { invoiceId, amountMinor, currency, connectionId, recipientRef, message, expiresInDays }` | Owner or admin. One transaction under the head row lock: the head id equals `expectedHeadEventId`, every fact equals the head, the invoice is `issued` with enough outstanding, the connection is `connected` and (API route) has an approved `create_link` recipe. Writes `approval`, moves to `creating_link`, and queues the job. Any mismatch is refused and nothing changes. |
| `reject` | `reason` | Owner or admin. `cancelled`, `cancelReason` = reason (Scout reads it). |
| `cancel` | `reason?` | See roles. Does not call the provider; the card says a created link may still be open at the provider. |
| `record_created` | `url`, `providerReference?`, `shownAmountMinor`, `shownCurrency` | Browser route only, only in `creating_link`, only while the browser grant is live. Scout reports what it read from the page and from opening the link as the payer. Mismatch with the card: approval voided, card back to `needs_you` with `failure.code = amount_mismatch` or `currency_shown_mismatch`, nothing sent. |
| `report_payment` | `source` (`dashboard`, `gmail`, `client_message`), `reference?`, `amountMinor?`, `currency?`, `note` | Moves `sent` to `payment_reported`. Never `paid`. |
| `confirm_payment` | `reference?`, `note?` | Owner or admin ticks "I can see this payment". Writes evidence for the card amount and moves to `paid` (`source: "owner_tick"`). |
| `dismiss_report` | `note?` | `payment_reported` back to `sent`. |
| `retry` | none | Owner or admin, from `failed` when `failure.retryable`. If the approval digest still matches the head it goes back to `creating_link` (browser route gets a fresh 15 minute grant); otherwise to `needs_you`. |
| `mark_sent` | `note?` | Owner or admin, from `creating_link` with a created link whose delivery failed: the owner sent the link by hand. Moves to `sent`. |

### 6.4 What "creating link" does

* **API route.** The relay job picks the approved `create_link` recipe, checks the approval
  digest against the head, substitutes the card values, calls the provider with the
  sealed key (host lock, no redirects), extracts `url`, `reference`, amount, currency,
  and compares them with the card. Match: it writes `link`, then sends the one approved
  message, then moves to `sent`. Every step is durable: the job row records
  `link_created` before the send starts, and the send is keyed by the card id so a retry
  never sends twice.
* **Browser route.** On approve the head gets `browserGrant { host, from, until, usedAt }`
  with `until = approvedAt + 15 minutes`. Scout is woken, opens the provider's create page,
  fills the approved facts, and calls the step check (section 7) before pressing Create.
  After Create it reads the link, opens it as the payer, and sends `record_created`. The
  relay then compares, sends the message and moves to `sent`. The card says it needs the
  owner's Mac awake and signed in to the provider.
* **Sending.** WhatsApp goes through the existing sender (`whatsapp::sender::enqueue_send`
  as the approving owner, so it is queued at once; free text only, so the 24 hour window
  rules apply). If WhatsApp refuses (window closed, no number connected) the card fails with
  `message_window_closed` or `message_failed` and keeps the link so the owner can send it
  by hand and `mark_sent`. Email uses the relay's Resend key when mail is configured, a
  plain text body; otherwise it fails the same visible way. After a send is queued the card
  stays `creating_link` until WhatsApp reports it sent (or failed).

### 6.5 Job runner

A relay task (same pattern as the WhatsApp sender tick, every 5 seconds) leases due rows of
`money_rails_jobs`: `create` (the recipe run; its provider result is saved before the head
changes, so a crash never repeats the call), `send` (queues the one approved message and
follows it to sent or failed; WhatsApp through `enqueue_send`, keyed `paylink:<card>`),
`evidence` (writes 47027, retried every 15 minutes up to 100 times while the reason shows on
the card as `evidence_pending`), `expire` (at `expiresAt`), `grant` (at the end of the
browser window). A failed create retries up to 6 times, then the card shows `failed` with
Try again. Nothing loops without a bound, and the card always shows where it is.

## 7. Browser route step check

The browser keeps its existing on-screen confirmation for Pay and Submit. An approved card
pre-clears exactly one Create, on the connection's browser host, for 15 minutes.

`POST /api/money-rails/browser-step` (NIP-98, owner, admin or owned agent):

```json
{ "linkId": "uuid", "host": "dashboard.stripe.com", "url": "https://dashboard.stripe.com/payment-links/create", "label": "Create link", "kind": "create" }
```

Response `200`: `{ "allow": true|false, "code": "...", "reason": "plain words", "consumed": true|false, "until": unix }`.

`allow: true` only when all of these hold, checked in one transaction that also stamps
`browserGrant.usedAt` with a compare and set (a second call is `grant_used`):

1. The card is `creating_link`, route `browser`, approved, and the approval digest matches the head.
2. `now < browserGrant.until`.
3. `host` equals the grant host exactly (one of the connection's `browserHosts`).
4. `kind` is `create`, and the label, button text and URL path pass the refusal list (section 5.1).

Codes for `allow: false`: `no_grant`, `grant_expired`, `grant_used`, `host_mismatch`,
`kind_not_allowed`, `step_refused` (with the forbidden word), `card_not_approved`.
The desktop treats `allow: false` as "show the existing on-screen confirmation, or refuse
when nobody is at the screen". Nothing else is ever pre-cleared. The UI worker owns the
call site; the relay owns the decision.

## 8. Payment notices (paid status by itself)

### 8.1 The inbox

`POST /hooks/pay/<noticeId>` on the business host. Public route, no NIP-98. The host
decides the business; the random `noticeId` decides the connection. The id is 128 bits of
randomness. An unknown id, or an id on the wrong host, is a plain 404.

* Body cap 64 KiB (413 above it). Content type not interpreted. Stored raw in
  `money_rails_notices` with the receive time and the signature header value. Kept 90
  days, then the body is dropped and only the evidence fields stay (reference, amount,
  currency, time, match, signature state).
* Dedupe: only a notice whose signature verified earns the provider event id (read through
  the approved notice map) as its dedupe key. Every other notice dedupes by the SHA-256 of
  its raw body, so a forged post that borrows a real event id can never block the genuine
  notice that carries it. `UNIQUE (community_id, connection_id, dedupe_key)`; a repeat
  returns `200` with `{ "ok": true, "duplicate": true }` and changes nothing.
* The route answers `200 {"ok": true, "duplicate": bool}` for a stored notice, whatever its
  signature state, so a provider does not retry a forged one forever. Limits per connection:
  60 posts a minute and 5,000 notices holding a raw body (`429` above either).
* Not found (unknown id, or an id on the wrong host) is `404`, a body over 64 KiB is `413`,
  and a relay fault is `500` so the provider redelivers (the dedupe row keeps that safe).
* A notice never creates or changes a card by itself except as in 8.3.

### 8.2 Notice map (owner approved, non secret)

```json
{
  "eventId": "/id",
  "reference": "/data/object/payment_link",
  "amount": { "pointer": "/data/object/amount_total", "scale": "minor" },
  "currency": "/data/object/currency",
  "occurredAt": "/created",
  "successWhen": [{ "pointer": "/type", "equals": "checkout.session.completed" }]
}
```

Scout proposes it from the provider's docs (`propose_notice_map`), the owner approves the
exact map (`approve_notice_map`). Without an approved map a notice is still stored and
matched by a plain search for the card's `cardRef` or the link's `providerReference` in the
body.

### 8.3 Classification (the only writer of `paid`)

For each stored notice the relay finds the card (map reference, `cardRef`, or
`providerReference`; otherwise the notice stays unmatched and is listed for the owner)
and then:

1. Signature: HMAC-SHA256 as configured, constant time. Result `verified`, `invalid`,
   `unsigned` (the connection holds a signing secret but the notice carried no signature)
   or `no_secret` (the connection holds no signing secret, so nothing could be checked).
2. Facts: amount and currency from the map, compared with the card.
3. Outcome (`judge_notice`, the only decision that can lead to paid):
   * The map says the event is not a payment success (for example an expiry): nothing changes.
   * The connection holds a secret and the notice is `invalid` or `unsigned`: nothing changes
     (stored and listed as ignored), so a forged post cannot even raise a report.
   * The notice facts differ from the card: `payment_reported` with `payment.mismatch`
     set, even when signed. Never paid.
   * `verified` AND the approved map's success rules matched: the card goes to
     `payment_reported` with `payment.state = "verified"`, a durable evidence job is queued,
     and only when the evidence (47027) is written does the card become `paid`
     (`source: "hmac"`). HMAC alone without an approved success rule is not enough.
   * Not `verified` but the connection has an approved `lookup_payment` recipe: the relay
     runs it; reference, amount and currency equal the card and the paid flag is true:
     the same path with `source: "lookup"`.
   * Anything else: `payment_reported` ("Payment reported, check"), `payment.state =
     "reported"`. Never paid.

A replayed verified notice is a duplicate (dedupe), so it cannot write evidence twice.

## 9. HTTP query

`POST /api/money-rails/query` (NIP-98). Body `{ "what": "...", ... }`.

| `what` | Roles | Result |
| --- | --- | --- |
| `connections` | owner, admin, owned agent | `{ "connections": [Summary] }`. Each summary is `{ "connection": <head>, "headEventId": hex }` and, for owner or admin only, also `noticeAddress`, `signature` (header and format, no secret) and `noticeMap`. |
| `connection` `connectionId` | owner, admin | the summary plus the full recipe bodies (never a secret) |
| `links` `linkId?`, `state?`, `partyId?`, `invoiceId?`, `limit?` | owner, admin, owned agent | `{ "links": [{ "headEventId": hex, "link": <head> }] }`, most recently changed first. `headEventId` is the head event id the next command on that card must name. |
| `link` `linkId` | owner, admin | `{ headEventId, link, recipient { channel, address, name }, notices }` (the only place the full address is returned) |
| `notices` `connectionId?`, `linkId?`, `unmatched?`, `limit?` | owner, admin | `{ "notices": [{ id, connectionId, receivedAt, signature, reference, amountMinor, currency, matchedLinkId, judgement, excerpt }] }` with the excerpt cut at 512 bytes |

The desktop can also read the heads directly as events: a REQ for kind 30680 and 30683
authored by the relay (community-wide company records, no secret in them) and filter by the
`partyId` or `invoiceId` inside. The customer record head (30679) is NOT changed by this PR:
the customer record's Money section reads the card heads of its `partyId`.

`POST /api/money-rails/run` (NIP-98, owner, admin or owned agent):
`{ "linkId": "uuid", "recipeId": "create-payment-link" }` runs an approved `create_link`
recipe on an approved card (API route) and returns the scrubbed result of section 5. It is
idempotent per card: a second call returns the stored result and makes no second provider
call. `{ "linkId", "recipeId": "<lookup>", "providerReference" }` runs a `lookup_payment`.

## 10. Wiring to the records

* A card hangs off an invoice (30641). Payment evidence (47027) is written against that
  invoice with `provider` = the connection label, `providerReference` = the verified
  reference, `evidenceRef` = `paylink:<linkId>`, and `expectedInvoiceHeadEventId` = the
  invoice head the relay reads inside the transaction. `paymentId` is a UUIDv5 of the card
  id and the notice dedupe key, so a retry is a duplicate, not a second payment.
* The relay writes the evidence by building a relay-signed 47027 command and running it
  through the existing business record handler as the owner or admin who approved the card
  (the same trick as `record_call_booked`). If the handler refuses (for example the
  approver is not in the client's private channel) the card stays `payment_reported` with
  `failure.code = evidence_pending`, and the sweeper retries; the owner sees why.
* The customer record timeline already shows `PaymentReceived` from 47027 and
  `InvoiceIssued` from the invoice, so revenue totals, scorecards and the weekly review stay
  right with no new milestone kind. A "Deposit paid" milestone line is therefore derived
  from the evidence, not a second write. (**OPEN**: if the board needs a distinct
  "Deposit paid" label, say so and the relay adds `MilestoneKind::DepositPaid`.)
* Invoice rules unchanged: evidence needs an issued invoice, the same currency, an amount
  at most the outstanding balance.

## 11. CLI: `colony pay`

Output follows the other commands (`--format compact` is a global flag before the subcommand;
writes return `{event_id, accepted, message}`; a refusal prints the relay's plain reason).

| Command | What it does |
| --- | --- |
| `colony pay connections` | Lists connections (provider, route, status, default, recipes and their approval). No secret ever. |
| `colony pay cards [--state S] [--party P] [--invoice I] [--limit N]` | Lists cards, most recently changed first. |
| `colony pay card --card <id>` | Shows one card and its `headEventId`. |
| `colony pay draft --party P --invoice I --amount <minor> --currency ZAR --purpose "..." (--to-whatsapp N \| --to-email E) --name "..." --message "...{link}..." [--connection C] [--expires-days 14] [--card-id ID]` | Drafts a card (47070 `draft`). Prints the card id on stderr. `--card-id` makes a retry safe. |
| `colony pay edit --card ID [--amount] [--purpose] [--message] [--to-whatsapp\|--to-email --name] [--expires-days] [--expected H]` | Edits a card; voids an approval. |
| `colony pay submit --card ID` / `colony pay cancel --card ID [--reason]` | Sends a complete draft to the owner / cancels your own draft. |
| `colony pay recipe-propose --connection C --file recipe.json` | Proposes a recipe from the provider's public docs. |
| `colony pay notice-map-propose --connection C --file map.json` | Proposes how to read the provider's notices. |
| `colony pay run --card ID --recipe R [--reference REF]` | Runs the approved recipe: a create recipe runs the card's create job now and prints where the card is; a lookup recipe prints what the provider says (never the raw body). |
| `colony pay created --card ID --url U [--reference R] --shown-amount <minor> --shown-currency ZAR` | Browser route: record the link read back as the payer. |
| `colony pay report --card ID --source dashboard\|gmail\|client-message [--reference] [--amount] [--currency] --note "..."` | Reports a payment for the owner to check. Never marks paid. |
| `colony pay step-check --card ID --host H --url U --label L [--kind create]` | Calls the browser step check. |

Every command that changes a card reads its current `headEventId` itself unless `--expected`
is given. Output is the relay's JSON; writes print `{event_id, accepted, message}`.

There is no `approve`, `confirm`, `refund`, `payout` or `transfer` command. Agents cannot
approve, and the word list means they could not ask for money to leave even through a recipe.

## 12. Storage and deploy

Migration `migrations/0061_money_rails_pay.sql` and the same tables in
`schema/schema.sql`, `scripts/reconcile-schema-after-pgschema.sql` (write fences) and the
tenant deletion manifest. **Additive only** (four new tables, no change to an existing
table), each with `attach_community_write_fence`:

* `money_rails_connections` (sealed key and signing secret, KEK id, nonces, the non secret
  configuration as JSON including recipes and the notice map, notice id, status, default flag).
* `money_rails_recipients` (the private recipient of a card, one row per reference, never
  updated).
* `money_rails_jobs` (durable work per card: `create`, `send`, `evidence`, `expire`,
  `grant`; leased, retried with backoff 15 s doubling to 15 min, bounded).
* `money_rails_notices` (raw body up to 64 KiB, dedupe key, signature state, match,
  judgement, reduced flag).

**Relay deploy with `existing_data_plan=migrate` is needed before the desktop release.**
Without it the new routes answer `503 money_not_configured`/missing table errors and the
UI must show "Money connections are not ready yet" (a distinct state, not an empty list).

## 13. Builder findings the coordinator should answer (OPEN)

1. **A bare deposit cannot create an invoice.** Invoice version 1 exists only through proposal
   acceptance (`previous_version_event_id` is absent only for acceptance). The spec's "a bare
   deposit creates a draft Deposit invoice first" is therefore not possible with today's
   records. v1 plan: a card needs an existing invoice; if it is still `draft` the card is
   `draft` with `waitingFor: "invoice_issue"` and the owner issues it (existing action) before
   approving. A deposit with no quote waits for a later change that lets the owner create an
   invoice directly.
2. **Email delivery.** The relay's only mail sender (`send_resend`) is for sign-in codes. v1
   posts a plain text message to Resend with the relay's configured sender address (no
   "<Business> via Colony" name, no reply-to: the relay does not know the owner's email). If
   the coordinator prefers WhatsApp only for v1, say so and email recipients become "copy the
   message" on the card.
5. **Scout is not woken on approval.** The browser route needs Scout to notice the approved
   card. v1 adds no wake reason: Scout finds it with `colony pay cards --state
   creating_link` on its normal wake. A wake reason is a one line follow-up if wanted.
3. **Evidence is written as the approving owner or admin.** The business record handler
   needs that person to be in the client's private channel. If this fails in practice the
   fallback is the `evidence_pending` state above, which the owner clears by ticking again.
4. **Cancel does not deactivate the provider's link.** No recipe purpose for it in v1
   (deactivating is not moving money, but it is a write the owner has not approved shapes
   for). The card tells the owner the link may still be open.

## 14. Privacy (spec section 11)

Notice bodies are raw payer data: owner and admin only, 90 days, then reduced to evidence
fields. Heads carry no phone number, email, key or notice address. Disconnect deletes the
sealed secrets in the same transaction as the head change. Logs carry ids and codes, never a
secret, a body or an address.
