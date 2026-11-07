# South African direct-marketing research: email and WhatsApp

Research date: 7 November 2026
Status: research memo, not legal advice
Audience: Signal Story owner, Colony product team, South African legal counsel

## Purpose and boundary

This memo records primary and official-source research for a proposed Colony email outreach channel. It is not legal advice, a legal opinion, or permission to send a campaign. It does not replace a South African lawyer reviewing the sender, recipients, copy, source of addresses, provider contracts, National Opt-Out Registry process, and operating policy.

The cautious interpretation below is research, not product logic. Do not assume that a publicly published address, a generic role inbox, a business recipient, a lack of an opt-out, or a low daily volume permits a cold sales email or WhatsApp message. Legal advice is still recommended before broad cold B2B email or WhatsApp. Colony does not run a per-recipient legal pass, hold, or block.

## Short answer for the owner

1. **Seek legal advice before broad cold sales email to South African prospects.** POPIA section 69 prohibits direct marketing through electronic communication unless there is consent or the customer route applies. It permits one approach to request consent where consent has not previously been withheld. Colony does not turn this research into a per-recipient legal pass, hold, or block. [L1]
2. **Public does not mean freely marketable.** A publicly displayed address can support collection from another source under the Information Regulator's discussion of POPIA section 12, but it does not remove the section 69 direct-marketing requirement. [L2]
3. **Treat B2B conservatively.** POPIA covers identifiable juristic persons where applicable, and section 69 refers to a data subject with "his, her or its" consent. No official exclusion for generic business email was found. A lawyer must decide the exact application to a role inbox and to Signal Story's chosen B2B model. [L1]
4. **Every marketing message needs a real stop route.** POPIA requires sender identity and a way to ask that messages cease. ECTA requires an unsubscribe option and, on request, details of the source of the consumer's personal information; sending after someone says it is unwelcome is an offence under ECTA section 45. [L1] [L3]
5. **The National Opt-Out Registry is changing quickly.** The government announced a phased 2026 to 2027 rollout, including marketer registration and monthly list cleansing. The October 2026 Gazette document available on gov.za labels its detailed guidelines as draft. Confirm current obligations and technical access before sending to consumers. [L4] [L5]
6. **Existing Colony WhatsApp controls help but do not settle legality.** Existing documentation requires owner approval for agent drafts and suppresses recognised stop requests. It is a useful operational baseline, not proof of POPIA consent, CPA registry compliance, or a lawful source for a particular contact. [R1]

## What is settled in the primary and official material

### POPIA applies to direct marketing through email

POPIA defines direct marketing broadly as approaching a data subject in person, by mail, or by electronic communication to promote or offer goods or services. It defines electronic communication broadly enough to cover a stored electronic message, and expressly lists email in section 69. [L1]

Section 69 says that processing personal information for direct marketing through electronic communication is prohibited unless the data subject has consented or is a customer subject to the customer conditions. It also says:

- A responsible party may approach a data subject once to ask for consent if the data subject has not previously withheld consent.
- For an existing customer, the contact details must have been obtained in the sale context, the marketing must be for the responsible party's own similar products or services, and the customer must have a free, simple chance to object when details are collected and in each later marketing message.
- A direct-marketing communication must identify the sender or person on whose behalf it was sent and provide an address or other contact detail for a request that messages cease.

The Information Regulator's direct-marketing guidance repeats this structure. It says the consent request should use Form 4 or a substantially similar form, be specific about what will be marketed and the communication method, and be available free of charge. It also says the responsible party bears the burden of proving consent. [L2]

**Product boundary:** version 1 preserves address provenance, sender identity, source evidence, owner approval, and durable suppression controls. It does not select a permitted legal route, store a legal-assessment result, or block a particular proposal because a per-recipient legal conclusion is unavailable. Counsel can advise on the one-time consent-request route, existing-customer facts, and any other proposed South African direct-marketing route outside the product.

### Research advisory, not a product gate

This memo is counsel-facing research, not a Colony feature that asks whether a specific message may legally be sent to a specific address. Colony does not run a per-recipient legal pass, hold, or block and does not store a legal-assessment result. It also does not let a model make a legal conclusion.

