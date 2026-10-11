# 10 Data and engine

- Date: 11 October 2026
- Status: draft for owner review (not approved)
- Index and IDs: [00-index.md](00-index.md)
- Code facts: checked against `origin/develop` at commit `64534835d` on 11 October 2026. Paths are relative to the repository root and line numbers refer to that commit. Facts marked "(survey)" come from the two 11 October code surveys (relay surface, desktop host) and were not re-opened for this file.

This file says, for every screen in the pack, what data it reads and writes, whether the engine supports it today, and which engine item (E-01 to E-32) has to be built. It ends with the relay limits the new app must respect, the main risks, and a suggested build order.

Status words:

- **WORKS**: the relay or engine already does this; only app work is needed.
- **PARTIAL**: some of it exists; the gap is named.
- **MISSING**: nothing usable exists yet.

## a. Architecture (recommended, technical call)

This section is my technical recommendation under the working agreement (routine technical decisions are mine; the owner can override any of it). It does not change any product decision.

### What the owner decided

On 11 October the owner chose to build "a fresh app from scratch on the same relay" over two other options: a minimal new interface on the current desktop engine, or simplifying the current app screen by screen.

### What "fresh app" means

- A new interface codebase: new screens, new navigation, new first run, new words. No screen of the current desktop app is carried over.
- A new, small bridge between the interface and the engine, designed for these screens rather than for the old ones.
- Start-up behaviour that lives in today's interface moves into the engine, so the interface only shows things and sends commands.

### What it does not mean

The engine is reused. Rewriting it would add months and throw away proven, tested parts:

| Engine part | Where it lives today | Plan |
|-|-|-|
| Relay (accounts, companies, conversations, records, media, search) | `crates/buzz-relay`, `crates/buzz-core`, `crates/buzz-db` | Reuse. Add new record kinds and a few endpoints (items below). |
| Company records (goals, tasks, decisions, routines, hires, positions, budgets) | `crates/buzz-core/src/company_records.rs`, `crates/buzz-relay/src/handlers/company_*.rs` | Reuse as the backbone of Today, Needs you, plans and desks. |
| Credits, packs, Stripe checkout, credits gateway | `crates/buzz-relay/src/api/payments.rs:41-58`, `crates/buzz-relay/src/api/credits_gateway.rs:38-75` | Reuse. Extend for a company wallet, per-employee usage and images. |
| Agent harness that runs each employee | `crates/buzz-acp` | Reuse unchanged in shape. Add role context and missed wake-ups (drafted base plan). |
| The `colony` command employees use to read and write records | `crates/buzz-cli` | Reuse. Add commands for the new records (drafts, posts, customers, numbers, site). |
| The hidden native host that creates, starts, stops and restarts employees and keeps their keys | `desktop/src-tauri` running as `colony-native-host` behind Electron (`desktop/electron/README.md:3-7`) | Reuse as the employee runner. Move start-up and auto-start logic into it. |
| Electron main process pieces (updater, notifications, deep links, single instance) | `desktop/electron/*.mjs` | Copy or extract into the new app. |

### Recommended shape

```
 New Colony app (Electron window, new interface built from Codex's approved designs)
   |  typed bridge (new): team, employees, settings, power, notifications
   v
 Native host (reused colony-native-host)              Relay (reused, extended)
   - runs every employee of the company this            - accounts, companies, members, invites
     computer runs (lock: E-12)                          - conversations (private topic channels)
   - start on launch, restart on crash, catch-up        - decisions, tasks, routines, hires, budgets
   - keys in the computer's keychain                    - new: profile, brief, drafts, customers,
   - provider setup (credits, Claude plan,                content calendar, numbers, site records
     ChatGPT plan), voice transcription                  - payments, credits gateway, media, search
   |                                                        ^
   v                                                        |
 Employees (buzz-acp + colony command) -------------------->+  read and write records, post messages

 Website hosting service (new, Cloudflare), driven by site records on the relay: builds, previews,
 deploys, domains, visits, contact form back to the relay.
```

How the app talks to the engine:

1. **To the relay, directly.** The app signs in with the accounts API, keeps the owner key in the computer's keychain through the host, and talks to the relay over WebSocket (conversations, live updates) and HTTP (accounts, payments, search, media). This is how today's app works, so no new transport is needed.
2. **To the host, through a new typed bridge.** Today the window reaches the host through a shim that pretends to be Tauri (`desktop/electron/README.md:3-7`). The new app should get a small, explicit bridge (team status, start, stop, restart, pause, move team, power setup, voice transcription, notification rules) instead of inheriting every old command.
3. **Start-up logic moves into the host.** Today agent restore waits for the interface to call `apply_workspace` (`desktop/src-tauri/src/commands/workspace.rs:167`, called from `desktop/src/shared/api/tauriWorkspace.ts:12`), and the hire flow that creates an employee lives in a React screen with auto-start off (`desktop/src/features/company-hiring/ui/HireReviewScreen.tsx:434`, `:489`). In the new app the host owns "the team runs": start every employee on launch, restart on crash, catch up after sleep, and report status.
4. **New server features follow the repo rule "prefer Nostr events over new HTTP endpoints".** New record kinds carry the brief, drafts, customers, content calendar, numbers and site state. HTTP is used only where it must be: Stripe and inbound email webhooks, hosting callbacks, media.

### Existing users

Today's desktop keeps its company list in browser storage (`desktop/src/features/communities/communityStorage.ts:36`) and its data in a namespaced app-data folder (survey). Recommendation: the new app is a separate install that signs in with the same account and finds companies on the server. Employees created by the old app are not moved automatically, because two apps running the same employee would answer twice. The engine plan must include a one-time "bring your old team over" step or a clear note for the few existing users.

## b. Data model mapping

How each product idea maps to relay records.

