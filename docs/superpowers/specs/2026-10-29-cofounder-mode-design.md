# Co-founder mode: Colony as a company operating system

Date: 29 Oct 2026. Owner: Basheer. Status: design for approval.

## 1. Intent and why

The owner wants to run his agency, Horizon Labs, inside Colony, and wants every Colony company to work the same way. Today Scout (the Chief of Staff agent) does what it is told. The owner wants a living, breathing co-founder: Scout holds the business with him, thinks about what to do next, proposes it, and once he approves, runs the team and gets it done. The owner does only what a person must do (sign up, log in, grant access, approve what goes out, approve spending, judge taste).

The deeper idea: a company is a fixed set of functions. Each function is a slot filled by one responsible lead agent, who runs invisible workers. Scout maps any business onto these functions, fills the slots one at a time, and keeps the whole company visible in one map. That turns Colony into a company operating system, not a chat app with bots.

## 2. Goals

- A per-company switch, "Co-founder mode", that changes Scout from order-taker to initiative-taker.
- The company map: Chief of Staff plus five functions with sub-functions, each function a slot with a lead agent, visible in the app.
- Scout plans, proposes, hires, briefs, orchestrates, reviews and reports, inside hard approval rules.
- Workers: nameless, cheap, visible agents that employees (and Scout) spawn for bounded jobs.
- Playbooks, starting with Operations, designed with the founder and followed by agents.
- One customer record from lead to client to project to invoice.
- Money and paperwork rails: quotes, proposals, agreements to sign, payment links, invoices.
- A scorecard per function and Scout's weekly review.
- Calendar booking for calls with leads and clients.
- Scout can use every Colony tool the owner can, including Discovery search, and asks for new tools when it needs them, preparing everything so the owner's part is one step.

## 3. Non-goals (v1)

- Email sending by API (spam and delivery problems). Agents keep using Gmail through the built-in browser.
- Humans leading function slots (later).
- A compliance centre (later; v1 keeps opt-outs and consent records inside WhatsApp outreach).
- Ready-made playbooks per Discovery business type (later).
- An always-on cloud Scout (open question, section 14).

## 4. Anti-goals: what makes this a failure even if it works

- **Scout sends outreach or spends money without the owner's approval.** The owner called this a major issue. It must be impossible by construction, not by prompt.
- Scout publishes or sends taste work (designs, social posts, websites, anything with the brand on it) without approval.
- The owner becomes a project manager: long reports, to-do lists for him, repeated questions. Asks must be one step, prepared in advance, and short (agent replies stay short, see the 28 Oct short-reply rule).
- Hidden work: anything an agent or worker does that the owner cannot see.
- Workers clutter the team list.

## 5. Co-founder mode switch

- Lives in Settings > Experimental features (ExperimentalFeaturesCard.tsx already exists). Off by default. Per company.
- Owner and admins can switch it (my call). Switching off stops new plans and new initiative; approved work in flight finishes (my call).
- Companies with it off keep today's Scout.

## 6. Onboarding when switched on

Starts from what Colony already knows; never a blank form.
1. Scout reads: company profile from setup, the company website (built-in browser), leads and campaigns, channels and past conversations, team, connected tools (WhatsApp etc.), Scout memory.
2. Scout plays back a short business brief: what you sell, to whom, prices, how you talk. The owner corrects or confirms. The brief stays a living page the owner can edit (my call).
3. Scout asks only what is missing, one short question at a time in the Scout chat: the money setting (cheapest first or best option), what needs approval beyond the hard rules, accounts to connect (prepared in the built-in browser, e.g. Pinterest login).
4. Scout proposes the company map for this business (section 7) and the first function to fill.
- Scout does NOT ask for "the goal": a business has many goals and they live inside functions (section 11).
- Switching off and on again does not restart onboarding; Scout checks what changed (my call).

## 7. The company map

- **Chief of Staff: Scout.** Runs the company with the owner.
- **Functions, in this order:** Sales, Operations, Customer Success, Finance, Brand. Each has sub-functions, e.g. Sales: lead finding, outreach, follow-ups, calls, quotes, closing; Customer Success: client chats, change requests, renewals, upsell, reviews; Finance: quotes, invoices, deposits, recurring plans, chasing payments, costs; Brand: the company's own website, portfolio, offer and prices, voice, marketing.
- **Slots.** Each function is a slot filled by ONE lead agent (a hired, named employee in the team list) who is responsible for it. Scout fills slots one at a time with the owner, starting where the business needs it (for a young agency: Sales, then Operations). Until a slot is filled, Scout covers it or leaves it empty and visible.
- **Scout maps any business onto the same five functions.** What sits inside changes per business; the five never change.
- **Visible.** A company map in the Company section shows every slot: lead agent and status, or empty with "fill this"; sub-functions; the function's scorecard numbers; the Operations playbook as a flow. Design follows the shipped Colony 3.0 app (feedback rule: real app screenshots win over the 23 Oct canvas) and is designed in Claude Design before building.

