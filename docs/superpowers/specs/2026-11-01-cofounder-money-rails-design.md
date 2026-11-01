# Co-founder mode: money rails v1 (payment links, signing, call booking)

Date: 1 Nov 2026. Status: design approved in direction by the owner on 1 Nov; this document waits for his read. Mockups: Claude Design canvas "Colony 3.0", page "Money rails".

Builds on: `2026-10-29-cofounder-mode-design.md` section 12 (one customer record, money and paperwork, calendar), the customer record (kinds 30679/47069), business records (`docs/business-records.md`: proposals 30633/47003/47004, invoices 30641/47026, payment evidence 47027), the hard rules (`docs/cofounder-hard-rules-audit.md`), company secret bindings (30647/47036) and the WhatsApp sealed-secret pattern (`crates/buzz-relay/src/whatsapp/secrets.rs`).

## 1. Intent and why

A small business owner's day breaks at three points after a lead says yes: getting the quote signed, getting the deposit paid, and getting a call in the calendar. Today Scout can draft all three but the owner does the clicking in other apps, and Colony never learns that it happened, so the customer record, the scorecards and the weekly review go stale.

Money rails v1 lets Scout do the work end to end, with the owner approving each outward step once, and brings "signed", "paid" and "booked" back onto the customer record by itself.

The owner rejected the first proposal (one South African provider per job) because it does not scale: "what if someone in Belarus wants to use it". So v1 is provider-neutral for payments, builds its own signing, and uses Google Calendar (the calendar most owners already have).

## 2. Goals

1. Scout can create a payment link on **any** provider the owner already uses, by working the provider's website in Colony's built-in browser or by calling the provider's API with a key Colony holds and Scout never sees.
2. Every payment link reaches a client only after the owner approves a card that names the client, amount, currency, what it is for, provider and how it will be sent.
3. "Paid" lands on the customer record by itself when the provider tells Colony (payment notices) or when Scout can confirm it, and never on an unverified claim.
4. Colony has its own signing page: a client opens a link, reads the document, types their name, agrees, and Colony keeps an audit trail and a PDF certificate. "Signed" lands on the customer record.
5. Scout books calls into the owner's Google Calendar after the owner approves each booking; Google sends the invite and reminders; "Call booked" lands on the customer record.
6. All three show on the customer record timeline and Money section exactly as the approved CFCustomerRecord board already shows them.

## 3. Non-goals (v1)

- Moving money out: no payouts, transfers or refunds by Scout, ever. Refunds stay a manual owner action recorded as a money adjustment (47028).
- Colony as merchant of record or holding client money.
- Card data of any kind inside Colony.
- Accredited or qualified electronic signatures (statute-required signatures, see section 8).
- A public self-serve booking page where clients pick their own slot (see question 3 at the end).
- Calendars other than Google (Microsoft, Apple, Cal.com) in v1.
- Recurring billing, subscriptions, invoices sent by the provider itself.
- Reading the owner's calendar event details.

## 4. Anti-goals: failure even if it works

- A record says **Paid** when nobody was paid (a spoofed or misread notice).
- Scout, a worker, a log line or a model provider ever sees a provider secret key.
- A client receives a link, a document or an invite the owner did not approve.
- A refund, payout or transfer happens through Colony.
- The signing page looks like phishing (unbranded, asks for a login or password).
- The owner gets double-booked, or a call lands in the wrong time zone.
- A silent failure: a link, signature or booking that failed and shows nothing.

## 5. Owner decisions (1 Nov 2026, verbatim)

- Payments, first reaction to a single-provider pick: "me having to pick a payment provider [won't] scale, because what if someone in Belarus wants to use it". Then: "think harder on how scout can be empowered to create payment links from any provider".
- Payments design approved ("Approve design"): Scout makes payment links on any provider, through the browser or through the provider's API with a key Scout never sees. Paid status arrives on the customer record by itself, and the owner approves every link before a client gets it.
- Signing: "What is that for? I don't understand. Why can't we build our own?" Then picked "Build our own": Colony link, client types name and ticks I agree, Colony records who, when, from where and a document fingerprint, plus a PDF certificate. No vendor, no per-document fee.
- Calendar: "Google Calendar. I speak Google Calendar. What do you need?" Then picked "Yes, build now": add calendar access to Colony's existing Google sign-in app, build and test with Google's test-user allowance (up to 100), owner submits Google's review when the demo is ready.

