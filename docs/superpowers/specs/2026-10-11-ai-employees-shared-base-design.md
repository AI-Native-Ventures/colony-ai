# AI employees: shared base (design)

- Date: 11 Oct 2026
- Status: design approved in chat section by section (A, B, C, D); this written spec awaits owner review
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

## Scope

In: voice rule for all agents, role pack v2 format, hire that approves duties, on-hire routine, work loop, home screen slot, per-employee work folder, proof gate.

Out (later sub-projects): the content of each built-in role pack, each role's screens and skills, social posting and email sending APIs, onboarding and landing changes, cloud-run employees.

## A. Voice (all agents)

A new section "How you talk" in `crates/buzz-acp/src/base_prompt.md`, the shared prompt every managed agent loads. One copy only, the same pattern as `web_tasks.md`.

Rules:

1. A reply is usually 1 to 5 sentences, result first, written like a teammate in chat. It may be longer when the situation truly needs it, which should be rare. This is a default, not a forced cap.
2. No headings, tables or bullet walls in chat. Code blocks and links are fine.
3. Long things (plans, research, drafts) go into a work item, canvas or doc. The chat gets one line plus a link.
4. One question at a time. A decision becomes an ask card with a one-sentence summary.
5. One pickup line, then only results or blockers. Step-by-step work shows in the activity panel, not in chat.

Existing lines that change in the same file:

- "Use GitHub-flavored Markdown" (line 81) becomes Markdown for code blocks and links only.
- "narrate as you go in brief messages" (line 123) becomes rule 5.

Example:

- Bad: "## Weekly Growth Report ### Summary - Signups increased by 12%..."
- Good: "Signups up 12% this week, mostly from the HN post. Do another one Thursday?"

## B. Role pack v2

Today a role pack has `personaId`, `title`, `job`, `skills`, `tools` (name and risk), `workerMenu` and `defaultAllowance`.

New fields:

| Field | Meaning | Engineer example |
|-|-|-|
| `owns` | The outcome the role owns, used as its goal template | "Ship fixes and roadmap items every week" |
| `channel` | Default home channel, created at hire if missing | `engineering` |
| `duties` | Default duties: title, schedule (cron and time zone), instructions | 09:00 triage of #bugs and GitHub issues |
| `onHire` | Sources to study and the plan horizon (14 days) | code folder, open issues |
| `askBefore` | Actions that always need the founder | merge, deploy |
| `home` | The role's native screen id | `engineer.prs` |
| `workFolder` | `none`, `optional` or `required` | `required` |

Code that changes:

- Rust: `HireRolePack` (`crates/buzz-core/src/company_records.rs:688`) gains the new fields. It uses `deny_unknown_fields`, so this is hire schema version 2. The relay accepts versions 1 and 2.
- TypeScript: the role pack parser and `companyHireRolePackFromPersona` in `desktop/src/features/company-hiring/companyHireModels.ts`. That function rejects built-in personas today (`persona.isBuiltIn`); built-in personas with a company role must be allowed.
- Tauri persona records: `company_role` metadata (`desktop/src-tauri/src/commands/personas/create.rs`) and built-in personas (`desktop/src-tauri/src/managed_agents/personas.rs`).
- Persona pack spec (`crates/buzz-persona/PERSONA_PACK_SPEC.md`) documents the company role block, so custom packs use the same format.

Hire review shows the duties, the goal from `owns` and the `askBefore` list. The founder's signature on the hire approves them. The relay creates the hire, its goal, the duty heads and their schedule workflows in one transaction (`crates/buzz-relay/src/handlers/company_hires.rs` with the helpers in `company_duties.rs`), so a hire never exists without its goal and duties or the reverse. The founder's signature is the authority this needs: only admins may create top-level goals (`crates/buzz-relay/src/handlers/company_records.rs:347-357`) and manage duties.

Built-in packs ship inside the desktop app and appear in the Role catalog. Their content arrives with each role's design. This base ships the mechanism and one test fixture pack.

## C. On-hire routine and work loop

All steps use existing primitives: goals, work items, duties (schedule workflow with an `AskAgent` step), asks and workers.