| Product idea | Relay record or API | Status | Evidence and gap |
|-|-|-|-|
| Account, sign in | Accounts API: signup, verify, signin, google, reset, claim, me (`crates/buzz-relay/src/api/accounts.rs:80-90`) | PARTIAL | Email sign-in needs a password (`accounts.rs:124-128`, `:139-146`); codes only verify an address or reset a password. The session response is the owner's secret key (`accounts.rs:371-388`); there is no server sign-out. E-02 |
| Company | Community (one host per company) | PARTIAL | Self-serve creation is off unless `BUZZ_SELF_PROVISION_DOMAIN` is set and, by default, only existing members may create (`crates/buzz-relay/src/api/self_provisioning.rs:35-40`, `:251-270`). Only the slug is stored; the relay's public name is fixed as "Buzz Relay" (`crates/buzz-relay/src/nip11.rs:203`). E-03 |
| Owner and partner | Relay member roles owner, admin, member (kinds 9030 to 9032, `crates/buzz-relay/src/handlers/relay_admin.rs:10-12`) | PARTIAL | A partner maps to admin. "Everything except billing" is mostly natural because credits belong to the owner's account, but hire approval is owner only today (`crates/buzz-relay/src/handlers/company_hires.rs:68-76`). E-19 |
| Invite | Invites API: mint and claim (`crates/buzz-relay/src/api/invites.rs:284`, `:361`) | PARTIAL | Codes work; nothing emails them and there is no invite page. E-19 |
| Business profile | None on the server | MISSING | Saved in one computer's browser storage (`desktop/src/features/onboarding/ui/BusinessSetupStep.tsx:26`, `:58-62`); passed to employees as `COLONY_BUSINESS_PROFILE` (`crates/buzz-acp/src/config.rs:298`); the records doc marks it NEEDS_API (`docs/company-records.md:377`). E-04 |
| Conversation (topic) | Private NIP-29 channel (kind 9007 with private visibility, `crates/buzz-sdk/src/builders.rs:646`, `:703`) with owner, partners and Scout as members (`builders.rs:594`) | WORKS | Topics cannot be direct messages, because a direct message is unique per set of people (`crates/buzz-db/src/store/dm.rs:370-389`). E-05 |
| Direct chat with one employee (M-07) | Direct message between a person and the employee | PARTIAL | Works for the owner. Employees accept direct messages only from their owner or sibling agents (`crates/buzz-acp/src/lib.rs:390-397`), so a partner's message is dropped. E-19 |
| Messages, edits, deletes, reactions, archive | Kinds 9, 40003, 9005 or 5, 7, 9002 (archive at `builders.rs:738-750`) | WORKS | Nothing to add. |
| Unread state | Kind 30078, encrypted to the reader (`crates/buzz-core/src/kind.rs:75`) | PARTIAL | No server unread counts; the app computes them. |
| Search | NIP-50 search (`crates/buzz-relay/src/handlers/req.rs:286-296`) | WORKS | Company record kinds are left out of search (survey). E-32 |
| Attachments and photos | Blossom media upload | WORKS | Limits in section e. No library index. E-31 |
| Employee | Managed agent on the team computer, plus hire head 30650, member position 30648 and a profile (kind 0) | PARTIAL | Records work. The employee is created with auto-start off and starts on its first mention (`HireReviewScreen.tsx:489`; survey). E-10 |
| Decision, question | Ask head 30643 and actions 47032, 47033: approval, tool consent, question, choice, checklist, verdict; categories general, money, hire, tool, secret, duty (survey; `crates/buzz-core/src/company_records.rs:513`) | WORKS | The ask head carries no tag naming who should decide (`crates/buzz-relay/src/handlers/company_asks.rs:1238-1252`), so finding "my" decisions means scanning every conversation. E-06 |
| Task | Company work item 30634 and action 47006, handled as a business command (`crates/buzz-core/src/kind.rs:957-975`) | WORKS | Team pages cannot yet list work by assignee (`docs/company-records.md:496-500`). E-13 |
| Goal | Goal head 30642 and action 47031 (survey) | WORKS | Used for each employee's "owns" line and Maya's month goal. |
| Routine | Duty head 30655 and action 47044, which creates a scheduled workflow (`crates/buzz-relay/src/handlers/company_duties.rs:413-420`) | WORKS | The employee must answer within 15 minutes (`crates/buzz-workflow/src/schema.rs:13`), so a sleeping computer misses routines. A duty must come from a decision today; the drafted base plan adds "comes from a hire". E-10, E-14 |
| Weekly budget | Allowance head 30653 and action 47042 | PARTIAL | Stored, not enforced; the records doc says the UI must not call it a cap yet (`docs/company-records.md:619-622`). E-15 |
| Credits spent per employee | AI sessions record the employee and company (`schema/schema.sql:2259-2266`) | PARTIAL | No endpoint reads usage per employee. E-15 |
| Brief and Friday wrap | None | MISSING | Today's Scout first message is an app template (Scout spec). E-07 |
| Cards (typed drafts: post, carousel, script, image set, message, reply, document, brand kit, plan) | None for the company itself | MISSING | Reserved, client-scoped schemas exist for content posts, approvals, knowledge documents, a social inbox and sites (`docs/business-records.md:319-338`), but ingest rejects every reserved business kind ("no write handler yet", `crates/buzz-relay/src/handlers/ingest.rs:2328-2331`). E-08 |
| Leads | Prospect head 30644 and action 47034 (`docs/business-records.md:209-222`) | PARTIAL | Records work inside the company's internal business channel. Paid lead search adapters are not active (`docs/business-records.md:222`). E-23 |
| Invoices and quotes | Client invoice records 30641 and 47026, money follow-ups 30645 and 47030 (`docs/business-records.md:308-317`) | PARTIAL | Built for client projects created from accepted proposals. Whether Grace's quick invoices fit them is unsure. E-08 |
| Customer messages | None | MISSING | The reserved social inbox schema (`docs/business-records.md:332`) assumes a connected platform. Inbound email does not exist; the relay only has a generic workflow webhook (`crates/buzz-relay/src/router.rs:157`). E-21, E-22 |
| Content calendar | Reserved content post schema with planned time and media (`docs/business-records.md:329`) | MISSING | Client-scoped and rejected by ingest today. E-24 |
| Growth numbers | None | MISSING | E-25 |
| Website | Reserved site, build, deployment, domain and enquiry schemas (`docs/business-records.md:334-338`) | MISSING | Rejected by ingest; no hosting. Monthly site subscriptions exist, PayFast in rand only (`crates/buzz-relay/src/api/payments.rs:47-55`, `:875-902`). E-20 |
| Credits wallet | Per-account ledger: balance, usage, history, packs, checkout (`payments.rs:41-45`) | PARTIAL | Belongs to an account, not a company. Checkout needs a verified email (`payments.rs:181`). E-15 |
| AI paid by credits | Credits gateway sessions and managed inference (`credits_gateway.rs:38-41`, `:64-68`) | PARTIAL | Off unless `COLONY_CREDITS_GATEWAY=1` and an upstream key exist; one model (`credits_gateway.rs:75`). E-16 |
| Needs you | Assembled by today's app from decisions per conversation every 30 seconds (`desktop/src/features/home/needsMeHooks.ts:24`, `:41-72`) | PARTIAL | No server object. E-06 |
| Phone push | Push gateway | PARTIAL | Apple push only (`crates/buzz-push-gateway/src/lib.rs:1`). Not needed at launch (desktop only). E-26 |

## c. Data for every ID

Short form: what each screen reads and writes, status, and engine items.

