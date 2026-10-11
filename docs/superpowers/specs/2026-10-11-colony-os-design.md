# Colony: the AI company that runs itself (product design)

- Date: 11 October 2026
- Status: draft for owner review. Every product decision below was made by the owner in chat on 11 October; the screen pack and technical calls await review.
- Screen pack (every screen, card, state, flow and data source): [`2026-10-11-colony-os-screens/00-index.md`](2026-10-11-colony-os-screens/00-index.md)
- Replaces, for the new app: the tech-founder audience, the shared base design's interface parts and the Scout design's interface parts (both 11 October, branch `docs/ai-employees-shared-base`). Their engine work is reused (section 8).

## 1. The product

Colony is an AI company for people who run a small business and are not technical. The owner talks to Scout, their Chief of Staff, in a few conversations, one per topic. Behind Scout, a starter team of AI employees plans and does the work: posts, campaigns, sales messages, the website, customer replies and admin. Anything public, any money and any big call comes to the owner as a card to approve. Nothing goes out without a person's OK, except the website, which Leo makes live after approval.

The interface is as small as the job allows: Today, Conversations, Team (each employee has a desk) and Settings. No terminal, no channels, no technical words.

## 2. Who it is for

- **Owner:** a non-technical small business owner or first-time founder, for example Lerato, who runs a fashion label in Johannesburg from Instagram, a small website and weekend markets. Busy, on her phone a lot, has a laptop, hates reading long text.
- **Partners:** people the owner invites (a co-owner, a manager). They can do everything except billing.
- **Computers:** Mac (Apple Silicon and Intel) and Windows. Desktop only at launch; the phone comes later.
- **Where the team runs:** on one of the owner's computers. When it sleeps, the team pauses and catches up when it wakes.

## 3. Owner decisions (11 October 2026)

| # | Topic | Decision |
|-|-|-|
| 1 | Why minimal | The company runs itself, it ships faster, and it is for non-technical people: "no terminal or slack and stuff. it can be an app but well thought out design wise". |
| 2 | Audience | Non-technical owners. Replaces the morning's choice of tech founders. |
| 3 | Where employees run | Locally, on the owner's computer, as today. |
| 4 | Paying for AI | Colony credits first (Stripe, in the app). The owner's own ChatGPT or Claude plan is optional. No free credits. |
| 5 | Main view | Conversations with Scout, several of them, one per topic. |
| 6 | Team | A starter team hired at setup. Scout adds more later. |
| 7 | Roles | Scout (Chief of Staff), Growth Marketer, Social Media Manager (reports to Growth), Sales Director, Website Builder (replaces the Engineer), Customer Care and Admin. Initiative, drafts first and the short voice carry over. |
| 8 | Devices | Desktop first: Mac and Windows. |
| 9 | Build | Option B: a fresh app from scratch on the same relay. |
| 10 | UI design | Codex designs the screens. This pack plans every screen so nothing is missed. |
| 11 | Where finished work lives | Employee desks: Social's post calendar, Website's live site, Sales' leads, Care's customer messages. Conversations are for talking and approving. |
| 12 | Names | A first name plus the role, changeable. Scout stays Scout. |
| 13 | Voice notes | Yes, at launch. |
| 14 | People | The owner plus partners. |
| 15 | Partners' powers | Like the owner, minus billing. Only the owner buys credits, changes billing, removes people or closes the company. |
| 16 | Roles round 1 | Approved: Scout with a new Friday wrap, Maya, Naledi. |
| 17 | Images | AI-made images are allowed (backgrounds, lifestyle scenes), each shown first, always labelled, never fake product shots. |
| 18 | Numbers | Maya asks one quick question on Thursdays and reads visits from the Colony website. Nothing to connect. |
| 19 | Roles round 2 | Approved: Sipho, Leo, Grace (with admin). |
| 20 | Selling on the website | Buy links, no checkout. |
| 21 | Look | A fresh look, keeping the Colony name, the ant mark and Manrope. The September theme catalogue is dropped. |
| 22 | Website address | A separate domain for owner sites, apart from colony.global. The name is checked and bought before launch. |
| 23 | Signing installers | Not yet. Installers are unsigned at launch, with clear install help; a Mac updates by downloading the new version. |

