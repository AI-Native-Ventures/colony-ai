# Email outreach channel: design

Status: proposed design, 7 November 2026
Audience: Colony builders, Signal Story owner, legal reviewer
Scope: research and design only. This document does not authorize provider access, email delivery, account creation, or a production change.

## Decision in one paragraph

Add email as a second source in the existing Outreach desk, but keep the connected mailbox and every provider credential on the owner's desktop. Start with a Gmail API connector for a Google Workspace mailbox on a separate sending domain. Design the connector interface so Microsoft 365 Graph can be added next. Do not ship generic SMTP plus IMAP in the first release. Every prospective email begins as a proposed draft, passes a deterministic pre-send check, and needs owner approval. A company-wide do-not-contact list, direct unsubscribe endpoint, address provenance, sender-readiness verdict, and evidence-backed copy are mandatory before any send path exists. Cold sending starts only after a multi-week no-cold-send period, follows an automatic bounded ramp, and stops on a bounce kill switch. Autopilot is off by default and is not part of the first sending release.

This design follows Colony's channel-first model and its rule that a message is work visible to humans, not a hidden agent action. The existing [WhatsApp outreach contract](../../whatsapp-outreach.md) supplies the interaction pattern: a proposal becomes a pending item in Needs you, the owner may edit, approve, or reject it, and a durable outcome appears in Chats. The email design deliberately does not copy WhatsApp's relay-held provider-secret model because OAuth credentials for an owner's mailbox should remain on that owner's desktop.

## Scope and non-goals

### In scope

- A user-connected mailbox for sending and reading relevant replies.
- Gmail API first, Microsoft Graph second, generic SMTP plus IMAP last.
- Email drafts, evidence, approval, schedule, send outcome, reply, suppression, and audit records.
- A company-wide suppression list and a public one-click unsubscribe endpoint.
- A plain READY or NOT READY verdict for each sender identity, with a concrete repair for every failed check.
- A bounded first-contact ramp, short per-recipient follow-up sequence, recipient-local send window, and sender-wide bounce kill switch.
- An Email source in the existing Outreach desk's Needs you, Pipeline, and Chats views.
- Deterministic pre-send checks with no model call.
- A legal-safe product posture for South African outreach while the owner obtains counsel.

### Not in the first release

- Sending from a relay, server, worker, or unattended cloud job.
- Buying lists, scraping directories, or importing third-party enrichment data.
- Automated mailbox rules, automatic replies, automatic consent decisions, or a high-volume campaign tool.
- A Colony-built warm-up service, open-tracking pixels, click tracking, or deliverability guarantees.
- A LinkedIn-style channel, social-network direct messages, browser automation, or collection of outreach data from social networks.
- SMTP recipient probes, VRFY probes, RCPT TO probes, or any attempt to infer mailbox existence by contacting a recipient server.
- Attachments, images, tracking redirects, mass campaigns, and list imports.
- A claim that delivery, inbox placement, or a provider complaint feed has been verified merely because an API accepted a message.

## Product invariants

1. **The owner brings the mailbox.** A provider token, app password, and refresh token stay in desktop-local storage. They are never put in a Nostr event, relay table, log, support bundle, agent prompt, or browser URL.
2. **The relay stores workflow state, not mailbox authority.** It can audit a proposal, decide approval, enforce a cap, store a suppression, and make a message visible in Chats. It cannot call Gmail, Graph, SMTP, or IMAP as the owner.
3. **Evidence is data, not prose.** Any factual claim about a recipient must point to a fresh observation, normally a Qualify signal and its evidence URL. A public address has its own provenance.
4. **Approval is the default.** A Scout or another agent may create a proposal, never approve it, send it, turn on autopilot, or reconnect a mailbox.
5. **Opt-out wins everywhere.** Once a suppression commits, no new email send claim for that address may be granted in the company. A message already in the tiny desktop-to-provider race window is recorded as such and is never silently retried.
6. **New protocol data is additive.** A relay and desktop one or two versions apart must continue to parse existing Outreach and Chat data. An old desktop ignores unknown email kinds and optional email fields rather than treating them as an error.
7. **No invented results.** Provider acceptance is not delivery. A reply classification is not a legal conclusion. A published address is not consent. A guessed address is not verified.
8. **Readiness is an explicit gate.** A sender is either READY or NOT READY. The product never turns an unknown, stale, or failed readiness input into a pass.
9. **Cold outreach is not a reply.** Cold first contacts and follow-ups obey the warm-up and ramp policy. A genuine reply gets priority over that cold quota, but never over suppression, a confirmed hard bounce, a disconnected sender, or the all-sending bounce kill switch.

## Sending connectors

### Comparison

| Option | Send and read path | Credential location | Strengths | Limits | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Gmail API with OAuth | Gmail API raw MIME send and Gmail API mailbox read | Desktop only | OAuth consent, reliable message and thread identifiers, explicit Gmail scopes, no password handling | Google app registration and mailbox scopes need owner and provider review; a personal Gmail address is a poor outreach identity | Build first for a Google Workspace mailbox on the chosen sending domain |
| Microsoft 365 with Graph | Graph sendMail and Graph mailbox delta reads | Desktop only | OAuth, delegated Mail.Send and Mail.Read, Outlook conversation metadata, delta cursor | Tenant consent and conditional access can block the flow; sendMail acceptance is not delivery | Build second using the same provider interface |
| SMTP plus IMAP | SMTP send and IMAP read | Desktop only | Broad provider coverage and useful for an existing custom-domain mailbox | Server settings, threading, OAuth support, NDR formats, and authentication vary by provider; basic password authentication is unsafe and often disabled | Defer until Gmail and Graph prove the workflow |

The first connector is Gmail API for a Google Workspace mailbox using the selected sending domain. The UI must reject a personal @gmail.com or @googlemail.com address as an outreach identity unless an owner explicitly enters a documented pilot exception. The app should display that exception as a deliverability and brand risk, not as a working default. Gmail's API documents message sending, threading, and the relevant OAuth model. [S5] [S6] [S7]

Microsoft Graph is the next connector because the same owner-authorized, local-token, API-first shape works. Exchange Online has disabled Basic authentication broadly, and Microsoft recommends OAuth or Graph over legacy mailbox protocols. Generic SMTP plus IMAP therefore arrives only after a capability test proves a provider supports TLS and either OAuth 2.0 or an owner-supplied app password. It must never ask for an ordinary mailbox password. [S9] [S10] [S11] [S12] [S13]

### Provider interface