### 01 Shell and global

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| G-01 App window | Company, my conversations, Needs you count, team status, wallet balance | Nothing directly | PARTIAL | E-01, E-05, E-06, E-13 |
| G-02 Menu bar and tray | Team status, Needs you count | Pause or resume team, quit (host) | PARTIAL: tray is Mac only | E-11, E-13, E-29 |
| G-03 Computer notifications | Decisions for me, brief records, time-to-post reminders, customers waiting | Local "seen" state | PARTIAL | E-26, E-06, E-07, E-24, E-22 |
| G-04 Banners | Connection, relay health, wallet signals, team state, plan limit, updater, team lock | Nothing | PARTIAL | E-15, E-17, E-12, E-27, E-29 |
| G-05 Keyboard | App only | App only | WORKS | E-01 |
| G-06 Toasts and undo | The undone record | Reverse action on that record | PARTIAL: depends on the record | E-01, E-08 |
| G-07 Employee identity | Employee profile (kind 0), position, status | Name and photo (via M-06) | PARTIAL | E-13 |
| G-08 Themes and sizes | Local settings | Local settings | WORKS | E-01 |

### 02 First run

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| O-01 Welcome and sign in | Google identity | Google sign-in; start of email sign-in | PARTIAL: email path needs a password today | E-02, E-30 |
| O-02 Email code | Code status | Request code, sign in with code | MISSING: no sign-in by code | E-02 |
| O-03 Your business | Nothing | Company, company name, business profile | MISSING | E-03, E-04 |
| O-04 Power your team | Gateway capabilities, plans found on this computer | Chosen power source (host) | PARTIAL | E-16, E-17 |
| O-05 Buy credits | Packs, payment status (`payments.rs:41-46`) | Checkout | WORKS (verified email needed) | E-15 |
| O-06 Connect your plan | Provider status (host) | Install and sign-in (host) | PARTIAL: Claude sign-in hidden; ChatGPT not wired | E-17 |
| O-07 Scout gets to know you | Business profile, links (Scout reads the web) | Profile confirmation | MISSING: Scout's first message is a template today | E-04, E-09, E-10 |
| O-08 Meet your team | Role packs, wallet balance | Five hires completed in one owner action, budgets | PARTIAL: hire records work; packs and immediate start missing | E-09, E-10, E-15 |
| O-09 Keep your team running | OS permission state | Start with computer, stay awake, notification permission | MISSING on Windows and for start-at-login | E-11, E-26 |
| O-10 Team starting | Each employee's start-up state (`desktop/src-tauri/src/managed_agents/runtime_types.rs:36-43`) | Nothing | PARTIAL | E-10, E-13, E-29 |
| P-01 Join a company | Invite, company | Claim invite, partner role | PARTIAL: codes work; email and partner role do not | E-19 |
| N-01 Welcome back | My companies (`/api/communities/mine`), team lock | Nothing | MISSING: no lock | E-12, E-03 |
| N-02 Moving your team | Team lock, employees | Hand-over: stop there, start here | MISSING | E-12 |

### 03 Today and conversations

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| T-01 Today | Latest brief, Needs you, catch-up summary, team status | Decisions, new conversation | PARTIAL | E-06, E-07, E-13, E-14, E-05 |
| T-02 Conversation list | My private conversations, last message, unread, open decisions per conversation | Archive, rename | WORKS (unread computed in app) | E-05 |
| T-03 Conversation | Messages, cards, "who is working on this" line | Messages, attachments, voice notes, @ names | WORKS for messages; cards PARTIAL | E-05, E-08, E-13, E-18 |
| T-04 New conversation | Starting points (app) | Private conversation with Scout and partners, first message | WORKS | E-05 |
| T-05 Needs you | Open decisions for me, decided history with who decided | Decisions | PARTIAL | E-06, E-19 |
| T-06 Search | Search results | Nothing | WORKS (records not searchable) | E-32 |
| T-07 Voice note | Microphone | Audio upload, transcript | MISSING | E-18 |
| T-08 Attachments | Upload limits | Media upload | WORKS | E-31 |

### 04 Cards

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| C-00 Card basics | Decision plus its linked draft | Decision outcome, status changes | PARTIAL | E-06, E-08 |
| C-01 Decision | Approval decision | Approve, decline | WORKS | E-06 |
| C-02 Question | Question or choice decision | Answer | WORKS | E-06 |
| C-03 Plan | Plan document, goal, tasks | Approve, change | PARTIAL | E-08, E-09 |
| C-04 Social post | Post draft, media | Approve, change, skip, mark as posted | MISSING | E-08, E-24, E-16 |
| C-05 Carousel | Post draft with slides | Same as C-04 | MISSING | E-08, E-24 |
| C-06 Video script | Script draft | Approve, change, mark as posted | MISSING | E-08 |
| C-07 Image set | AI-made images | Pick, approve, ask for more | MISSING | E-16, E-31, E-08 |
| C-08 Message draft | Message draft | Approve, change, mark as sent | MISSING | E-08 |
| C-09 Customer reply | Customer thread, reply draft | Approve, change, mark as sent | MISSING | E-08, E-22 |
| C-10 Website change | Site version, preview build | Publish, change, decline | MISSING | E-20, E-08 |
| C-11 Lead list | Prospects | Approve chosen leads | PARTIAL | E-23, E-08 |
| C-12 Document | Document draft or attached file | Approve, change | PARTIAL: files attach today | E-08 |
| C-13 Invoice or quote | Invoice or quote draft | Approve, mark as sent, mark as paid | PARTIAL: client invoices exist, fit unsure | E-08 |
| C-14 Brand kit | Brand draft, logo, photos | Approve, change | MISSING | E-08, E-31, E-04 |
| C-15 Hire proposal | Hire head and decision | Hire, not now | WORKS (final approval owner only) | E-09, E-10, E-19 |
| C-16 Money request | Money decision | Approve, decline | WORKS; partner billing rule missing | E-06, E-19, E-15 |
| C-17 Numbers check-in | Question decision | Numbers record | MISSING | E-25 |
| C-18 Problem | Employee health, task watchdog | Restart, pause | PARTIAL: watchdog check-ins are dropped by employees | E-29, E-14 |
| C-19 Brief and Friday wrap | Brief record | Nothing | MISSING | E-07 |
| C-20 Done note | Status change on a record | Nothing | PARTIAL | E-08 |

