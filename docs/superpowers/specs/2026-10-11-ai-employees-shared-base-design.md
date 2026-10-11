# AI employees: shared base (design)

- Date: 11 Oct 2026
- Status: approved by the owner (sections A to D in chat, written spec on 11 Oct). Revised the same day after a code check: built in two phases (owner decision), Phase 1 now, Phase 2 (allowance enforcement) right after.
- Sub-project 1 of 8: shared base, Scout, Engineer, Growth Marketer, Social Media Manager, Sales Director, onboarding, landing page

## Why

Colony launches to tech startup founders who already pay for Claude or Codex. Colony is their whole startup team. The owner's rule for every employee:

> "AI Employees that take initiative and do real meaningful and impactful work, and not chatbots that need extensive prompting and management"

This base gives every employee the same voice, the same role pack format and the same way of starting work on its own. Each role (Scout, Engineer, Growth Marketer, Social Media Manager, Sales Director) then gets its own design for native screens, skills and capabilities, built on this base.

## Owner decisions this spec carries

1. Audience: tech startup founders on Claude or Codex. The non-technical owner version is not approved.
2. Team setup: a catalog of pre-built employees to hire, plus custom employees for experienced users.
3. Roles: Chief of Staff (Scout), Engineer, Growth Marketer, Social Media Manager (reports to Growth Marketer), Sales Director.
4. Initiative approach A: each role owns a job, ships with default duties and an on-hire routine.
5. Social and Sales launch in draft mode (the final post or email is one founder click); real APIs come after.
6. Agents talk short, concise and conversational, never long reports: usually 1 to 5 sentences, longer only when the situation needs it (not a hard cap).
7. Each role gets its own design (native experience, skills, capabilities). This base only provides the slots.
8. Everything reaches the founder through Scout unless the founder addresses an employee directly (Scout design, sub-project 2).
9. Build in two phases: Phase 1 makes employees run and work; Phase 2 enforces allowances.

## What the code check found (11 Oct)

- A hire creates the agent with auto-start off, nothing triggers its first turn, and an agent subscribes from "now", so a wake-up sent while it is offline is lost.
- Two hiring bugs: the desktop hire parser rejects a hire head once the relay adds the employee `p` tag (`companyHireModels.ts:288`), and persona `company_role` is dropped on save because `ManagedAgentRecord` has no such field (`desktop/src-tauri/src/managed_agents/types.rs:320-573`, `into_agent_record` 197-259). Also `defaultAllowance` is never carried into a proposal.
- A duty head must name a source ask (`crates/buzz-core/src/company_duties.rs:169-189`); a direct hire has none.
- Agents receive no role context (title, job, goal, limits, manager).
- Allowance enforcement needs machinery that does not exist (see Phase 2).
- No restart button on the employee profile; no employee to home channel mapping; no per-agent working folder.

## Scope

Phase 1 (this build): voice rule, role pack v2, the hiring bug fixes, role context for agents, hire completion that creates the goal and duties, employees that start with the app and get an on-hire kickoff, missed wake-up catch-up, home tab and profile section, restart button, per-employee work folder, proof gate.

Phase 2 (next build): allowance enforcement.

Out (later sub-projects): the content of each built-in role pack, each role's screens and skills, Scout's routing and desk, social posting and email sending APIs, onboarding and landing changes, cloud-run employees.

## A. Voice (all agents)

A new single-source file `crates/buzz-acp/src/voice.md`, exported as `VOICE_RULES` and joined into `DEFAULT_BASE_PROMPT` between `base_prompt.md` and `web_tasks.md`, the same pattern as the web rules. The desktop nest skill and the managed `AGENTS.md` section include the same text.

Rules:

1. A reply is usually 1 to 5 sentences, result first, written like a teammate in chat. It may be longer when the situation truly needs it, which should be rare. This is a default, not a forced cap.
2. No headings, tables or bullet walls in chat. Code blocks and links are fine.
3. Long things (plans, research, drafts) go into a work item, canvas or doc. The chat gets one line plus a link.
4. One question at a time. A decision becomes an ask card with a one-sentence summary.
5. One pickup line, then only results or blockers. Step-by-step work shows in the activity panel, not in chat.

