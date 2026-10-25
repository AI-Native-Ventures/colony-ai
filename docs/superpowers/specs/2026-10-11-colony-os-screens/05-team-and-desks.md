# 05 Team and desks

- Part of the Colony screen pack. Read [00-index.md](00-index.md) first: its rules (section 5), words (section 8), common states (section 10) and engine items (section 12) apply to every entry here.
- IDs in this file: M-01 to M-08, D-01 to D-06, and the sub-screens D-02a, D-03a, D-04a, D-05a, D-06a, D-06b and D-06c.
- Items marked "(default)" are sensible defaults chosen while writing this file. The ones that need the owner are listed in the last section.

## Shared behaviour on team screens

1. **One decision, many places.** A decision shown on a desk is the same decision that sits in Needs you (T-05) and in the conversation where it came up. Deciding in any place updates every place and adds the "decided by" line (C-00).
2. **Who may.** The owner and partners can do everything on these screens except billing. Billing actions (setting up or paying for website hosting, buying credits) are marked "(owner only)". A partner sees them read-only with a line such as "Only Lerato can set up hosting."
3. **The team's computer.** Restarting one employee, pausing and resuming can be done from any computer; the computer that runs the team carries them out (default; needs E-12 and E-29). When that computer is off, the action says "Restarts when Lerato's MacBook is back on." Restarting the whole team after it stopped (X-10) only works at the team computer.
4. **Status is never colour alone.** Every status chip (G-07) comes with a plain status line, for example the chip "paused" with "Paused by Kagiso at 14:05."
5. **Keyboard.** Every action is reachable with Tab and works with Enter or Space. Lists and tabs move with the arrow keys. Escape closes a sub-screen and returns focus to where it was opened. Extra shortcuts are listed per entry; global shortcuts are in G-05.
6. **Former team members.** When an employee is let go, their page stays readable (work, plans, activity) under "Former team members" on M-01 (default). Nothing on it can be changed.

## Employee states used in this file

The chip comes from G-07. "Waiting on you" means the employee cannot continue without a person; an employee who is busy and also has open decisions shows "working" plus a waiting count. When several states apply, the chip shows the first match in this order: stopped, paused, away, starting, waiting on you, working, free. G-07 is the authority for these words.

| State | Chip (G-07) | Status line example |
|-|-|-|
| Starting | starting | "Getting ready. This takes about a minute." |
| First week, before the first plan is approved | working | "Getting to know your business. First plan coming for your OK." |
| Working | working | "Drafting next week's 5 posts." |
| Free | free | "Nothing to do right now. Next: plan check, Monday 09:00." |
| Away (the team computer is off or asleep) | away | "Lerato's MacBook Air is off. Naledi carries on when it's back." |
| Waiting on you | waiting on you | "Waiting on you: approve the brand kit." |
| Paused by a person | paused | "Paused by Kagiso at 14:05." |
| Paused for credits | paused | "Out of credits. Naledi continues when credits are added." |
| Paused for the owner's own plan limit | paused | "Your Claude plan limit is reached until 14:00." |
| Paused at the weekly budget | paused | "Reached her $5.00 weekly budget. Scout asked you about it." |
| Stopped | stopped | "Stopped. Restart to continue." |
| Failing | stopped | "Ran into a problem: couldn't open Instagram. Scout is on it." |
| Let go | no chip | "Let go by Lerato on 3 Nov." |

## Default routines

Every employee also has "Plan check" every Monday at 09:00, which reviews the 2-week plan and sends the next one when the current one ends. Routines run in the company's time zone (S-01) and only while the team's computer is on; missed runs catch up once when it comes back (E-14).

| Employee | Routines (default times) |
|-|-|
| Scout | Morning brief, weekdays 08:30. Friday wrap, Fridays 16:00 (default time). |
| Maya | Plan check. Numbers check-in, Thursdays 10:00 (default time). Campaign ideas, first Monday of the month 10:00 (default). |
| Naledi | Plan check. Next week's posts, Mondays 10:00 (default time). Time-to-post reminders, at each post's time. Monthly look back, last Friday of the month 11:00 (default). |
| Sipho | Plan check. Lead hunt, Tuesdays 09:00 (default time). Follow-up check, weekdays 08:00 (default time). |
| Leo | Plan check. Site check, Wednesdays 09:00 (default). Monthly refresh, first Tuesday of the month 09:00 (default). |
| Grace | Plan check. Customers waiting check, every day 08:00 including weekends (default). Admin catch-up, Fridays 10:00 (default time). |

Employees also work without a routine: when Scout or their manager asks, when a person messages them, and (for Grace) as soon as a customer message arrives.

---

### M-01 Team

- **Who:** owner, partner
- **Purpose:** See the whole team at a glance: who is doing what, who is waiting on you, and what each employee costs this week.
- **Get here:** "Team" in the app window (G-01) or its shortcut (G-05); "See the team" from the team line on Today (T-01); "Team status" in the menu bar or tray (G-02) (default); the back action from any employee page (M-02).
- **Leads to:** an employee page (M-02); a direct chat (M-07); Needs you showing that employee's decisions first (T-05); a new conversation with Scout about hiring (T-04); Credits and billing (S-02, owner only); a former employee's read-only page (M-02, let go state).
- **Shows:**
  1. Team summary: number of employees, how many decisions are waiting on you, and credits used this week. If the whole team is paused or stopped, the reason comes first (with the G-04 banner).
  2. One entry per employee, in this order: Scout, Maya with Naledi shown as reporting to her, Sipho, Leo, Grace, then any later hires. Each entry has:
     - identity (G-07): avatar, name, role;
     - status chip and status line (see "Employee states");
     - the current task in plain words, or the next routine when free;
     - waiting-on-you count, when above zero;
     - this week's credits against the weekly budget ("$3.40 of $5.00 this week");
     - last active ("Active now", "Last worked 2 hours ago").
  3. The reporting lines: Scout reports to the owner; Maya, Sipho, Leo and Grace report to Scout; Naledi reports to Maya. Codex decides how to show this.
  4. "Ask Scout to hire someone": the only way to add an employee (there is no catalogue screen).
  5. Former team members, collapsed, when there are any (default).
- **Actions:**
  - Open an employee (owner, partner) -> M-02 on the Desk tab. Keyboard: arrow keys move between employees, Enter opens.
  - Message an employee (owner, partner) -> M-07 for that employee.
  - See decisions waiting (owner, partner) -> T-05 with that employee's decisions first.
  - Ask Scout to hire someone (owner, partner) -> T-04 with the first message filled in: "I'd like to hire someone to help with ". Scout answers with a hire proposal (C-15).
  - Resume team (owner, partner), only in the paused-by-a-person state -> the team resumes (same as S-07).
  - Restart team (owner, partner), only in the team-stopped state and only on the team's computer -> same as X-10.
  - Buy credits (owner only), only in the paused-for-credits state -> the buy credits flow from S-02. Partner sees "Only Lerato can buy credits. We've let her know."
- **States:**
  - Normal: as above.
  - First day: every employee is starting or in their first week. Summary reads "Your team is getting to know your business. Each plan comes to you for a yes."
  - Some waiting on you: the summary leads with the count.
  - Team paused for credits (X-05): every chip shows "paused" with "Out of credits"; owner sees Buy credits; partner sees the read-only line.
  - Team paused by a person (X-22): every chip shows "paused" with who paused it and when; Resume team is offered.
  - Team stopped (X-10): every chip shows "stopped"; Restart team on the team's computer, "Restart from Lerato's MacBook" elsewhere.
  - Team on another computer (X-13): status still shows, with "Your team runs on Lerato's MacBook" under the summary.
  - Only Scout left (everyone else let go): "Only Scout is on your team right now. Ask Scout to hire someone."
  - Offline: last known status with "As of 10:42"; actions that need the internet are disabled and say why.
  - Loading: common rules.
- **Words:**
  - "6 employees. 2 decisions waiting on you. $9.10 used this week."
  - "Naledi is drafting next week's 5 posts."
  - "$3.40 of $5.00 this week."
  - "Grace has nothing to do right now. Next: checking for customers waiting, 08:00 tomorrow."
  - "Want someone new on the team? Ask Scout."