For an otherwise eligible proposal, Colony may show a plain advisory note when the address source or recipient type is high risk. The note says that legal advice is still recommended before broad cold B2B email or WhatsApp. It is not a legal opinion, never states that a send is lawful or unlawful, and cannot block approval, scheduling, or sending. Actual operational controls such as do-not-contact, opt-out, hard-bounce, sender-readiness, mailbox-state, and deterministic content checks remain independent of this advisory.

### POPIA reaches natural and, where applicable, juristic persons

POPIA defines a person as a natural or juristic person. Its definition of personal information covers identifiable living natural persons and, where applicable, identifiable existing juristic persons, including an email address. [L1]

Section 69 uses "data subject" rather than a natural-person-only phrase and speaks of "his, her or its" consent. The official Information Regulator guidance uses the same data-subject framing for electronic direct marketing. [L1] [L2]

**Product consequence:** do not make "B2B" or "role address" an automatic exemption. A named mailbox such as name@business.co.za is plainly high-risk personal information. A generic inbox such as info@business.co.za may raise a harder factual question. The product should retain the same provenance, suppression, source-disclosure, and owner-approval controls, and may show an advisory note for the high-risk recipient type without making a legal determination.

### A public website can support collection, not a free pass to market

The Information Regulator's guidance says personal information may be collected from another source where it is in or derived from a public record, deliberately made public by the data subject, or another listed section 12 basis applies. The same guidance distinguishes a public record, which is under a public body's control, from information deliberately made public. [L2]

A business's own contact page is not automatically a statutory public record. It may be evidence that the business deliberately published a contact address. That is a collection question. It does not displace section 69's consent or customer conditions for unsolicited electronic direct marketing. The Regulator expressly says that an absent CPA pre-emptive block does not mean a marketer can send electronic direct marketing without section 69 compliance. [L2]

**Product consequence:** keep only business-published PUBLIC_EMAIL observations with the source URL, visible address, capture time, and whether the address is role-based or named. Do not source addresses from social networks, directories, brokers, or guessed patterns in version 1. A public source should be available to the recipient on request.

### ECTA section 45 adds unsubscribe and source-disclosure duties

ECTA section 45 requires someone who sends unsolicited commercial communications to consumers to provide:

- An option to cancel a subscription to that sender's mailing list.
- Identifying details of the source from which the sender obtained the consumer's personal information, when the consumer asks.

The section says a person who breaches subsection 1 commits an offence, and separately makes it an offence to send unsolicited commercial communications after the recipient says they are unwelcome. [L3]

**Product consequence:** every campaign message needs a visible unsubscribe route, List-Unsubscribe headers where the provider supports them, a direct reply route, and a durable source field. An opt-out must block future sends across the company, not merely hide one campaign row.

### CPA section 11 protects against unwanted direct marketing

CPA section 11 gives every person privacy rights to refuse, require discontinuance of, or pre-emptively block an approach or communication primarily for direct marketing. A person approached for direct marketing may demand that future communications stop. A person conducting direct marketing must have procedures to receive those demands and must not send to someone who has made one or registered a relevant pre-emptive block. [L6]

CPA section 11 is an additional regime. The precise applicability of the CPA's consumer concept to a particular B2B recipient needs legal review, but the product should not use that uncertainty to weaken its stop and suppression controls.

### National Opt-Out Registry status as checked

The National Consumer Commission's official April 2026 statement says amended Regulation 4 established the Opt-Out Registry system and expected direct marketers to register. [L7] The Government of South Africa's 7 October 2026 release says:

- Direct marketer registration opened from 15 September 2026 through December 2026.
- A free cleansing phase runs from December 2026 to April 2027.
- Consumer pre-emptive blocks are expected from May 2027.
- Direct marketers must register and cleanse lists monthly before direct-marketing campaigns.

The same release is official government material, but the available detailed "Guidelines for Compliance with Opt-Out Registry Regulations" Gazette document is explicitly labelled **DRAFT**. [L4] [L5]

**Product consequence:** do not claim that Colony has registry compliance until the owner and counsel confirm the current rules, access method, scope, fee, cleanse artifact, and effective dates. No registry-based legal pass, hold, or block is designed here. A later consumer-campaign proposal can define its operational requirements after the owner and counsel confirm the then-current rules.

### WhatsApp should be treated as electronic direct marketing

