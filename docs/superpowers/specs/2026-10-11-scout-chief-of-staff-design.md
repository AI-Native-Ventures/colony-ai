# Scout, Chief of Staff (design)

- Date: 11 Oct 2026
- Status: design approved in chat section by section (1 to 4); this written spec awaits owner review
- Sub-project 2 of 8. Builds on the shared base, Phase 1 (`2026-10-11-ai-employees-shared-base-design.md`)

## Why

Scout runs the founder's AI team so the founder does not have to manage each employee. It turns the founder's goals into briefs, keeps work moving, and brings the founder only what truly needs them, in short conversational messages.

## Owner decisions (11 Oct 2026)

1. Scout's main job: runs the team. It turns goals into briefs, chases progress, unblocks employees, proposes hires, and brings the founder decisions plus a short daily brief.
2. Routing: everything reaches the founder through Scout, unless the founder addresses an employee directly; then that employee answers the founder there.
3. Scout lives in Today (its desk), in a Scout chat, and in any channel by @mention.
4. "Things that need me get to me": no batching delay for real decisions. Scout never runs big things on its own. Whatever the founder asked for, only Scout talks to them about it.
5. Owner plus co-founders and admins can talk to Scout. Decisions keep the existing owner and admin rules.
6. Voice from the shared base: usually 1 to 5 sentences, conversational, never reports.

## Scout today (code check, 11 Oct)

- Persona `builtin:fizz` "Scout" (`desktop/src-tauri/src/managed_agents/personas.rs:37-47`), prompt `desktop/src/features/onboarding/assets/scout-instructions.txt`, business profile added by `desktop/src/features/onboarding/scoutPersona.ts:4-14`.
- Only reacts to messages; the harness heartbeat setting (`crates/buzz-acp/src/config.rs:305-329`) is never set.
- Lives only in the private Welcome channel (`desktop/src/features/onboarding/welcomeGuide.ts:199-264`), owner-only, manual start.
- Its first message is posted by the app from a template or the connection test reply (`desktop/src/features/onboarding/welcomeKickoff.ts:69-70, 186-207, 754-764`), not by a Scout turn.
- No code where Scout assigns work, resolves asks or summarizes the team. `colony team list` returns titles only; runtime status lives only in desktop UI (`employeePresentation.ts:15-46`).
- Work watchdog check-ins are relay-signed messages without workflow tags (`crates/buzz-relay/src/handlers/company_work_watchdog_worker.rs:371-421`), so the agent author gate (`crates/buzz-acp/src/lib.rs:258-331`) drops them.
- Direct messages are accepted only from the owner or same-owner agents (`crates/buzz-acp/src/lib.rs:392-405`), so an admin cannot DM Scout.
- Today (`desktop/src/features/home/ui/TodayScreen.tsx`) shows Needs me (`needsMeHooks.ts:116-143`) and Moving forward; nothing writes a Scout brief.

## 1. Authority

| Scout does alone (inside plans the founder approved) | Scout brings to the founder |
|-|-|
| Briefs employees, splits work, assigns work items | Every employee's 2-week plan (Scout's one-line summary plus Approve) |
| Chases progress, unblocks, reorders work | Hiring, raises, anything with money |
| Answers employees' questions when it can | Anything public: posts, emails, merges, deploys |
| Checks employees' work before reporting it | Changes to priorities or goals |
| Proposes hires from the catalog, as hire asks | Something going wrong: an employee failing, work stuck |

- Single point of contact: employees send questions, plans and asks to Scout (their manager). Scout answers within its authority or raises one ask to the founder with one line of context and a link.
- Tool consent prompts for risky tools still go straight to the founder; an agent cannot approve them.
- Asks only an owner or admin may resolve (money, hire, tool, secret, duty) are forwarded, never resolved by Scout (already enforced by the relay).

## 2. Where Scout lives