Not objected, so treated as decided: Today sits on top of the conversation list; customer messages reach Grace by forwarding or pasting; closing the window keeps the team working, and only Quit stops it; one computer runs the team; new hires come through Scout's cards, with no catalogue screen; partners see every conversation and desk; owners with Shopify or Wix get pasted-change drafts, and a Colony site is optional; self-hosting is hidden.

Carried over from earlier decisions: Manrope (24 September); no self-serve credit refunds (24 September); a 20 percent margin on usage, with OpenRouter as the credits upstream on written confirmation from OpenRouter (9 October); website hosting at $10 a month per site (24 September), now through Stripe; customers bring their own domain (24 September).

## 4. The team

Every employee takes initiative, works inside a 2-week plan the owner approved, talks in 1 to 5 sentences, and puts anything long into a card or document. Every one of them also has a "Plan check" every Monday at 09:00.

| Employee | Owns | First week | Schedule (company time zone) | Makes | Never alone | Desk |
|-|-|-|-|-|-|-|
| **Scout**, Chief of Staff | Running the team; the one voice to the owner | Interviews the owner at setup, proposes the team, combines everyone's 2-week plans into one company plan for a single OK | Morning brief, weekdays 08:30. Friday wrap, Fridays 16:00. Wakes on any question, blocker or result. | Briefs, decisions as cards, checked work, hire proposals, problem reports | Money, hiring, anything public, changing goals | D-01: briefs, "what Scout handled on its own", company plan |
| **Maya**, Growth Marketer | More customers and sales each month. Naledi reports to her. | Studies the business, site, socials and 3 to 5 similar brands; writes a 2-week plan with 1 or 2 campaigns; briefs Naledi, Sipho and Leo | Numbers check-in, Thursdays 10:00. Campaign ideas, first Monday of the month. | Growth plan, campaign briefs, offer ideas, newsletter drafts, the numbers line in the brief | Discounts, prices, any spend, brand changes | D-02: goal and numbers, campaigns, ideas |
| **Naledi**, Social Media Manager | Showing up well on social media every week | Studies profiles and the owner's photos; brand kit for OK; drafts the first week of posts | Next week's posts, Mondays 10:00. A reminder at each post's time. Monthly look back. | Posts, carousels, video scripts with shot lists, AI-made images (labelled), bio updates, replies to pasted comments | Anything public, customer photos or names, prices | D-03: content calendar, ready to post, brand kit, photo library |
| **Sipho**, Sales Director | New deals: stockists, bulk and corporate orders, partnerships | Picks 2 or 3 kinds of leads, finds the first 20, drafts messages for the top 5 | Lead hunt, Tuesdays 09:00. Follow-up check, weekdays 08:00. | Lead lists, first messages and follow-ups (email, social messages, WhatsApp text), line sheets, price lists, quotes | Sending anything, prices, discounts, terms, promises | D-04: deals by stage, follow-ups, target customers |
| **Leo**, Website Builder | A live, current website that brings in customers | Builds a first version and shows a preview; it goes live on the Colony address after OK | Site check, Wednesdays 09:00. Campaign pages when Maya asks. Monthly refresh. | Website changes with computer and phone previews, new pages, own-domain help, visit numbers | Making changes live, domain changes, the $10 monthly hosting | D-05: live preview, changes, history with undo, domain, visits, hosting |
| **Grace**, Customer Care and Admin | A fast, kind answer for every customer; admin never piles up | Writes the FAQ and policies for OK, sets up the forwarding address, drafts reply templates | Drafts a reply as soon as a message arrives. Customers-waiting check, daily 08:00. Admin catch-up, Fridays 10:00. | Reply drafts, FAQ and policies, invoices and quotes as PDFs, payment reminders, supplier emails | Refunds, discounts, exceptions to policies, money | D-06: customer messages, knowledge, admin list |

At launch Scout proposes only these six roles, for example re-hiring a role skipped at setup. Custom employees come later.