The desktop owns one implementation of this capability interface per connected account:

    connect(interactive_owner_only) -> ConnectedAccount
    refresh_if_needed() -> AccessState
    verify_sender_identity() -> SenderIdentity
    send_raw_mime(draft, idempotency_key) -> ProviderAccepted | ProviderRejected | Ambiguous
    sync_inbound(cursor) -> InboundPage
    fetch_message(provider_message_id) -> InboundMessage
    disconnect() -> LocalCredentialDeleted

The interface intentionally does not expose a generic "send anything" command to agents. The only sender call receives an already-approved immutable message revision and an idempotency key issued by the relay.

For Gmail, request the narrowest scope for the release being used:

- Outbound-only release: gmail.send.
- Reply release: gmail.send plus gmail.readonly. Do not ask for mailbox mutation merely to read replies.

For Graph:

- Outbound-only release: delegated Mail.Send.
- Reply release: delegated Mail.Send plus delegated Mail.Read.

Use OAuth authorization code flow with PKCE and a loopback callback that is opened only after the owner presses Connect. Use a high-entropy state value and validate it before exchanging the code. Store the granted scopes and account identifier with the local connection record. Do not support application permissions, service accounts, domain-wide delegation, or an OAuth redirect controlled by the relay in version 1. Google publishes Gmail send and read scopes; Graph documents delegated Mail.Send and its mailbox-read permission model. [S9] [S16]

### Desktop-local credential record

The implementation must use Colony's approved file-backed desktop profile store, not a new path chosen by a feature team and not an OS keychain prompt. The logical record is:

    EmailCredentialV1 {
      account_id,
      provider: gmail | graph | smtp_imap,
      mailbox_address,
      granted_scopes,
      access_token,
      refresh_token_or_app_password,
      access_token_expires_at,
      provider_metadata,
      connected_at,
      last_refresh_at,
      state: connected | refresh_failed | requires_reconnect | disconnected
    }

The file must be private to the local desktop user, excluded from diagnostics and export, and protected using the repository's existing file-backed identity protection. If the existing store does not encrypt local secrets, the implementation must state that fact in its security review rather than claim encryption it does not provide. No credential is copied to a relay, browser local storage, source file, test fixture, or event payload.

Before a planned send or inbound sync, the desktop refreshes a valid OAuth token locally. Google offline access supplies a refresh token, while Microsoft's v2 flow uses offline_access for refresh tokens. If a refresh returns revoked, invalid_grant, policy, consent, or tenant errors:

1. Mark the local connection requires_reconnect.
2. Post a credential-state event with no token or provider error body.
3. Put related scheduled rows in blocked_connection, not failed_sent.
4. Create one Needs you item asking the owner to reconnect.
5. Do not retry OAuth interactively or attempt to fall back to a password.

The owner may reconnect only through the provider's own interactive page. Reconnection creates a new local credential record and leaves the old audit trail intact.

### Why the relay is not the sender

The relay remains the policy source of truth but never receives a provider credential. A desktop that owns the mailbox claims one approved row, verifies the policy immediately before send, calls the provider, and posts a bounded outcome. If that desktop is asleep, closed, offline, or disconnected, scheduled rows remain queued with "Waiting for the connected desktop." This is intentional. It is safer than moving an owner's mail authority to a shared relay just to achieve unattended sending.

## Sender readiness, warm-up, and operating limits

### Sender identities and a plain readiness verdict

The company may connect several sender mailboxes, but each is a separately named sender identity with its own daily cold-email cap, pause state, readiness evidence, and local sign-in. A sender identity is not a shared cloud credential:

    EmailSenderIdentity {
      sender_id,
      display_name,
      mailbox_address,
      sending_domain,
      desktop_profile_id,
      cold_daily_cap,
      paused_at,
      pause_reason,
      readiness_status: ready | not_ready,
      readiness_reasons,
      readiness_checked_at
    }

The credential record for every mailbox remains in the approved desktop file store described above. The relay receives only the sender identity, its public state, and the opaque desktop-profile identifier. It never receives a mailbox sign-in, refresh token, provider session, or password. An owner can pause one mailbox without pausing another, but all mailboxes share the same company suppression list, business-level sequence stops, and legal policy.

The readiness panel shows only **READY** or **NOT READY**. READY means that every required input below is fresh and passing. Anything absent, stale, failed, listed, or unknown is NOT READY. The panel names the failed check, evidence time, and the exact repair. It does not use a reassuring intermediate label such as "probably ready."

| Check | Evidence Colony records | NOT READY repair |
| --- | --- | --- |
| Verified From identity | Provider identity response and owner-controlled seed evidence | Correct the provider identity or use the approved sender mailbox |
| SPF | DNS TXT lookup plus the selected provider's expected sender setup | Publish or correct the SPF record, then check again |
| DKIM | Configured selector, DNS result, and aligned seed result | Publish the selector and obtain a passing owner seed result |
| DMARC | DNS TXT result at `_dmarc.sending-domain` and aligned seed result | Publish or correct the record and alignment, then check again |
| TLS transport | Provider capability or owner seed-message header evidence | Fix transport configuration or choose a capable provider |
| Domain age | Owner-provided registrar or setup evidence with observed date | Wait until the domain has completed the minimum 21-day no-cold-send period |
| Blocklist status | Dated, read-only result from an owner-approved status source | Resolve the listing or configure and obtain a fresh clean status result |
| Hard-bounce rate | Confirmed bounce events for this mailbox over the defined rolling window | Investigate source and list quality, then have the owner clear the kill switch |
| Visible unsubscribe | Generated MIME includes a footer line, List-Unsubscribe, and List-Unsubscribe-Post | Fix the template or endpoint before another claim |
| Sender details | Display name, reply address, legal or trading identity, and postal address | Complete the approved sender profile |
| Suppression endpoint | Health result and opaque-token fixture result | Restore endpoint health before cold sending |
| Mailbox state | Completed inbound baseline, durable cursor, and no unresolved sync gap | Finish sync or resolve the gap before any provider call |

The DNS, age, blocklist, and seed checks are configuration evidence, not proof that a recipient will receive mail. The owner may choose a later read-only blocklist or warm-up-status provider, but it supplies only a dated status signal. It never receives Colony write access, never sends mail through Colony, and never overrides a failed DNS, legal, suppression, or bounce check. Gmail's published guidance requires authentication and TLS for all senders to personal Gmail, with additional DMARC, alignment, and one-click unsubscribe requirements at bulk scale. [S1]

### Warm-up and automatic cold-email ramp

Colony does not build a warm-up service and does not generate artificial messages to manufacture reputation. The initial release also does not connect to a warm-up service. During warm-up, Colony shows NOT READY, holds cold sequences in Needs you, and leaves the owner able to finish legitimate setup and seed verification. It does not invite the owner to work around the hold.