## 8. Operations and playbooks

- Operations is the actual work the business sells, different for every business, so Scout designs it WITH the founder(s) as a playbook: ordered steps, each with an owner (a function, a lead agent, a worker type, or the founder), inputs and outputs, approval points, and tools.
- Examples:
  - Horizon Labs: client brief and assets, logins and domain, website build or social content design, founder approval, present to client, revisions, launch.
  - Recruitment agency: scan job sites (Indeed), pick roles worth filling, find candidates, research and shortlist, email candidates to gauge interest, offer the hiring company a partnership (first candidates free), get an ongoing agreement signed (that step handed to Sales).
- Operations can hand steps to other functions.
- Every function has playbooks (its routines and processes), not only Operations. Playbooks are versioned; Scout proposes improvements from the weekly review, and the owner approves changes to a playbook (my call).
- A playbook runs per job (per client or project), so each running copy shows its current step.

## 9. Scout's behaviour in co-founder mode

- **Initiative loop.** Scout wakes on a schedule (daily start) and on events (an inbound reply, a worker or employee finishing, an approval given, a deadline near, a scorecard change) and moves work forward without being mentioned. Existing duties/wake machinery is the base.
- **Plans.** Scout proposes plans as plan cards: steps, who does each, cost, timing. The owner approves, edits or rejects. Approved plans run without further asks except at approval points.
- **Hiring.** Scout decides which employees the business needs, hires them (existing hire flow), briefs them, assigns them to slots, and manages them.
- **Review.** Scout and lead agents check work against a quality bar before the owner sees it and send weak work back.
- **Taste.** For designs, posts, websites and branded material Scout brings options for approval (my guess: 2 or 3 with a recommendation). Before designing, agents gather inspiration on Pinterest in the built-in browser (owner logs in once when asked).
- **Money setting.** Default cheapest first (free if possible) because a young business has little money; a company setting switches to "best option". Any cost still needs approval.
- **Capability gaps.** When Scout needs something Colony cannot do yet, it finds the options, picks the cheapest that works, prepares everything (what to sign up for, plan, what goes where), opens the exact page in the built-in browser, and asks for only the human step (sign up, log in, grant access, "done"). Then it finishes the setup and carries on. It states the cost before the sign-up.
- **Access list.** Every tool and account Scout and agents can use, with revoke. New access goes through the capability-gap flow.
- **Talking.** Short messages; one place for asks ("Needs you"): approve (outreach, spend, taste, plan, playbook change), do (human-only step, prepared), decide.

## 10. Hard approval rules (enforced, not prompted)

1. No outreach to anyone outside the company without owner (or admin) approval. **Owner decision: one approval covers one message.** Approving a WhatsApp batch approves only the first message of each row; EVERY later agent message (replies inside an open chat, follow-ups, files, links, quotes, payment links, invites) is a draft the owner approves, edits or rejects before it sends. Messages the owner or an admin types themselves send at once.
2. No spending without approval: paid tools, sign-ups, ads, credits beyond a set budget. Discovery searches are not a company spend (see section 14).
3. No publishing taste work without approval.
4. Workers can never take outward actions or spend; they produce material for their employee only. Workers get no browser and no shell (my call, follows from this rule).

Where it is enforced:
- Colony-run channels (WhatsApp via the relay, Discovery, credits, money rails Colony integrates): enforced at the relay; a pending draft never reaches the provider. Tests must fail without the guard.
- The built-in browser (Gmail, social sites, sign-ups, checkouts): **owner decision: keep today's on-screen confirmation.** The browser stops on Send / Pay / Submit-like actions and asks the person on screen; if nobody is there it refuses. An approval given earlier in "Needs you" does not by itself unlock a browser send (my reading of that choice).
- The approval record (who approved what, when) is kept.

## 11. Goals, numbers and the weekly review

- Goals live inside functions and there can be many (e.g. Sales: 5 new clients a month; Operations: launch in 7 days; Finance: R30k recurring a month). Scout proposes goals from the numbers; the owner approves them like plans.
- Each function has a scorecard (Sales: leads, contacted, replied, calls, quotes, won; Operations: jobs in progress, days to deliver, revisions; Customer Success: active clients, renewals, referrals; Finance: cash in, owed, recurring, costs; Brand: cost per client, what is working).
- Weekly review: Scout posts a short review (what moved, what worked, e.g. which WhatsApp template gets replies, what it proposes to change) and asks only for the decisions that need the owner.

## 12. One customer record, money and paperwork, calendar