Standing rules that apply: hard rules (no outreach and no spending without approval, gated at the relay for anything Colony runs), "one user action = one atomic persist", mockups first from the real 3.0 design, GitHub CI is the gate, no em dashes in UI copy.

## 6. Shared building blocks

### 6.1 Approval cards
Each rail drafts a typed card in the conversation (Scout DM or the channel where the ask came from) and in **Needs you**, using the existing plan/ask card language (CFPlanCard, CFNeedsYou): chips "Needs you" plus the type ("Payment link", "Signature", "Call"), a title, the facts table, and Approve, Edit, Reject. Approve is one atomic relay command; the relay re-checks every fact against the head before acting. Approval authority: owner and admins (the same people who approve WhatsApp drafts today). **Coordinator call.**

### 6.2 Connections (Settings > Business > Money and calendar)
One list of connections per business: payment providers (any number), Google Calendar (one), and the payment-notice address. Each row shows provider, route (browser or API), status and last use. Connections are relay-side state, so every Mac and agent in the business sees the same list.

### 6.3 The vault and request recipes (API route)
- A provider API key is pasted once by the owner or an admin into a Colony dialog (never into chat). The desktop sends it straight to the relay over the authenticated connection; the relay seals it with the same envelope pattern as WhatsApp tokens (KEK + community + connection id as AAD) and keeps only the sealed value. It is never returned in any response, event or log.
- The key is locked to the provider's API host(s) named at connect time (for example `api.stripe.com`).
- Scout never calls the provider directly. It asks Colony to run a **request recipe**: a named, owner-approved request shape (method, host, path template, body template) such as "Create payment link: POST https://api.stripe.com/v1/payment_links". Scout drafts recipes by reading the provider's public API docs; the owner approves each recipe once at connect time, shown in plain words. Read-only lookup recipes (GET) are allowed for checking a payment.
- The relay refuses any recipe whose path or body mentions refunds, payouts, transfers, withdrawals or balance moves, whatever the owner approved. **Coordinator call.**
- Recipe runs that create a link run only inside an approved payment-link card (6.1), with the approved amount and currency substituted by the relay, not by Scout.
- Responses go back to Scout with known secret-looking fields removed and the key value scrubbed by exact match.

### 6.4 The browser route
- The owner signs in to the provider's dashboard once in Colony's built-in browser, in a tab shared with the business's AI employees (existing agent browser default access). Session cookies stay in Colony's browser profile on that Mac.
- After the owner approves a payment-link card, Scout opens the provider's create-link page, fills the approved amount, currency and description, and presses Create. The browser's existing Pay/Submit on-screen confirmation is pre-cleared **once**, for that provider host, for 15 minutes, by the approved card. Anything else (a second Create, a different host, Pay, Refund) still stops for on-screen confirmation or is refused when nobody is at the screen. **Coordinator call.**
- Scout reads the created link from the page, opens it to confirm the amount and currency shown to the payer, and records it on the card. A mismatch stops the flow and re-asks the owner.
- Only works while the owner's Mac is awake and signed in to the provider; the card says so.

### 6.5 Payment notices (paid status by itself)
- Each payment connection gets its own private notice address on the business's relay host: `https://<business-host>/hooks/pay/<random-id>` (same shape as `/hooks/whatsapp/{id}`), so every notice maps to one connection and its signing secret. **Coordinator call (builder check).** Scout can paste it into the provider's webhook settings through the browser, after the owner approves that change like any other submit.
- The relay stores each notice body (capped at 64 KiB, kept 90 days), dedupes by provider event id or body hash, and never acts on it alone.
- A notice becomes **payment evidence** (47027, existing) only when it is confirmed by one of: a signature check the relay can perform with a signing secret held in the vault (generic HMAC-SHA256 over the raw body with a header name chosen at connect time), an API lookup recipe returning the same reference, amount and currency, or the owner ticking "I can see this payment".
- Until then the record shows "Payment reported, check" with the notice, never "Paid".
- Providers without notices: Scout checks the dashboard in the browser or the owner's Gmail (existing browser access) and posts a "Payment reported" for the owner to confirm.