Existing lines that change: `base_prompt.md` line 81 ("Use GitHub-flavored Markdown") becomes Markdown for code blocks and links only; line 123 ("narrate as you go in brief messages") becomes rule 5; `desktop/src-tauri/src/managed_agents/nest_skill.md` lines 143-148 (Markdown tables and headings) align with rule 2, with a `NEST_SKILL_VERSION` bump.

Example:

- Bad: "## Weekly Growth Report ### Summary - Signups increased by 12%..."
- Good: "Signups up 12% this week, mostly from the HN post. Do another one Thursday?"

## B. Role pack v2

Today a role pack has `personaId`, `title`, `job`, `skills`, `tools` (name and risk), `workerMenu` and `defaultAllowance`.

New optional fields:

| Field | Meaning | Engineer example |
|-|-|-|
| `owns` | The outcome the role owns, used as its goal | "Ship fixes and roadmap items every week" |
| `channel` | Default home channel name | `engineering` |
| `duties` | Default duties: title, readable schedule, instructions | "Every day at 09:00": triage #bugs and GitHub issues |
| `onHire` | Sources to study and the plan horizon (default 14 days) | code folder, open issues |
| `askBefore` | Actions that always need the founder | merge, deploy |
| `home` | The role's native screen id | `engineer.prs` |
| `workFolder` | `none`, `optional` or `required` | `required` |

Decisions:

- The fields are additive and optional, with no schema version bump. Old packs still parse. Desktops at 1.0.7 or older reject records that carry new keys (their parsers reject unknown keys), so founders need the new desktop to see such hires.
- Rust: `HireRolePack` (`crates/buzz-core/src/company_records.rs:686-704`) and the Tauri `CompanyRoleMetadata` (`desktop/src-tauri/src/managed_agents/types.rs:22-32`) gain the fields and validation. TypeScript: the role pack parser and `companyHireRolePackFromPersona` (`desktop/src/features/company-hiring/companyHireModels.ts`), which stops rejecting built-in personas that carry a company role and starts copying `defaultAllowance`.
- Built-in packs: `BuiltInPersona` (`desktop/src-tauri/src/managed_agents/personas.rs:7-16`) gains a company role, and `merge_personas` refreshes built-in roles from code on every load. Phase 1 ships no production pack; a "Test Engineer" fixture pack exists only when `COLONY_FIXTURE_ROLE_PACKS=1`. Each role design adds its real pack.
- Custom packs are created in the app as today; no persona pack file format change.
- Hire review shows the job, `owns`, duties and `askBefore`. The founder's signature on the hire approves them.

## C. On-hire routine and work loop

1. **Hire completes.** In the relay transaction that completes the hire (`crates/buzz-relay/src/handlers/company_hires.rs:357-430`), the relay also creates the employee's goal (root goal from `owns`, owned by the employee, linked to the home channel) and its duties, each with its schedule workflow, plus a built-in "Plan review" duty ("Every Monday at 09:00"). All or nothing. Duty heads gain a hire source (`sourceHireId`) as the alternative to a source ask. The founder's time zone travels with the Complete action.
2. **Employee starts.** The desktop creates the employee with start-on-launch on and starts it after completion. The relay posts a workflow-tagged on-hire kickoff in the home channel, so the agent's existing author gate accepts it.
3. **Role context.** The desktop stores a role context on the employee (title, job, owns, ask-before list, manager, home channel, goal, on-hire sources, plan horizon) and passes it as `COLONY_ROLE_CONTEXT`; `buzz-acp` adds a `<colony-role>` block to the agent instructions, the same pattern as the business profile.
4. **Studies and plans.** The employee reads the business profile and its on-hire sources (workers do the heavy reading), writes the 2-week plan into its home channel canvas and sends it to its manager. A human manager gets an `Approval` ask; when Scout is the manager, Scout brings it to the founder (Scout design).
5. **Works on its own.** After approval it creates the plan's work items under its goal (`colony work`; members may create and self-assign) and starts. Duties, @mentions and manager briefs wake it. It posts one-line results with links and asks only at its `askBefore` limits.
6. **Missed wake-ups.** When an agent starts, it processes mentions and duty wakes that arrived while it was offline, once each, instead of subscribing from "now".
7. **Plan refresh.** The "Plan review" duty checks the plan every Monday; at 14 days old the employee sends the next plan.