### 05 Team and desks

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| M-01 Team | Team status, positions, weekly credits per employee | Nothing | PARTIAL | E-13, E-15 |
| M-02 Employee page | Profile, status, desk data | Nothing | PARTIAL | E-13 |
| M-03 Plan tab | Current plan, goal, tasks and progress | Nothing | PARTIAL | E-08, E-09 |
| M-04 Schedule tab | Routines and their next run | Nothing | WORKS | E-09 |
| M-05 Activity tab | One line per thing done | Nothing | PARTIAL: no per-employee activity read | E-13 |
| M-06 Employee settings | Profile, budget, state | Rename, photo, budget, pause, resume, restart, let go | PARTIAL: pause not enforced | E-15, E-29 |
| M-07 Direct chat | Direct messages | Messages | PARTIAL: partners blocked | E-05, E-19 |
| M-08 New hire starting | Hire and start-up state | Nothing | MISSING: no immediate start | E-10 |
| D-01 Scout's desk | Brief history, what Scout decided alone, company plan | Nothing | MISSING | E-07, E-08, E-09 |
| D-02 Maya's desk | Goal, campaigns, numbers, ideas | Approve or park ideas | PARTIAL: goals work | E-25, E-08, E-24 |
| D-03 Naledi's desk | Content calendar, ready to post, brand kit, photo library | Mark as posted, upload photos | MISSING | E-24, E-31, E-08 |
| D-04 Sipho's desk | Prospects with stage, follow-ups | Move stage, mark as sent | PARTIAL | E-23 |
| D-05 Leo's desk | Site, pages, preview, history, domain, visits, hosting payment | Publish, undo, connect domain | MISSING | E-20 |
| D-06 Grace's desk | Customer messages, knowledge, admin list, forwarding address | Mark as sent, edit knowledge | MISSING (invoices PARTIAL) | E-21, E-22, E-08 |

### 06 Settings

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| S-01 Business profile | Profile record | Profile record | MISSING | E-04 |
| S-02 Credits and billing | Balance, usage, history, packs, hosting payment | Checkout, auto top-up, hosting payment | PARTIAL: per account; no per-employee usage; no auto top-up; hosting in rand via PayFast | E-15, E-20 |
| S-03 How your team is powered | Power source, plan status (host), gateway | Switch source, connect, disconnect | PARTIAL | E-16, E-17 |
| S-04 Connections | Forwarding address, domain state, social account names | Social account names (profile) | MISSING | E-21, E-20, E-04 |
| S-05 People | Members, roles, invites | Invite, cancel invite, remove | PARTIAL: no member list over HTTP (survey) | E-19 |
| S-06 Notifications | Per-person preferences | Preferences | MISSING | E-26 |
| S-07 Running | Lock, host settings | Start with computer, stay awake, pause, restart, move team | PARTIAL | E-11, E-12, E-29 |
| S-08 Account | `GET /api/accounts/me` | Sign out, close company, leave company | PARTIAL: deletion likely fails after payments | E-28, E-02 |
| S-09 Help and updates | Version, update status | Check for updates, send help messages, problem reports and feedback | PARTIAL | E-27, E-33 |

### 07 System states and dialogs

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| X-01 Offline | Connection | Queued messages | WORKS (app) | E-01 |
| X-02 Colony unreachable | Relay health | Nothing | WORKS (app) | E-01 |
| X-03 While you were away | What ran late or was missed | Nothing | MISSING | E-14, E-07 |
| X-04 Credits low | Low-balance signal | Nothing | MISSING | E-15 |
| X-05 Credits out | Out-of-credits answer from the gateway (`credits_gateway.rs:233`) | Nothing | PARTIAL | E-15, E-16, E-29 |
| X-06 Own plan limit reached | Plan limit signal | Switch to credits | PARTIAL: shown as an employee chat reply today (survey) | E-17, E-29 |
| X-07 Own plan disconnected | Plan sign-in state | Reconnect | PARTIAL | E-17 |
| X-08 Employee stuck or failing | Employee health | Restart | PARTIAL | E-29, E-13 |
| X-09 Scout stopped | Scout health | Restart Scout | PARTIAL | E-29 |
| X-10 Team stopped | Host health | Restart team | PARTIAL | E-29, E-01 |
| X-11 Update ready or required | Updater, minimum version | Restart to update | PARTIAL: no minimum-version signal (unsure) | E-27 |
| X-12 Signed out | Session state | Sign in | PARTIAL: the session never expires on the server | E-02 |
| X-13 Team runs on another computer | Team lock | Move here | MISSING | E-12 |
| X-14 First close of the window | Host state | Remember "shown" | PARTIAL: Windows quits on close | E-11 |
| X-15 Quit | Host state | Stop team | WORKS | E-11 |
| X-16 Confirmations | The target record | The confirmed action | WORKS (app) | E-01 |
| X-17 Empty states | App only | Nothing | WORKS (app) | E-01 |
| X-18 Loading | App only | Nothing | WORKS (app) | E-01 |
| X-19 Problem messages | Engine error kinds, mapped to plain words | Nothing | PARTIAL | E-29 |
| X-20 Permissions | OS permission state | Permission request | MISSING for the microphone | E-18, E-26 |
| X-21 Can't run here | OS version, single-instance lock, disk space | Nothing | PARTIAL: single instance exists (survey) | E-01, E-27 |
| X-22 Team paused by a person | Pause state | Resume | MISSING: pause is not enforced | E-15, E-29 |

### 08 Outside the app

| ID | Reads | Writes | Status | Engine |
|-|-|-|-|-|
| W-01 Landing page | Static | Nothing | PARTIAL: written for the old audience | E-30 |
| W-02 Download and install | Release files | Nothing | PARTIAL: unsigned builds, Apple Silicon only | E-27 |
| W-03 Pricing | Packs, hosting price | Nothing | PARTIAL | E-30, E-15 |
| W-04 Terms and privacy | Static | Acceptance at sign-up | PARTIAL: relay serves join terms and privacy (`crates/buzz-relay/src/api/invites.rs:132-141`); customer terms missing | E-30 |
| W-05 Payment pages | Stripe checkout, return page | Payment | PARTIAL: the return page is one line of text (`payments.rs:58`) and does not open the app | E-15, E-30 |
| W-06 Emails | Account and company events | Email | PARTIAL: Resend sends sign-in codes only (`crates/buzz-relay/src/api/accounts/mail.rs:28-40`) | E-30, E-19, E-02 |
| W-07 Invite page | Invite | Open app or download | MISSING | E-19, E-30 |
| W-08 Owner's website | Site records, enquiries | Contact form | MISSING | E-20 |
| W-09 Website paused page | Hosting payment state | Nothing | MISSING | E-20 |

## d. Engine items

Each item: what it is, which IDs need it, where it lives today, the work, size (S: days, M: one to two weeks, L: several weeks), what it depends on, and phase ("Launch" means needed for the first public release).

Two drafted plans can be reused. Both are unreviewed drafts:

