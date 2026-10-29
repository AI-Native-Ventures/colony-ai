# Co-founder mode: master plan

**Spec:** `docs/superpowers/specs/2026-10-29-cofounder-mode-design.md` (approved 29 Oct 2026).
**Screens (design authority):** Claude Design canvas "Colony 3.0" https://claude.ai/artifact/RnYdZoidiBCf13htG27KE8, page "Co-founder mode"; design system https://claude.ai/artifact/TX32mvMvgCARPS3wh2mqFU. The shipped app wins over the canvas where they differ.

The spec covers several subsystems, so it ships as phases. Each phase has its own detailed plan, written when the phase before it lands (plans written earlier go stale). Each phase ends at a proof gate on a packaged build exercised in the owner's own Horizon Labs company; a phase is Done only after that gate and the owner's look at a proof page.

## Event kind blocks (coordinator-assigned, do not reuse)

| Block | Heads | Actions |
|---|---|---|
| Reserved (Colony OS engine, not landed) | 30657 business profile, 30658 team computer, 30659 brief | 47046, 47047 |
| WhatsApp outreach (C3-WA, in flight) | 30660 to 30667 | 47048 to 47055 |
| Co-founder mode (all phases) | 30670 to 30679 | 47060 to 47069 |

## Phases

| Phase | Delivers | Workers | Proof gate |
|---|---|---|---|
| 0, in flight | WhatsApp outreach (PR #445 relay + C3-WA-UI-1), Google login popups (#446 merged), tag uses (C3-DISCOVERY-TAG-USES-1), free-AI gateway chain fix (C3-JUDGE-AI-10) | existing | first real WhatsApp batch to the owner's own phone, approved in Colony; reply lands in #Outreach |
| 1, foundations (`01-phase1-foundations.md`) | co-founder switch per company; company function slots; radial company map and function pages (filled and empty); `colony discovery search` for agents with a per-company fair-use cap; worker runs (`colony work spawn`) with budgets and visible status/output/cost | Sonnet: tasks 1 to 4. Codex: tasks 5 and 6 | owner switches co-founder mode on in Horizon Labs; map shows Scout, Aya in Sales, Scout covering Operations, three empty slots; Scout runs a 10-result Discovery search into Leads; Aya spawns a research worker whose status, output and cost show on the Sales page |
| 2, Scout's initiative | co-founder Scout prompt and onboarding (brief playback, money setting, approval switches, account set-up in the browser); plan cards (new ask category with a typed plan proposal); "Needs you" (approve / do / decide) inside Today; wakes on events (inbound reply, worker done, approval given, deadline); hiring into a slot (hire proposal carries the function, completion assigns the slot); access list with revoke and the capability-gap flow; hard-rule enforcement audit (every outward path either relay-gated or browser on-screen confirmation) | Sonnet backend, Codex UI | Scout onboards Horizon Labs, proposes a November plan as a card, the owner approves, Scout hires into an empty slot via an approved hire ask, and nothing goes out without an approval record |
| 3, Operations playbooks | playbook records (versioned steps with owners, approval points, tools), designed with the founder in chat, running copies per client job with current step, Operations page as a flow | Sonnet, Codex | the Horizon Labs delivery playbook exists, one client job runs through two steps with an approval point |
| 4, customer record, calendar, money and paperwork | one record from lead to client to project to invoice (lead converts and keeps history; chats, files, money attached); calendar booking (one provider, cheapest in SA, via the capability-gap flow); quotes and proposals, e-sign agreements, payment links, invoices (one provider each, relay-gated sends) | Sonnet, Codex | Plane Tree style journey: quote approved and sent, agreement signed, deposit link paid in test mode, call booked, all on one customer record |
| 5, numbers and weekly review | scorecard per function, goals per function (Scout proposes, owner approves), Friday weekly review message with decisions | Sonnet, Codex | a real Friday review for Horizon Labs with correct numbers from the week |

## Rules for every phase

- Workers never merge; PRs into develop; GitHub CI is the gate; no local cargo.
- No production DB, no Fly, no production relay writes by workers; real Discovery searches and real WhatsApp sends happen only at the coordinator's proof gate with the owner's OK.
- Older desktops parse records with unknown keys as failures: new fields go into NEW kinds or into fields old clients ignore; never add keys to existing record types without checking every reader.
- Every new kind goes into all lists in `crates/buzz-core/src/kind.rs`, `desktop/src/shared/constants/kinds.ts` and `docs/company-records.md`.
- UI matches the approved boards exactly; screenshots at 1440 and 390, light and dark, side by side with the board PNGs.
- No em dashes in any copy. Agent replies stay short.