## 5. How it works

1. **Setup (under 10 minutes with credits).** Sign in with Google or an email code. Answer a short guided chat about the business (no AI needed yet). Buy credits or connect an own plan. Scout's first real turn reads the owner's links and shows the business profile to confirm. Scout proposes the team with names, first-week lines and weekly budgets; one approval hires everyone. Colony is set to keep running. The team starts, and Scout greets the owner in Today.
2. **First hour.** Each employee says hello within 5 minutes and studies the business. Scout brings one company plan with every employee's 2-week plan for one OK.
3. **Every day.** The morning brief arrives at 08:30. Decisions arrive as cards in Needs you, the moment they arise. People approve, ask for changes or decline; drafts get copy, download, open-the-app and "mark as posted" or "mark as sent" actions. Leo's website changes go live on approval.
4. **Talking.** The owner starts a conversation per topic ("Spring launch"); Scout briefs the right employees, and their work comes back as cards in that conversation. Naming an employee with @, or opening their chat from their desk, talks to them directly.
5. **Fridays.** The Friday wrap says what got done, what is next and what it cost.

The product rules every screen follows (Scout is the one voice, drafts first, only what needs a person interrupts, short, plain words, always a way out, one computer runs the team, money needs a person and billing needs the owner, show who decided, AI-made images are labelled) are in the screen pack index, section 5.

## 6. What is in the app

About 110 screens, cards and states, 16 banners and 22 flows, each with an ID, in the screen pack:

| Group | IDs | File |
|-|-|-|
| Shell and global: window, menu bar and tray, notifications, 16 banners, keyboard, toasts, employee identity, themes | G-01 to G-08, G-04a to G-04p | 01 |
| First run: sign-in, business chat, power, Scout's first turn, meet the team, keep running, team starting; partner join; new computer | O-01 to O-10, P-01, P-01a, N-01, N-02 | 02 |
| Today and conversations: Today, list, conversation, new, Needs you, search, voice notes, attachments | T-01 to T-08 | 03 |
| Cards: 20 card types plus shared basics | C-00 to C-20 | 04 |
| Team and desks: team, employee page and tabs, direct chat, new hire, six desks and seven sub-screens | M-01 to M-08, D-01 to D-06, D-02a to D-06c | 05 |
| Settings | S-01 to S-09 | 06 |
| System states and dialogs, with confirmation and empty-state catalogues | X-01 to X-22 | 07 |
| Outside the app: landing, download, pricing, terms and privacy, payment pages, emails, invite page, the owner's website, paused site | W-01 to W-09 | 08 |
| Flows, step by step with failure branches, and a coverage table | F-01 to F-22 | 09 |
| Data for every ID and the engine work behind it | E-01 to E-33 | 10 |

## 7. Technical shape (my technical calls; the owner can override)

- **Fresh app, reused engine.** The interface, navigation, first run and words are new and are built from Codex's approved designs. The relay, company records, credits and Stripe, the agent harness, the `colony` command and the hidden native host that runs employees are reused and extended. Rewriting the engine would add months and discard proven parts. Details: screen pack file 10, section a.
- **The host owns "the team runs".** Starting employees on launch, restarting after a crash, catching up after sleep and reporting status move out of today's screens into the native host. The new interface only shows things and sends commands through a small typed bridge.
- **One computer runs the team**, with a hand-over flow (N-02). Two computers never run the same employee.
- **Voice notes are written down on the computer.** That makes them free, private and available without credits, instead of the small per-minute credit cost first discussed. The proof gate is in E-18.
- **New server features are Nostr events**, following the repo rule: the business profile, briefs, typed drafts, customer messages, the content calendar, numbers and website records. HTTP is used only for Stripe, inbound email, hosting callbacks and media.
- **Existing users.** The new app is a separate install that signs in with the same account. Employees from the old app are not moved automatically (two apps would answer twice); the engine plan includes a one-time "bring your old team over" step or a clear note.

## 8. What happens to earlier work