- **Shared base, Phase 1 backend plan** in `/Users/mac/worktrees/.lanes/wt-ai-employees-spec/docs/superpowers/plans/2026-10-11-ai-employees-base-phase1/`: `part-1-core-relay.md` (role pack fields, hire completion that creates the goal, routines from the hire, the Plan review routine and the kickoff message), `part-2-acp.md` (voice rules, role context, missed wake-ups), `part-3-tauri.md` (role metadata, role context, working folder, start on launch). Parts 4 (old React screens) and 5 (gate) were never written and are replaced by this pack. Open issues found while drafting must be fixed before reuse: a work folder outside the nest cuts the employee off from its skills; part 2 needs `COLONY_WAKE_LEDGER`, which part 3 never sets; the first start needs a replay floor; desktops at 1.0.7 or older fail whole lists on records with new keys; the founder must be a member of the home conversation for routines to fire.
- **Shared base, Phase 2** (budget enforcement) in `docs/superpowers/specs/2026-10-11-ai-employees-shared-base-design.md` on branch `docs/ai-employees-shared-base`: background spend sync, a relay check when spend is recorded, pause in the runtime, a resume action, one raise request per employee per week.

### E-01 New app shell and bridge

- **Needed by:** every ID.
- **Today:** Electron owns the window; the Tauri host runs hidden and serves commands over stdio through a shim (`desktop/electron/README.md:3-7`). Restore and auto-start wait for the interface (`desktop/src-tauri/src/commands/workspace.rs:167`); hiring runs in a React screen (`HireReviewScreen.tsx:434-489`).
- **Work:** new app package and build; reuse or extract Electron main pieces (updater, notifications, deep links, single instance); a typed bridge for the new screens; move restore, auto-start, wake and restart into the host; port only the data logic the new screens need.
- **Size:** L. **Depends on:** nothing. **Phase:** Launch.

### E-02 Email code sign-in without a password

- **Needed by:** O-01, O-02, X-12, S-08, W-06.
- **Today:** sign-in requires email and password (`crates/buzz-relay/src/api/accounts.rs:124-146`, `:651`); codes exist for verifying and resetting (`accounts.rs:565`, `:765-870`); the session is the secret key itself (`accounts.rs:371-388`).
- **Work:** "send me a code" and "sign in with code" using the existing code issuing and rate limits; keep key custody as decided on 23 September (server-assisted recovery); record sign-outs so X-12 can be shown when needed.
- **Size:** S to M. **Depends on:** nothing. **Phase:** Launch.

### E-03 Company creation and company name

- **Needed by:** O-03, N-01, G-01.
- **Today:** self-serve creation is disabled unless configured and limited to existing members by default (`crates/buzz-relay/src/api/self_provisioning.rs:35-40`, `:251-270`); public mode allows 3 per IP and 50 per deployment per hour (`crates/buzz-relay/src/config.rs:1316-1318`); at most 5 companies per owner (`crates/buzz-db/src/store/relay_members.rs:456`); creation makes no conversations (survey); the name shown is fixed (`crates/buzz-relay/src/nip11.rs:203`).
- **Work:** turn on creation for verified new accounts with sensible launch limits; store the company's display name; create the starter conversations from the app.
- **Size:** M. **Depends on:** E-02. **Phase:** Launch.

### E-04 Business profile on the server

- **Needed by:** O-03, O-07, S-01, S-04, C-14, every employee.
- **Today:** one computer's browser storage (`BusinessSetupStep.tsx:26`, `:58-62`); passed to employees as one environment value (`crates/buzz-acp/src/config.rs:298`); marked NEEDS_API (`docs/company-records.md:377`).
- **Work:** a company profile record (owners and partners write, members and employees read) with name, what you sell, who buys, where, links, social account names, brand, time zone; the host passes it to every employee; a change notifies Scout.
- **Size:** M. **Depends on:** E-03. **Phase:** Launch.

### E-05 Topic conversations

- **Needed by:** G-01, T-01 to T-04, M-07.
- **Today:** private channels, members and archive all work (`builders.rs:594`, `:646`, `:703`, `:738-750`).
- **Work:** app work: create one private conversation per topic with Scout, the owner and partners; Scout names it; a new partner is added to every conversation.
- **Size:** S. **Depends on:** E-19 for partners. **Phase:** Launch.

### E-06 Needs you index

- **Needed by:** G-01, G-03, T-01, T-05, C-00 to C-02, C-16.
- **Today:** the app scans every conversation every 30 seconds (`needsMeHooks.ts:24`, `:41-72`); decisions do not name who should decide (`company_asks.rs:1238-1252`).
- **Work:** tag each decision with the people who may decide (owner, and partners unless it is billing); subscribe live instead of polling; show "decided by" from the resolution.
- **Size:** M. **Depends on:** E-19 for the partner rule. **Phase:** Launch.

### E-07 Brief and Friday wrap records

- **Needed by:** T-01, C-19, D-01, X-03, G-03.
- **Today:** missing.
- **Work:** a brief record (a tagged Scout message or a small record) written by Scout's 08:30 weekday and Friday routines; Today shows the latest; D-01 lists history.
- **Size:** S. **Depends on:** E-09. **Phase:** Launch.

### E-08 Typed card records

- **Needed by:** C-00, C-03 to C-14, C-20, G-06, M-03, D-01 to D-03, D-06.
- **Today:** decisions work. Reserved, client-scoped schemas exist for posts, approvals, documents, inbox and sites (`docs/business-records.md:319-338`) but ingest rejects them (`ingest.rs:2328-2331`).
- **Work:** company-scoped draft records with a type (post, carousel, video script, image set, message, customer reply, document, brand kit, plan, invoice or quote), status (draft, approved, ready, posted or sent, skipped) and a link to their decision; relay validation; `colony` commands so employees create and update them; renderers in the app. Decide whether to adapt the reserved client-scoped kinds or add new company kinds (risk 8).
- **Size:** L. **Depends on:** E-06. **Phase:** Launch.

### E-09 Role packs for six employees

- **Needed by:** O-07, O-08, C-03, C-15, M-03, M-04, D-01 to D-06, all employee output.
- **Today:** the format exists; the catalog says there are no built-in role packs (`desktop/src/features/company-hiring/ui/HireRolesScreen.tsx:365`); built-in personas are Scout, Writer and Researcher (`desktop/src-tauri/src/managed_agents/personas.rs:39-60`).
- **Work:** six packs (Scout, Maya, Naledi, Sipho, Leo, Grace): instructions, voice rules, skills for the `colony` command, routines, never-alone lists, first-week routine; Scout's chief-of-staff skill; default names; real-run tests per role.
- **Size:** L. **Depends on:** E-08, E-10. **Phase:** Launch. **Reuse:** base plan part 1 (role pack fields) and part 3 (role context).

