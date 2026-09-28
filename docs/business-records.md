# Colony business record contracts

Status: W18a contract and broker implementation. Schema version: `1`.

Business records are signed Nostr events in the community resolved from the
relay host. The `h` tag is the authoritative NIP-29 group scope. A client UUID
is also the UUID of that client's private stream channel. Client-scoped records
use that UUID in both their `clientId` content field and `h` tag. Proposal
acceptance is business-scoped by `h` and names the target client channel in its
`clientId`. The relay checks private visibility, stream channel type,
membership, token channel scope, event kind, content, d-tag coordinate, and
record-specific authorization before persisting a command.

Invoice schema version 1 accepts optional tax fields. An older invoice version
or head that omits them means no tax and remains valid. Tax fields are omitted
from serialization when unset, so existing tax-free invoices keep their
meaning and shape.

The relay signs canonical replaceable heads and conversion receipts. A command
event and all of its head changes are stored in one transaction. The SDK builds
member-signed command events with matching `h` and `d` tags. Unknown JSON fields
are rejected for the typed schemas in `buzz-core` so an older relay fails
closed when a client sends a future schema.

Each community has one trusted internal business channel recorded as
`communities.business_channel_id`. The first Party create may register it only
when signed by a community owner or admin who is also a member of that private
stream. Registration commits with the Party command. Party updates, proposal
versions, and proposal acceptances must use that registered channel. The relay
never infers the internal channel from a client-supplied `h` tag, and the
registered channel cannot be changed through a business command.

## Kind registry

The same integers are registered in `crates/buzz-core/src/kind.rs`, exposed by
`crates/buzz-sdk`, mirrored in `desktop/src/shared/constants/kinds.ts`, and
mirrored in `mobile/lib/shared/relay/nostr_models.dart`.

| Kind | Name | Write status |
| ---: | --- | --- |
| 30630 | Party head | Relay signed, replaceable |
| 30631 | Client head | Relay signed, replaceable |
| 30632 | Service head | Relay signed, replaceable |
| 30633 | Proposal head | Relay signed, replaceable |
| 30634 | Work item head | Relay signed, replaceable |
| 30635 | Knowledge document head | Reserved |
| 30636 | Knowledge fact head | Reserved |
| 30637 | Social account head | Reserved |
| 30638 | Content campaign head | Reserved |
| 30639 | Content post head | Reserved |
| 30640 | Site head | Reserved |
| 30641 | Invoice head | Relay signed, replaceable current invoice |
| 30644 | Prospect head | Relay signed, replaceable |
| 30645 | Money follow-up head | Relay signed, replaceable client follow-up state |
| 47000 | Party action | Brokered |
| 47001 | Client action | Brokered |
| 47002 | Service action | Brokered |
| 47003 | Proposal version | Brokered, immutable |
| 47004 | Proposal acceptance | Brokered, exact version and conversion claim |
| 47005 | Proposal conversion receipt | Relay signed, append only |
| 47006 | Work item action | Brokered |
| 47007 | Deliverable version | Brokered, immutable |
| 47008 | Deliverable approval | Brokered, append only |
| 47009 | Knowledge document version | Reserved |
| 47010 | Knowledge fact version | Reserved |
| 47011 | Knowledge access change | Reserved |
| 47012 | Social account authorization | Reserved |
| 47013 | Content campaign action | Reserved |
| 47014 | Content post version | Reserved |
| 47015 | Content feedback | Reserved |
| 47016 | Content approval | Reserved |
| 47017 | Publishing intent | Reserved |
| 47018 | Publishing receipt | Reserved |
| 47019 | Social inbox action | Reserved |
| 47020 | Sourced report snapshot | Reserved |
| 47021 | Site version | Reserved |
| 47022 | Site build | Reserved |
| 47023 | Site deployment | Reserved |
| 47024 | Site domain | Reserved |
| 47025 | Site enquiry | Reserved |
| 47026 | Invoice version | Brokered, immutable |
| 47027 | Payment evidence | Brokered, append only |
| 47028 | Money adjustment | Brokered, append only |
| 47029 | Reconciliation | Reserved |
| 47030 | Money follow up | Brokered, immutable |
| 47031 to 47033 | Company records | See [company records](company-records.md) |
| 47034 | Prospect action | Brokered |

All business kinds require an `h` tag and `MessagesWrite`. Relay-authored heads
and receipts reject client submission. Reserved member kinds are rejected by
ingest until their schema validator and broker are implemented. These values
are allocated now to keep the registry collision free and let later phases
build on stable contracts.