- **Today is Scout's desk**, in this order: Scout's brief (1 to 5 sentences, always the latest), Needs you (decisions Scout raised plus the existing owner and admin asks), a team strip (each employee: what it is working on, blocked, paused, or waiting on you), and a box that opens the Scout chat.
- **Scout chat**: one private direct chat per person (owner, each co-founder or admin), pinned at the top of Conversations.
- **Any channel**: Scout is a member of every channel and answers @mentions there. Unprompted, it only speaks in a channel to brief or chase an employee.
- **Access**: owner plus admins.

## 3. Rhythm and waking

- Event-driven wakes:
  - an employee mentions Scout or sends it a plan, question or blocker;
  - a work watchdog check-in (no update, overdue, blocked) addressed to Scout;
  - an ask Scout raised is resolved;
  - the owner or an admin messages Scout.
- One scheduled duty: "Morning brief", every weekday at 08:30 in the founder's time zone. It writes the brief (what moved, what is blocked, what needs you) to the Scout chat and the top of Today.
- Decisions reach the founder when they arise, with no batching delay. Related items that arrive together become one ask.
- Urgent (work blocked, an employee failing, money at risk) also raises a desktop notification.

## 4. Skills, capabilities, first run

- **Prompt and skill.** Rewrite Scout's instructions for the Chief of Staff job and the voice rules. Add a bundled chief-of-staff skill that teaches the `colony` goals, work, asks, team and duties commands, how to brief an employee (goal, done condition, deadline, who to ask), how to forward to the founder (one line plus an ask), and when to escalate.
- **Team status.** A read capability (`colony team status`) that returns, per employee: title, status (active or paused), current work item, last activity, and open asks waiting on the founder. Built from relay records (member heads, work items, asks), read only.
- **Every channel.** The founder's app adds Scout to every channel it can see, including existing ones, and to new channels as they appear. Direct chats are excluded except Scout's own.
- **Admin access.** Scout's respond-to allowlist is kept in sync with the community's owner and admin roles. The agent author gate accepts direct messages from allowlisted people for Scout (today direct messages are owner-only).
- **Brief record.** Scout's brief is a message in the Scout chat tagged `colony:brief`; Today shows the latest one.
- **Watchdog wakes.** Work watchdog check-ins addressed to Scout carry the workflow tags (owner = founder, mention = Scout) so the author gate accepts them.
- **Ask resolution wakes.** When an ask Scout raised is resolved, Scout is woken in that thread.
- **First run.** Scout's first message is a real Scout turn, replacing the app template: it welcomes the founder by name, reads the startup profile, proposes starter hires from the catalog as hire asks, and asks what to work on first.

## Errors

| Case | Behavior |
|-|-|
| Founder's computer off or app closed | Today shows Scout as offline; missed wakes are processed at start (shared base) |
| Scout is wrong | The founder corrects it in chat; Scout records the lesson (existing lessons) |
| An ask only an owner or admin may resolve | Scout forwards it and never resolves it |
| An employee keeps failing | Scout raises one urgent ask with the failure and a Restart link (shared base) |
| Scout itself crashes | Today shows Scout as stopped with a Restart button |

## Testing and proof gate

1. Unit: team status read model; allowlist sync from roles; author gate accepts allowlisted direct messages for Scout and still rejects others; watchdog check-in tags; brief tag parsing in Today.
2. Desktop e2e (smoke and integration): Today desk renders the brief, Needs you, the team strip and the chat box; Scout chat pinned; Scout added to a new channel.
3. Real-run gate (packaged app, clean profile, real Claude Code, fixture pack from the shared base): Scout's first message is a real turn that proposes the Test Engineer; hire it; the employee sends its plan to Scout; Scout raises exactly one ask to the founder; approve it in Today; Scout tells the employee; a watchdog check-in wakes Scout; an admin DM reaches Scout; replies measured as in the shared base.

## Out of scope

Mobile Scout, cloud-run Scout, WhatsApp, inbox and calendar, and the content of the other roles' packs.

## Rollout

After shared base Phase 1. Relay first (watchdog tags, team status, ask resolution wake), then desktop and harness.