### E-10 Hire completes and starts the employee at once

- **Needed by:** O-07, O-08, O-10, M-08, C-15.
- **Today:** employees are created with auto-start off (`HireReviewScreen.tsx:489`) and start on their first mention (survey); hire approval and completion need the owner (`company_hires.rs:68-76`).
- **Work:** base plan Phase 1: completing a hire creates the goal, routines, the Plan review routine and a kickoff; the host creates and starts the employee with start-on-launch on. O-08 completes five hires in one owner action, so completion must be batched or paced (section e).
- **Size:** M. **Depends on:** E-01. **Phase:** Launch. **Reuse:** base plan parts 1 and 3.

### E-11 Background running

- **Needed by:** G-02, O-09, S-07, X-14, X-15.
- **Today:** the tray starts only on Mac (`desktop/src-tauri/src/lib.rs:255-258`); closing the window hides it on Mac and quits elsewhere (`desktop/electron/main.mjs:449-456`, `:591`); no start-at-login code exists (searched `desktop/electron` and `desktop/src-tauri`); keep-awake is Mac only with a one-hour idle cap (`desktop/src-tauri/src/prevent_sleep.rs:16-48`).
- **Work:** tray on Windows; close keeps running on both; start with the computer on both; stay awake while plugged in on both; clear behaviour on battery.
- **Size:** M. **Depends on:** E-01. **Phase:** Launch.

### E-12 One computer runs the team

- **Needed by:** N-01, N-02, X-13, S-07, G-04.
- **Today:** no lock; presence is explicitly "not a distributed singleton lock" (`docs/agent-availability.md:33`, `:51`); employee keys live in the computer's keychain (service `buzz-desktop`, `desktop/src-tauri/src/app_state_keyring.rs:21`) and employee records do not move to other computers (survey).
- **Work:** a company-scoped team lock with a heartbeat on the relay; hand-over (stop on the old computer, make employee keys available on the new one, start there); safe handling when the old computer is off. Key transfer is the hard part: either server-held employee keys (like owner keys) or new keys on move.
- **Size:** L. **Depends on:** E-01, E-03. **Phase:** Launch.

### E-13 Team status without the old interface

- **Needed by:** G-01, G-02, G-07, T-01, T-03, M-01, M-02, M-05, O-10, X-08.
- **Today:** the host knows start-up states (`runtime_types.rs:36-43`) but "ready" reaches it through the old interface (survey); team pages cannot list work by assignee (`docs/company-records.md:496-500`).
- **Work:** the host reports state per employee (starting, working, idle, waiting on you, paused, stopped) and current task to the app, and publishes a small status record so partners and other computers see it; a per-employee activity read for M-05.
- **Size:** M. **Depends on:** E-01. **Phase:** Launch.

### E-14 Missed wake-ups and catch-up

- **Needed by:** T-01, X-03, C-18, F-16.
- **Today:** employees subscribe from "now" (base spec); routines wait 15 minutes for an answer (`crates/buzz-workflow/src/schema.rs:13`); task watchdog check-ins carry no workflow tags (`crates/buzz-relay/src/handlers/company_work_watchdog_worker.rs:387-404`), so employees drop them at their author gate (`crates/buzz-acp/src/lib.rs:255-262`); the heartbeat setting is off by default (`crates/buzz-acp/src/config.rs:306-308`).
- **Work:** base plan part 2 (persisted start point, look-back of at most 7 days, each event once); run missed routines once on start; tag watchdog check-ins for Scout; a "while you were away" summary.
- **Size:** M. **Depends on:** E-01. **Phase:** Launch. **Reuse:** base plan part 2.

### E-15 Company wallet, usage per employee, budgets

- **Needed by:** G-04, O-05, O-08, M-01, M-06, S-02, X-04, X-05, X-22, C-16, W-03, W-05.
- **Today:** balance, usage and history per account (`payments.rs:41-45`); sessions record the employee (`schema/schema.sql:2259-2266`) but no per-employee read; budgets stored, not enforced (`docs/company-records.md:619-622`); no low-balance signal; checkout needs a verified email (`payments.rs:181`).
- **Work:** the owner's account is the company wallet; per-employee weekly usage; a low-balance signal (about three days of recent use); budget enforcement and pause with resume (base Phase 2); auto top-up with a saved card (recommend after launch, hidden in S-02 until ready); a proper return page that opens the app after checkout.
- **Size:** L. **Depends on:** E-16. **Phase:** Launch (auto top-up after launch).

### E-16 Credits gateway live, images through credits

- **Needed by:** O-04, C-04, C-07, X-05, every employee on credits.
- **Today:** off unless `COLONY_CREDITS_GATEWAY=1` and an upstream key exist (`credits_gateway.rs:38-41`); one model with a 20 percent margin (`credits_gateway.rs:75`); two-hour sessions (`credits_gateway.rs:161`), 16 sessions per account (`crates/buzz-db/src/store/credits_gateway.rs:85`); 4 pending requests per account and 1 per session (`store/credits_gateway.rs:174`); out of credits answers 402 (`credits_gateway.rs:233`).
- **Work:** switch on in production once customer terms exist (E-30); choose models per job (strong model for each employee, cheap helpers for heavy work); raise the in-flight cap for six employees; an image route billed in credits for AI-made images; a transcription route if voice notes use the cloud (E-18).
- **Size:** M. **Depends on:** E-30. **Phase:** Launch.

### E-17 Own plan without a terminal

- **Needed by:** O-04, O-06, S-03, X-06, X-07.
- **Today:** Claude's plan sign-in runs hidden (`desktop/src-tauri/src/commands/agent_auth.rs:90-94`, `:219-229`); other providers open a terminal (`agent_auth.rs:94`); installs run `curl` pipes and npm (`desktop/src-tauri/src/commands/agent_discovery.rs:292`, `:662-666`); the ChatGPT plan work is off and has no interface (`desktop/electron/chatgpt/README.md:1-11`).
- **Work:** silent install with plain progress; ChatGPT plan path end to end; detect "plan limit reached until" and "signed out" and show X-06 and X-07 instead of chat warnings.
- **Size:** M (Claude), L (ChatGPT). **Depends on:** E-01. **Phase:** Launch for the Claude plan; ChatGPT plan when its review clears (unsure).

### E-18 Voice notes

- **Needed by:** T-03, T-07, X-20, F-19.
- **Today:** missing.
- **Work:** record in the app with microphone permission; upload the audio; transcribe; post audio with its transcript; Scout reads the transcript. Technical call (11 October): transcribe on this computer with a bundled speech model, so voice notes are free and work on an own plan. Proof gate: a 1-minute note in South African English, recorded on a 2019 Intel laptop, is written down in under 30 seconds and reads correctly. If the gate fails, owners with credits fall back to transcription through credits.
- **Size:** M. **Depends on:** E-01. **Phase:** Launch (owner decision).