POPIA's electronic-communication definition is broad. The Information Regulator's guidance gives email, SMS, telephone, push notifications, and direct messaging in Instagram or LinkedIn as examples. It does not name WhatsApp in the source reviewed here. Treating a WhatsApp business outreach message as electronic direct marketing is therefore a cautious inference from the statute and guidance, not a quoted WhatsApp-specific ruling. [L1] [L2]

**Product consequence:** use the same conservative source, suppression, identity, and stop-route controls for WhatsApp outreach. Do not treat a WhatsApp template approval as recipient consent, and seek legal advice before broad cold B2B WhatsApp outreach.

## Existing Colony WhatsApp posture, compared

The repository's WhatsApp outreach contract already contains several strong operational controls:

| Existing posture | Why it helps | What it does not prove |
| --- | --- | --- |
| Agent follow-ups are drafts that an owner or admin approves, edits, or rejects | Keeps an agent from autonomously contacting a person | The recipient's POPIA consent or customer status |
| Recognised stop, unsubscribe, no thanks, and not interested messages opt the contact out | Provides a practical internal suppression route | Coverage of every wording, every channel, or registry status |
| Later sends to an opted-out contact are refused | Supports prompt discontinuance | That an earlier message was lawful |
| Daily cap and pacing exist | Reduces volume and operational risk | Deliverability, consent, or legal compliance |
| Durable send states distinguish ambiguous outcomes | Avoids duplicate sends after uncertainty | Actual delivery or reading |

Source: [Colony WhatsApp outreach contract](../../whatsapp-outreach.md), especially its approval, pacing, and opt-out sections. [R1]

The recommended email design reuses those safety patterns and strengthens them where email differs: mailbox credentials stay on desktop, published-email provenance is stored, sending-domain readiness is checked, List-Unsubscribe is included, reply sync is scoped, and a public endpoint can record a one-click opt-out immediately.

## What remains contested or fact-dependent

### Cold B2B email to a generic company inbox

The official text and guidance support a conservative conclusion: POPIA can cover juristic-person information and section 69 is not written as a natural-person-only rule. No official source reviewed here creates a broad "B2B cold-email exception." [L1] [L2]

There may be fact-specific arguments about whether a particular generic inbox identifies a data subject, whether a recipient is a consumer for CPA or ECTA purposes, whether the communication is actually direct marketing, and how the rules apply to a juristic recipient. This memo does not resolve those arguments. The owner should seek legal advice before Signal Story uses broad cold direct-sales outreach to a role inbox without recorded consent.

### The exact form and content of a one-time consent request

The Regulator's guidance says a consent request should use Form 4 or a substantially similar form and identify the goods or services and chosen method. [L2] The product should not guess whether a proposed first email contains too much promotional material. Counsel should approve the exact text, sender identity, source disclosure, and evidence record for the consent request.

### Registry operation during a changing rollout

The newest government release states dates and intended obligations, while the detailed October 2026 guidance document is draft. [L4] [L5] The exact technical interface, final guidance, fees, proof of cleansing, how role addresses are checked, and what a marketer must retain were not confirmed from a final binding technical specification in the sources reviewed.

### Provider and cross-border processing

Google and Microsoft can process email content and account data outside South Africa. POPIA section 72 regulates transfers to foreign recipients. This memo does not assess provider contracts, transfer mechanism, operator terms, or whether Signal Story and Colony occupy responsible-party or operator roles for each deployment. Counsel must review those facts. [L1]

## What could not be confirmed

- A final, non-draft NCC technical guide or API specification for the 2026 National Opt-Out Registry.
- A regulator or court decision specifically resolving cold marketing email to a generic juristic-company role mailbox under section 69.
- A regulator or court decision specifically naming WhatsApp in section 69 enforcement. The conservative treatment here is an inference.
- The full legal effect, implementation status, and operational availability of the registry for every address type on 7 November 2026.
- Whether Signal Story's exact corporate structure, client arrangements, and chosen domains make it the responsible party, an operator, or both for a planned campaign.
- Whether a provider's complaint, bounce, or read signal is complete enough to make a legal or deliverability claim.

## Operational controls retained separately from legal advice

