# Outreach lists and mentionable things (design)

Date: 2 Nov 2026. Status: design for owner review. Mockups: Colony 3.0 canvas https://claude.ai/artifact/RnYdZoidiBCf13htG27KE8, page "Outreach lists" (local PNGs: /Users/mac/worktrees/.lanes/phase2/real-run-20261004/outreach-lists-design/shots/).

## 1. Intent

Owner, 2 Nov 2026: "remember we are focusing on whatsapp. I'd like to be able to select a number of leads in the campaign or in the lead list and add them to an outreach campaign that I can reference in the chat and agents can access that data. Like I'd like to say @scout research these more and update their records, or say @scout prepare outreach whatsapp messages for these with template 1 (should also be able to mention templates and agents should be able to see that). Make the system smart and flexible and enable things to be mentionable and for agents to have access."

The owner works in chat. Anything he can see in Colony (a group of leads, a Discovery campaign, a WhatsApp template, a lead) should be something he can point at in a message, and the agent he is talking to must be able to open it and act on it. WhatsApp is the only outreach channel in this work.

## 2. Goals, non-goals, anti-goals

Owner addition, 2 Nov 07:52 (screenshot of a campaign's Prospects tab with 30 rows selected): "need to filter because I want to select leads with a phone/WhatsApp number that I have not contacted yet, you get me".

Goals
- Filter leads and prospects by "has phone number", WhatsApp status and stage, see counts, and select every match in one click.
- Select several leads (Leads table or a Discovery campaign's prospects) and put them in a named outreach list in two clicks.
- Mention a list, a campaign, a template or a lead in any message, from one picker.
- Agents resolve every mention through the CLI and act on it: research and update lead records, prepare a WhatsApp batch for a list with a named template.
- Discovery campaigns become shared records (today they live in one Mac's local storage), so agents and other devices see them.

Non-goals
- Email outreach (owner: "we are focusing on WhatsApp").
- Automatic sending. Every WhatsApp batch still waits for the owner (or an admin) to approve it, the daily new-chat cap stays, opt-outs stay honoured.
- A full CRM segment builder (filters saved as dynamic lists). Lists are explicit sets of leads.

Anti-goals (a failure even if it technically works)
- Owner has to type ids, links or commands. He picks things from a picker or a checkbox.
- An agent answers "I can't see that list". Every mention must resolve or the agent must say exactly why (for example "that list was archived").
- Chips that look different from the existing lead chip, or a picker that looks unlike the 3.0 composer.

## 3. What exists today (main, 2 Nov)

- Leads are business records in the private Sales channel: kinds 30630 (head), 30644, 47034 (actions). Discovery saves each prospect with an external id `campaign:<campaignId>` (desktop `discoveryMapping.ts` `externalIdsFor`; agent `colony discovery search --save` the same).
- Discovery campaigns themselves (name, vertical, tags, area, target, progress) live only in the desktop's local storage (`discoveryCampaignStore.ts`, per community and pubkey). Agents and other devices cannot see them.
- Entity links: `buzz://lead/<id>` chips (`LeadReferenceComposerButton.tsx`, `LeadReferenceCard.tsx`) are plain text links that agents read and that every client renders as a lead card. Other schemes: message, channel, pr, repo, issue, project, join, goal, connect, user.
- `colony leads list|get|note|stage|qualify|save`. No command updates a lead's facts (phone, website, email, contact name).
- Phones are stored but never shown: in the owner's business 106 of 108 lead records (kind 30644) carry a phone from Google Maps (`discoveryMapping.ts`), yet the Leads table shows Contact "Not set" and the lead page WhatsApp card shows "NUMBER Not set". This is a defect to fix in this work.
- The campaign Prospects selection bar today offers "Accept as lead" and "Discuss in Sales" only.
- WhatsApp: `colony whatsapp templates` lists approved templates with a Colony title (owner can rename; agents can propose a title). `colony whatsapp batch create --template <title or Meta name> --lead <id>... | --stage <stage> | --params-file` already prepares an owner-approved batch, with `--campaign <name>` only added to the note.

## 4. Concepts (plain words for the owner)

- **Outreach list**: a named group of leads, for example "Melville guesthouses, Nov". Made by ticking leads, or by asking Scout. A lead can be in several lists.
- **Campaign**: a Discovery search you ran ("Restaurants prospects, Johannesburg"). Now shared: everyone in the business and every agent sees it and its leads.
- **Template**: an approved WhatsApp template, shown by its Colony title ("Built a site for you"). Numbered in the picker in the order of Settings > WhatsApp > Templates, so "template 1" also works.
- **Mention**: in any message, type `@` or press Reference. One picker shows people and agents, lists, campaigns, templates and leads. The pick becomes a chip.

## 5. Data model

All new records follow the company-record pattern already used for leads and customers: a member or agent publishes an action event, the relay validates it and writes a relay-signed addressable head. Stored in the Sales channel scope (same visibility as leads).

Kinds (checked against `buzz-core/src/kind.rs` on main 2 Nov: 30680 is taken by `KIND_COFOUNDER_LEAD_HEAD`; the money rails spec proposed 30680 to 30683 and 47070 to 47074, so money rails must renumber; this spec takes the next free block):

| Kind | Name | What |
|---|---|---|
| 30684 | KIND_OUTREACH_LIST_HEAD | Addressable head, `d` = list id. Name, optional note, member lead ids in add order, source (manual, campaign id, agent), default template (optional), archived flag, counts. |
| 47075 | KIND_OUTREACH_LIST_ACTION | create, rename, add_members, remove_members, set_default_template, archive, unarchive. |
| 30685 | KIND_DISCOVERY_CAMPAIGN_HEAD | Addressable head, `d` = campaign id (the same id already in `campaign:<id>`). Name, vertical, picked tags, area, target, status, found, skipped duplicates, end reason, run by. |
| 47076 | KIND_DISCOVERY_CAMPAIGN_ACTION | create, progress, finish, rename, archive. Desktop publishes as the run moves; the local store becomes a cache. |

Rules
- Lists hold lead ids only, never copies of lead data. A deleted or merged lead drops out with a visible "1 lead no longer exists" line.
- Size cap: 500 leads per list (the Discovery campaign maximum).
- Who may change a list: owner, admins, Sales members, and agents with Sales access (agents may create lists and add or remove members when asked; only people archive). Opted-out contacts can be in a list but are skipped in every batch, as today.
- Existing campaigns in a desktop's local storage are published once on first launch after the update (backfill), with their ids unchanged, so existing `campaign:<id>` leads join their campaign.

Links and chips
- New entity links: `buzz://list/<id>`, `buzz://campaign/<id>`, `buzz://template/<meta-name>?lang=<code>`.
- A chip renders exactly like today's lead chip (same height, radius, type ramp), with a type icon and the title: list (stacked people icon), campaign (Discovery compass icon), template (WhatsApp bubble icon), lead (unchanged).
- A message stays plain text plus links, so agents read it with no client.

## 6. Agent access (CLI and skill)

New and changed commands (all return the normal JSON contract):

- `colony lists list [--query <text>] [--archived]`
- `colony lists get <id|link>`: name, note, members with each lead's stage, phone, website, last WhatsApp status, opted out flag.
- `colony lists create --name <text> [--lead <id|link>]... [--from-campaign <id|link>] [--note <text>]`
- `colony lists add|remove <list> --lead <id|link>...`
- `colony campaigns list|get <id|link>`: the campaign record plus its leads.
- `colony whatsapp templates get <title|number|meta-name|link>`: body with slots, buttons, category, language, approval state.
- `colony leads list` gains `--has-phone`, `--whatsapp <not_contacted|in_batch|sent|replied|opted_out|no_number>` and returns each lead's phone, so agents can do what the filters do.
- `colony leads update <lead> [--phone] [--website] [--contact-name] [--email] [--address] [--note]`: agents may update facts on existing leads (create stays with Discovery and people), every change recorded on the lead's history as "Updated by Scout" with the source URL when given.
- `colony whatsapp batch create --list <id|link>` (new), combined with `--template`. Rows come from the list's members; leads without a WhatsApp number or opted out are listed as skipped in the batch card.

Skill (`nest_skill.md`): a short "Mentions" section: every `buzz://list|campaign|template|lead` link in a message is something the person pointed at; resolve it with the matching `get` before answering; "these" or "them" after a list chip means that list's members; never ask the person for ids.

## 7. Screens (boards on the canvas)

1. **Leads table, filter and multi-select** (Business > Sales > Leads): filter pills under the search, each removable and showing its count: "Has phone number 106", "WhatsApp: Not contacted 98", "Stage: New 96", plus "Add filter"; the match count on the right ("96 of 108 match"). Filters combine (AND). A checkbox column, select all on the page, shift-click range, then "Select all 96 matching leads". Columns: Business, Phone (formatted, contact person under it when known, ellipsis, never wraps out of the cell), Stage, WhatsApp status, Next step.
2. **WhatsApp status filter menu**: Not contacted, In a batch waiting for you, Sent, Replied, Opted out, No WhatsApp number, each with its count; multi-select. Counts are for leads with a phone number. "Has WhatsApp" (the number is on WhatsApp) shows only once a send or a check proves it; until then the honest filter is "Has phone number".
3. **Selection bar** (both tables): "N selected", Add to outreach list, WhatsApp batch (opens a template picker, then Scout prepares an owner-approved batch), Ask Scout, More (Change stage, Mark lost; on a campaign also Discuss in Sales), Clear. On a campaign the first action stays "Accept as lead". The bar lives inside the content column, wraps at narrow widths and never covers the sidebar.
4. **Campaign prospects, filter and multi-select**: the same filters, Phone and WhatsApp columns, "Select all 39 matching prospects".
5. **Lead page**: a Contact card shows the business phone ("from Google Maps"), contact person, website and address; the WhatsApp card uses the business phone as the WhatsApp number unless the owner sets another ("Use another number"), shows WhatsApp status and the lists the lead is in, with "Prepare a message" and "Add to outreach list".
6. **Add to outreach list dialog**: "New list" (name prefilled from the campaign or "Selected leads, 2 Nov") or pick an existing list (name, size, last used). One primary button.
7. **Outreach list page** (Sales > Lists tab, and from any list chip): name, size, source, default template; members table (business, stage, WhatsApp status, last contacted); actions "Ask Scout" and "Prepare WhatsApp batch"; "Copy reference" puts the chip on the clipboard.
8. **Mention picker** in the composer: typing `@` or pressing Reference opens one picker grouped as People and agents, Lists, Campaigns, Templates, Leads; arrow keys, Enter, Escape; matches across names. Templates show their number and title.
9. **Chat with chips resolved**: owner: "@Scout research [Melville guesthouses, Nov] more and update their records". Scout: short reply with what changed. Owner: "@Scout prepare WhatsApp messages for [Melville guesthouses, Nov] with [1 · Built a site for you]". Scout: the batch card.
10. **Batch card for a list**: today's approved batch card, with the list chip and the template chip in its header and skipped rows explained.
11. **Phone (390)**: leads filtered and selected (filters wrap, bottom bar with Add to list, Batch and More), list page, mention picker as a bottom sheet. Light and dark.

## 8. Acceptance (builder's gates)

- Select 3 leads, add to a new list, mention it in Scout's DM, ask Scout to update their records: Scout runs `colony lists get` and `colony leads update` and the lead history shows its changes. Proven on mock e2e and on the relay e2e lane.
- Ask Scout for a batch for a list with "template 1": a pending batch appears with all list members that have a number, skips explained, nothing sent before approval.
- Every chip type renders in DM, channel and thread; a stale link shows a calm "no longer available" chip.
- Keyboard: picker fully usable without a pointer (AGENTS.md rule 8); screen reader reads "List, Melville guesthouses, Nov, 12 leads".
- Red proofs for each seam, light and dark, 1440 and 390 screenshots next to the boards.

## 9. Decided by the coordinator (owner can override)

- The Leads table swaps Contact for Phone (the contact person shows under the phone) and moves Service / month to the lead page, so five columns still fit at every width with no overflow.
- Change stage and Mark lost sit behind "More" so the bar fits; on a phone the bar shows Add to list, Batch and More.
- The lead's business phone is its WhatsApp number by default; a send failure "not on WhatsApp" marks it No WhatsApp number.

- Lists are explicit sets, not saved filters.
- Lists live in the Sales scope, so Outreach members see them through Sales access rules.
- Template ids in links use the Meta template name, since Colony titles can change.
- Campaigns become shared records with a one-time backfill from each Mac.

## 10. Questions only the owner can answer

1. Who may see and change outreach lists: everyone with Sales access (default here), or only you, admins and agents?
2. May Scout make a list on its own when it helps (for example "the 20 best fits from this campaign"), or only when you ask?
3. Is it right to number templates in the picker by their order in Settings > WhatsApp > Templates, so "template 1" always means the first one there?
4. Is moving Service / month off the Leads table to the lead page fine, so Phone and WhatsApp status fit?