### E-19 Partners

- **Needed by:** P-01, S-05, T-05, M-07, C-15, C-16, W-06, W-07.
- **Today:** invite codes (`invites.rs:284`, `:361`); roles (`relay_admin.rs:10-12`; role changes are owner only); employees accept direct messages from their owner only (`crates/buzz-acp/src/lib.rs:390-397`); hire approval is owner only (`company_hires.rs:68-76`).
- **Work:** email invites and an invite page; partner as admin; let partners' messages and @ names reach employees (keep each employee's allowlist in sync with the company's admins); decide in the relay that partners may approve hires (product rule: anything except billing); "decided by" on every decision; leaving a company.
- **Size:** M. **Depends on:** E-06. **Phase:** Launch.

### E-20 Website hosting

- **Needed by:** C-10, D-05, S-02, S-04, W-08, W-09, F-09.
- **Today:** site records are reserved (`docs/business-records.md:334-338`) and rejected; site subscriptions exist only through PayFast in rand (`payments.rs:47-55`, `:875-902`); no hosting integration.
- **Work:** site records; a build step for Leo's site source; previews; publish to Cloudflare; history with undo; the Colony web address on a separate domain (owner, 11 October; the name is checked and bought first); own domains with Cloudflare custom hostnames and automatic certificates (Colony never sells domains); visit counts; contact form to Grace; $10 a month through Stripe; the paused page.
- **Size:** L (largest item). **Depends on:** E-08, E-15. **Phase:** Launch.

### E-21 Inbound email

- **Needed by:** D-06, S-04, F-07.
- **Today:** only a generic workflow webhook (`crates/buzz-relay/src/router.rs:157`); email is sent only for sign-in codes.
- **Work:** a forwarding address per company; receive, check and parse mail (vendor choice in the engine plan); store as customer messages with attachments; spam and size limits; a "test my forwarding" check.
- **Size:** M. **Depends on:** E-22. **Phase:** Launch.

### E-22 Customer inbox records

- **Needed by:** C-09, D-06, G-03, F-07.
- **Today:** missing (the reserved social inbox assumes connected platforms, `docs/business-records.md:332`).
- **Work:** company-scoped customer and customer-message records (sources: forwarded email, pasted text, screenshot, website form), status (to reply, waiting on customer, done), linked reply drafts (E-08), a "waiting more than 24 hours" signal.
- **Size:** M. **Depends on:** E-08. **Phase:** Launch.

### E-23 Leads and deal stages

- **Needed by:** C-11, D-04, F-08.
- **Today:** prospect records work inside the internal business channel (`docs/business-records.md:209-222`); paid search adapters are not active.
- **Work:** stages (new, contacted, talking, won, lost), follow-up dates and linked message drafts on prospects; `colony` commands for Sipho; paid lead search after launch (Sipho uses web research at launch).
- **Size:** M. **Depends on:** E-08. **Phase:** Launch (paid search after launch).

### E-24 Content calendar and post reminders

- **Needed by:** C-04, C-05, D-02, D-03, G-03, F-06.
- **Today:** the reserved content post schema has a planned time and media (`docs/business-records.md:329`) but is client-scoped and rejected.
- **Work:** company-scoped posts with status and planned time; a time-to-post reminder (notification plus a nudge from Scout); an "AI-made" flag on media.
- **Size:** M. **Depends on:** E-08, E-31. **Phase:** Launch.

### E-25 Growth numbers

- **Needed by:** C-17, D-02, F-20.
- **Work:** a weekly numbers record (orders, optional revenue, optional followers, site visits from E-20); the Thursday question; Maya's desk read.
- **Size:** S. **Depends on:** E-06. **Phase:** Launch.

### E-26 Notifications

- **Needed by:** G-03, O-09, S-06, X-20.
- **Today:** computer notifications exist and open a conversation on click (survey); the rules for when to notify live in the old interface (survey); phone push is Apple only and not needed at launch.
- **Work:** rules for decisions, urgent problems, brief, Friday wrap, time to post and customers waiting; click opens the right ID; quiet hours; per-person preferences.
- **Size:** S to M. **Depends on:** E-06, E-07. **Phase:** Launch.

### E-27 Signed installers and updates

- **Needed by:** W-02, X-11, X-21, S-09.
- **Today:** installers for Apple Silicon Mac, Windows x64 and Linux only (`desktop/scripts/electron-installer.mjs:10-12`); Mac signing runs only when Apple credentials exist (`desktop/scripts/electron-package.mjs:216-222`); updates come from a GitHub feed every 6 hours (`desktop/electron/updater-service.mjs:3-9`, `:224`); the release workflow has never run (survey).
- **Work:** Intel Mac build; installers stay unsigned at launch (owner, 11 October: not yet), so W-02 carries clear install help and a Mac updates by download (X-11); a proven update path on Windows; a minimum-version signal for "update required". Signing is added later, when the owner pays for it.
- **Size:** M. **Depends on:** E-01. **Phase:** Launch.

### E-28 Close company, leave company

- **Needed by:** S-08, F-22.
- **Today:** account deletion removes only the account row (`accounts.rs:999-1018`); credit, payment and AI tables block deletion of accounts that have them (`schema/schema.sql:2132`, `:2150`, `:2183`, `:2261-2271`), so deletion should fail for anyone who paid (not tested).
- **Work:** close company (stop the team, cancel hosting, archive the company, keep money records as the law requires); leave company for partners; account deletion that keeps ledgers.
- **Size:** M. **Depends on:** E-12, E-20. **Phase:** Launch.

### E-29 Plain-language health and repair

- **Needed by:** G-02, G-04, C-18, M-06, S-07, X-05 to X-10, X-19, X-22.
- **Today:** the host knows failed and stopped states (`runtime_types.rs:36-43`); a dead harness is only marked stopped and never restarted; provider failures appear as warning replies in chat (survey).
- **Work:** the host restarts employees with backoff and a final "stuck" state; problem records Scout turns into C-18 cards; banners for the whole team; restart one employee and restart the team.
- **Size:** M. **Depends on:** E-13. **Phase:** Launch.

### E-30 Colony's own web pages and emails

- **Needed by:** O-01, W-01 to W-07, E-16.
- **Today:** the landing page speaks to the earlier tech-founder audience (survey); the relay serves join terms and privacy routes (`invites.rs:132-141`); customer terms with the AI provider flow-down clause do not exist yet; email is only sign-in codes (`accounts/mail.rs:28-40`).
- **Work:** landing (only built features), download, pricing, terms, privacy; emails for invites, credits low and out, hosting payment failed and company closed (Stripe sends receipts).
- **Size:** M. **Depends on:** nothing. **Phase:** Launch.