The recommended sender policy is a minimum 21 calendar-day no-cold-send period after the sender identity has passing authentication evidence. When that period and every readiness check have passed, the mailbox becomes READY and Colony automatically applies this per-mailbox cold-email ramp:

| Eligible cold-sending day | New first contacts and follow-ups allowed |
| --- | --- |
| Days 1 to 21 after authenticated setup | 0 |
| First READY day | 3 |
| Each subsequent clean local business day | Previous cap plus 2 |
| Ongoing ceiling in the first release | 25 per mailbox per day |

A day is clean only when there is no unresolved hard bounce, complaint, provider throttle, unsubscribe failure, readiness regression, or mail-state gap. A sender pause freezes the cap. A later owner-approved mailbox may have a different lower cap, never a higher one without a separate owner decision. Every lead also keeps its own cooldown and sequence cap, so several mailboxes cannot multiply-contact the same business.

A genuine reply does not consume the cold-email ramp or cold cap. It may use a priority send claim after its own preflight passes. That exception never defeats recipient suppression, a confirmed hard bounce, a disconnected sender, or the all-sending bounce kill switch below. These are operating limits, not provider quotas; provider limits can be lower and change without notice. Google's guidance recommends gradual, consistent volume increases and monitoring of errors and reputation. [S2]

### Time zones and office hours

Queue a cold first contact or follow-up only Monday through Friday, 09:00 to 16:30 in the recipient's verified time zone. South African prospects therefore use the same local window, while foreign prospects use their own verified location. The time zone is valid only when it comes from a stored country and city signal, owner selection, or a published business address that the owner confirms. If it is unknown, the row remains Needs you rather than assuming Africa/Johannesburg.

The app may draft an inbound reply immediately, but schedules its send in the recipient-local window unless the owner explicitly sends it sooner. No scheduling rule delays recording an opt-out. Local public holidays are not inferred in version 1. The owner can pause a campaign for a date range. This is a recipient-respect policy, not a legal conclusion about every country's direct-marketing hours.

### Bounce and complaint kill switch

Provider acceptance only means the provider accepted the submission. It does not establish recipient delivery, inbox placement, reading, or a human reply. Microsoft Graph explicitly distinguishes a 202 Accepted response from completed delivery. [S9]

The sender-wide bounce kill switch activates when either of these conditions is true:

- The rolling hard-bounce rate is greater than 2 percent of the latest 100 provider-accepted campaign messages from that mailbox.
- Three confirmed hard bounces arrive within any rolling 24-hour period.

During the first 25 campaign messages, any hard bounce also freezes the ramp for owner review because the sample is too small to call healthy. When the kill switch is active, the relay refuses every new send claim for that sender, including a reply claim. Drafts remain visible and intact in Needs you. The owner must correct the source or sender problem, document the reason, and explicitly resume the sender. A reply bypasses the cold ramp only, never this safety switch.

- A clear hard bounce or non-delivery report creates a company-wide suppression with reason `hard_bounce` and marks the address undeliverable. It is never retried automatically.
- A transient rejection before provider acceptance receives a durable retry record: 15 minutes, 1 hour, then 4 hours, maximum three attempts. A later retry re-runs every policy check.
- A provider 5xx, timeout, or crash after the provider call begins but before a definite result is an unknown outcome. The row becomes `outcome_unknown`, keeps its exact draft revision and idempotency key, appears in Needs you, and is never automatically sent a second time.
- A provider complaint or feedback-loop signal, when a connector actually exposes one, creates a complaint suppression and pauses the related campaign. Not every mailbox provider supplies complaint data, so the UI must say "complaint feedback unavailable" instead of implying coverage.
- A provider throttle pauses new sends for that sender identity and leaves every caught failure as a durable retry or a visible terminal state.

## Discovery, fit, address evidence, and do-not-contact controls

### Who Colony may identify

Discovery first checks the company do-not-contact list against the business's known address and domain. A matching address or domain means the business is skipped before contact discovery, and the register records `skipped_do_not_contact` with the suppression reason. Discovery must not use the absence of a contact record as permission to resume.

For an eligible business, the only named people who may become a candidate are an owner or manager explicitly presented as current on the business's own site. The evidence must bind the name, present role, and business to the same first-party page or clearly linked official page. The system rejects a person found only in a testimonial, review, past-team page, news item about a former employee, social profile, directory, or a look-alike job title. It never turns a guessed role or a historical mention into a current decision-maker.

The general-inbox fallback is deliberately narrow: `info@`, `owner@`, or another generic address is eligible only when the business itself prints it on an official page and Discovery found no supported current owner or manager. It remains subject to the same legal, readiness, fit, suppression, and approval gates. A bot challenge is recorded as `challenged`, not as a down website or a failed business. The job stops at that state and is not retried automatically.

### Fit gate and contact register

Before a proposal exists, a deterministic fit assessment produces an evidence-backed score from 0 to 100. The recommended initial minimum is 60. The owner may choose a higher threshold by company or campaign, but an agent cannot lower it for an individual prospect. A score below the threshold creates no draft and no queued send.

The Outreach register must show both contacted and not-contacted businesses. Each not-contacted row has a durable, plain-language reason such as `below_fit_threshold`, `skipped_do_not_contact`, `no_supported_current_contact`, `challenged`, `address_not_eligible`, `legal_hold`, `sender_not_ready`, or `owner_rejected`. It also preserves the score, score-policy version, available evidence identifiers, and the time of the decision. This makes a skipped prospect explainable without pretending that a weak fit is a technical failure.

### Company do-not-contact list

The suppression service holds two target forms: a canonical email address and a normalized business domain. Either form prevents marketing email. A record contains the target type, protected target value, company scope, reason, source event, occurred time, actor, and any re-consent or correction reference.

The system checks this list in four places: before Discovery begins, before a proposal is created, during every pre-send check, and immediately before the desktop makes a provider call. A domain suppression prevents contact discovery and all campaign mail to that business domain. An address suppression prevents mail to that address even if its domain is otherwise eligible. The relay is authoritative for the send-time check, so a desktop cannot send from a stale local view.

Every suppression has a reason, such as recipient opt-out, hard bounce, complaint, legal request, owner instruction, or registry block. Undo is an explicit, audited reversal record, not deletion. For a recipient opt-out, an undo requires documented later re-consent and an owner decision. The original suppression and its reason remain visible in the audit trail.

### Allowed sources

The first release accepts only:

1. A Qualify PUBLIC_EMAIL observation. Store the exact published address, source URL, observed time, page title if available, and the observation identifier.
2. A role address visibly published by the business, such as info@, hello@, sales@, bookings@, or support@, with the same URL and capture metadata.
3. An owner-entered address with an explicit source note and a separate owner confirmation.