- **Data:** Reads the team and reporting lines from member positions (kind 30648, WORKS), status and current task from the team status read model (E-13, PARTIAL), waiting counts from the Needs you index (E-06, PARTIAL), weekly credits per employee and weekly budgets from the company wallet (E-15, PARTIAL: no usage per employee today; budgets in kind 30653 exist but are not enforced). Writes nothing itself; hiring starts as a conversation (E-05, WORKS) that leads to a hire record (kind 30650, WORKS).
- **Not here:** a catalogue of roles to browse, creating custom employees by form (ask Scout instead), pausing the whole team (S-07), buying credits (S-02).

---

### M-02 Employee page

- **Who:** owner, partner
- **Purpose:** Everything about one employee in one place: what they are doing now, their work, plan, routines and settings.
- **Get here:** M-01; the team line on Today (T-01); the avatar or name on any card or message (C-00); an employee named with @ in a conversation (T-03); a notification about this employee (G-03), which opens the relevant tab; "See Naledi" on a problem card (C-18); a new hire (M-08).
- **Leads to:** the tabs Desk (the employee's desk, D-01 to D-06), Plan (M-03), Schedule (M-04), Activity (M-05) and Settings (M-06); the direct chat (M-07); card viewers (C-xx); Needs you (T-05); the problem flow (X-08); back to M-01.
- **Shows:**
  1. Header:
     - identity (G-07): avatar, name, role, and the reporting line ("Reports to Maya"; Scout: "Reports to you");
     - status chip and status line;
     - the top decision waiting on you, if any, with the total count ("Waiting on you: approve the brand kit, and 1 more");
     - this week's credits against the weekly budget;
     - Message [name], always available.
  2. A problem line from Scout (C-18) above everything else when the employee is failing or stopped.
  3. The tabs: Desk (opens first), Plan, Schedule, Activity, Settings. For Scout the Plan tab shows the company plan.
- **Actions:**
  - Message [name] (owner, partner) -> M-07.
  - Switch tab (owner, partner). Keyboard: arrow keys across the tab list, Enter or Space to open. The chosen tab is remembered per employee (default).
  - Open the waiting decision (owner, partner) -> its card viewer (C-xx).
  - Resume (owner, partner), when paused by a person -> chip changes to working or free.
  - Restart (owner, partner), when stopped or failing, from any computer -> the team computer restarts the employee; chip "starting", then "working". When the team computer is off: "Restarts when Lerato's MacBook is back on."
  - Buy credits (owner only), when paused for credits -> the buy credits flow from S-02. Partner sees "Only Lerato can buy credits. We've let her know."
  - Raise budget (owner, partner), when paused at the weekly budget -> the money request card (C-16) for this employee.
  - Back to Team -> M-01. Keyboard: Escape when focus is not in a field (default).
- **States:** every employee state from the table above, with these differences:
  - Starting: the Desk tab shows "Naledi is getting ready." and nothing else; other tabs are empty with one line each.
  - First week, before the plan is approved: the Desk tab shows what the employee is studying ("Naledi is reading your Instagram and website.") and "Her first plan comes to you here and in Needs you." The Plan tab says "No plan yet."
  - Waiting on you: the header puts the decision first.
  - Paused (any reason): every tab stays readable and people can still approve drafts; the header says why and offers the fix for that reason.
  - Stopped or failing: the problem line (C-18) with Restart and "Ask Scout what happened" (opens T-03 with Scout).
  - Let go: read-only page with "Let go by Lerato on 3 Nov." Desk, Plan and Activity are readable; Schedule shows every routine as off; Settings is hidden; Message is hidden.
  - Team on another computer (X-13): everything works; Restart waits for the team computer, as described in shared behaviour 3.
  - Offline, loading, partner view: common rules.
- **Words:**
  - "Naledi is drafting next week's 5 posts."
  - "Waiting on you: approve the brand kit, and 1 more."
  - "Paused by Kagiso at 14:05. Resume when you're ready."
  - "Naledi ran into a problem and stopped. Restart her?"
  - "Out of credits. Naledi continues when credits are added."
- **Data:** Reads identity from the employee's profile (kind 0, WORKS), reporting line from member positions (kind 30648, WORKS), status and current task (E-13, PARTIAL), waiting decisions (E-06, PARTIAL), weekly credits and budget (E-15, PARTIAL). Writes restart (E-29, PARTIAL: the engine can restart an employee today, but crash recovery and plain problem lines are missing), pause and resume by a person (E-29 with E-12, MISSING: a paused employee keeps working today), the hand-off to buy credits (E-15).
- **Not here:** logs, technical health details, file locations, the AI provider or model behind the employee.

---

### M-03 Plan tab

- **Who:** owner, partner
- **Purpose:** Show the employee's current 2-week plan, how far along each part is, and let a person approve it or ask for changes.
- **Get here:** the Plan tab of M-02; "See in Naledi's plan" on a plan card (C-03); the company plan on Scout's desk (D-01), which links to each employee's plan; a "plan ready" notification (G-03).
- **Leads to:** the plan card viewer (C-03); results of plan items (card viewers, desk items); the direct chat with the plan quoted (M-07); the conversation where the plan was discussed (T-03); previous plans (this tab, read-only mode).
- **Shows:**
  1. Plan status, one of: "Waiting on you" (with Approve and Ask for changes); "Approved by Lerato on 13 Oct. Runs 13 to 26 Oct."; "Changes requested by Kagiso. A new version comes back here."; "No plan yet."; "This plan ended. The next one is on its way."
  2. The goal for these 2 weeks in one sentence, and how it serves the employee's job ("More customers and sales each month").
  3. Plan items grouped by week. Each item: plain title, status (not started, in progress, done, blocked, dropped), due day, a link to its result when there is one, and a "waiting on you" marker when a person must act.
  4. Progress: "5 of 9 done. On track." or "Behind: 2 items are late."
  5. What the employee will need from you during the plan (the "never alone" items that apply, for example "Prices for the bundle offer").
  6. Expected credits for the 2 weeks, compared with the weekly budget.
  7. Next plan: "Next plan due 27 Oct. Checked every Monday at 09:00."
  8. Previous plans: date range and one-line outcome ("8 of 10 done"), newest first.
- **Actions:**
  - Approve plan (owner, partner), when waiting -> same as approving the plan card (C-03); adds the "decided by" line; the employee starts the plan.
  - Ask for changes (owner, partner) -> a short note field; the employee revises and sends a new version; status shows who asked and when.
  - Open an item's result (owner, partner) -> its card viewer or desk item.
  - Talk about this plan (owner, partner) -> M-07 with the plan quoted.
  - Open a previous plan (owner, partner) -> the same tab in read-only mode, with "Back to current plan".
  - People do not edit plan items directly (default). They ask for changes and the employee rewrites the plan.
- **States:** no plan yet (first week: "Naledi's first plan comes after she has studied your business."); waiting on you; approved and running; behind; changes requested; ended with the next plan coming; employee paused ("Plan on hold while Naledi is paused."); let go (read-only); offline; loading.
- **Words:**
  - "5 of 9 done. On track."
  - "Approved by Lerato on 13 Oct."
  - "Changes requested by Kagiso. A new version comes back here."
  - "Week 2: start posting on TikTok, 3 times a week."
  - "This plan should use about $14 of credits."
- **Data:** Reads the plan document (E-08, PARTIAL: typed plan records are missing), its approval decision (kind 30643, WORKS), plan items as tasks under the employee's goal (work items kind 30634 and goals kind 30642, WORKS), expected credits (E-15, PARTIAL). Writes approval or a change request (kind 30643, WORKS). Plans created at hire time need E-10 (MISSING).
- **Not here:** editing items by hand, Gantt charts, long-term roadmaps.

---

### M-04 Schedule tab

- **Who:** owner, partner
- **Purpose:** Show the employee's routines in plain words with when each runs next, and let a person turn one off or change its time.
- **Get here:** the Schedule tab of M-02; "Morning brief, weekdays at 08:30" on a brief (C-19) (default); "See schedule" from a missed-routine line in While you were away (X-03).
- **Leads to:** M-02; the confirmation for turning off an important routine (X-16); Running settings (S-07) from the "computer on" note.
- **Shows:**
  1. Routines, each with: plain name ("Next week's posts"), when in plain words ("Every Monday at 10:00"), next run ("Next: Monday 20 Oct, 10:00"), the last run and its result ("Last: Monday 13 Oct. 5 posts drafted."), and on or off.
  2. Work without a routine, in one line: "Naledi also works when Maya or Scout asks, or when you message her."
  3. Time zone: "Times are Johannesburg time." (from S-01).
  4. A note when the team's computer may sleep: "Routines run while your team's computer is on." with a link to S-07.
- **Actions:**
  - Turn a routine off or on (owner, partner) -> saved at once with an undo toast (G-06). Turning off "Plan check" or Scout's "Morning brief" first asks for confirmation (X-16) and says what stops ("Naledi won't send new plans.").
  - Change time (owner, partner) -> choose days and a time in plain words; "Next" updates. Keyboard: the day and time choices work with arrow keys.
  - New routines are not added here. A person asks the employee or Scout, and the employee proposes the routine as a decision (C-01).
- **States:** normal; routine off ("Off since 14 Oct. Turned off by Lerato."); running now ("Running now"); missed while the computer was off ("Missed at 09:00 while your team's computer was off. Done at 09:40."); didn't finish ("Didn't finish: couldn't reach Instagram. Scout is looking into it."); employee paused (each routine shows "On hold while Naledi is paused"); let go (all off, read-only); offline (read-only); loading.
- **Words:**
  - "Next week's posts: every Monday at 10:00. Next: Monday 20 Oct."
  - "Missed at 09:00 while your team's computer was off. Done at 09:40."
  - "Off since 14 Oct. Turned off by Lerato."
  - "Times are Johannesburg time."
  - "Turn off plan check? Naledi won't send new plans."
- **Data:** Reads and writes routines as duties (kind 30655, WORKS: each runs a scheduled workflow with a time zone; the employee must be online within 15 minutes of the time), run history (PARTIAL), catch-up after sleep (E-14, MISSING). Routines created at hire time need E-10 (MISSING: a routine must name a source decision today).
- **Not here:** running a routine right now (ask in M-07 or a conversation instead), routines with conditions, any technical schedule format.

---

### M-05 Activity tab

- **Who:** owner, partner
- **Purpose:** A plain, newest-first record of what the employee did, so people can check their work without reading chats.
- **Get here:** the Activity tab of M-02; "See what Naledi did" in While you were away (X-03); links from Scout's desk (D-01).
- **Leads to:** each line's result (card viewers, desk items), the conversation where it was asked for (T-03), the direct chat (M-07).
- **Shows:**
  1. Lines grouped by day (Today, Yesterday, then dates).
  2. Each line: time; one plain sentence of what was done; a link to the result; why it happened ("Asked by Maya", "Routine: Next week's posts", "Asked by you in Spring launch"); and the credits that piece of work used (default).
  3. Filters: All, Results, Decisions, Problems.
- **Actions:**
  - Open a result (owner, partner) -> its viewer or desk item.
  - Filter (owner, partner). Keyboard: arrow keys across the filters.
  - Show older (owner, partner) -> loads the previous days.
- **States:** empty ("Nothing yet. Naledi's work shows up here as she goes."); normal; filtered with no results ("No problems this week."); let go (read-only history kept); offline (what was already loaded); loading.
- **Words:**
  - "09:40 Drafted 5 posts for next week. Routine: Next week's posts. $0.60"
  - "11:15 Asked Maya which offer to feature. Maya chose the linen bundle."
  - "Yesterday 16:02 Spring carousel marked as posted by Lerato."
  - "Couldn't open Instagram at 16:05. Tried again at 16:20 and it worked."
- **Data:** Reads a per-employee activity feed built from messages, task updates (kind 30634, WORKS), card status changes (E-08, PARTIAL), routine runs (kind 30655, WORKS) and credits per piece of work (E-15, MISSING: no usage per employee today). The feed itself needs E-13 (PARTIAL).
- **Not here:** step-by-step technical traces, logs, the employee's internal notes.

---

### M-06 Employee settings

- **Who:** owner, partner. Nothing here is billing.
- **Purpose:** Change how this employee is set up: name, photo, weekly budget, pause, restart or let go.
- **Get here:** the Settings tab of M-02; "Change budget" on a weekly budget raise (C-16) (default).
- **Leads to:** M-02; confirmations (X-16); M-01 after letting someone go; undo toasts (G-06).
- **Shows:**
  1. Name (editable) and role (fixed). Scout's name is not editable.
  2. Photo: a choice of built-in avatars or an uploaded picture (default).
  3. Weekly budget: the amount per week, used so far this week, a typical week for this employee, and what happens when it is reached ("Naledi pauses and Scout asks you whether to raise it.").
  4. Pause or Resume, with the current state.
  5. Restart, with one line on what it does ("Naledi picks up where she left off.").
  6. "Always asks you first" (read-only): the employee's never-alone list from their role (for Naledi: anything public, customer photos or names, prices).
  7. "Reports to" (read-only).
  8. Let go.
- **Actions:**
  - Rename (owner, partner; not Scout) -> the new name shows everywhere at once; undo toast.
  - Change photo (owner, partner) -> saved; undo toast.
  - Change weekly budget (owner, partner (default): it spends credits the owner has already bought, so it is not billing) -> saved; if the employee was paused at their budget and the new budget is higher, they continue.
  - Pause (owner, partner) -> the employee finishes the step they are on, then waits (default); chip "paused" with who and when; decisions they already sent stay open.
  - Resume (owner, partner) -> continues where they left off.
  - Restart (owner, partner; from any computer, carried out by the team computer) -> chip "starting", then back to work; memory and work are kept (default). When the team computer is off: "Restarts when Lerato's MacBook is back on."
  - Let go (owner, partner (default); not Scout) -> confirmation (X-16) that says what happens: the employee stops now; their drafts, posts and history stay readable under Former team members; decisions they sent are withdrawn; their routines stop; their conversations keep every message. After confirming, an undo toast stays for 10 seconds (default). To bring someone back later, ask Scout (a new hire).
- **States:** normal; Scout (no rename, no let go; Pause is replaced by "Scout runs the team, so pausing Scout pauses everyone. Pause the team in Settings." with a link to S-07) (default); paused; saving; save failed (problem message with retry); team computer off (Restart waits for it); offline (read-only); let go (hidden).
- **Words:**
  - "Weekly budget: $5.00. Used $3.40 this week."
  - "When Naledi reaches her budget she pauses and Scout asks you."
  - "Pause Naledi? She finishes what she's doing, then waits."
  - "Let Naledi go? She stops now. Her posts and history stay here."
  - "Scout runs the team, so pausing Scout pauses everyone."
- **Data:** Writes the name and photo to the employee's profile (kind 0, WORKS; photo upload through media upload, WORKS), the weekly budget (kind 30653, PARTIAL: written today, not enforced; enforcement is E-15), pause and resume (E-29, MISSING), restart (E-29, PARTIAL), letting go (removing the employee from the company and stopping them on the team's computer, PARTIAL; withdrawing their decisions needs E-06 and E-08; turning off their routines uses kind 30655, WORKS). Reads the never-alone list from the role pack (E-09, MISSING).
- **Not here:** changing the employee's role, instructions or skills (ask Scout), choosing an AI model, any billing.