### E-31 Photo library

- **Needed by:** C-07, C-14, D-03, D-05, T-08.
- **Today:** media upload works; there is no library.
- **Work:** a company media index with tags (product, AI-made, logo) and filters, shared by Naledi and Leo.
- **Size:** S to M. **Depends on:** nothing. **Phase:** Launch.

### E-32 Search

- **Needed by:** T-06.
- **Today:** NIP-50 search works (`req.rs:286-296`); company records are not searchable (survey).
- **Work:** app work; decide whether draft records join search.
- **Size:** S. **Depends on:** E-08. **Phase:** Launch.

### E-33 Support inbox

- **Needed by:** S-09, X-12 (Get help), C-18 and X-08 (Get help after a second failure).
- **Today:** missing. Email is used only for sign-in codes.
- **Work:** help messages, problem reports with the details the person agreed to send (app version, type of computer, recent problem messages; never conversations unless pasted), and feedback reach a Colony support inbox and get an email reply.
- **Size:** S. **Depends on:** E-01, E-30. **Phase:** Launch.

## e. Relay limits the new app must respect

| Limit | Value and evidence | What it means for screens |
|-|-|-|
| Stored events per person | 60 per minute (`crates/buzz-auth/src/rate_limit.rs:117-119`) | Bulk actions (approve a week of posts, first-run setup) must be paced or batched and show progress, never fail halfway. "One user action, one atomic write" (repo rule 5) applies to O-08. |
| Stored events per employee | 120 per minute (`rate_limit.rs:129-131`) | Employees writing many drafts at once are throttled; the "working" status covers it. |
| HTTP calls per person | 300 per minute (`rate_limit.rs:123-125`) | Avoid polling; use live subscriptions (E-06). |
| WebSocket frames | 10 per second (`rate_limit.rs:126-128`) | Coalesce typing and read updates. |
| Filters must name kinds; private kinds need "addressed to me" | `req.rs:261-284` | Every screen query names its record kinds. Needs you must use the addressed-to-me form (E-06). |
| Query size | 1024 subscriptions, 128 conversations per filter (`req.rs:26`, `:43`); 10 filters and 1000 results (survey) | The conversation list and archive must page beyond 128 conversations. |
| Event size and clock | 256 KB content, clock within 15 minutes (`crates/buzz-relay/src/handlers/ingest.rs:2270`, `:2279`) | Long documents travel as files. A computer with a wrong clock gets a plain X-19 message ("Your computer's clock is off"). |
| Media | Image 50 MB, GIF 10 MB, video 500 MB, other files 100 MB (`crates/buzz-relay/src/config.rs:1461-1476`); 30 uploads per minute and 2 at a time per person (`config.rs:1500-1511`) | T-08 and the photo library show these limits and queue bulk uploads. |
| AI requests on credits | 4 in flight per account, 1 per session, 16 sessions (`crates/buzz-db/src/store/credits_gateway.rs:85`, `:174`) | Six employees share four AI calls at a time. Status must say "waiting for a turn" or the cap must rise (E-16). |
| Companies | 5 per owner (`relay_members.rs:456`); public creation 3 per IP and 50 per deployment per hour (`config.rs:1316-1318`) | O-03 needs plain copy for these limits; the hourly cap must rise before a launch day. |
| Sign-in requests | 60 per IP and 10 per email per minute; 30-second code resend (survey) | O-02 shows a 30-second resend timer. |
| Routine answer window | 15 minutes (`crates/buzz-workflow/src/schema.rs:13`) | A sleeping computer misses routines; X-03 and E-14 cover catch-up. |

## f. Risks and unknowns

Ranked, most serious first.

1. **One computer runs the team (E-12).** Moving employees between computers needs their keys, and nothing prevents two computers running the same employee today. A wrong design means duplicate answers or lost employees.
2. **Website hosting size (E-20).** The largest new system: builds, previews, Cloudflare, domains, billing, forms. It could delay launch. A fallback is launching Leo on the Colony address first and adding own domains right after.
3. **Windows background running and signing (E-11, E-27).** Windows quits on close and has no tray today; unsigned installers trigger warnings that non-technical owners may not get past. The owner accepted unsigned installers for launch on 11 October, so W-02 must make the steps easy.
4. **AI capacity and real weekly cost (E-16, E-15).** Four AI calls at a time for six employees, one model, and no measured weekly cost per team. The weekly budget defaults shown in O-08 need real numbers.
5. **Inbound email (E-21).** Vendor choice, spam, parsing, and the difficulty of setting up forwarding for non-technical owners.
6. **Customer terms before charging (E-30).** The AI provider confirmed Colony credits are fine only with customer terms that pass its rules down; no terms page exists yet.
7. **Voice transcription (E-18).** Model size, speed and quality for local accents are unknown; the cloud path costs credits and fails for owners on their own plan without credits.
8. **Draft record design (E-08).** The reserved schemas were written for client projects. Reusing them or adding company-scoped kinds is a long-lived choice.

## g. Suggested build order

Codex designs the screens while phase 0 runs, because phase 0 has no interface.

| Phase | Engine items | What the owner can see at the end |
|-|-|-|
| 0. Foundations | E-02, E-03, E-04, E-10, E-14, E-11, E-29 (basics) | Sign in with a code; a company created with its name and profile; a test employee hired from the engine starts at once, keeps running with the window closed on Mac and Windows, and catches up after sleep. Proven by a real run. |
| 1. App and Scout | E-01, E-05, E-06, E-07, E-09 (Scout), E-13, E-16, E-26, E-30 (terms) | The new app from Codex's designs: first run with credits, Scout's real first turn, Today with a real brief, conversations, Needs you, notifications. |
| 2. The team at work | E-08, E-09 (five roles), E-15, E-23, E-24, E-25, E-31, E-32 | The full starter team producing plans, posts, leads and numbers as cards; desks for Maya, Naledi and Sipho; weekly budgets with real usage. |
| 3. Care, partners, voice, second computer | E-21, E-22, E-19, E-18, E-17, E-12 | Forwarding address works and Grace drafts replies; a partner joins and approves; voice notes; moving the team to another computer. |
| 4. Website | E-20 | Leo builds and publishes a site on the Colony address, connects an own domain, monthly payment, contact form to Grace. |
| 5. Launch readiness | E-27, E-28, E-30 (landing, pricing, emails) | Installers for Mac (both chips) and Windows with clear install help (unsigned at launch), update path proven, close company, the new landing and pricing pages. |

The engine plan written after spec approval will turn these phases into tasks with proof gates.