Do not collect names from a site for email targeting in version 1 beyond the current owner or manager rule above. Do not pull addresses from social networks, directories, data brokers, LinkedIn, browser extensions, contact databases, or another product's data.

Each address has one status:

| Status | Meaning | Send eligibility |
| --- | --- | --- |
| published_role | A role inbox visibly published by the business | Eligible only after legal-basis, readiness, preflight, and approval checks |
| published_personal | A named or person-identifying address visibly published by the business | Requires the conservative consent path and owner approval |
| owner_added | Owner supplied it with source note | Requires the conservative consent path and owner approval |
| guessed | Constructed from a name or pattern, not published | Not eligible by default |
| syntax_invalid | Fails deterministic syntax or domain checks | Never eligible |
| domain_unresolved | Domain has no usable mail route at last check | Not eligible until rechecked |
| hard_bounce | Confirmed undeliverable | Suppressed |
| suppressed | Recipient opted out, complained, bounced, or registry blocked | Never eligible until documented re-consent is reviewed |

Pattern guessing is not a version 1 feature. If the owner later authorizes it, it must remain guessed in every view, never be represented as verified, and require a per-address owner checkbox before it can become a proposal. Bulk selection cannot approve guessed addresses.

### Feasible verification

The desktop may run these local, non-contacting checks:

- Parse mailbox syntax and normalize the domain.
- Look up MX records, falling back to an A or AAAA route only when appropriate.
- Compare the published address domain with the business website domain and flag a mismatch.
- Preserve the public source URL and a captured text fragment.
- Record an owner test only as a test of the owner's own mailbox setup, never as proof that a prospect's address exists.

Do not implement SMTP VRFY, SMTP EXPN, SMTP RCPT TO, catch-all probing, or any other remote mailbox probe from a user machine. Modern providers often block or disguise those results; the attempts can create abuse signals and do not give a reliable recipient-consent answer. A paid verification vendor would add cost, a third-party disclosure of personal information, and a new legal review. It is out of scope until the owner explicitly chooses it.

### Evidence from Qualify

The Qualify specification already makes PUBLIC_EMAIL an observation with a source URL and observed time. Email drafting consumes an immutable evidence snapshot:

    EvidenceSnapshot {
      observation_id,
      signal: PUBLIC_EMAIL | other_qualify_signal,
      value,
      confidence,
      evidence_url,
      observed_at,
      expires_at
    }

Only a fresh observation within 30 days and at the confidence threshold set by the Qualify design may appear in an email proposal. A signal about a missing feature must use its qualified wording, such as "no booking page found," not a stronger claim about the business.

### External text is data, never authority

Website text, bot-challenge pages, contact forms, inbound email, and attachments are untrusted data. They can supply an evidence capture after deterministic validation, but cannot alter a policy, request a send, grant a legal basis, change a cap, choose a recipient, or invoke a tool. A model-assisted extraction or drafting call receives this material as clearly delimited data and has an empty tool list. It cannot browse, send mail, change files, call a provider, or take any side effect.

The product records an untrusted-content flag whenever external text contains a directive, credential request, instruction-disclosure request, or policy-changing request. The flag sends the item to Needs you. A bot challenge is one such flag: it is visible as `challenged` and stops the discovery attempt rather than being treated as a broken site or retried.

## Deterministic pre-send check

The pre-send check runs with no AI at draft creation, after any edit, at owner approval, and immediately before the desktop claims a send. It produces a machine-readable list of pass, warn, or block results. A warning cannot be ignored by an agent. A block cannot be bypassed by an owner except where the owner-decision policy expressly allows it and the override is audited.

### Copy representation

A no-AI checker cannot truthfully infer whether arbitrary free prose contains an unsupported factual assertion. Version 1 therefore represents copy as typed blocks:

    StaticBlock: approved non-factual language
    MergeBlock: a defined field with a source
    ClaimBlock: text plus one or more EvidenceSnapshot identifiers
    LinkBlock: a URL plus domain classification
    FooterBlock: approved sender, postal address, and opt-out language
    AITransparencyBlock: truthful disclosure language when a recipient asks

An agent may propose the blocks. The owner may edit them, but an edit that introduces a fact must become a ClaimBlock with evidence. If the UI cannot represent the edit as typed blocks, it becomes a blocked raw_text_edit rather than silently passing.

### Required checks

| Check | Blocking rule |
| --- | --- |
| Merge fields | No unresolved, unknown, empty, or stale merge field |
| Claims | Every ClaimBlock has at least one fresh evidence snapshot and the displayed text matches its allowed wording |
| Sender statements | Business identity, service description, reply address, and physical postal address point to an owner-approved sender profile revision |
| Banned language | Reject configured phrases such as guarantee, guaranteed, risk-free, urgent, act now, and any owner-configured phrase; flag superlatives for owner review |
| Length | Maximum 180 words and 1,200 characters for a first contact |
| Links | A cold-mail link must be HTTPS and on an owner-verified sender domain. No tracking redirects, URL shorteners, or recipient-site links. A non-owner domain is an autopilot hold; a human may approve an explicitly labelled external-link reply after review |
| Address | Status is eligible, source and timestamp exist, syntax and domain route are current, and a guessed address has an individual owner acknowledgement if that future feature exists |
| Legal basis | A per-recipient legal assessment is present and has a sending-permitted result for this route |
| Suppression | No address or business-domain do-not-contact record, no campaign stop, and no relevant registry block record |
| Readiness | Sender identity is READY, its connection is connected, mailbox baseline is complete, and no sender-wide pause or kill switch applies |
| Cap and window | A durable per-mailbox quota slot, sequence-step allowance, and valid recipient-time-zone window exist |
| Cold-mail footer | Every cold message contains the business postal address and a plain, usable opt-out line in both text and HTML parts |
| Unsubscribe | Visible footer link, List-Unsubscribe, and List-Unsubscribe-Post headers are generated for campaign mail |
| AI transparency | A message that answers whether Scout is AI uses the approved truthful disclosure block and never claims to be human |

The legal-basis check answers the per-recipient South African question "may this specific message be sent to this address now?" It creates an immutable assessment with recipient, address provenance, jurisdiction evidence, purpose, proposed message type, consent or customer evidence, registry evidence, policy version, result, and reviewer where relevant. Conservative outcomes are:

| Result | Meaning | Product action |
| --- | --- | --- |
| `permitted_recorded_consent` | Specific recorded consent supports this sender, purpose, and channel | May continue to the other gates |
| `permitted_existing_customer` | Similar-service route and sale-context evidence are present | May continue to the other gates |
| `permitted_one_time_consent_request` | No prior refusal is recorded and the reviewed consent-request route applies | One attempt only, then no follow-up unless consent is recorded |
| `legal_hold` | Jurisdiction, recipient type, address source, consent facts, registry state, or policy mapping cannot be established | Do not approve, schedule, or send; create a Needs you legal item |
| `legal_blocked` | A refusal, incompatible purpose, missing required evidence, or explicit policy prohibition exists | Cancel any queued campaign row and retain the reason |

Any direct sales email outside those conservative routes stays `legal_hold` until the owner attaches a lawyer-approved policy. The check may say "unable to verify" but may never convert that state into a pass, and a manual approval cannot turn an unresolved legal hold into an outbound send.

### AI subscription headroom

Colony may read a user's supported AI-plan quota signal through a desktop-local, read-only adapter. The adapter records only the remaining allowance, reset window, and observation time needed for scheduling. It does not read billing data, send prompts to a quota provider, copy account credentials to the relay, or scrape a browser session.

The default policy reserves 25 percent of the available model allowance for the owner's own work. The owner may raise that reserve. When the read-only signal is absent, stale, or at or below the reserve, Colony pauses model-assisted discovery, drafting, and triage with the visible reason `owner_headroom_reserved`. Deterministic preflight, suppression, mailbox sync, and manual review remain available. A queued AI task is skipped rather than silently spending into the reserve, and no AI call in this feature has tools.

## Outreach desk workflow

### States

    proposed
      -> preflight_blocked
      -> needs_owner
      -> approved
      -> scheduled
      -> claiming
      -> sending
      -> provider_accepted
      -> delivery_unknown
      -> replied | auto_reply | out_of_office | bounced | suppressed

    sending
      -> outcome_unknown

Terminal exceptions are rejected, cancelled, failed_pre_acceptance, outcome_unknown, and requires_reconnect. `outcome_unknown` retains the exact approved draft and is never eligible for an automatic second provider call. The UI never labels provider_accepted as delivered.

### Needs you

The existing Needs you tab gains an Email section with:

- Draft subject, plain-text preview, recipient business, address status, legal-basis label, and exact evidence chips.
- A preflight summary with every block and warning in plain language, including READY or NOT READY sender evidence and the repair.
- Buttons: Approve, Edit, Reject, and Open evidence.
- A distinct outcome-unknown item requiring a human decision rather than a resend button.
- A reply needing attention item unless it is a deterministic opt-out, bounce, or auto-reply.
- A legal hold, prompt-injection hold, or first-reply-after-re-consent hold that cannot be cleared by the draft author.

Approve records the exact message revision, evidence snapshot, sender-profile revision, policy revision, reviewer, and time. Edit creates a new immutable draft revision and re-runs preflight. Reject creates an audit record and cannot be converted back into approved without a new proposal.

An approved batch is a convenience for review, not a blanket authorization to change individual messages. Each recipient row remains independently preflighted and may be dropped. The desktop obtains a send claim per row.

### Follow-up sequences

An initial contact may have at most two follow-ups, for a maximum of three campaign messages per recipient and per business sequence. The recommended cadence is the initial message, a first follow-up after four recipient-local business days, and a final follow-up after ten recipient-local business days. A scheduled follow-up is a new immutable proposal, not a repeat of an old send, and is shown in Needs you for approval while autopilot is off.

The sequence stops immediately and cancels every remaining step when any of these occurs: a reply from the recipient or anyone mapped to the same business, an address or domain suppression, an opt-out, a bounce, a complaint, an out-of-office response, a legal hold, sender NOT READY state, mailbox sync gap, kill switch, owner pause, or expiry. A reply from any known participant at the business creates a business-level `replied` stop, so Colony never keeps cold-emailing colleagues after a business has answered.

No new cold sequence starts for the same business until the owner explicitly chooses a new, legally permitted outreach reason. Switching mailboxes, aliases, or contacts does not reset the business-level sequence stop.

### Pipeline

Pipeline includes an Email lane or source marker without replacing WhatsApp stages. A lead can have both channels. The email record shows only factual state:

- queued
- provider accepted
- delivery unknown
- replied
- auto reply
- out of office
- bounced
- opted out
- needs owner

Pipeline also shows `awaiting_reply` only after a provider-accepted campaign message with no later reply, opt-out, bounce, or terminal stop. It is a work filter, not a claim that the recipient saw the mail. It must not show invented follow-up promises or engagement scores.

### Chats

Email replies and every sent email land in the existing Chats tab as one channel-aware conversation attached to the business and lead. The conversation retains the ordered outbound and inbound thread context, sender, recipients, timestamps, subject, provider thread identifiers, and safe plain-text body. Chats provides an `Awaiting reply` filter for conversations whose latest relevant state is a sent campaign message. Render incoming HTML after strict sanitization with remote images and external content disabled by default. Attachments remain metadata-only in version 1 and require a later explicit download design.

Conversation context is available to the owner and, if an owner explicitly asks for a draft, to a no-tools model call as untrusted data. It does not authorize an agent to send, change policy, follow instructions embedded in a reply, or suppress a safety check.

## Autopilot

Autopilot is OFF by default. It is unavailable in the initial sending release.

After a separate owner decision and legal review, an owner may enable a narrow rule set only for recorded-consent or existing-customer messages. A rule has:

    rule_id
    sender_identity
    campaign
    legal_basis_types
    approved_template_revision
    allowed_evidence_signals
    daily_cap
    time_window
    owner_domain_allowlist
    instruction_fingerprint_version
    expires_at
    enabled_by

Autopilot must stop immediately when any of these occurs:

- a recipient reply, opt-out, hard bounce, complaint, or provider throttle;
- a sender readiness regression or missing authentication;
- a provider token error or desktop disconnect;
- a preflight warning or expired evidence;
- a non-owner-domain link, an instruction-echo match, or the first reply after a documented re-consent;
- a rule expiry, campaign pause, or owner revocation.

Autopilot never sends to a guessed address, a new personal address, a recipient with an ambiguous legal basis, or an address with a public-source mismatch. It never sends a message containing a link outside the sender's owner-domain allowlist. This deliberately holds a Google Calendar booking URL, because it is a third-party domain, for explicit human approval.

The instruction-echo guard compares normalized outgoing text against a local, non-exported fingerprint set of Scout policy and instruction phrases. A match is `prompt_injection_hold`; it does not reveal the matched instruction, ask the model to explain it, or let the message send. Inbound content that asks Scout to ignore policy, disclose instructions, or change an action is untrusted data and creates the same human-review hold.

