# Colony screen pack: index and contract

- Date: 11 October 2026
- Status: draft for owner review (not approved)
- Product design: [`../2026-10-11-colony-os-design.md`](../2026-10-11-colony-os-design.md)
- Readers: Codex (designs every screen), engine builders (data and backend), the owner (review)

## 1. What this pack is

Colony is being rebuilt as a fresh desktop app for non-technical small business owners: an AI company that runs itself. The owner talks to Scout, their Chief of Staff, in a few topic conversations. A starter team of AI employees does the work on the owner's computer. Anything that needs a person arrives as a card to approve.

This pack lists every screen, card, state and flow in the app, each with a fixed ID. For every ID it says what the screen is for, how people get there, what it shows, what people can do, every state it can be in, sample words, and the data behind it.

**This pack decides what. Codex decides how it looks.**

- Fixed here: which screens exist, their content and its order of importance, actions, states, words, rules, data.
- Codex owns: layout, visual style, components, icons, illustration, motion, spacing, colour.
- Codex must not add, drop or merge screens, actions or states. Ideas go into a notes list per ID for the owner to decide.
- After the owner approves Codex's designs, those designs become the build authority. Builders work from the approved design files, not from prose.

## 2. Fixed design inputs

| Input | Value | Source |
|-|-|-|
| Platforms | Mac (Apple Silicon and Intel) and Windows 10 and 11. Desktop only; no phone app at launch. | Owner, 11 Oct |
| Design size | 1440 x 900. Everything must still work in a 1024 x 700 window. | This pack |
| Font | Manrope. Never Satoshi. | Owner, 24 Sep and 3 Oct |
| Name and mark | Colony, with the Colony ant mark. Never "Buzz", "Fizz" or "Honey". | Owner |
| Look | A fresh look designed by Codex for non-technical owners. Keep the Colony name, the ant mark and Manrope. The September theme catalogue is dropped. | Owner, 11 Oct |
| Themes | Light and dark, following the computer's setting, with a manual switch in S-08 Appearance | This pack |
| Accessibility | Every action works by keyboard. Visible focus. One label per action. A screen reader name for every control. Status never shown by colour alone. WCAG AA contrast. | Repo rules 7 and 8 |
| Deliverable | One design per ID, named by ID (for example `T-03-conversation.png`). Each state of an ID is its own frame (`T-03-conversation--offline.png`). A clickable prototype of flows F-01 to F-08. | This pack |

## 3. People

| Who | Can | Cannot |
|-|-|-|
| Owner | Everything | |
| Partner (invited by the owner) | See every conversation, desk and setting. Talk to Scout and employees. Approve any decision except billing. | Buy credits, change auto top-up, manage the website hosting payment or payment cards, remove people, close the company |
| Employee (AI) | Their role's work, inside plans a person approved | Anything public, any money, hiring, or changing goals without a person |

## 4. The team

Default names. The owner can rename every employee except Scout.

| Name | Role | Reports to | Owns | Desk |
|-|-|-|-|-|
| Scout | Chief of Staff | Owner | Running the team; the one voice to the owner | D-01 |
| Maya | Growth Marketer | Scout | More customers and sales each month | D-02 |
| Naledi | Social Media Manager | Maya | Showing up well on social media every week | D-03 |
| Sipho | Sales Director | Scout | New deals: stockists, bulk and corporate orders, partnerships | D-04 |
| Leo | Website Builder | Scout | A live, current website that brings in customers | D-05 |
| Grace | Customer Care and Admin | Scout | A fast, kind answer for every customer; admin never piles up | D-06 |

Each role's first week, schedule, outputs and "never alone" list are in the product design, section 4.

At launch Scout proposes only these six roles, for example re-hiring a role that was skipped at setup or let go. Custom employees come later.

## 5. Product rules every screen follows

1. **Scout is the one voice.** The owner deals with Scout. An employee talks to the owner only when the owner opens that employee's chat (M-07) or names them with @ in a conversation.
2. **Drafts first.** Nothing public leaves Colony without a person's approval. At launch people post and send things themselves: every draft has copy, download, open-the-right-app and "mark as posted" or "mark as sent" actions. One exception: Leo publishes the Colony website after approval.
3. **Only what needs a person interrupts.** Decisions arrive at once as cards in Needs you, with no batching delay. Everything else is visible but quiet.
4. **Short.** Employee messages are usually 1 to 5 sentences, result first. Anything long is a card or a document.
5. **Plain words.** Use the glossary in section 8. No technical terms anywhere.
6. **Always a way out.** No state may hide the only way to recover (repo rule 6). Every problem says what happened and what to do next.
7. **One computer runs the team.** Closing the window keeps the team working from the menu bar (Mac) or tray (Windows). Only Quit stops it. Other computers (partners, a second laptop) show everything but do not run the team.
8. **Money and public actions always need a person. Billing needs the owner.**
9. **Show who did what.** Every decision shows who decided and when ("Approved by Kagiso, 10:42").
10. **AI-made images are labelled** "AI-made" everywhere they appear and are never presented as real product photos.