---

### M-07 Direct chat

- **Who:** owner, partner
- **Purpose:** Talk to one employee directly, without Scout in the middle.
- **Get here:** "Message [name]" on M-02 or M-01; a notification about a reply in this chat (G-03); "Talk about this plan" on M-03; "Ask Naledi" links on desks.
- **Leads to:** card viewers (C-xx) for anything the employee shares; the employee page (M-02); Needs you (T-05); a topic conversation with Scout when the request needs more of the team (T-03).
- **Shows:**
  1. Who you are talking to: identity (G-07), status chip and status line.
  2. A standing line that explains the rule: "Just you and Naledi. Scout still sees any decisions so the team stays in step."
  3. Messages between people and the employee. Each person's message shows who wrote it (owner or partner). The employee's replies are usually 1 to 5 sentences.
  4. Cards (C-xx) inline, with their "decided by" lines.
  5. The composer, the same as in a conversation (T-03): text, voice note (T-07), attachments (T-08).
- **Actions:**
  - Send a message, voice note or attachment (owner, partner). Keyboard: Enter sends, Shift+Enter adds a new line (G-05).
  - Decide on a card inline (owner, partner) -> same as C-00.
  - Open a card viewer (owner, partner).
  - Bring in Scout (owner, partner) -> starts a topic conversation with Scout that quotes this chat (T-04 with context). The employee also offers this when a request needs others: "That needs Leo too. I'll bring Scout in."
  - Open [name]'s page (owner, partner) -> M-02.