After a recipient opt-out has been explicitly reversed through documented later re-consent, the first reply to that recipient always requires owner approval. Autopilot cannot send it. It never infers a consent, legal basis, calendar intent, or interest from a reply. Every automatic decision posts a visible audit item. The owner can switch it off at any time; the switch cancels unsent claims before a new provider call starts.

## Replies and opt-outs

### Inbound sync

The desktop polls the connected mailbox while it is running:

- Gmail: use the Gmail API's message and thread identifiers, retaining a local high-water cursor.
- Graph: use a folder delta token for Inbox and any configured sent/reply folder.
- SMTP plus IMAP, when later built: use IMAP UIDVALIDITY and UID state, never message sequence number alone.

No provider call is eligible until the configured message scope has a known mailbox state: an initial baseline has completed, every baseline message is durably classified or quarantined, the durable cursor is committed, and no delta or UID gap remains. A reconnect, cursor invalidation, or interrupted page keeps the sender NOT READY until the gap is reconciled. This prevents an outbound sequence from racing a reply that the desktop has not yet observed.

Cursor advancement is transactional: store the inbound message and relay event before committing the local cursor. Deduplicate with provider account plus provider message identifier and RFC Message-ID. Do not retrieve or display mail outside the configured response scope, and give the owner a clear read-scope consent screen before enabling reply handling.

Thread a reply with provider conversation information when available and RFC Message-ID, In-Reply-To, References, normalized participants, and subject as secondary evidence. Gmail replies must preserve the Gmail thread id and the RFC reply headers. Graph messages provide conversationId and internetMessageId. Gmail and Graph document those threading and change-tracking primitives. [S6] [S10] [S11] A reply that cannot be safely mapped is shown as "Unmatched email" for a human to attach or ignore.

### Classify without pretending certainty

Run deterministic checks before any model-assisted triage. A model is not needed for a stop request and must never be the only gate between a stop request and suppression.

1. Extract the entire new-message subject and text content, not just a preview, normalize Unicode, case, spacing, punctuation, and common reply markers, then scan it with versioned phrase packs. A bare `STOP` is always a stop request.
2. The initial packs cover English, Afrikaans, isiZulu, and isiXhosa. Each pack is a reviewed list of stop, unsubscribe, and no-contact expressions plus inflection and punctuation rules. The same deterministic pack interface accepts other languages used by a company. A language is not declared supported until a native-language reviewer has approved its pack.
3. If a stop expression matches anywhere in the new reply, atomically create the address suppression, retain the exact reason and matched pack version, cancel future address rows, and create the business-level sequence stop. This is permanent until an explicit audited undo based on documented later re-consent.
4. If the same reply also matches a complaint or legal-action phrase pack, retain the opt-out first and create an owner escalation tagged `complaint_or_legal_request`. A complaint never cancels the opt-out just because it needs owner attention.
5. If the message is a delivery-status notification or a provider NDR, classify it as bounce and apply the bounce rules.
6. If standard auto-response headers show `Auto-Submitted: auto-replied`, or the message matches configured out-of-office signals, classify it as `auto_reply` or `out_of_office`.
7. Otherwise classify it as `human_or_unknown` and route it to Needs you.

An unrecognized or ambiguous phrase is not a reason to keep sending. The current business sequence remains held until a human decides whether it is a stop request. An out-of-office response stops follow-up and appears in Chats; it does not count as consent or human interest.

### Replies, AI identity, and calendar booking

Colony does not send autonomous replies in the initial release. A human can ask Scout to draft a reply using the whole safe conversation context, but Scout has no tools and cannot send it. If a recipient asks whether Scout is AI, any proposed answer must include the approved truthful disclosure: Scout is an AI assistant working with the sender, and a human can take over. The system must not draft or approve a claim that Scout is human.

The approved Google Calendar booking link is available only in a reply after a human has identified genuine scheduling intent or explicitly chooses it. It is not included in cold first contacts or follow-ups. Because a Google Calendar URL is outside the owner's domain, it is an autopilot hold and requires the owner to review the exact link and reply. Colony does not create a calendar event, read a recipient's calendar, or infer booking consent from a click.

### Opt-out service level

An opt-out is honoured in minutes:

- The public one-click endpoint commits a company suppression before returning success.
- A deterministic inbox opt-out commits the same suppression as part of inbound-message storage.
- The sender checks the relay suppression state at claim time and immediately before the provider call.
- Queued rows for that canonical address are cancelled in the same suppression transaction.

There is a narrow distributed race between the last authorization check on a desktop and the provider receiving a send request. The feature must document it honestly. If it occurs, the message is not resent, and the audit shows whether suppression arrived before or after the recorded provider attempt. Moving mailbox credentials to the relay would reduce this race but violates the default custody model, so this design does not do that.

## Message format and signature

The canonical version of every cold email is plain text. Colony generates a matching, minimal HTML alternative only when the message uses structured formatting. The text and HTML parts must carry the same recipient, claims, postal address, opt-out line, and unsubscribe destination. HTML is not an opportunity to add tracking pixels, remote images, hidden copy, or a second message. A text-only message remains valid where a visual layout adds no value.

The initial signature is text only: sender name, company or trading identity, reply address, physical postal address, and the required opt-out line. A logo image is excluded from the first release. It increases payload and image-treatment variability without adding a necessary safety control, and its absence avoids pretending that a logo improves deliverability. If the owner later requests a logo, it needs a separate seed-mail review for rendering and inbox behavior, must not be a tracking pixel or remote asset, and cannot change the plain-text equivalent.

Every cold message ends with a readable opt-out line, for example: "To stop future email from [company], reply STOP or use the unsubscribe link." The wording is owner-approved, present in both MIME alternatives, and tested as part of the deterministic preflight.

## One-click unsubscribe and suppression

Every marketing or consent-request message gets:

    List-Unsubscribe: <https://relay-host/email/unsubscribe/opaque-token>
    List-Unsubscribe-Post: List-Unsubscribe=One-Click

It also includes a visible body link to the same endpoint. The raw MIME builder must sign these headers with the sending domain's DKIM configuration. RFC 8058 requires the one-click HTTPS URI and a valid DKIM signature that covers the unsubscribe headers. [S3]

The relay endpoint is a justified narrow public HTTP exception. It does not receive a mailbox credential, does not send mail, and does not expose email content. It accepts an opaque, high-entropy, single-purpose token that refers to one company and one canonical address. It performs this transaction:

1. Validate the token, expiry, and intended company.
2. Write or retain the suppression record.
3. Cancel unsent rows for that address and add the business-level sequence stop when the address maps to a business.
4. Append a minimal audit record.
5. Return success without redirecting the one-click POST.

The token contains no address in clear text. A GET may show a human-readable confirmation page; the RFC one-click POST responds directly. A forged or expired token cannot reveal whether an address exists.