- **Customer record.** One record per business across its life: lead, client, projects/jobs, quotes, agreements, invoices and payments, plus every WhatsApp chat, email and file. Leads and clients exist today as separate records; this unifies them (lead converts to client and keeps its history).
- **Email in.** **Owner decision: no inbox API.** Agents check Gmail in the built-in browser whenever they need to, with no time limit, and copy relevant emails onto the customer record. (Only while the computer is awake, like all agents.)
- **Money and paperwork rails.** Quotes and proposals (documents agents draft, owner approves), agreements to sign, payment links for deposits (the WhatsApp template "Deposit payment link" already exists), invoices and recurring plans. **My call:** Colony integrates a small fixed set, one e-sign service, one payment-link provider and one calendar, chosen as the cheapest that works in South Africa, so status (signed, paid, booked) flows back into the customer record and scorecards and sending is gated at the relay. Scout picks among them; anything outside the set falls back to the browser with on-screen confirmation. Existing money records and Stripe/PayFast code are the base.
- **Calendar booking.** Agents offer times and book calls with leads and clients into the owner's calendar (provider via the capability-gap flow, e.g. Google Calendar or a free booking tool), with reminders.

## 13. Workers

- Lead agents (and Scout) spawn workers for bounded jobs: research, drafts, design options, per-lead research in parallel.
- Workers are nameless, never in the team or agents list, labelled by their job ("Research: Melville guesthouses"), shown under the employee or task that started them, fully visible: live status like agents, output when done, kept on the task after they finish, cost shown next to each.
- Workers run on cheap or free models by default (Colony free gateway models, DeepSeek, Gemini); employees and Scout use a strong model to plan, brief and review.
- Every worker run has a budget cap (tokens and money) and a time limit; fan-out is bounded.
- New primitive: an agent command such as `colony work spawn --brief ... --model cheap --budget ...` that runs a headless worker and returns its result to the caller.

## 14. Tools Scout needs in v1

- Discovery search for agents (today the colony CLI can list and update leads but cannot search): an agent command to run a search and save results to leads/campaigns. **Owner decision: Colony absorbs the search cost and charges a monthly subscription for access to Discovery.** So agent searches are not a company spend needing approval; they need an active Discovery subscription, and the relay keeps a fair-use cap per company to protect Colony's cost (my call: cap value set by Colony, visible to the owner).
- WhatsApp outreach (being built: C3-WA-RELAY-1 and C3-WA-UI-1).
- The built-in browser with working Google sign-in (being fixed: C3-BROWSER-GOOGLE-LOGIN-1), used for Pinterest, Gmail, sign-ups.
- Worker spawn (section 13), plan cards and the "Needs you" asks, the company map, playbooks, customer record, money and paperwork rails, calendar booking, scorecards.

## 15. Constraints and context

- Agents run locally on the owner's computer and stop when it sleeps (current Colony runtime).
- Colony 3.0 look is fixed by the shipped app; new screens are designed in Claude Design from the real screens and approved before building.
- Existing primitives to build on: goals, asks (approval cards), duties and wakes, hire flow and role catalog, leads, money records, work/projects, secrets bindings, Knowledge tab, agent browser, credits gateway.
- POPIA and WhatsApp rules apply to outreach (consent-first openers, opt-outs honoured).
- Owner rules: no em dashes in any UI copy; short agent replies.

## 16. Decided by the owner

Co-founder mode off by default in Experimental features, per company. Scout = Chief of Staff. Functions and order: Sales, Operations, Customer Success, Finance, Brand, with sub-functions. One lead agent per function slot, filled one at a time. Workers nameless, not in team list, fully visible. Operations designed with the founder as the business's process. Approval required for outreach and spending (major failure otherwise) and for taste work. Cheapest first, changeable. Scout finds and prepares new tools, owner does only the human step in the built-in browser. Pinterest native in the browser. Onboarding starts from what is known; no single goal question. v1 includes playbooks, one customer record, money and paperwork rails, numbers and weekly review, calendar booking. Email by API out.

## 17. My calls (owner to check)

Owner and admins can switch the mode; switching off lets approved work finish; brief is a living editable page; re-enabling checks for changes instead of re-onboarding; taste options come as 2 or 3 with a recommendation; playbook changes need owner approval; the company map lives in the Company section; a budget may pre-approve small spend inside an approved plan; workers get no browser or shell; a fixed set of integrated providers (one e-sign, one payment link, one calendar, cheapest in SA); a Discovery fair-use cap per company; the extra approval rules asked at onboarding are a fixed list of switches (for example "approve every hire", "approve playbook changes", "approve every Discovery campaign"), enforced where Colony runs the action and given to Scout as instructions elsewhere; always-on cloud Scout is not in v1 (agents still stop when the computer sleeps).

## 18. Left to the builder

Data model and event kinds, how wakes are scheduled, the worker runtime and model routing, plan card and map layouts (subject to the Claude Design approval step), provider integrations behind the capability-gap flow, migration of leads and clients into one record.