- **Behaviour:** Scout is not in this chat. Decisions created here also appear in Needs you (T-05), and Scout is told about them and about any results, so briefs stay complete. There is one direct chat per employee, shared by the owner and partners (default).
- **States:** first time ("Ask Naledi anything about your social media. Scout still sees any decisions."); employee working ("Naledi is working on it."); employee paused, stopped or failing ("Naledi is paused. Your message waits until she's back." with Resume or Restart as fits); team paused (G-04 banner; messages wait); credits out (messages wait; owner sees Buy credits); let go (read-only: "Naledi is no longer on the team."); offline (messages wait and send when back); loading.
- **Words:**
  - "Just you and Naledi. Scout still sees any decisions."
  - Naledi: "Tuesday's carousel is ready. Want to see it?"
  - Naledi: "That needs Leo too. I'll bring Scout in."
  - "Naledi is paused. Your message waits until she's back."
- **Data:** A private conversation with the owner, partners and the employee as members (E-05, WORKS for owner-only; partners need E-19, PARTIAL, because an employee today only accepts direct messages from the owner). Decisions go to the Needs you index (E-06, PARTIAL) and typed cards (E-08, PARTIAL). Scout being told needs E-13 (PARTIAL).
- **Not here:** group chats with several employees (use a topic conversation with Scout), changing the employee's instructions.

---

### M-08 New hire starting

- **Who:** owner, partner
- **Purpose:** Show a newly hired employee getting set up after a hire proposal is approved, until their first week begins.
- **Get here:** approving a hire proposal (C-15) opens this screen; Scout's message "Leo is joining" in the conversation (T-03); the new employee's entry on M-01 while starting.
- **Leads to:** the new employee's page (M-02) when setup is done; the conversation with Scout (T-03).
- **Shows:**
  1. Who joined: identity (G-07), role, reporting line, weekly budget, and "Approved by Lerato, 10:42."
  2. Setup steps, each with done, in progress or failed: "Setting up on your team's computer", "Reading your business profile", "Saying hello to the team", "Starting the first week".
  3. What happens next: "Leo's first plan comes to you for a yes." and the first routines.
- **Actions:**
  - Go to [name]'s page (owner, partner) -> M-02. Opens by itself when setup finishes (default).
  - Message [name] (owner, partner), once setup is done -> M-07.
  - Try again (owner, partner), when a step failed -> repeats that step.
  - Cancel hire (owner, partner), while starting (default) -> confirmation (X-16), then the employee is removed and no further credits are used.
  - Ask Scout (owner, partner) -> T-03.
- **States:** in progress; done; failed ("Setup didn't finish: your team's computer went to sleep. It continues when it wakes." or another plain reason, with Try again); on another computer ("Setting up on Lerato's MacBook."); team's computer off ("Setup starts when Lerato's MacBook is on."); credits out ("Setup waits for credits."); offline; loading.
- **Words:**
  - "Leo, Website Builder, is joining your team." (example: a role skipped at setup)
  - "Setting up on your team's computer."
  - "Leo's first plan comes to you for a yes."
  - "Setup didn't finish: your team's computer went to sleep. It continues when it wakes."