The company-wide do-not-contact service holds both address and normalized-domain records. An address record contains a keyed canonical-address index, protected address value, scope, reason, source event, occurred time, and any documented re-consent reference. A domain record has the same audit shape and prevents discovery and campaign mail to that business domain. Suppression applies to every email campaign and sender identity in that company, not across unrelated Colony communities. Only a documented, later re-consent reviewed by an owner can restore an address; an owner must separately document why a domain-wide record is being undone. Deleting a suppression is never a shortcut to resend.

## Data model and relay split

### Desktop-local

- One EmailCredentialV1 and provider sync cursor per connected mailbox.
- Mailbox baseline and delta-gap state needed to decide whether sending is safe.
- Read-only AI subscription-budget snapshot and owner reserve setting.
- Raw provider identifiers needed for reconnect and duplicate prevention.
- Sanitized temporary message-render cache.
- Provider-specific diagnostic code with secrets and message body redacted.

### Relay-held, company-scoped

| Record | Purpose | Sensitive fields |
| --- | --- | --- |
| EmailSenderIdentity | Named mailbox, domain, visible sender details, per-mailbox cap, pause, readiness state | None beyond business contact data |
| EmailSenderReadiness | Exact READY or NOT READY evidence, repair, age, blocklist, bounce, sync state | Sender business data and diagnostics |
| EmailAddressProvenance | Published address, source URL, observation, status | Address and source capture |
| EmailFitAssessment | Evidence-backed fit score, threshold, and skip reason | Business observations |
| EmailLegalAssessment | Per-recipient legal-basis result and evidence | Recipient address and legal records |
| EmailProposal and EmailRevision | Draft blocks, evidence snapshot, legal basis, review decision | Recipient address, content |
| EmailSequence | At most three campaign steps and business-level stop state | Recipient and business references |
| EmailSendLease and EmailAttempt | Idempotency, quota, outcome, error category | Provider identifiers only, no tokens |
| EmailConversation and EmailMessage | Chats-tab representation of outbound and inbound text | Message content and participant address |
| EmailSuppression | Address or domain do-not-contact record, reason, and undo audit | Protected target and opt-out reason |
| EmailSyncNotice | Lets desktop announce credential, baseline, or sync state without secrets | Account alias and state |

Keep personal data visible only to the same roles that can use the existing Outreach desk. Minimize relay copies of incoming mail to the content needed for the conversation, sanitise before rendering, and make retention a separate owner decision before launch.

### Proposed event kinds

These are proposed symbolic kinds, not registered integers and not an authorization to edit the kind registry:

| Proposed symbolic kind | Direction | Purpose |
| --- | --- | --- |
| KIND_EMAIL_PROPOSAL | Agent or member to relay | Create an immutable draft proposal |
| KIND_EMAIL_DECISION | Owner or admin to relay | Approve, edit through a new revision, reject, cancel |
| KIND_EMAIL_SEND_CLAIM | Connected desktop to relay | Claim one approved row after cap and suppression checks |
| KIND_EMAIL_SEND_OUTCOME | Connected desktop to relay | Record provider accepted, rejected, failed, or outcome unknown |
| KIND_EMAIL_INBOUND | Connected desktop to relay | Store a sanitized, deduplicated inbound email event |
| KIND_EMAIL_SUPPRESSION | Relay or owner to relay | Create or undo an address or domain do-not-contact record with reason |
| KIND_EMAIL_SENDER_READINESS | Connected desktop to relay | Publish non-secret READY or NOT READY evidence and repair |
| KIND_EMAIL_SEQUENCE_STATE | Relay or owner to relay | Create, stop, or cancel a bounded business sequence |
| KIND_EMAIL_LEGAL_ASSESSMENT | Owner or policy service to relay | Persist the per-recipient legal result and supporting references |
| KIND_EMAIL_AUTOPILOT_RULE | Owner to relay | Create, enable, disable, or expire a narrow rule |
| KIND_EMAIL_ACCOUNT_STATE | Connected desktop to relay | Announce connected, requires_reconnect, or disconnected without secrets |

Before implementation, the coordinator assigns an unused numeric block after reviewing the current kind registry and reservations. The wire format starts with v: 1. Existing kinds, WhatsApp query shapes, and existing Chat message enums are not changed. New fields are optional. New email records live in a feature-specific read path rather than being injected as a required variant into an existing response.

### Compatibility plan

1. First ship an old-client fixture test that parses relay output with no email fields and ignores an unknown email event kind.
2. Ship desktop support for the new optional source marker before a relay emits that marker in a shared existing endpoint.
3. Keep the email detail query feature-scoped. An older desktop never calls it.
4. Make sender state additive and tolerate an absent readiness object as "email unavailable," never as "all messaging unavailable."
5. Test the current desktop plus two previous supported desktop schemas against a relay with email data.

## Failure, retry, and audit rules

Every caught failure either propagates to the caller or creates a durable retry or terminal record. Catching, logging, and returning success is prohibited.

| Failure | Durable state | Retry policy |
| --- | --- | --- |
| OAuth refresh rejected | requires_reconnect | No automatic retry |
| Desktop offline before claim | scheduled | Retry when the same desktop reconnects, bounded by campaign expiry |
| Mailbox baseline incomplete or delta gap | not_ready_mailbox_state | No provider call until a full reconcile completes |
| Policy check fails | blocked_policy | No retry until data or owner decision changes |
| Temporary provider rejection before acceptance | retry_pending | 15 minutes, 1 hour, 4 hours, then failed_pre_acceptance |
| Provider 5xx or call outcome unknown | outcome_unknown | Keep the draft and idempotency key; never auto-resend |
| Hard bounce | suppressed | Never retry |
| Bounce kill switch threshold | sender_paused | Refuse all claims until an owner resolves and resumes |
| Address or domain do-not-contact match | suppressed | Never retry unless an audited undo changes it |
| AI budget at or below owner reserve | owner_headroom_reserved | Skip model work until a fresh budget signal exceeds reserve |
| Sync network failure | sync_retry_pending | Exponential backoff from 30 seconds to 1 hour, maximum eight attempts, then Needs you |
| Inbound parse failure | inbound_quarantined | Retain redacted metadata and require human inspection |
| One-click endpoint failure | unsubscribe_endpoint_failed | Alert immediately, pause new campaign sends until health is restored |

Use idempotency keys from EmailProposal revision plus recipient and attempt generation. The desktop must never create a fresh key on retry unless the relay records a new planned attempt. No automatic action may turn `outcome_unknown` into `provider_accepted` or a second provider call.