Known v1 limit: `askBefore` is enforced by the prompt plus tool consent for tools rated risky. A general shell command cannot be fully fenced.

## D. Home tab, profile, work folder, errors

- **Home tab.** A channel is an employee's home when one of its bot members has a hire head whose `introductionChannelId` is this channel (hire heads are found by the employee `p` tag). There the work area dock offers a "Home" tab for that employee (`desktop/src/features/workarea/dock/workAreaTabRegistry.tsx`). Until a role design fills it, it shows real data: the goal, the employee's open work items and its duties with next run.
- **Profile.** The employee profile overview (`desktop/src/features/company-team/ui/EmployeeProfileScreen.tsx`) shows the same summary and gains a Restart button wired to the existing runtime restart.
- **Work folder.** The employee record gains an optional working folder; the runtime starts that employee there (`desktop/src-tauri/src/managed_agents/runtime.rs:601-604`) and a change marks the employee as needing a restart. The hire configure step offers a folder picker when the pack's `workFolder` is `optional` or `required`.

| Case | Behavior |
|-|-|
| Plan rejected | The employee revises it with the founder's note and sends it again |
| Missing source (no code folder, no website) | One question, then it continues with what it has |
| Crash or stuck | Scout flags it; the founder presses Restart on its profile |
| Laptop off or app closed | Missed duties catch up once (existing scheduler catch-up) and missed wake-ups are processed at start |
| Goal or duty creation fails | The hire does not complete; nothing partial is stored |

## Testing and proof gate (Phase 1)

1. Contract tests: role pack v2 in Rust (core and Tauri) and TypeScript; old packs still parse; built-ins with a role reach the catalog; `defaultAllowance` survives; `company_role` survives a save and reload; a hire head with the employee `p` tag parses.
2. Prompt tests: the voice rules reach every framed system prompt exactly once, before the agent instructions; no em dashes; brand guard passes; the nest skill version is bumped; the role block appears only when `COLONY_ROLE_CONTEXT` is set.
3. Relay PostgreSQL tests: completing a hire creates the hire, goal, duties and workflows together; a failure creates none; the kickoff is published once with the workflow tags.
4. Desktop e2e (smoke and integration projects): the catalog shows the fixture pack; review shows job, owns, duties and limits; the Home tab appears only in the home channel; Restart works.
5. Real-run gate (packaged app, clean profile, real Claude Code, `COLONY_FIXTURE_ROLE_PACKS=1`): hire the Test Engineer on a test repo with no prompting. Within 5 minutes it posts an intro and sends its plan. After approval a duty run leads to a PR on the test repo. Quit and reopen the app while a duty fires: the missed wake is processed once. Replies measured: at least 9 in 10 are 5 sentences or fewer, and none is a report.

## Phase 2: allowance enforcement (next build)

Found missing on 11 Oct: spend is only recorded while the founder's Spend screen is open (`desktop/src/features/power/spendRelay.ts:178-304`); nothing reads spend per week on the relay; a paused employee keeps working and there is no resume; the relay cannot create asks; Colony credits turns and Codex turns are not priced in the ledger. Phase 2 adds background spend sync, a relay check when spend is recorded (effective allowance from the 30653 head, else the hire value), pause enforcement in the runtime, a resume action, and exactly one raise ask per employee per week. It gets its own short design and plan.

## Rollout

- Relay first, then desktop. No feature flag: the mechanism is invisible until packs exist, and the voice rule is a prompt change.
- Desktops at 1.0.7 or older skip hire and duty records that carry new keys.

## Next

Scout design (sub-project 2, in progress), then Engineer, Growth Marketer, Social Media Manager, Sales Director, onboarding and the landing page last.
