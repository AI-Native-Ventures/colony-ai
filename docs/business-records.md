# Colony business record contracts

Status: W00.05 contract and broker implementation. Schema version: `1`.

Business records are signed Nostr events in the community resolved from the
relay host. The `h` tag is the authoritative NIP-29 group scope. A client UUID
is also the UUID of that client's private stream channel. Client-scoped records
use that UUID in both their `clientId` content field and `h` tag. Proposal
acceptance is business-scoped by `h` and names the target client channel in its
`clientId`. The relay checks private visibility, stream channel type,
membership, token channel scope, event kind, content, d-tag coordinate, and
record-specific authorization before persisting a command.

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
| 30632 | Service head | Reserved |
| 30633 | Proposal head | Relay signed, replaceable |
| 30634 | Work item head | Relay signed, replaceable |
| 30635 | Knowledge document head | Reserved |
| 30636 | Knowledge fact head | Reserved |
| 30637 | Social account head | Reserved |
| 30638 | Content campaign head | Reserved |
| 30639 | Content post head | Reserved |
| 30640 | Site head | Reserved |
| 30641 | Invoice head | Relay signed, replaceable draft invoice |
| 47000 | Party action | Brokered |
| 47001 | Client action | Brokered |
| 47002 | Service action | Reserved |
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
| 47026 | Invoice version | Reserved |
| 47027 | Payment evidence | Reserved |
| 47028 | Money adjustment | Reserved |
| 47029 | Reconciliation | Reserved |
| 47030 | Money follow up | Reserved |

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
| Proposal version revision `n` | `business:<community-uuid>:proposal:<proposal-uuid>:version:<n>` |
| Conversion acceptance or receipt | `business:<community-uuid>:conversion:<conversion-uuid>` |
| Client head or action | `client:<client-uuid>:client:<client-uuid>` |
| Work item head or action | `client:<client-uuid>:work:<work-item-uuid>` |
| Deliverable version revision `n` | `client:<client-uuid>:deliverable:<deliverable-uuid>:version:<n>` |
| Approval of version event `id` | `client:<client-uuid>:deliverable-approval:<id>` |
| Invoice head | `client:<client-uuid>:invoice:<invoice-uuid>` |

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

### Work item action, kind 47006

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

## Reserved schemas for later broker phases

These JSON shapes are contract reservations. Service catalog records are
community-scoped and live in the private internal business channel. Their
d-tags begin `business:<community-uuid>:`. The remaining records are scoped to
the relevant private client channel and use a d-tag beginning
`client:<client-uuid>:`. Their handlers are intentionally not active yet, and
the relay rejects writes to these kinds until their action validation and
authorization are implemented.

| Record kinds | Required content fields |
| --- | --- |
| Service head 30632, service action 47002 | `schemaVersion`, community-scoped `serviceId`, `action`, `expectedHeadEventId`, `name`, `description`, `currency`, `unitAmountMinor`, `status`, `sourceEventId`. The d-tag is `business:<community-uuid>:service:<service-uuid>`. |
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
| Invoice head 30641, version 47026 | `schemaVersion`, `clientId`, `invoiceId`, `version`, `previousVersionEventId`, `proposalVersionEventId`, `currency`, `lines`, `totalMinor`, `status`, `dueAt`, `sourceEventId` |
| Payment 47027 | `schemaVersion`, `clientId`, `invoiceId`, `provider`, `providerReference`, `amountMinor`, `currency`, `occurredAt`, `evidenceRef`, `sourceEventId` |
| Money adjustment 47028 | `schemaVersion`, `clientId`, `invoiceId`, `adjustmentId`, `type`, `amountMinor`, `currency`, `reason`, `evidenceRef`, `sourceEventId` |
| Reconciliation 47029 | `schemaVersion`, `clientId`, `externalAccount`, `externalReference`, `recordId`, `matchState`, `amountMinor`, `currency`, `evidenceRef`, `sourceEventId` |
| Money follow up 47030 | `schemaVersion`, `clientId`, `invoiceId`, `followUpId`, `action`, `dueAt`, `draftContent`, `sourceEventId` |

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