1. Restrict address intake to an evidence-backed PUBLIC_EMAIL observation or an owner-entered address with source.
2. Store source, sender identity, message revision, approval, and suppression history with each proposed send. Do not store a per-recipient legal-assessment result.
3. Use company-wide address and domain do-not-contact records that no agent can override.
4. Bound any consent-request campaign to one message and stop it after a refusal, opt-out, complaint, or other deterministic campaign stop.
5. Require a clear, visible unsubscribe and a mechanism to identify the source on request.
6. Treat a direct reply, List-Unsubscribe action, provider complaint, known hard bounce, registry result, or human stop request as a reason to stop future campaign mail.
7. Keep customer and prospect evidence distinct. Do not label a prospect as a customer to justify a send.
8. Do not ask an AI model for legal advice or a legal conclusion. Any AI drafting call remains no-tools and treats external text as data.

## Questions for the owner to take to a South African lawyer

1. Can Signal Story lawfully send a one-time consent request by email or WhatsApp to a business-published generic role address? What exact facts change the answer for a named address?
2. Does POPIA section 69 apply to a juristic person and a generic role address in the intended campaign, and how should the company document its reasoning?
3. What exact Form 4 or substantially similar wording should a one-time consent request use? May it include a short description of Signal Story's web and social-media services?
4. For existing customers, what evidence proves that contact details were collected in a sale context, the services are similar, and an objection opportunity was offered at collection and in each communication?
5. Does a business's public website contact page make an address "deliberately public" for collection, and what source capture and privacy notice are required before use?
6. Which recipient types are consumers under the CPA and ECTA for Signal Story's planned B2B outreach? Should the product apply the stricter rules regardless?
7. What must Signal Story do now for the National Opt-Out Registry: registration, monthly cleansing, evidence retention, fees, role-address handling, and handling a result that cannot be matched confidently?
8. Who is the POPIA responsible party and who is the operator when Colony is used by Signal Story and later by Signal Story clients? What contracts, privacy notices, and information-officer steps are required?
9. What POPIA section 72 transfer safeguards and provider terms are needed for Gmail, Microsoft 365, or another mail host?
10. Does the existing WhatsApp consent, source, stop, and approval posture meet the lawyer's recommendation, or must it change before more outreach?
11. What retention period is justified for source evidence, opt-out evidence, bounced addresses, message bodies, and audit records?
12. What response and escalation time is required after a recipient asks to stop, requests the source of their data, requests access or deletion, or lodges a complaint?
13. What plain-language advisory should the owner see for a high-risk address source or recipient type without presenting legal advice or blocking a proposal?

## Sources checked 7 November 2026

- [L1: Protection of Personal Information Act 4 of 2013, primary text](https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013popi.pdf). Key material: definitions, sections 5, 12, 18, 69, and 72.
- [L2: Information Regulator, Guidance Note on Direct Marketing in terms of POPIA, dated 3 December 2024](https://inforegulator.org.za/wp-content/uploads/2020/07/GUIDANCE-NOTE-ON-DIRECT-MARKETING-IN-TERMS-OF-THE-PROTECTION-OF-PERSONAL-INFORMATION-ACT-4-OF-2013-POPIA.pdf).
- [L3: Electronic Communications and Transactions Act 25 of 2002, primary text, section 45](https://www.gov.za/sites/default/files/gcis_document/201409/a25-02.pdf).
- [L4: Government of South Africa, National Consumer Commission launches National Opt-Out Registry, 7 October 2026](https://www.gov.za/news/media-statements/national-consumer-commission-launches-national-opt-out-registry-07-oct-2026).
- [L5: Government Gazette, draft Guidelines for Compliance with Opt-Out Registry Regulations, 2 October 2026](https://www.gov.za/sites/default/files/gcis_document/202610/554657981.pdf). This source visibly says DRAFT.
- [L6: Consumer Protection Act 68 of 2008, primary text, section 11](https://www.gov.za/sites/default/files/32186_467.pdf).
- [L7: National Consumer Commission, NCC welcomes regulations to curb spam calls, 17 April 2026](https://thencc.org.za/ncc-welcomes-regulations-to-curb-spam-calls/).
- [R1: Colony WhatsApp outreach contract](../../whatsapp-outreach.md), repository documentation reviewed 7 November 2026.

No Sellbird source, documentation, or text was opened, read, copied, or used for this memo.