1. **Hire signed.** The employee, its goal, its duties and its home channel exist. It posts a one-line intro (existing hire success behavior).
2. **Studies the startup.** It reads the business profile plus its `onHire` sources. Workers do the heavy reading.
3. **Plan ask.** It writes the 2-week plan into its home channel canvas and raises one `Approval` ask with a one-line summary and a link. The founder (owner or admin) resolves it.
4. **On approval.** It creates the plan's work items under its goal with `colony work`, then starts the first item.
5. **Wake-ups.** Duties, @mentions and briefs from its manager wake it. Each time it picks the next work item, hands parts to workers, posts a one-line result with a link and marks the item done (unverified). It raises an ask only at its `askBefore` limits.
6. **Plan refresh.** Every pack gets a built-in "Plan review" duty, Mondays 09:00 local. When the plan is 14 days old, it posts the next plan ask.

Known v1 limit: `askBefore` is enforced by the prompt plus tool consent for tools rated risky. A general shell command cannot be fully fenced.

## D. Home screen slot, work folder, errors

**Home screen slot.** The pack's `home` screen shows as a tab in the work area dock of the employee's home channel (`desktop/src/features/workarea/dock/workAreaTabRegistry.tsx`) and as a section on its profile (`desktop/src/features/company-team/ui/EmployeeProfileScreen.tsx`). The base ships the slot with an empty state; each role design fills it.

**Work folder.** Today every agent starts in the home folder (`default_agent_workdir`, `desktop/src-tauri/src/managed_agents/mod.rs:138`, used by `runtime.rs:602` and `backend.rs:86`). A hire can set a work folder when the pack's `workFolder` is `optional` or `required`; the runtime starts that employee there.

**Errors.**

| Case | Behavior |
|-|-|
| Plan rejected | The employee revises it with the founder's note and asks again |
| Missing source (no code folder, no website) | One question ask, then it continues with what it has |
| Allowance used up | Pauses with the reason and raises a Money ask for a raise. New in this base: nothing enforces the weekly allowance today. The check compares the spend ledger (`crates/buzz-core/src/company_spend.rs`) with the hire's `weeklyAllowance` and uses the existing core pause (`crates/buzz-core/src/company_members.rs:340`) |
| Crash or stuck | Scout flags it in the daily summary; the founder restarts it from its profile (existing `restart_managed_agent_runtime`). A takeover flow does not exist and is out of scope here |
| Laptop off or app closed | Missed duties catch up once (existing bounded schedule catch-up, `crates/buzz-relay/src/api/workflows.rs:268`) |

## Testing and proof gate

1. Contract tests: role pack v2 parsing in Rust and TypeScript, version 1 still accepted, the built-in exclusion removed only for packs with a company role.
2. Prompt test: the base prompt contains the voice section exactly once and no longer tells agents to narrate (bound to the production prompt builder, like the web rules test).
3. Relay tests (PostgreSQL): a signed hire creates the hire, its goal, its duties and workflows together; a failure creates none of them. Spend reaching the weekly allowance pauses the employee and raises exactly one raise ask.
4. Desktop e2e (smoke and integration projects): the catalog shows the fixture pack; hire review shows duties and limits; the home tab appears in the employee's channel.
5. Real-run gate (packaged app, clean profile, real Claude Code): hire the fixture "Test Engineer" on a test repo with no prompting. Within 5 minutes it posts an intro and a plan ask. After approval a duty run leads to a PR on the test repo. Every chat reply in the run is measured: at least 9 in 10 are 5 sentences or fewer, and none is a report (headings, tables, bullet walls).

## Rollout

- Relay first (accepts hire schema v1 and v2), then desktop.
- No feature flag: the mechanism is invisible until packs exist, and the voice rule is a prompt change.
- Desktops at 1.0.7 or older skip version 2 hire records (their parser rejects unknown keys), so founders need the new desktop to see new hires.

## Next

Scout design (sub-project 2), then Engineer, Growth Marketer, Social Media Manager, Sales Director, onboarding and the landing page last.