## 6. Owner decisions on 11 October

These were open when the pack was started and are now decided.

| # | Decision | Owner's answer | Affects |
|-|-|-|-|
| 1 | Starting look for Codex | A fresh look. Keep the Colony name, the ant mark and Manrope. Light and dark only. | All screens, G-08 |
| 2 | Web address for Colony-hosted websites | A separate domain from colony.global, for example leratodesigns.colony.site. The domain name is checked and bought before launch. | D-05, W-03, W-08, W-09 |
| 3 | Paying for signed installers | Not yet. Installers are unsigned at launch: W-02 shows the extra install steps, and a Mac updates by downloading the new version (X-11, G-04l). | W-02, X-11, G-02, G-04, O-01 |

The questions still open for the owner are collected in the product design, section 9.

## 7. Sample company (use it in every design)

- Business: **Lerato Designs**, a women's fashion label in Johannesburg. Sells through Instagram (4,200 followers), a small website and weekend pop-up markets. A spring linen collection is about to launch.
- Owner: **Lerato Mokoena**. Partner: **Kagiso Dlamini** (operations).
- Customers: **Thabo Nkosi** (where is my order?), **Aisha Patel** (wants to return a dress), **Nomsa Khumalo** (asks about sizes).
- Leads: **Juniper and Jade** (boutique, Rosebank), **Kalahari Collective** (concept store, Cape Town), **Brightway Events** (corporate uniforms).
- Conversations: "Spring launch", "More customers", "Website refresh", "November pop-up".
- Website: leratodesigns.colony.site today; leratodesigns.co.za once her domain is connected.
- Credits: balance $18.40. This week $9.10 used: Scout $0.50, Maya $2.10, Naledi $3.40, Sipho $1.20, Leo $1.50, Grace $0.40.
- Time zone: Africa/Johannesburg. Credits are shown in US dollars.

## 8. Words

| Say | Never say |
|-|-|
| company | community, workspace, relay, server |
| conversation | channel, thread, DM, room |
| employee, team, or the person's name | agent, bot, persona, model, AI agent |
| decision, question | ask, approval request, workflow |
| task | work item, ticket, issue |
| schedule, routine | duty, cron, job, workflow |
| weekly budget | allowance, spend limit |
| credits | tokens, API calls, usage units |
| plan (2-week plan) | roadmap, OKR |
| desk | dashboard, home tab, workspace |
| brief, Friday wrap | report, digest |
| draft, ready to post, posted, sent | pending, queued, published (the website alone may say "live") |
| AI-made | generated, synthetic |
| restart | reset, reboot, kill, process |
| this computer | machine, host, device |