| Earlier work | In the new plan |
|-|-|
| Shared base Phase 1 backend plan parts (hire completes and starts the employee, role context, missed wake-ups, duties from hires), branch `docs/ai-employees-shared-base` | Reused for E-10, E-14 and E-09; to be reviewed against this design before use |
| Shared base Phase 2 (allowance enforcement) | Becomes part of E-15 (company wallet and weekly budgets) |
| Scout design (authority, rhythm, first real turn, watchdog and ask wakes, admin access) | The behaviour carries over; its old-app screens (Today desk, Home tab) are replaced by this pack |
| Engineer design (sections 1 and 2) | On hold; the role becomes the Website Builder |
| Current desktop app (1.0.x) | Stays for existing users until the new app ships and the move step exists |

## 9. Questions still open for the owner

Each file in the screen pack ends with "Defaults in this file": choices made while writing that stand unless the owner changes them. These four need a real answer, because they are about money, data or the brand:

1. **Default weekly budgets and the first pack.** Recommendation: Scout $2, Maya $3, Naledi $5, Sipho $3, Leo $4, Grace $2 (up to $19 a week), with the $50 pack recommended at setup. Replace these with measured numbers after the real-run gate.
2. **Credit basics.** Recommendation: credits never expire, there are no self-serve refunds (24 September), and partners cost nothing extra.
3. **Keeping data.** Recommendation: a 7-day grace period after a failed hosting payment before the site pauses; a paused site kept for 90 days; a closed company's data deleted after 30 days; no download of everything at launch (the Colony team sends a copy on request).
4. **On owners' public websites.** Recommendation: a small "Made with Colony" credit that owners can switch off once their own domain is connected, and a visible "AI-made image" caption on any AI-made image.

## 10. Not at launch

A phone app; posting to social networks from Colony; reading the owner's inbox; sending email or WhatsApp from Colony; a WhatsApp or Instagram message integration; checkout on owners' websites; lead search services; custom employees; employees running in the cloud; languages other than English; signed installers; downloading all data; the team running on two computers.

## 11. Proof gates

- **Design gate:** Codex delivers a design for every ID and state, plus the clickable flows F-01 to F-08. The owner approves them screen by screen, and the approved designs become the build authority. "Verified" means the built screen compared side by side with the approved design.
- **Engine phase gates:** each phase in file 10, section g ends with a real run on a packaged app, a clean profile and real AI, never only mock tests.
- **Product gates for launch:**
  - first run to Today in under 10 minutes on credits;
  - Scout's first words in under 30 seconds after power is ready;
  - every employee says hello within 5 minutes;
  - the company plan arrives within 60 minutes;
  - the team keeps working with the window closed on Mac and Windows;
  - a sleeping computer catches up once;
  - at least 9 in 10 employee replies are 5 sentences or fewer;
  - no technical word appears in any screen (an automated scan of the built app, as with the earlier brand scan).

## 12. Handing the pack to Codex

After the owner approves this design, give Codex the folder `docs/superpowers/specs/2026-10-11-colony-os-screens/` with this prompt:

> Design every screen of Colony, a desktop app for Mac and Windows used by non-technical small business owners. Read `00-index.md` first, then files `01` to `09`; file `10` explains the data behind each screen. The pack fixes what each screen shows and does; you own how it looks. Do not add, drop or merge screens, actions or states: put any proposal in a notes list per ID.
> Deliver: a static, clickable HTML prototype with one route per ID and a switch for each of its states; PNG exports of every ID and state at 1440 x 900, checked at 1024 x 700; light and dark; flows F-01 to F-08 clickable end to end. Use a fresh look with the Colony name, the ant mark and Manrope, the sample company in `00-index.md` section 7, and the words in section 8. Start with G-01, T-01, T-03, C-00 to C-05, T-05, M-01, M-02, D-03 and O-01 to O-10, then do the rest.

## 13. Next steps

1. The owner reviews this design and the screen pack page, and answers section 9.
2. Codex starts the designs (section 12) while engine phase 0 runs, because phase 0 has no interface.
3. The writing-plans step turns engine phases 0 and 1 into tasks with proof gates.