- **Data:** Completes the hire (kind 30650, WORKS: completion needs the employee created on the team's computer and an intro message), creates the employee on the team's computer (WORKS in the current engine, to be moved out of the old UI: E-01), starts them at once with their goal and routines (E-10, MISSING), and reports setup progress (E-13, PARTIAL).
- **Not here:** choosing the role or name (that happens in the hire proposal, C-15), any payment.

---

### D-01 Scout's desk

- **Who:** owner, partner
- **Purpose:** Check how Scout is running the team: the company plan, what Scout decided without you, and every brief and Friday wrap.
- **Get here:** the Desk tab of Scout's page (M-02); "Past briefs" on Today (T-01); "See all briefs" on a brief card (C-19); Scout's entry on M-01.
- **Leads to:** the company plan viewer (C-03); each employee's plan (M-03); a past brief (C-19 viewer); the conversations a brief mentions (T-03); a new conversation with Scout to correct a call (T-03); Needs you (T-05); M-01.
- **Shows:**
  1. Company plan for the current 2 weeks: the company goal in one line, each employee's plan in one line with progress ("Naledi: 3 posts a week, 5 of 6 done"), and who approved it and when. If it is waiting on you, it comes first with Approve and Ask for changes.
  2. "What Scout handled on its own": newest first. Each entry shows when, what came up ("Naledi asked which photos to use for the linen carousel"), what Scout decided ("Picked the 3 studio shots you approved last week"), why in one line ("They match the brand kit you approved"), a link to where it happened, and "Not what I'd do".
  3. Brief history: morning briefs and Friday wraps, newest first, each with its date and its 1 to 5 sentences, with a filter for briefs or Friday wraps.
  4. Scout's routines in one line each (Morning brief, weekdays 08:30; Friday wrap, Fridays 16:00), linking to M-04.
  5. Team health in one line ("Everyone is working. 2 decisions are waiting on you."), linking to M-01 and T-05.
- **Actions:**
  - Approve the company plan or ask for changes (owner, partner) -> same as C-03.
  - Not what I'd do (owner, partner) -> a new conversation with Scout that quotes the entry; Scout replies, remembers the lesson, and the entry shows "Corrected by Lerato, 11:02".
  - Open a brief (owner, partner) -> C-19 viewer.
  - Filter briefs (owner, partner). Keyboard: arrow keys across the filter.
- **States:** first day (no briefs: "Your first morning brief arrives tomorrow at 08:30."; nothing handled yet: "When Scout answers something for the team without you, it shows here so you can check."); company plan waiting on you; normal; Scout stopped (X-09: "Scout has stopped. Restart Scout." with Restart on the team's computer); team paused; offline; loading.
- **Words:**
  - "Naledi asked which photos to use. I picked the 3 studio shots you approved last week."
  - "Not what you'd do? Tell me and I'll remember."
  - "Friday wrap: 14 things done, 3 waiting on you, $9.10 used this week."
  - "Your first morning brief arrives tomorrow at 08:30."
- **Data:** Reads briefs and Friday wraps (E-07, MISSING), the "handled on its own" log (E-07 with E-08, MISSING: no record of Scout's own decisions today), the company plan (E-08, PARTIAL, with its decision in kind 30643, WORKS) and team health (E-13 and E-06, PARTIAL). "Not what I'd do" starts a conversation (E-05, WORKS) and relies on Scout's lessons, which the engine keeps today.
- **Not here:** Scout's instructions or settings for how it manages (correct it by talking to it), raw message history between Scout and employees.

---

### D-02 Maya's desk

- **Who:** owner, partner
- **Purpose:** See whether the business is getting more customers and sales, which campaigns are running and who does what in them, and Maya's ideas.
- **Get here:** the Desk tab of Maya's page (M-02); "See the trend" on the numbers check-in (C-17); the growth plan (C-12); links in Friday wraps (C-19).
- **Leads to:** campaign detail (D-02a); documents (C-12); newsletter drafts (C-08); this week's numbers check-in (C-17); other desks from "who does what" (D-03, D-04, D-05, D-06); the direct chat (M-07); the conversation a campaign started in (T-03).
- **Shows:**
  1. This month's goal in one sentence and progress ("26 orders so far. On track for 40 in October.").
  2. Numbers, each with where it came from:
     - orders this week, from the Thursday answer ("You told us on Thursday");
     - money taken this week, if the person shared it;
     - new Instagram followers, if the person shared it;
     - website visits for the last 7 and 30 days, from the Colony website ("From your website");
     - a simple trend over the last 8 weeks, with weeks without an answer shown as "No answer".
  3. Campaigns: each with name, dates, goal, status (planned, running, paused, done), who does what ("Naledi: 9 posts. Leo: a spring page. Sipho: 10 boutiques. Grace: sale FAQ."), the next step, and the result once done.
  4. Ideas: one line each with the reason ("Bundle the linen set with a scarf at 10% off. Bundles sold best last month."), with status new, approved or parked.
  5. Newsletter drafts: draft, ready to send, sent.
- **Actions:**
  - Share this week's numbers (owner, partner) -> the numbers check-in (C-17).
  - Fix a number (owner, partner) (default) -> correct a past week's answer.
  - Open a campaign (owner, partner) -> D-02a.
  - Approve an idea (owner, partner) -> Maya turns it into a campaign or task. Approving an idea that names a discount or price counts as approving that discount or price, and the idea says so before you approve (default).
  - Park an idea or bring it back (owner, partner).
  - Open a newsletter draft (owner, partner) -> C-08 (copy, open in email app, mark as sent).
  - Message Maya (owner, partner) -> M-07.
- **States:** first week ("Maya asks for your numbers on Thursday. Website visits appear once your Colony website is live."); no Colony website (visits: "Visits appear when your website runs on Colony." with a link to D-05); website on Shopify or Wix (visits: "Visits from your Shopify site aren't connected yet." (default)); no numbers this week ("You didn't share numbers this week. Add them now?"); campaign behind; Maya paused; offline; loading.
- **Words:**
  - "26 orders so far. On track for 40 in October."
  - "Visits from your website: 412 this week, up 18%."
  - "You didn't share numbers this week. Add them now?"
  - "Idea: bundle the linen set with a scarf at 10% off. Bundles sold best last month."
  - "Spring launch runs until 31 Oct. Next: Leo's spring page goes live on Thursday."
- **Data:** Reads the month goal (kind 30642, WORKS), numbers from the Thursday answers (E-25, MISSING), website visits (E-20, MISSING), campaigns as goals with tasks (kinds 30642 and 30634, WORKS) plus typed campaign cards (E-08, PARTIAL), ideas as decisions (kind 30643, WORKS), newsletter drafts (E-08, PARTIAL).
- **Not here:** ad accounts, connected analytics, Shopify or Instagram data (not connected at launch).

### D-02a Campaign detail

- **Who:** owner, partner
- **Purpose:** One campaign from start to finish: its goal, who does what, the drafts and results, and what it achieved.
- **Get here:** a campaign on D-02; a campaign named in a brief (C-19) or a conversation (T-03).
- **Leads to:** card viewers for each draft and result (C-04, C-05, C-08, C-10, C-11, C-12); the employees' desks; the conversation where the campaign started (T-03); D-02.
- **Shows:**
  1. Name, goal, dates and status.
  2. Who does what: per employee, their tasks for this campaign and each task's status.
  3. Decisions waiting on you for this campaign.
  4. Drafts and results, newest first.
  5. Credits used by the campaign so far.
  6. After it ends: the result in a sentence or two ("31 orders during the campaign, 12 of them the bundle.").
- **Actions:**
  - Open a draft or result (owner, partner).
  - Pause campaign or resume it (owner, partner) (default) -> employees stop or restart their campaign tasks; other work goes on.
  - End campaign early (owner, partner) (default) -> confirmation (X-16); Maya writes the result.
  - Open the conversation (owner, partner) -> T-03.
  - Message Maya (owner, partner) -> M-07.
- **States:** planned (waiting on the plan's approval); running; behind; paused; done; offline; loading.
- **Words:**
  - "Spring launch: 1 to 31 Oct. Goal: 40 orders."
  - "Leo: spring page, ready for your OK."
  - "Paused by Kagiso. Naledi and Sipho stopped their spring tasks."
  - "31 orders during the campaign, 12 of them the bundle."
- **Data:** Goals and tasks (kinds 30642 and 30634, WORKS), typed drafts (E-08, PARTIAL), credits used (E-15, MISSING per employee and campaign), results (E-25, MISSING).
- **Not here:** paid ads, campaign budgets in money other than credits (any ad spend comes as a money request, C-16).

---

### D-03 Naledi's desk

- **Who:** owner, partner
- **Purpose:** Handle everything for social media: what is ready to post today, what is planned, the brand kit and the photos Naledi uses.
- **Get here:** the Desk tab of Naledi's page (M-02); the "Time to post" notification (G-03), which opens the matching post; "See in calendar" on a post, carousel or video script card (C-04, C-05, C-06); Needs you (T-05).
- **Leads to:** post, carousel, video script and image set viewers (C-04, C-05, C-06, C-07); the brand kit viewer (C-14); the photo library (D-03a); account names in Connections (S-04); the social app or website the person posts on (outside Colony); the direct chat (M-07).
- **Shows:**
  1. Ready to post: today's posts and any overdue ones first. Each shows the first image or slide, the start of the caption, the platform, the suggested time, and the "AI-made" label on any AI-made image, with the actions listed below.
  2. A reminder on any post with AI-made images: "This post has AI-made images. Turn on Instagram's AI label when you post it."
  3. Waiting on you: drafts to approve, including the Monday batch ("Next week's 5 posts").
  4. Content calendar, by week (opens first) or month. Each day shows its posts with a status: draft, ready to post, posted, skipped, missed. A filter by platform (Instagram, TikTok, Facebook).
  5. Brand kit summary: colours, fonts, logo, voice words, and who approved it and when.
  6. Photo library summary: "86 photos, 12 AI-made."
  7. Account names used for the "Open" actions: Instagram @leratodesigns, TikTok and Facebook names, editable in S-04.
- **Actions:**
  - Copy caption (owner, partner) -> copies the caption with hashtags; toast "Copied. Paste it into Instagram."
  - Save images (owner, partner) -> saves the post's images to the computer's Downloads folder; toast "Saved 5 images to your Downloads folder."
  - Open Instagram, TikTok or Facebook (owner, partner) -> opens the platform's website at the company's account (default).
  - Mark as posted (owner, partner) -> optional box to paste the post's link; status "Posted by Kagiso, 12:10"; Naledi is told.
  - Skip (owner, partner) -> optional reason; status "skipped"; Naledi learns from the reason.
  - Approve all (owner, partner), for a batch -> every draft in it is approved, each with the "decided by" line.
  - Open a draft to approve, ask for changes or change its day (owner, partner) -> its viewer (C-04, C-05, C-06). Changing the day is an action in the viewer, not only by dragging, so it works by keyboard (default).
  - Switch week or month, move between weeks, filter by platform (owner, partner). Keyboard: arrow keys move between days; Enter opens a post.
  - Open the brand kit (owner, partner) -> C-14.
  - Open the photo library (owner, partner) -> D-03a.
  - Message Naledi (owner, partner) -> M-07.
- **States:** first week ("Naledi is studying your Instagram and website. Your brand kit comes to you for a yes first."; calendar empty); brand kit waiting on you; batch waiting on you; normal; missed post ("Missed: Tuesday's carousel. Post it now or skip it?"); no account names yet ("Add your Instagram name so Open Instagram goes to your account." with a link to S-04); Naledi paused (drafts still approvable, no new drafts); offline (Copy caption still works; Save images works for images already on this computer; Mark as posted waits and sends when back); loading.
- **Words:**
  - "Time to post: the linen carousel for Instagram."
  - "Copied. Paste it into Instagram."
  - "This post has AI-made images. Turn on Instagram's AI label when you post it."
  - "Missed: Tuesday's carousel. Post it now or skip it?"
  - "Next week's 5 posts are ready. Approve all, or look one by one."
- **Data:** Reads and writes the content calendar and post statuses (E-24, MISSING), post drafts (E-08, PARTIAL), images (media upload WORKS; the library is E-31, MISSING), AI-made images (E-16, PARTIAL), time-to-post reminders (E-24 with E-26, PARTIAL), account names (business profile, E-04, MISSING).
- **Not here:** posting for the person (no social accounts are connected at launch), comments and messages from social apps (people paste them to Naledi or Grace), follower analytics (Maya asks on Thursdays).

### D-03a Photo library

- **Who:** owner, partner
- **Purpose:** Keep the photos Naledi and Leo may use: the company's real photos and AI-made images, always told apart.
- **Get here:** the photo library summary on D-03; "Photos" on Leo's desk (D-05); the brand kit (C-14); the business profile (S-01); photos dropped into any conversation are also added here (default), with a toast saying so.
- **Leads to:** the image set viewer for AI-made choices (C-07); the direct chat with Naledi with a photo attached (M-07); D-03.
- **Shows:**
  1. Add photos, by dropping files or choosing them. Accepted: JPG, PNG, HEIC and WebP, up to 50 MB each (default).
  2. Filters: All, Your photos, AI-made. Tags (for example "linen", "spring", "studio") to filter by.
  3. The photos. Each shows the "AI-made" label when it applies, its tags, where it is used ("Used in 3 posts"), and who added it and when.
  4. One photo open: a larger view, its tags, where it is used, and the photo actions below.
- **Actions:**
  - Add photos (owner, partner) -> upload with progress; Naledi suggests tags (default), which people can change.
  - Edit tags (owner, partner).
  - Don't use this (owner, partner) -> employees skip the photo from now on; it is marked "Not used".
  - Use in a post (owner, partner) -> opens M-07 with Naledi and the photo attached.
  - Delete (owner, partner) -> if the photo is used, a confirmation says where ("Used in 2 posts. Those posts keep their own copy."); then an undo toast.
  - Rule: an AI-made image can never be tagged or used as a product photo (rule 10).
- **States:** empty ("Add 10 to 20 photos of your products. Naledi and Leo use them in posts and on your website."); uploading; a file not accepted ("Couldn't add this file. Use a photo under 50 MB."); normal; filtered with no results; offline (adding waits until back); loading.
- **Words:**
  - "Add 10 to 20 photos of your products."
  - "AI-made. Never used as a product photo."
  - "Used in 3 posts."
  - "Couldn't add this file. Use a photo under 50 MB."
- **Data:** Upload through media upload (WORKS: images up to 50 MB, 30 uploads a minute). Library records with tags, "not used" and the AI-made flag (E-31, MISSING; AI-made images arrive through E-16). HEIC conversion (default) needs engine work under E-31.
- **Not here:** photo editing, photo shoots booking, stock photo search.

---

### D-04 Sipho's desk

- **Who:** owner, partner
- **Purpose:** See every deal from first contact to won, what needs a follow-up today, and the kinds of customers Sipho is looking for.
- **Get here:** the Desk tab of Sipho's page (M-02); "See all leads" on a lead list (C-11); an outreach or follow-up draft (C-08); links in Friday wraps (C-19).
- **Leads to:** lead detail (D-04a); lead list, message draft, document and invoice or quote viewers (C-11, C-08, C-12, C-13); the email app or WhatsApp on the computer (outside Colony); the direct chat (M-07).
- **Shows:**
  1. Today's follow-ups: each lead due a follow-up today, with its ready draft and the actions below.
  2. Waiting on you: new lead lists, drafts and quotes to approve.
  3. Deals by stage: New (found, not contacted), Contacted, Talking (they replied), Won, Lost, with a count per stage. Each lead shows its name, type of business, place, why it fits in one line, the last contact and the next step with its date.
  4. Target customers: the 2 or 3 kinds of customers Sipho hunts for ("Boutiques that stock local designers in Johannesburg and Cape Town", "Event companies that order branded clothing").
  5. This week: "12 new leads, 5 messages sent, 2 replies."
- **Actions:**
  - Copy message (owner, partner) -> toast "Copied."
  - Open in email (owner, partner) -> opens the computer's email app with the recipient, subject and message filled in (default).
  - Open in WhatsApp (owner, partner) -> opens WhatsApp with the message filled in for that number (default).
  - Mark as sent (owner, partner) -> "Sent by Kagiso, 11:20"; the lead moves to Contacted; Sipho plans the follow-up.
  - Later (owner, partner) (default) -> moves the follow-up to tomorrow.
  - Approve a lead list (owner, partner) -> C-11, choosing which leads to contact.
  - Open a lead (owner, partner) -> D-04a.
  - Move a lead to another stage (owner, partner) -> for Lost, an optional reason; for Won, Sipho offers a quote or invoice draft (C-13) with Grace.
  - Add a lead yourself (owner, partner) (default) -> name and where you heard of them; Sipho researches and drafts.
  - Edit target customers (owner, partner) -> Sipho confirms in M-07 ("Got it. From Tuesday I'll also look for corporate uniform buyers.").
  - Message Sipho (owner, partner) -> M-07.
- **States:** first week ("Sipho is looking for your first 20 leads." with the target customers waiting for your OK); no leads yet; normal; nothing due today ("No follow-ups due today."); Sipho paused; offline (Copy works; Open and Mark as sent wait for the connection where needed); loading.
- **Words:**
  - "3 follow-ups due today. Drafts are ready."
  - "Juniper and Jade: boutique in Rosebank. Stocks 4 local labels, no linen yet."
  - "Marked as sent by Kagiso, 11:20."
  - "12 new leads this week. 2 replied."
- **Data:** Leads and stages (E-23, PARTIAL: prospect records exist), drafts (E-08, PARTIAL), follow-up timing through routines (kind 30655, WORKS) and tasks (kind 30634, WORKS). Lead search uses the employee's own web research at launch; the planned search providers are not active (E-23).
- **Not here:** sending email for the person, reading the person's inbox, a full sales system with deal values and forecasts.

### D-04a Lead detail

- **Who:** owner, partner
- **Purpose:** Everything about one lead: who they are, why they fit, every contact so far and the next step.
- **Get here:** any lead on D-04; a row in a lead list (C-11).
- **Leads to:** message drafts (C-08); quotes (C-13); line sheets and price lists (C-12); the lead's website (outside Colony); the email app or WhatsApp; the direct chat with Sipho with this lead quoted (M-07); D-04.
- **Shows:**
  1. The lead: business name, type, place, website, contact person and how to reach them (email, phone or WhatsApp, Instagram), where Sipho found them, and why they fit in 2 or 3 sentences.
  2. Stage and next step with its date.
  3. History: every message sent (by whom, when, by email or WhatsApp, with the text), every reply pasted in, and notes.
  4. The next draft, ready to approve or send.
  5. Related documents: quote, line sheet, invoices.
- **Actions:**
  - Paste their reply (owner, partner) -> a box for the reply's text or a screenshot; Sipho reads it, moves the lead to Talking and drafts the next step.
  - Copy, Open in email, Open in WhatsApp, Mark as sent (owner, partner) -> as on D-04.
  - Change stage (owner, partner).
  - Add a note (owner, partner).
  - Edit contact details (owner, partner).
  - Not a fit (owner, partner) -> asks why; the lead moves to Lost and Sipho adjusts his search.
  - Ask Sipho (owner, partner) -> M-07 with this lead quoted.
- **States:** new; contacted ("Follow-up planned for Thursday."); talking; won; lost; no contact found ("Sipho couldn't find a contact. Know one? Add it here."); screenshot unreadable ("Sipho couldn't read this screenshot. Paste the text instead?"); offline; loading.
- **Words:**
  - "Found on their website. Stocks 4 local labels, none in linen."
  - "Sent by Lerato on 14 Oct by email."
  - "They replied: 'Send us your line sheet.' Sipho drafted one."
  - "Not a fit? Tell Sipho why and he'll adjust."
- **Data:** Lead record and history (E-23, PARTIAL), drafts and documents (E-08, PARTIAL), pasted screenshots through media upload (WORKS).
- **Not here:** calling from Colony, email tracking, contact syncing.

---

### D-05 Leo's desk

- **Who:** owner, partner. Hosting payment actions are owner only.
- **Purpose:** See the website as customers see it, what is about to change, what changed, and its address, visits and hosting.
- **Get here:** the Desk tab of Leo's page (M-02); "See site" on a website change (C-10); links in Friday wraps (C-19); the website domain in Connections (S-04).
- **Leads to:** the website change viewer (C-10); Connect your domain (D-05a); the live site in the browser (W-08); Credits and billing for hosting (S-02, owner only); the photo library (D-03a); Grace's knowledge, which feeds the FAQ page (D-06b); the direct chat (M-07).
- **Shows (site live):**
  1. Live preview of the site as customers see it, switchable between computer and phone, with "Open in browser".
  2. Changes waiting on you: each with what changes and which pages, and Make it live, Ask for changes, Decline.
  3. Pages: Home, Shop or Lookbook, About, Contact, FAQ and policies (kept in step with Grace's knowledge), and campaign pages, each with its status (live, draft, hidden) and last change.
  4. How people buy: each product links to the company's own payment link, its existing shop, or an order form that goes to Grace. There is no checkout on Colony sites.
  5. Change history: each change that went live, with date, who approved it and what changed, with Undo.
  6. Address and domain: the Colony address (leratodesigns.colony.site) and the own-domain status (not connected, connecting, connected, problem).
  7. Visits: last 7 days and last 30 days, and the most visited pages (default).
  8. Hosting: "$10 a month", status (active, payment problem, paused), next payment date.
- **Actions:**
  - Make it live (owner, partner) -> the change goes live; "Live. Approved by Lerato, 09:12" with Undo in a toast and in the history.
  - Ask for changes or Decline (owner, partner) -> as on C-10.
  - Undo a change (owner, partner) -> confirmation (X-16), then the previous version is live again.
  - Switch computer and phone preview (owner, partner). Keyboard: arrow keys across the two choices.
  - Open in browser (owner, partner) -> the live site (W-08).
  - Connect your domain (owner, partner) -> D-05a.
  - Set up hosting or manage the hosting payment (owner only) -> the hosting payment flow in S-02 and the payment pages (W-05). Partner sees "Only Lerato can set up hosting. We've asked her."
  - Start my site (owner, partner), when there is no Colony site -> Leo builds a first version as a preview.
  - Mark a Shopify or Wix change as done (owner, partner), for companies that keep their existing site.
  - Message Leo (owner, partner) -> M-07.
- **States:**
  - No Colony site yet: "You don't have a Colony website yet." with Start my site and one line on what happens ("Leo builds a first version. You see a preview before anything goes live.").
  - First week: "Leo is building your first version. You'll see a preview before anything goes live."
  - First site ready: the preview with Make it live. If hosting is not set up, Make it live explains "Your website needs hosting: $10 a month." The owner sees Set up hosting; a partner sees the read-only line and the owner is told.
  - Live: as above.
  - Going live: "Going live..." then live. Didn't go live: plain reason with Try again.
  - Domain connecting: "Waiting for your domain. This can take up to a day."
  - Hosting payment problem: "Your card was declined. Your site stays up until 20 Oct." Owner: Update card. Partner: read-only.
  - Site paused for an unpaid hosting bill: "Your website is paused. Visitors see a 'back soon' page." (W-09) Owner: Pay now.
  - Existing Shopify or Wix site: "Your site runs on Shopify." The desk shows Leo's suggested changes as drafts, each with Copy and where to paste it ("In Shopify: Online Store, then Pages, then About"), status to do or done, and the optional "Start a Colony site".
  - Leo paused; offline (preview of the last loaded version; Make it live and Undo wait); loading.
- **Words:**
  - "Your site is live at leratodesigns.colony.site."
  - "2 changes waiting: a new spring banner and a linen page."
  - "Live. Approved by Lerato, 09:12. Undo?"
  - "Visits: 412 this week, 1,630 in the last 30 days."
  - "Your card was declined. Your site stays up until 20 Oct."
  - "Only Lerato can set up hosting. We've asked her."
- **Data:** Everything about the website itself is E-20 (MISSING): building, preview, publish, history and undo, visits, the Colony address, own domains, the $10 monthly payment and the paused page. Website change drafts are typed cards (E-08, PARTIAL). The hosting payment uses Stripe through the company wallet and billing (E-15, PARTIAL). Pasted-change drafts for Shopify or Wix are documents (E-08, PARTIAL).
- **Not here:** a page editor for people (ask Leo), selling with a checkout, hosting the site yourself (hidden at launch), buying domains through Colony.

### D-05a Connect your domain

- **Who:** owner, partner
- **Purpose:** Walk a non-technical owner through pointing their own web address (for example leratodesigns.co.za) at their Colony website.
- **Get here:** "Connect your domain" on D-05; the website domain in Connections (S-04); Leo's message "Ready to use your own address?" (M-07 or T-03).
- **Leads to:** D-05 when done; the company's domain seller's website (outside Colony); the direct chat with Leo with this step quoted (M-07).
- **Shows, step by step:**
  1. "Do you have your own web address?" Yes leads to step 2. No: "Buy one from a domain seller first. Leo can suggest names." (Colony does not sell addresses at launch.)
  2. Enter the address, with a check that it looks right.
  3. "Where did you buy it?" A short list of common sellers and Other (default list: GoDaddy, Namecheap, Squarespace, Afrihost, Domains.co.za, xneelo). Picking one shows that seller's steps in plain words, with exactly two lines to copy, each with its own Copy action, and one sentence explaining them: "These two lines tell the internet where your website lives."
  4. Check now: Colony looks for the lines and shows waiting, found or a problem in plain words.
  5. Done: "leratodesigns.co.za now shows your website." with the secure padlock ready.
- **Actions:**
  - Copy each line (owner, partner) -> toast "Copied."
  - Open my domain seller (owner, partner) -> the seller's website.
  - Check now (owner, partner). Colony keeps checking on its own and tells the person when it works (default).
  - Ask Leo for help (owner, partner) -> M-07 with this step quoted.
  - Back, or Cancel (owner, partner) -> D-05, keeping what was entered.
  - Remove domain (owner, partner), once connected -> confirmation (X-16); the site goes back to the Colony address only.
- **States:** entering; waiting for the lines ("We're checking. This can take up to a day. We'll tell you when it works."); found and securing; connected; problem ("The line is there but points somewhere else. Check that it matches exactly."); removing; offline.
- **Words:**
  - "These two lines tell the internet where your website lives."
  - "Copy this, then paste it where your domain seller says 'Value'."
  - "We're checking. This can take up to a day. We'll tell you when it works."
  - "leratodesigns.co.za now shows your website."
- **Data:** Own domains, checks and secure certificates are part of E-20 (MISSING). The seller list and steps are static help kept with the app (default).
- **Not here:** buying a domain, email set-up on the domain, moving a domain between sellers.

---

### D-06 Grace's desk

- **Who:** owner, partner
- **Purpose:** Make sure every customer gets an answer and admin does not pile up: customer messages with replies ready, what Grace knows, and the admin list.
- **Get here:** the Desk tab of Grace's page (M-02); the "Customer waiting" notification (G-03); a customer reply card (C-09); links in Friday wraps (C-19); Needs you (T-05).
- **Leads to:** customer thread (D-06a); knowledge (D-06b); paste a customer message (D-06c); customer reply, decision, message draft and invoice or quote viewers (C-09, C-01, C-08, C-13); the forwarding address in Connections (S-04); the direct chat (M-07).
- **Shows:**
  1. Customer messages in three groups: To reply (each with its reply ready), Waiting on the customer, Done. Each shows the customer's name, where the message came from (forwarded email, pasted, screenshot, website form), the first line of their message, how long they have waited (flagged after 24 hours), and the reply's status.
  2. Decisions Grace needs from you: refunds, discounts and exceptions to your policies, as decision cards (C-01).
  3. Add a customer message: "Paste a message" (D-06c), and the forwarding address with Copy.
  4. Admin list:
     - invoices and quotes with status draft, sent, paid or overdue;
     - reminders with due dates;
     - supplier emails as drafts.
  5. Knowledge summary: "FAQ and policies: approved by Lerato on 12 Oct. 24 answers." linking to D-06b.
  6. How to forward, by email provider (Gmail, Outlook, Yahoo, Apple Mail, Other), in plain steps (default).
- **Actions:**
  - Open a customer (owner, partner) -> D-06a.
  - Approve a reply, then Copy, Open in email or Mark as sent (owner, partner) -> the customer moves to Waiting on the customer, or to Done when no answer is expected.
  - Paste a message (owner, partner) -> D-06c. Keyboard: pasting while Grace's desk has focus opens D-06c with the pasted content (default).
  - Copy forwarding address (owner, partner) -> toast "Copied."
  - Open knowledge (owner, partner) -> D-06b.
  - Invoice or quote (owner, partner) -> C-13: Download PDF, Copy email text, Mark as sent, Mark as paid.
  - Reminder (owner, partner) -> Done, or Later (tomorrow) (default).
  - Supplier email (owner, partner) -> C-08.
  - Message Grace (owner, partner) -> M-07.
- **States:** first week ("Grace is writing your FAQ and policies from your website. They come to you for a yes first."); forwarding not set up ("Forward customer emails to leratodesigns@inbox.colony.global and Grace drafts the reply." with the provider steps); no customer messages yet ("When customers write to you, forward the email or paste the message here. Grace drafts the reply."); customer waiting over 24 hours (flagged here and in a notification, G-03); a decision needed (shown first); Grace paused (replies already drafted can still be approved and sent); offline (Copy works; Mark as sent waits); loading.
- **Words:**
  - "Thabo asked where his order is. Reply ready."
  - "Nomsa has waited 26 hours. Answer her now?"
  - "Aisha wants to return a dress she wore once. Your policy says unworn only. Make an exception?"
  - "Invoice 014 for Brightway Events is 5 days overdue. Reminder drafted."
  - "Forward customer emails to leratodesigns@inbox.colony.global and Grace drafts the reply."
- **Data:** Customer messages and their status (E-22, MISSING), forwarded email (E-21, MISSING; the address shown is a sample until E-21 sets the real format), website form messages (E-20 with E-22, MISSING), reply, supplier email and invoice drafts (E-08, PARTIAL), decisions (kind 30643, WORKS), reminders as tasks (kind 30634, WORKS), knowledge (E-08 documents plus the business profile, E-04, MISSING).
- **Not here:** sending email or WhatsApp for the person, reading the person's inbox, an order or stock system, bookkeeping.

### D-06a Customer thread

- **Who:** owner, partner
- **Purpose:** One customer's messages, Grace's drafts and what happened, so a person can reply with confidence.
- **Get here:** a customer on D-06; "See Thabo's messages" on a customer reply card (C-09); the "Customer waiting" notification (G-03).
- **Leads to:** the reply viewer (C-09); an exception decision (C-01); the policy Grace used (D-06b); an invoice or quote for this customer (C-13); the email app or WhatsApp; the direct chat with Grace with this customer quoted (M-07).
- **Shows:**
  1. The customer: name, how they reached you (email, WhatsApp, Instagram, Facebook, website form), and their contact details.
  2. Messages in order: the customer's messages with where each came from (and the original screenshot when one was pasted), the replies sent (who sent it, when), and Grace's notes.
  3. The reply ready to go: the text, the policy it is based on ("Based on: Returns policy"), and the actions below.
  4. Status: To reply, Waiting on the customer, or Done.
- **Actions:**
  - Approve the reply, then Copy, Open in email or Mark as sent (owner, partner).
  - Ask for changes (owner, partner) -> a note; Grace redrafts.
  - Write my own reply (owner, partner) -> a box for the person's own reply; Grace keeps it as the reply sent once marked as sent, and learns the tone (default).
  - Add their new message (owner, partner) -> D-06c for this customer.
  - Mark done or Reopen (owner, partner).
  - Ask Grace (owner, partner) -> M-07 with this customer quoted.
- **States:** to reply; waiting on the customer; done; needs a decision ("Aisha wants to return a dress she wore once. Your policy says unworn only. Make an exception?"); screenshot unreadable ("Grace couldn't read this screenshot. Paste the text instead?"); offline; loading.
- **Words:**
  - "From Thabo by email, 09:14: 'Hi, where is my order?'"
  - "Based on your delivery policy: 3 to 5 working days in Gauteng."
  - "Sent by Kagiso, 10:02."
  - "Grace couldn't read this screenshot. Paste the text instead?"
- **Data:** Customer record and messages (E-22, MISSING), forwarded emails (E-21, MISSING), drafts (E-08, PARTIAL), screenshots through media upload (WORKS).
- **Not here:** order tracking, delivery company look-ups, customer accounts.

### D-06b Knowledge

- **Who:** owner, partner
- **Purpose:** Everything Grace knows to answer customers: policies, the FAQ and product facts, which people can check and correct.
- **Get here:** "Open knowledge" on D-06; "Based on: Returns policy" in a customer thread (D-06a); the FAQ and policies document (C-12); the business profile (S-01) (default).
- **Leads to:** the FAQ document viewer (C-12); Leo's desk when the website's FAQ page needs updating (D-05); the direct chat with Grace (M-07).
- **Shows:**
  1. Policies: Delivery, Returns and exchanges, Sizes and fit, Payment, Changing an order (default list), each with its text, who changed it last and when, and whether it is approved.
  2. FAQ: questions and answers.
  3. Product facts: materials, care, sizes per range, and prices. Prices are shown here, but only people change them (prices are on every employee's never-alone list).
  4. Where it is used: "Used in replies and on your website's FAQ page."
- **Actions:**
  - Edit (owner, partner) -> change the text; Grace confirms ("Got it. I'll use this from now on."). When the website shows that text, Leo prepares a website change (C-10) for approval (default).
  - Add a question and answer (owner, partner).
  - Remove (owner, partner) -> undo toast.
  - Ask Grace to draft a policy (owner, partner) -> M-07.
- **States:** first week (Grace's first draft waiting on you); approved; changed but the website still shows the old version ("Your website still shows the old returns policy. Leo has an update ready."); empty; offline (read-only); loading.
- **Words:**
  - "Returns: unworn items within 14 days, with the tag on."
  - "Changed by Lerato on 15 Oct."
  - "Your website still shows the old version. Leo has an update ready."
  - "Got it. I'll use this from now on."
- **Data:** Policies, FAQ and product facts stored as approved documents (E-08, PARTIAL) alongside the business profile (E-04, MISSING). Keeping the website in step uses E-20 (MISSING).
- **Not here:** legal templates, terms of sale generators.

### D-06c Paste a customer message

- **Who:** owner, partner
- **Purpose:** Get a customer message from WhatsApp, Instagram or anywhere else into Colony so Grace can draft the reply.
- **Get here:** "Paste a message" on D-06; "Add their new message" on a customer thread (D-06a); pasting while Grace's desk has focus; saying "this is a customer message" about a pasted screenshot in a conversation, after which Scout passes it to Grace (default).
- **Leads to:** the customer thread (D-06a), new or existing.
- **Shows:**
  1. A box for the message's text, or a dropped or pasted screenshot.
  2. Who it is from: name, and contact details if known.
  3. Where it came from: WhatsApp, Instagram, Facebook, Email, Other.
  4. A match with an existing customer, when there is one ("Looks like Thabo Nkosi. Add it to his messages?").
- **Actions:**
  - Add (owner, partner) -> the message joins the customer's thread and Grace starts drafting.
  - Use the match or make a new customer (owner, partner).
  - Cancel (owner, partner) -> back where it was opened. Keyboard: Escape.
- **States:** empty; reading a screenshot ("Reading the screenshot..."); screenshot unreadable ("Grace couldn't read this screenshot. Paste the text instead?"); matched customer; offline (the message waits and is added when back).
- **Words:**
  - "Paste the message or drop a screenshot."
  - "Looks like Thabo Nkosi. Add it to his messages?"
  - "Grace is drafting a reply."
- **Data:** Customer records (E-22, MISSING), screenshots through media upload (WORKS), the draft (E-08, PARTIAL).
- **Not here:** importing whole chat histories, connecting WhatsApp or Instagram (not at launch).

---

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. Items marked "Decided by the owner" were answered on 11 October.

1. **Can partners let an employee go?** Recommendation: yes, with the confirmation in M-06. Partners can already approve hires, and someone let go can be hired again through Scout.
2. **Can partners change an employee's weekly budget?** Recommendation: yes. It only spends credits the owner already bought; buying credits stays owner only.
3. **Direct chats: one shared chat per employee, or a private one per person?** Recommendation: one shared chat per employee, each message showing who wrote it. It matches "partners see every conversation" and keeps Scout's picture complete.
4. **Scout can't be let go, and pausing Scout pauses the whole team.** Recommendation: keep both rules, because Scout is the one voice and runs the team.
5. **Default routine times:** Friday wrap Fridays 16:00, Maya's numbers question Thursdays 10:00, Sipho's follow-ups weekdays 08:00, and Grace's customers-waiting check every day at 08:00 including weekends. Recommendation: keep them; anyone can change a time in M-04.