Never show: keys or codes from the system, file paths, logs, model names, provider names (except the owner's own "ChatGPT plan" or "Claude plan"), error codes, "Buzz", "Fizz", "Honey", "Nostr", "harness", "terminal", "CLI".

Employee voice in chat: usually 1 to 5 sentences, result first, like a teammate. No headings, tables or bullet walls in chat. One question at a time. Example: "Next week's 5 posts are ready. Want to look now?"

## 9. Entry template

Every ID in files 01 to 08 uses this shape:

```
### T-03 Conversation
- **Who:** owner, partner
- **Purpose:** one sentence
- **Get here:** every entry point (other IDs, notifications, shortcuts)
- **Leads to:** every exit (IDs)
- **Shows:** content blocks in order of importance, with the fields of each
- **Actions:** label (who may) -> result. Keyboard path.
- **States:** every state the screen can be in and what changes
- **Words:** 3 to 6 sample lines in the product voice
- **Data:** reads and writes, with engine status (WORKS, PARTIAL, MISSING) and engine items (E-xx)
- **Not here:** what is deliberately left out
```

## 10. Common states

These apply everywhere unless an entry says otherwise.

| State | Rule |
|-|-|
| Loading | Under 300 ms: show nothing new. Over 300 ms: placeholder shapes. Over 10 s: one plain line ("Still loading. Check your internet if this keeps going.") |
| Offline | Banner (G-04): "You're offline. Your team waits until you're back." Actions that need the internet are disabled and say why. Typed messages wait and send when back. |
| Team paused (credits out, own plan limit, paused by a person) | Banner (G-04) with the reason and the fix. People can still read, type and approve. Employees pick up when the team resumes. |
| Partner view | Billing controls are read-only with "Only Lerato can change billing." |
| Problem | What happened in plain words, what to do, and a retry when that helps. Never an error code. |
| Empty | One line saying what will appear here and, when useful, one action to start. |

## 11. Inventory

### 01 Shell and global ([01-shell-and-global.md](01-shell-and-global.md))

| ID | Name | Purpose |
|-|-|-|
| G-01 | App window | Move between Today, Conversations, Team and Settings; Needs you count; team status; search; new conversation |
| G-02 | Menu bar and tray | Team status, Needs you count, open Colony, message Scout, pause or resume the team, quit |
| G-03 | Computer notifications | Decisions, urgent problems, brief ready, Friday wrap ready, time to post, customer waiting |
| G-04 | Banners | One pattern for offline, Colony unreachable, credits low or out, team paused, plan limit, update ready, team on another computer |
| G-05 | Keyboard | Shortcuts and focus rules |
| G-06 | Toasts and undo | Short confirmations with undo |
| G-07 | Employee identity | Avatar, name, role and status chip (starting, working, free, waiting on you, paused, stopped, away) |
| G-08 | Themes and sizes | Light and dark, text size, smallest window |
| G-04a to G-04p | Banner catalogue | One row per banner, inside G-04 |

### 02 First run ([02-first-run.md](02-first-run.md))

| ID | Name | Purpose |
|-|-|-|
| O-01 | Welcome and sign in | Google or email; terms and privacy |
| O-02 | Email code | 6-digit code, resend, wrong or expired code |
| O-03 | Your business | Short guided chat in Scout's style: name, what you sell, who buys, where, links. Needs no AI and no credits. |
| O-04 | Power your team | Choose Colony credits or your own ChatGPT or Claude plan |
| O-05 | Buy credits | Packs, payment in the browser, waiting, paid, cancelled |
| O-06 | Connect your plan | Claude or ChatGPT: setting up on this computer, sign in in the browser, connected, failed |
| O-07 | Scout gets to know you | Scout's first real turn: reads your links, shows the business profile to confirm |
| O-08 | Meet your team | Scout's proposed starter team: names, first-week lines, weekly budgets, total; untick roles; hire |
| O-09 | Keep your team running | Start with the computer, stay awake while plugged in, allow notifications |
| O-10 | Team starting | Each employee getting ready, then Today with Scout's first message |
| P-01 | Join a company | A partner signs in from an invite link, accepts, lands in Today |
| P-01a | Stay in the loop | A new partner's notification and start-with-computer choices |
| N-01 | Welcome back | Signing in on another computer: the company is found; the team runs elsewhere: keep it there or move it here |
| N-02 | Moving your team | Confirm, progress, done |

### 03 Today and conversations ([03-today-and-conversations.md](03-today-and-conversations.md))

| ID | Name | Purpose |
|-|-|-|
| T-01 | Today | Scout's latest brief, Needs you, while you were away, a line per employee, message Scout |
| T-02 | Conversation list | Today pinned on top, conversations by latest activity, archived ones |
| T-03 | Conversation | Messages and cards with Scout (and employees when named); composer with voice notes and attachments |
| T-04 | New conversation | Starting points and the first message |
| T-05 | Needs you | Every open decision, urgent first, plus a history of decided ones |
| T-06 | Search | Find conversations and messages |
| T-07 | Voice note | Record, review, send; the transcript |
| T-08 | Attachments | Add photos and files, previews, limits |

### 04 Cards ([04-cards.md](04-cards.md))

Every card has an inline form (in conversations, Today and Needs you) and a full viewer.

| ID | Name | From |
|-|-|-|
| C-00 | Card basics | Shared parts, states and "decided by" line |
| C-01 | Decision | Anyone: approve or decline |
| C-02 | Question | Anyone: answer in words or pick an option |
| C-03 | Plan | Each employee's 2-week plan; Scout's company plan |
| C-04 | Social post | Naledi |
| C-05 | Carousel | Naledi |
| C-06 | Video script | Naledi (reels, TikTok) |
| C-07 | Image set | Naledi, Leo (AI-made images to choose from) |
| C-08 | Message draft | Sipho (outreach, follow-ups), Grace (supplier emails), Maya (newsletter) |
| C-09 | Customer reply | Grace |
| C-10 | Website change | Leo |
| C-11 | Lead list | Sipho |
| C-12 | Document | Maya (growth plan), Grace (FAQ and policies), Sipho (line sheet, price list), anyone |
| C-13 | Invoice or quote | Grace, Sipho |
| C-14 | Brand kit | Naledi |
| C-15 | Hire proposal | Scout |
| C-16 | Money request | Scout (weekly budget raise, ad spend, paid tool, hosting) |
| C-17 | Numbers check-in | Maya through Scout, Thursdays |
| C-18 | Problem | Scout (employee stuck or failing) |
| C-19 | Brief and Friday wrap | Scout |
| C-20 | Done note | Anyone; no action needed |

### 05 Team and desks ([05-team-and-desks.md](05-team-and-desks.md))

| ID | Name | Purpose |
|-|-|-|
| M-01 | Team | Everyone, what they are doing, status, this week's credits |
| M-02 | Employee page | Header, then tabs: Desk, Plan, Schedule, Activity, Settings |
| M-03 | Plan tab | The current 2-week plan and its progress |
| M-04 | Schedule tab | Routines and when each runs next |
| M-05 | Activity tab | One line per thing done, newest first |
| M-06 | Employee settings | Rename, photo, weekly budget, pause or resume, restart, let go |
| M-07 | Direct chat | Talk to one employee without Scout |
| M-08 | New hire starting | After a hire proposal is approved |
| D-01 | Scout's desk | Brief history, what Scout handled on its own, company plan |
| D-02 | Maya's desk | Month goal and numbers, campaigns, ideas |
| D-03 | Naledi's desk | Content calendar, ready to post, brand kit, photo library |
| D-04 | Sipho's desk | Deals by stage, lead detail, today's follow-ups, target customers |
| D-05 | Leo's desk | Live preview, pages, changes waiting, history with undo, address and domain, visits, hosting |
| D-06 | Grace's desk | Customer messages, customer thread, knowledge, admin list, forwarding address |
| D-02a | Campaign detail | One campaign: who does what, drafts, results |
| D-03a | Photo library | Real photos and AI-made images, always told apart |
| D-04a | Lead detail | One lead: why they fit, every contact, next step |
| D-05a | Connect your domain | Step-by-step help to point an own domain at the Colony website |
| D-06a | Customer thread | One customer's messages, drafts and what happened |
| D-06b | Knowledge | Policies, FAQ and product facts Grace answers from |
| D-06c | Paste a customer message | Bring a WhatsApp, Instagram or other message in for Grace |

Sub-screens take a letter suffix.

### 06 Settings ([06-settings.md](06-settings.md))

| ID | Name |
|-|-|
| S-01 | Business profile |
| S-02 | Credits and billing |
| S-03 | How your team is powered (credits, Claude plan, ChatGPT plan) |
| S-04 | Connections (forwarding address, website domain, social account names) |
| S-05 | People (partners and invites) |
| S-06 | Notifications |
| S-07 | Running (this computer, start with the computer, stay awake, pause, restart, move the team) |
| S-08 | Account (profile, appearance, sign out, close the company or leave it) |
| S-09 | Help and updates |

### 07 System states and dialogs ([07-system-states.md](07-system-states.md))

| ID | Name |
|-|-|
| X-01 | Offline |
| X-02 | Colony unreachable |
| X-03 | While you were away |
| X-04 | Credits low |
| X-05 | Credits out (team paused) |
| X-06 | Own plan limit reached |
| X-07 | Own plan disconnected |
| X-08 | Employee stuck or failing |
| X-09 | Scout stopped |
| X-10 | Team stopped |
| X-11 | Update ready or required |
| X-12 | Signed out |
| X-13 | Team runs on another computer |
| X-14 | First close of the window |
| X-15 | Quit |
| X-16 | Confirmations |
| X-17 | Empty states |
| X-18 | Loading |
| X-19 | Problem messages |
| X-20 | Permissions (notifications, microphone) |
| X-21 | Can't run here (old system, already open, disk full) |
| X-22 | Team paused by a person |

### 08 Outside the app ([08-outside-the-app.md](08-outside-the-app.md))

| ID | Name |
|-|-|
| W-01 | Landing page |
| W-02 | Download and install |
| W-03 | Pricing |
| W-04 | Terms and privacy |
| W-05 | Payment pages (checkout, back to the app) |
| W-06 | Emails |
| W-07 | Invite page |
| W-08 | The owner's website (Colony-hosted) |
| W-09 | Website paused page |

### 09 Flows ([09-flows.md](09-flows.md))

| ID | Flow |
|-|-|
| F-01 | Owner first run |
| F-02 | Partner joins |
| F-03 | Signing in on a new computer |
| F-04 | Daily loop |
| F-05 | New topic to done |
| F-06 | Social post to posted |
| F-07 | Customer message to sent reply |
| F-08 | Sales outreach |
| F-09 | First website and own domain |
| F-10 | Approving the 2-week plans |
| F-11 | Talking to one employee |
| F-12 | Hiring another employee |
| F-13 | Pause, restart, let go |
| F-14 | Credits low and top-up |
| F-15 | Credits out and resume |
| F-16 | Computer asleep overnight |
| F-17 | Employee stuck |
| F-18 | App update |
| F-19 | Voice note |
| F-20 | Thursday numbers |
| F-21 | Friday wrap |
| F-22 | Closing the company |

### 10 Data and engine ([10-data-and-engine.md](10-data-and-engine.md))

Data for every ID, and the engine work behind it.

## 12. Engine items

Every "Data" line points at these. Status comes from the 11 October code survey (relay and desktop on develop). Details, owners and order are in [10-data-and-engine.md](10-data-and-engine.md).

| ID | Engine item | Status today |
|-|-|-|
| E-01 | New app shell and bridge to the agent engine | PARTIAL: engine reusable, start-up logic lives in old UI |
| E-02 | Email code sign-in without a password | PARTIAL: codes only verify and reset |
| E-03 | Company creation for new accounts, company name on the server | PARTIAL: behind a flag, slug only |
| E-04 | Business profile on the server | MISSING: stored on one computer only |
| E-05 | Topic conversations (private, Scout, owner, partners), titles, archive | WORKS: client work only |
| E-06 | Needs you index (decisions addressed to people) | PARTIAL: client scans every conversation |
| E-07 | Brief and Friday wrap records | MISSING |
| E-08 | Typed card records (drafts, statuses: ready, posted, sent) linked to decisions | PARTIAL: decisions work, typed drafts missing |
| E-09 | Six role packs (instructions, skills, routines, never-alone lists) | MISSING: format exists, no content |
| E-10 | Hire completes and starts the employee at once | MISSING: starts on first mention today |
| E-11 | Background running: close to tray on Mac and Windows, start with the computer, stay awake on both | PARTIAL: Mac only, no start at login |
| E-12 | One computer runs the team: lock and hand-over | MISSING |
| E-13 | Team status (state, current task, waiting on you) without the old UI | PARTIAL |
| E-14 | Missed wake-ups and catch-up after sleep | MISSING |
| E-15 | Company wallet: credits per company, usage per employee, low balance, weekly budgets enforced | PARTIAL: per account, no per-employee usage, not enforced |
| E-16 | Credits gateway live, AI-made images through credits | PARTIAL: off by default, one model |
| E-17 | Own plan without a terminal: Claude and ChatGPT plan sign-in, limit and disconnect signals | PARTIAL: Claude hidden login, ChatGPT not wired |
| E-18 | Voice notes: record, transcribe on this computer (free), transcript | MISSING |
| E-19 | Partners: email invites, accept, partner role, remove, "decided by" | PARTIAL: invites and roles exist |
| E-20 | Website hosting: build, preview, publish, history and undo, visits, contact form, Colony address, own domains, monthly payment, paused page | MISSING |
| E-21 | Inbound email: forwarding address per company to Grace | MISSING |
| E-22 | Customer inbox records for Grace | MISSING |
| E-23 | Leads and deal stages for Sipho | PARTIAL: prospect records exist |
| E-24 | Content calendar records and time-to-post reminders for Naledi | MISSING |
| E-25 | Growth numbers (Thursday check-in, site visits) for Maya | MISSING |
| E-26 | Notifications: events, click targets, quiet hours | PARTIAL: desktop notifications exist, rules live in old UI |
| E-27 | Installers for Mac (Apple Silicon and Intel) and Windows with clear install help and proven updates; signing later (owner: not yet) | PARTIAL: unsigned, Apple Silicon only |
| E-28 | Close company and leave company that work for paying owners | PARTIAL: deletion likely fails after payments |
| E-29 | Plain-language health and repair: restart one employee or the whole team | PARTIAL |
| E-30 | Website pages for Colony itself (landing, pricing, terms, privacy) and product emails | PARTIAL: landing exists for old audience |
| E-31 | Photo library (owner photos and AI-made images, tags) | MISSING: media upload works |
| E-32 | Search across conversations | WORKS: client work only |
| E-33 | Support inbox: help messages, problem reports with consented details, feedback | MISSING |

## 13. Coverage checks

- Every ID appears in at least one flow in 09.
- Every card type appears on at least one desk or in at least one flow.
- Every common state in section 10 is designed for T-01, T-03 and M-02 at least.
- Every action that touches money or anything public is marked with who may do it.