## Coordinates and client isolation

NIP-33 replacement coordinates omit the channel ID. Client-scoped d-tags
therefore include the client UUID. The relay also requires a private stream
channel and binds the client UUID in the content to the `h` UUID.

| Record | `d` value |
| --- | --- |
| Party head or action | `business:<community-uuid>:party:<party-uuid>` |
| Proposal head | `business:<community-uuid>:proposal:<proposal-uuid>` |
| Service head or action | `business:<community-uuid>:service:<service-uuid>` |
| Prospect head or action | `business:<community-uuid>:prospect:<prospect-uuid>` |
| Proposal version revision `n` | `business:<community-uuid>:proposal:<proposal-uuid>:version:<n>` |
| Conversion acceptance or receipt | `business:<community-uuid>:conversion:<conversion-uuid>` |
| Client head or action | `client:<client-uuid>:client:<client-uuid>` |
| Work item head or action | `client:<client-uuid>:work:<work-item-uuid>` |
| Company work item head or action | `company:work:<work-item-uuid>` |
| Deliverable version revision `n` | `client:<client-uuid>:deliverable:<deliverable-uuid>:version:<n>` |
| Approval of version event `id` | `client:<client-uuid>:deliverable-approval:<id>` |
| Invoice head | `client:<client-uuid>:invoice:<invoice-uuid>` |
| Invoice version `n` | `client:<client-uuid>:invoice:<invoice-uuid>:version:<n>` |
| Payment evidence | `client:<client-uuid>:payment:<payment-uuid>` |
| Money adjustment | `client:<client-uuid>:money-adjustment:<adjustment-uuid>` |
| Follow-up action and head | `client:<client-uuid>:money-follow-up:<follow-up-uuid>` |

Tags contain exactly one two-value `h` tag and one two-value `d` tag on brokered
commands. The proposal acceptance's `h` tag identifies the private business
channel. Its target `clientId` is the private client stream channel UUID. The
acceptance is signed by the named acceptor, who must have membership in the
business channel. If the client channel already exists, the acceptor must also
be a member there. If it does not exist, the conversion transaction creates
the private channel and makes the acceptor its owner.

## Brokered content schemas

All property names are camel case. All typed request objects reject unknown
fields. Every request has `schemaVersion: 1`. UUIDs are lowercase canonical
UUID strings. Event IDs, pubkeys, and SHA-256 digests are exactly 64 lowercase
hex characters. Monetary values are signed 64-bit integers in the smallest
currency unit. Quantities use integer hundredths.
Proposal currency is a three-letter uppercase ISO 4217 code; this broker checks
the shape but does not consult a currency registry.

### Party action, kind 47000

`PartyAction` fields: `partyId`, `action`, `expectedHeadEventId`, and `party`.
The action is `create`, `update`, `archive`, or `restore`. Create omits
`expectedHeadEventId`; every other action names the exact current relay head.
`party` contains the same `partyId`, `partyType` (`person` or `organization`),
`displayName`, and `externalIds`. Members, admins, and owners of the internal
business channel can manage party records. If no business channel is registered,
an owner or admin's first Party create registers the command's channel in the
same transaction. Kind 30630 contains `status` and
`sourceActionEventId`; archive sets status to `archived`, and restore sets it
to `active`. A party must be active to link it to a client or proposal.

### Client action, kind 47001

`ClientAction` fields: `clientId`, `action`, `expectedHeadEventId`, and `head`.
The member-supplied `head` contains `schemaVersion`, `clientId`, `partyId`,
`displayName`, `approverPubkeys`, and `status`. The relay adds
`sourceActionEventId` to the canonical kind 30631 head. The relay requires
owner or admin membership in that client's private stream channel. Archive
sets the status to `archived`; restore sets it to `active`. The client record
coordinate is the client channel UUID.

### Client work item action, kind 47006

`WorkItemAction` fields: `clientId`, `workItemId`, `action`,
`expectedHeadEventId`, and `head`. The member-supplied head contains
`schemaVersion`, `clientId`, `workItemId`, `title`, `status`,
`assignedPubkeys`, `approverPubkeys`, and `deliverables`. The relay adds
`sourceEventId` to the canonical kind 30634 head.
Create requires an owner or admin. Updates require an owner, admin, or assigned
member. A non-admin assigned member cannot change assignees, approvers, title,
or deliverable pointers. Only a deliverable-version command can advance a
deliverable pointer. Archive sets the work status to `archived`; restore sets
it to `open`. The relay emits kind 30634.