### 6.6 Customer record wiring
- Payment links hang off an invoice (existing 30641). A deposit with no invoice creates a draft "Deposit" invoice first. Confirmed payments are existing payment evidence (47027) against that invoice, so revenue totals, scorecards and the weekly review stay right.
- Signature and booking outcomes add customer-record milestones (47069): "Agreement signed", "Call booked", "Deposit paid", matching the CFCustomerRecord timeline.
- Signed PDFs and certificates go into the record's Files.

## 7. Payment links: the flow

1. Trigger: the owner asks ("send Plane Tree a deposit link for R3,750"), a playbook step reaches "deposit", or a signed quote lands. Scout picks the provider: the owner's default connection, else the only one, else it asks.
2. Scout drafts the card: client, amount and currency (from the invoice or quote), what it is for, invoice, provider and route, how it will be sent (WhatsApp to the client's number, or email), link expiry if the provider supports it.
3. Owner approves. One approval covers creating the link and sending one message containing it to the named recipient. **Coordinator call** (avoids a second approval for the message; the message text is shown on the card).
4. Colony creates the link (recipe run by the relay, or Scout in the browser per 6.4) and checks the amount.
5. Colony sends the approved message (existing WhatsApp send path or relay mail), and the card shows Sent.
6. Paid status per 6.5. Card and record move to Paid, with provider reference.
7. Edit after approval voids the approval. Reject records the reason for Scout.

Card states: Draft, Needs you, Creating link, Sent, Payment reported (check), Paid, Expired, Cancelled, Failed (with reason and Try again). Every failure leaves a durable record and a visible state (rule 1 of the review-proven rules).

## 8. Signing: Colony's own

### What it is for (plain words, for the owner)
The client signs the quote or agreement before work starts, which is proof they agreed to the price and the work.

### Flow
1. Scout drafts a signature request from a quote (the exact proposal version, 30633/47003) or from an uploaded PDF: signer name, email and/or WhatsApp number, a short message, expiry (default 14 days).
2. Owner approves the card (it is outreach). Colony sends the link by email (relay mail, Resend, sender name "<Business> via Colony", reply-to the owner's email) or WhatsApp (approved send). **Coordinator call (builder check)** for the sender.
3. The client opens `https://<business-host>/sign/<token>`: business name and logo on top, the document in full, "Type your full name", a tick box "I have read this document and I agree to it", Sign; and Decline with an optional reason. A short privacy notice says what is recorded. Phone first (390 px) and desktop.
4. On Sign, the relay checks the token, expiry and that the document digest still matches, then writes a relay-signed receipt and moves the request head to Signed. The owner gets a notice; the record gets "Agreement signed".
5. If the document was a quote, the record offers "Start the work" (the existing proposal conversion, done by the owner with the receipt as evidence). **Coordinator call**, because today's acceptance must be signed by a member pubkey and the client is not a member.

### Audit trail (in the receipt and on the certificate)
Request id; business; document title; document SHA-256 digest and page count; signer name as typed; where the link was sent (email or number, masked on the certificate); sent at; first opened at; signed at (relay clock, UTC and the business time zone); IP address and user agent at signing; consent text and its version; the method ("typed name and tick box"); relay event id and signature.

### Certificate
A PDF: the original document pages, then a certificate page with the audit trail above, a verification link (`/sign/verify/<receipt-id>`) that re-checks the digest, and "Signed electronically through Colony" (see question 3). Stored in the record's Files, and emailed to the signer when an email is known. A WhatsApp-only signer gets the certificate link in a message only after the owner approves it. **Coordinator call (builder check).**

### Legal scope (for the owner, not legal advice)
- South Africa: ECTA section 13 accepts an electronic signature where the parties have not agreed on a type, if the method identifies the person and shows their approval and is reliable. Only signatures a statute itself requires need an accredited advanced electronic signature. ECTA does not cover the sale of land, long leases of land, wills and bills of exchange.
- United States: the ESIGN Act and UETA give electronic signatures the same effect as ink for most commercial contracts.
- European Union: eIDAS article 25(1): a simple electronic signature cannot be denied legal effect only because it is electronic.
- Out of scope in v1: anything that needs an advanced, qualified or witnessed signature. The request dialog says so in one line.

### States
Draft, Needs you, Sent, Opened, Signed, Declined, Expired, Voided (owner), Replaced (a newer document version voids the old link; the signer page says "This document was replaced. Ask [business] for the new link.").

## 9. Call booking: Google Calendar

### Connect
- Settings > Business > Money and calendar > Connect Google Calendar. The owner signs in with Google in the system browser and grants two permissions: see free and busy times, and create events Colony makes. Scopes: `calendar.freebusy` and `calendar.events`; the builder confirms the narrowest scopes Google offers at build time.
- OAuth runs on the existing "AI-Native" Google Cloud project with the existing Web client and one fixed redirect on the relay (`https://relay.colony.ainative.ventures/oauth/google/calendar/callback`, business in the state parameter). The relay keeps the refresh token sealed like a vault key. **Coordinator call** (one redirect works for every business host).
- Working hours per business (default Monday to Friday, 09:00 to 17:00, business time zone), call length (default 30 minutes), buffer (default 15 minutes).

### Flow
1. A lead replies "yes, call me", or the owner asks. Scout reads free/busy for the next 7 working days and proposes up to 3 times, shown in the business time zone and the lead's when known.
2. The message offering the times is ordinary outreach (approved as today).
3. When the lead picks, Scout drafts the booking card: who, when (both zones), length, Google Meet link yes or no, invite to the lead's email or "no email: confirm by WhatsApp".
4. Owner approves. The relay re-checks free/busy at that moment; if the slot is taken it stops and Scout offers new times. Otherwise it creates the event with the lead as guest; Google sends the invite and Google's own reminders.
5. Record gets "Call booked" with the time; the owner's Today shows it.
6. Lead reschedules or cancels by message: Scout drafts a change card; approval updates or cancels the event.

### Before Google's review (owner steps)
- In testing mode Google allows up to 100 test users, and refresh tokens for sensitive scopes expire after 7 days, so a test user reconnects weekly. The connection row shows "Reconnect" when that happens; bookings never fail silently.
- When the demo works, the owner (the only person who can submit for that Google account) submits verification: app homepage on colony.global, privacy policy that names the calendar data use (we write it, he approves), scope reasons, a short screen video (we record it). Google's review can take weeks.

## 10. Event kinds (proposed; all free in `crates/buzz-core/src/kind.rs` on main a3490b3b0)

| Kind | Name | Notes |
|---|---|---|
| 30680 | Payment link head | Relay-authored, one per link, state machine of section 7 |
| 47070 | Payment link action | Member or agent command: draft, edit, approve, reject, record-created, cancel |
| 30681 | Signature request head | Relay-authored, states of section 8 |
| 47071 | Signature request action | Draft, approve, void, resend |
| 47072 | Signature receipt | Relay-authored, immutable, the audit trail |
| 30682 | Booking head | Relay-authored |
| 47073 | Booking action | Draft, approve, reschedule, cancel |
| 30683 | Money rails connection head | One per connection (provider, Google Calendar, notice address), no secret values |
| 47074 | Money rails connection action | Connect, approve recipe, set default, disconnect |

Reused, unchanged: 30641/47026 invoices, 47027 payment evidence, 47028 adjustments, 30679/47069 customer record milestones, 30647/47036 secret binding metadata (with `storage: server` enabled for money-rails keys; the builder decides whether to extend the spec or keep connection metadata in 30683 only).

Payment notices are rows in a relay table, not events (raw provider bodies can carry payer personal data). Only the confirmed evidence becomes an event.

## 11. Privacy (POPIA) notes

- Colony processes personal information for the business (the responsible party): signer name, contact, IP and user agent; payer details inside provider notices; calendar availability and the events Colony creates.
- Collect the minimum: notices are stored raw only for 90 days and then reduced to the evidence fields; free/busy only, never event titles or guests of other events.
- The signing page carries a plain notice of what is recorded and why, and who the business is.
- Secrets (provider keys, signing secrets, Google refresh tokens) are sealed at rest, never in events, logs or agent context.
- A business that disconnects a provider or Google has its sealed secrets deleted at once; records already made stay.

## 12. Constraints

- Agents run only while the owner's Mac is awake (no cloud Scout in v1). Relay-side steps (recipe runs, notices, signing page, booking creation after approval) do not need the Mac.
- Unsigned Mac builds: nothing in money rails may depend on the Keychain.
- Hard rules: anything Colony runs is gated at the relay; the browser keeps its on-screen confirmation.
- One user action is one atomic relay command; every prefix of a multi-step flow is consistent and retried durably.
- Mockups approved before any screen is built. No em dashes anywhere in UI copy.

## 13. Review Focus

1. A spoofed or replayed POST to the notice address must never make a record say Paid.
2. The amount or currency on the created link differs from the approved card (browser typo, provider rounding, wrong currency default): stop and re-ask.
3. The quote changes after the signature link went out: the old link must show Replaced, and a signature on the old digest is refused.
4. Time zones and double booking: the slot is re-checked at approval; times show in both zones; daylight-saving dates handled.
5. Expired or revoked Google refresh token (7-day testing expiry): the booking card and the connection row show Reconnect; no silent failure.

Also tested: a recipe that targets a refund or payout path is refused even if approved; duplicate notices are deduped; a vault key never appears in a response, event or log line (search the test output for the key).

## 14. My calls (coordinator calls, owner to check)

1. Owner and admins may approve money-rails cards (same as WhatsApp drafts).
2. One approval covers creating a payment link and sending one message with it.
3. The relay refuses refund, payout, transfer and withdrawal recipes outright.
4. The browser route pre-clears exactly one Create on the provider host for 15 minutes after approval.
5. Paid needs a verified notice, an API lookup or the owner's tick.
6. Payment links always hang off an invoice; a bare deposit creates a draft Deposit invoice. Invoices need a client, so a deposit after a signed quote waits for "Start the work" (Scout asks the owner for it in the same Needs you entry). **Builder check.**
7. Signing v1 trusts possession of the link plus the typed name (no extra code), see question 1.
8. "Start the work" after a signed quote stays an owner action.
9. One fixed Google redirect on the relay host; refresh tokens sealed on the relay.
10. Defaults: working hours 09:00 to 17:00 Monday to Friday, 30-minute calls, 15-minute buffer, links and signature requests expire after 14 days.
11. Notice bodies kept 90 days.

## 15. Left to the builder

Exact recipe format and how Scout learns one from docs; HMAC header conventions per provider; PDF rendering library; the signer page stack (served by the relay like the web client); the CLI subcommands (`colony pay`, `colony sign`, `colony book`) and their output shapes; table names; where in Settings each row sits within the approved boards; test fixtures for providers.

## 16. Questions only the owner can answer (from the builder check)

1. **Signer check.** v1 trusts that whoever opens the link is the client, plus their typed name. Should the signer also enter a one-time code sent to their email or WhatsApp before signing? Stronger proof, one more step for the client.
2. **Who picks the call time.** v1: Scout offers up to 3 times in the chat and the lead picks. Alternative: a booking link where the client picks any free slot themselves (a bigger build: a public booking page).
3. **Signing page branding.** Show "Signed electronically through Colony" with the Colony mark on the signing page and certificate (free marketing, as the mockups show), or only the business's own name and logo?

Answers will be folded in here before building starts.

## 17. Owner answers (1 Nov 2026, ~09:10 SAST)

- Mockups on the canvas page "Money rails": **build as shown.**
- Signer check: **link plus typed name is enough** (no one-time code in v1).
- Call times: **Scout offers 3 times** the owner approved; the client replies with one. No public booking page in v1.
- Signing page and certificate: **business brand on top, a small "Signed electronically through Colony" at the bottom**, as in the boards.
- Build order: payment links first, then signing, then booking.