Audit records include actor, record identifiers, old and new state, policy version, evidence IDs, and redacted error category. They never contain OAuth tokens, app passwords, raw authorization headers, or full provider error bodies.

## Rollout in small PRs

Estimates are implementation effort after legal and owner decisions, not a promise of calendar time. Each PR must be reviewed, signed, and have GitHub CI green for its exact commit. CI is source and test evidence, not mail-provider or customer proof.

| PR | Concrete scope | Estimate | Acceptance gate |
| --- | --- | --- | --- |
| 0 | This design, legal memo, and owner summary | 0.5 developer-day | Document review confirms no provider account, secret, or send action occurred |
| 1 | Data contracts, symbolic kind allocation, address and domain do-not-contact primitive, fit and legal records, compatibility fixtures | 2 developer-days plus 1 QA day | Exact-head CI green; transaction tests prove one address or domain suppression cancels queued rows, stops a business sequence, skips Discovery, and old schemas ignore email output |
| 2 | Gmail connect screen, multiple desktop-local mailbox records, baseline sync state, no sending | 3 developer-days plus 2 QA days | Exact-head CI green; disposable-profile test proves token redaction, per-mailbox pause state, reconnect state, baseline gating, and no relay credential field; owner conducts a separate real OAuth review |
| 3 | Sender readiness, 21-day warm-up hold, automatic capped ramp, kill switch, MIME builder, deterministic preflight, Needs you approval cards, no provider call | 4 developer-days plus 2 QA days | Exact-head CI green; mutation tests show removing every preflight guard fails a production-path test; reviewed desktop screenshots at supported sizes |
| 4 | Gmail local sender, per-mailbox quota claim, visible unsubscribe endpoint, bounded outcome states | 4 developer-days plus 3 QA days | Exact-head CI green; local fake-provider fault tests cover accepted, rejected, 5xx outcome unknown, duplicate, suppression race, kill switch, and no-auto-resend; a separately authorized owner seed-mail test proves only the chosen sender identity |
| 5 | Gmail reply sync, thread mapping, deterministic multilingual opt-out, bounded follow-up sequences, Chats integration | 4 developer-days plus 3 QA days | Exact-head CI green; fixture mailbox proves an opt-out commits before future claims, any business reply stops the sequence, auto-reply is not treated as interest, and unsafe messages route to human review |
| 6 | Microsoft Graph connector and delta sync | 4 developer-days plus 3 QA days | Exact-head CI green; mocked Graph token, delta, and send failures pass; separately authorized owner tenant proof remains distinct |
| 7 | Generic SMTP plus IMAP capability-gated connector | 5 developer-days plus 4 QA days | Exact-head CI green; TLS and OAuth or app-password requirements are enforced; no SMTP probing test exists because the product must not probe recipients |
| 8 | Optional narrow autopilot rules | 3 developer-days plus 3 QA days | Written owner authorization and lawyer review, exact-head CI green, and fault tests show every stop condition cancels future sends |

No PR may merge or enable sending merely because the preceding PR is green. Provider setup, domain authentication, legal review, and a narrowly scoped owner seed-mail test remain separate gates.

## Owner decisions required

1. **Legal release posture:** approve the conservative consent-request and existing-customer paths only, or obtain written South African counsel for any broader B2B role-address policy.
2. **Sending identities:** choose each named mailbox, its desktop owner, separate domain or subdomain, visible sender name, daily cold cap, pause authority, and whether Signal Story or a customer company is the responsible sender.
3. **Readiness sources:** approve the registrar or setup evidence, read-only blocklist-status source, 21-day no-cold-send rule, 2 percent or three-in-24-hours kill switch, and owner-only resume process.
4. **Provider order:** approve Gmail API first, then Graph, with SMTP plus IMAP deferred.
5. **Mailbox access:** approve outbound-only permissions first and separately approve mailbox-read scope for reply handling.
6. **Sender facts and format:** approve the service description, company identity, reply address, physical postal address, plain opt-out line, text-first format, and no-logo launch signature.
7. **Targeting policy:** approve the owner-or-manager first-party rule, 60-point fit minimum, general-inbox fallback, challenged-page stop, and not-contacted register reasons.
8. **Sequence policy:** approve the maximum three-message sequence, four and ten recipient-local business-day cadence, business-wide reply stop, and recipient-local send window.
9. **Do-not-contact policy:** approve address and domain records, reason taxonomy, multilingual phrase-pack review process, and documented undo procedure.
10. **Calendar and AI identity:** approve the Google Calendar link for manually reviewed replies and the exact truthful AI disclosure language.
11. **AI usage:** approve the 25 percent owner headroom reserve and the desktop-local read-only quota adapter.
12. **Autopilot:** keep it off for launch. Any later exception requires a separate signed decision and retains the external-link, instruction-echo, and first-reply-after-re-consent holds.
13. **Retention:** decide how long the company keeps inbound email content, evidence captures, opt-out evidence, and audit records.
14. **National Opt-Out Registry:** confirm registration, cleansing, and interface obligations with South African counsel and the current NCC process before a consumer-directed campaign.
15. **Channel boundary:** confirm that a LinkedIn-style channel remains out of scope for this design and rollout.

## Sources checked 7 November 2026

- [S1: Gmail Email sender guidelines](https://support.google.com/mail/answer/81126)
- [S2: Gmail guidance on gradual volume increases and monitoring](https://support.google.com/mail/answer/81126?hl=en-gb)
- [S3: RFC 8058, Signaling One-Click Functionality for List Email Headers](https://www.rfc-editor.org/rfc/rfc8058.html)
- [S4: RFC 2369, List-Unsubscribe header syntax](https://www.rfc-editor.org/rfc/rfc2369.html)
- [S5: Gmail API sending guide](https://developers.google.com/workspace/gmail/api/guides/sending)
- [S6: Gmail API thread guide](https://developers.google.com/workspace/gmail/api/guides/threads)
- [S7: Google OAuth offline access and refresh tokens](https://developers.google.com/identity/protocols/oauth2/web-server)
- [S8: Google OAuth refresh-token failure cases](https://developers.google.com/identity/protocols/oauth2)
- [S9: Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [S10: Microsoft Graph message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [S11: Microsoft Graph message properties](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)
- [S12: Microsoft offline_access scope](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)
- [S13: Microsoft guidance on Basic authentication deprecation](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online)
- [S14: Qualify, signals and targeting specification supplied with this task, 7 November 2026]
- [S15: Colony WhatsApp outreach contract](../../whatsapp-outreach.md)
- [S16: Google OAuth scopes, including Gmail send and read scopes](https://developers.google.com/identity/protocols/oauth2/scopes)

This is a technical and product design, not legal advice. The companion legal memo identifies the legal questions that require South African counsel.