### Company work item action, kind 47006

Company work uses the same 30634 head and 47006 action kinds, but has no
`clientId`. Its coordinate is `company:work:<work-item-uuid>` and its single
`h` tag is the channel where the commitment lives. The company is resolved from
the relay host. The company work fields and state transitions are defined in
[company-records.md](company-records.md#company-work-items). A goal link changes
through one exact-head company work `update` action for that item. Multi-select
clients send separate actions and report partial failures per item. This
separate scope preserves the existing client work payload and W11 behavior.

A company work update may move the same item to a root message in another
active channel only when the actor has work-edit authority and both channels
have identical active membership sets. The member action uses the current
source `h`; the relay derives the destination `h` from the root message and
replaces the work head atomically. Client work item actions are unchanged.

### Service action, kind 47002

`ServiceAction` fields: `schemaVersion`, `serviceId`, `action`,
`expectedHeadEventId`, and `service`. `service` contains `serviceId`, `name`,
`description`, `currency`, `monthlyFeeMinor`, `postsPerMonth`, and
`revisionRounds`. Only owners and admins of the internal business channel can
manage services. The relay emits kind 30632.

### Prospect action, kind 47034

`ProspectAction` fields: `schemaVersion`, `prospectId`, `action`,
`expectedHeadEventId`, `prospect`, and optional `activity`. `prospect` contains
`prospectId`, the prospect `party`, `industry`, `vertical`, optional
`fitScore`, `potentialMonthlyValueMinor`, `website`, `contactName`,
`location`, `email`, `phone` and `lastVerifiedAt`, `evidence` (sourced
evidence items), `qualification`, `saved`, `stage` (`qualified`,
`in_conversation`, `proposal`, `won`, or `lost`), and `lostReason` for a lost
prospect. Members, admins and owners of the internal business channel can
manage prospects. The relay emits kind 30644 `ProspectHead` with the prospect, its
status, the activity history and `sourceActionEventId`. Prospect records live
in the internal business channel; see the W10 discovery plan for provider
boundaries (OutScraper, Brave Search and Exa adapters are not active yet).

### Proposal version, kind 47003

`ProposalVersion` fields: `schemaVersion`, `proposalId`, `prospectPartyId`,
`namedAcceptorPubkey`, `revision`, `previousVersionEventId`, `expiresAt`,
`currency`, `lines`, and `terms`. Each line has optional `serviceId`,
`description`, `quantityHundredths`, and `unitAmountMinor`. Revision one has no
previous event. Later revisions increment by one and name the exact prior
version event. The relay stores the member event and advances the relay-signed
kind 30633 `ProposalHead`, which contains the exact current event ID, content
digest, and revision.

### Proposal acceptance, kind 47004

`ProposalAcceptance` fields: `schemaVersion`, `proposalId`,
`proposalVersionEventId`, `proposalVersionDigest`, `conversionId`, `clientId`,
`workItemId`, and `draftInvoiceId`. The digest is SHA-256 of the exact UTF-8
bytes of the proposal version's Nostr content. The version must still be the
current proposal head, must not be expired, and must name the signing pubkey as
the acceptor.

The relay requires the prospect party head. If no channel exists at `clientId`,
the conversion transaction creates a private stream channel and makes the
accepting signer its owner. If a private stream channel already exists there,
the named acceptor must already be a member. In one PostgreSQL transaction it
records the acceptance, the unique conversion claim, the client group and owner
membership when needed, and the relay-signed receipt. It also creates the
relay-signed client, work item, and draft invoice heads. After commit the relay
publishes the NIP-29 group discovery snapshots; an exact acceptance retry
re-emits them if that post-commit step failed. The client name comes from the
prospect party. The new work item title is
`Proposal <proposal UUID>`, starts `open`, has no assignees, and lists the named
acceptor as approver. The invoice copies the proposal's currency and lines,
starts in `draft`, contains no taxes or external payment action, and records
the integer line-total sum in minor units. Quantity multiplication is rounded
down to a whole minor unit per line.

`business_proposal_conversion_claims` is scoped by community. It permits one
conversion ID per accepted version, one work item and invoice ID per community,
and one stored acceptance event per claim. An exact replay of conversion ID,
business channel, proposal, version, digest, signer, client, work item, and
invoice returns the original receipt ID. Reusing any claimed ID with different
values fails closed.
The advisory lock on the current proposal head keeps exact-version validation
current through commit. No payment is initiated. Payfast is selected for
Colony credit purchases and the USD 10 monthly subscription for a
Colony-hosted website. This contract does not authorize collection on a
client-project invoice.

### Deliverable version, kind 47007

`DeliverableVersion` fields: `schemaVersion`, `clientId`, `workItemId`,
`deliverableId`, `version`, `previousVersionEventId`, `contentDigest`,
`mediaDigests`, and `body`. The actor must be assigned to the work item or be an
owner/admin. The digest is SHA-256 of the compact JSON serialization of `body`
with object keys in serde_json's sorted order. The digest list is unique and
sorted lexicographically; `mediaDigest` is SHA-256 of its compact JSON array.
The version digest is SHA-256 of the 64-byte concatenation of the 32 decoded
bytes of `contentDigest` and the 32 decoded bytes of `mediaDigest`. The relay
stores the signed version and advances the work head pointer in one transaction.
Revisions begin at one and each later revision names the exact current version
event.

### Deliverable approval, kind 47008

`DeliverableApproval` fields: `schemaVersion`, `clientId`, `workItemId`,
`deliverableId`, `versionEventId`, `contentDigest`, `mediaDigest`, `decision`,
and optional `note`. `decision` is `approved`, `changes_requested`, or
`rejected`. The signer must be listed in the current work head's
`approverPubkeys`. Approval targets the exact current version ID and both
digests. The relay takes the work-head coordinate lock while persisting the
decision. A later deliverable version changes the pointer and immediately
makes earlier approval events stale for current-state calculations; history
is retained.

## Additional business schemas

Money schemas are active in W18a and their transition and amount rules are
specified below. Reconciliation remains reserved for W18b. Other listed kinds
are reservations for later broker phases and the relay rejects writes to them
until their validation and authorization are implemented. Community-scoped
records live in the private internal business channel and use d-tags beginning
`business:<community-uuid>:`. Client-scoped records live in their private
client channel and use a d-tag beginning `client:<client-uuid>:`.

### Active money schemas

| Record | Required content fields |
| --- | --- |
| Invoice head 30641 | `schemaVersion`, `clientId`, `invoiceId`, `proposalId`, `proposalVersionEventId`, `currency`, `lines`, optional `taxLines`, optional `sellerTaxNumber`, optional `customerTaxNumber`, `totalMinor`, `creditedMinor`, `writtenOffMinor`, `collectedMinor`, `outstandingMinor`, `paymentEvidenceCount`, `version`, `currentVersionEventId`, `status`, `dueAt`, `issuedAt`, `sourceEventId` |
| Invoice version 47026 | `schemaVersion`, `clientId`, `invoiceId`, `version`, `previousVersionEventId`, `proposalVersionEventId`, `expectedHeadEventId`, `action`, `currency`, `lines`, optional `taxLines`, optional `sellerTaxNumber`, optional `customerTaxNumber`, `totalMinor`, `status`, `dueAt`, `voidReason` |
| Payment evidence 47027 | `schemaVersion`, `clientId`, `invoiceId`, `paymentId`, `provider`, `providerReference`, `amountMinor`, `currency`, `occurredAt`, `evidenceRef`, `expectedInvoiceHeadEventId` |
| Money adjustment 47028 | `schemaVersion`, `clientId`, `invoiceId`, `adjustmentId`, `adjustmentType`, `amountMinor`, `currency`, `occurredAt`, `reason`, `evidenceRef`, `expectedInvoiceHeadEventId` |
| Money follow up action 47030 | `schemaVersion`, `clientId`, `invoiceId`, `followUpId`, `action`, `expectedHeadEventId`, `expectedInvoiceHeadEventId`, `dueAt`, `draftContent` |
| Money follow up head 30645 | `schemaVersion`, `clientId`, `invoiceId`, `followUpId`, `status`, `version`, `currentVersionEventId`, `dueAt`, `draftContent`, `approvalIntentOnly`, `approvedByPubkey`, `approvedAt`, `sourceEventId` |

### Reserved schemas for later broker phases

| Record kinds | Required content fields |
| --- | --- |
| Knowledge document head 30635, version 47009 | `schemaVersion`, `clientId`, `documentId`, `version`, `previousVersionEventId`, `title`, `body`, `contentDigest`, `sourceRefs`, `sourceEventId` |
| Knowledge fact head 30636, version 47010 | `schemaVersion`, `clientId`, `factId`, `version`, `previousVersionEventId`, `statement`, `confidence`, `sourceRefs`, `expiresAt`, `sourceEventId` |
| Knowledge access change 47011 | `schemaVersion`, `clientId`, `recordId`, `subjectPubkey`, `access`, `reason`, `sourceEventId` |
| Social account head 30637, authorization 47012 | `schemaVersion`, `clientId`, `accountId`, `provider`, `handle`, `credentialRef`, `scopes`, `status`, `authorizedBy`, `sourceEventId`. Provider is Instagram, Facebook, TikTok, LinkedIn, or X. Colony owns the developer app; the end user authorizes their own account. |
| Content campaign head 30638, action 47013 | `schemaVersion`, `clientId`, `campaignId`, `action`, `expectedHeadEventId`, `name`, `goals`, `channels`, `status`, `sourceEventId` |
| Content post head 30639, version 47014 | `schemaVersion`, `clientId`, `postId`, `version`, `previousVersionEventId`, `campaignId`, `channel`, `text`, `mediaRefs`, `scheduledAt`, `sourceEventId` |
| Content feedback 47015 | `schemaVersion`, `clientId`, `postVersionEventId`, `authorPubkey`, `body`, `mediaRef`, `location`, `sourceEventId` |
| Content approval 47016 | `schemaVersion`, `clientId`, `postVersionEventId`, `contentDigest`, `decision`, `approverPubkey`, `sourceEventId` |
| Publishing intent 47017, receipt 47018 | `schemaVersion`, `clientId`, `postVersionEventId`, `approvalEventId`, `provider`, `idempotencyKey`, `status`, `providerPostId`, `publishedAt`, `errorCode`, `sourceEventId` |
| Social inbox action 47019 | `schemaVersion`, `clientId`, `provider`, `remoteMessageId`, `action`, `assigneePubkey`, `replyDraft`, `sourceEventId` |
| Sourced report snapshot 47020 | `schemaVersion`, `clientId`, `source`, `sourceUrl`, `capturedAt`, `expiresAt`, `contentDigest`, `data`, `sourceEventId`. Discovery sources are OutScraper, Brave Search, and Exa. Colony-owned API keys are paid for with Colony credits. |
| Site head 30640, version 47021 | `schemaVersion`, `clientId`, `siteId`, `version`, `previousVersionEventId`, `contentDigest`, `hostingMode`, `source`, `sourceEventId`. Hosting mode is Colony-hosted on Colony Cloudflare for USD 10 per site per month, or customer self-hosted with the customer paying their provider directly. Colony does not host non-website apps and must not use Colony's Vercel for customer apps. |
| Site build 47022 | `schemaVersion`, `clientId`, `siteId`, `siteVersionEventId`, `artifactDigest`, `previewUrl`, `status`, `sourceEventId` |
| Site deployment 47023 | `schemaVersion`, `clientId`, `siteId`, `siteVersionEventId`, `buildEventId`, `environment`, `provider`, `status`, `deploymentUrl`, `sourceEventId` |
| Site domain 47024 | `schemaVersion`, `clientId`, `siteId`, `domain`, `verification`, `dnsEvidence`, `status`, `sourceEventId`. The customer keeps their registrar; verify with Cloudflare for SaaS custom hostnames and auto SSL. Colony does not buy domains. |
| Site enquiry 47025 | `schemaVersion`, `clientId`, `siteId`, `receivedAt`, `formData`, `consent`, `sourceEventId` |
| Reconciliation 47029 | `schemaVersion`, `clientId`, `externalAccount`, `externalReference`, `recordId`, `matchState`, `amountMinor`, `currency`, `evidenceRef`, `sourceEventId` |

Money event d-tags are `client:<client UUID>:invoice:<invoice UUID>:version:<n>`
for invoice versions, `client:<client UUID>:payment:<payment UUID>` for payment
evidence, `client:<client UUID>:money-adjustment:<adjustment UUID>` for
adjustments, and `client:<client UUID>:money-follow-up:<follow-up UUID>` for
follow-up actions and their relay-signed heads. Every event's single `h` tag is
the same UUID as `clientId`. The invoice head uses
`client:<client UUID>:invoice:<invoice UUID>`.

### Money transitions and totals

Proposal acceptance creates invoice version 1 and its relay-signed draft head
in the same transaction as the client and work records. Invoice versions are
immutable. A draft edit, issue, or void command must name the exact current
invoice head; issue and void append a new version and replace the relay-signed
head. A void requires a non-empty reason and is rejected if any payment
evidence was recorded, even if a later refund reduced the net collected amount
to zero. Draft and void invoices do not count as invoiced revenue.

All amounts are integer minor units. Currency values use uppercase three-letter
ISO 4217 codes. The relay checks line totals with checked integer arithmetic
and rejects non-positive payment or adjustment amounts. Invoice head totals are
updated in the same transaction as the payment or adjustment evidence:

- `totalMinor` is the gross invoice amount from the current invoice version.
  With no configured tax it equals the sum of the net line amounts. The
  optional `taxLines` array contains up to 100 `{label, rateBasisPoints}` rules.
  `label` is optional and, when supplied, contains 1 to 200 UTF-8 bytes.
  `rateBasisPoints` is a 32-bit unsigned integer. `sellerTaxNumber` and
  `customerTaxNumber` are optional invoice snapshots containing non-empty
  strings of at most 128 bytes. Empty or absent `taxLines` applies no tax. The
  relay never supplies a default rule. Businesses may configure zero or more
  rules on a draft; each rule uses an integer basis-point rate, where 100 basis
  points equals one percent.
- Each net line amount is `floor(quantityHundredths * unitAmountMinor / 100)`.
  For each invoice line and each configured tax rule, tax minor units are
  `floor((lineNetMinor * rateBasisPoints + 5000) / 10000)`, which rounds to the
  nearest minor unit with ties rounded up. The relay sums these rounded
  line-level tax amounts, then adds them to the net subtotal for `totalMinor`.
  It does not round only once over the invoice subtotal.
- `creditedMinor` is the sum of credit notes and cannot exceed `totalMinor`.
- `writtenOffMinor` is the sum of write-offs against the remaining balance.
- `collectedMinor` is recorded payments less refunds already paid externally.
- Invoiced revenue is `totalMinor - creditedMinor` for issued invoices only.
- `outstandingMinor` for an issued invoice is `max(totalMinor - creditedMinor - writtenOffMinor - collectedMinor, 0)`. Draft and void invoices have zero outstanding.
- Client credit available for a refund is `max(collectedMinor - (totalMinor - creditedMinor - writtenOffMinor), 0)`.

Payment evidence applies only to an issued invoice, must use the invoice
currency, and cannot exceed its current outstanding balance. `provider` is
`manual` or a named provider; provider credentials are never included, and a
provider reference is required when a named provider is used. `evidenceRef` is
required for every payment and adjustment. `occurredAt` records when the
adjustment took effect and is used for period-based reporting. A credit note
reduces the invoice amount but does not represent a returned payment. A refund
records evidence of a refund that already happened outside Colony and cannot
exceed client credit.
A write-off reduces the outstanding balance without adding collected cash.

Money mutations require a community owner or admin and membership in the
private client channel. Other members can read only through client channels
they are authorized to read. The invoice head is the exact-head lock for
payment and adjustment operations. Follow-up actions use their relay-signed
head and the current invoice head as locks; a follow-up can be drafted only for
an issued overdue invoice with a positive outstanding balance. Its state moves
from `draft` to `in_review` to `approved`. Approval records intent only. It
does not send email, a payment request, or a reminder.

Version, payment, adjustment, and follow-up action events are their own source
events, so they do not include a self-referential `sourceEventId`. Relay-signed
heads carry `sourceEventId` pointing to the member action that produced the
head. Tax terms are stored only on invoice versions and their relay-signed
invoice head. Payment evidence remains evidence of an external payment already
received and never initiates collection.

There is no cost record kind or source-health API in this contract. Cost and
profitability figures require a real source before they can be reported. A UI
may derive revenue from issued invoice records, but it must report costs and
profit as unavailable until cost records and their source status are defined.

Credential values, access tokens, private keys, and payment card data must not
be placed in these events. `credentialRef` is an opaque local/provider secret
reference. Payment and provider receipt records represent evidence; writing
one does not authorize an external send, charge, deployment, or social post.

## Proof boundaries

The broker implementation is covered by focused `buzz-core` and `buzz-relay`
tests for kind registration, h-tag scope, cross-client denial, and exact-version
approval invalidation. Conversion SQL runs inside the command transaction and
the migration declares uniqueness fences. Visual comparison is not applicable
to this backend contract change. GitHub CI, merge, Electron runtime adoption,
and production behavior are separate proof gates.

## NEEDS_DESIGN

The frozen reference has no hosting plan choice or site subscription screen.
Those screens remain blocked on design input. This contract allocates site
record kinds but does not implement a hosting choice or subscription UI.
