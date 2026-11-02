# Co-founder hard rules audit

Task C3-COF2-PLANS, 30 Oct 2026. Spec: `docs/superpowers/specs/2026-10-29-cofounder-mode-design.md` section 10.

The rules:

1. No outreach to anyone outside the company without owner or admin approval. One approval covers one message.
2. No spending without approval (paid tools, sign-ups, ads, credits beyond a set budget). Discovery searches are not a company spend.
3. No publishing taste work without approval.
4. Workers never take outward actions or spend.

Enforcement is split. Anything Colony runs (WhatsApp, Discovery, credits, payments) is gated at the relay, so a pending draft never reaches the provider. The built-in browser keeps today's on-screen confirmation: it stops on Send, Pay and Submit-like actions and refuses if nobody can answer. An approval given earlier in Needs you does not unlock a browser send.

**A plan approval is never a send authorization.** Approving a co-founder plan (kind 47063) records the owner's intent in the plan head. The plan code in `crates/buzz-core/src/company_plans.rs` has no sender, no payment call and no network access. Every outward step of an approved plan still passes through the gates below, and a plan step that sends or spends must carry an approval point that the owner approves before the step can start.

**A playbook approval is never a send authorization either.** Approving a playbook version or a change (kind 47067) records the owner's intent. `crates/buzz-core/src/company_playbooks.rs` has no sender, no payment call and no network access. A step of a running copy that sends, spends or publishes carries an approval point that the owner approves before the step can start (`job_transition_allowed` refuses `pending` to `in_progress` for a gated step; the owner approves with `approve_step`, which a managed agent can never do). A worker step never carries an outreach or spend approval point (`validate_owner_and_gate`), also when a step is handed to a worker. Tests: `an_approval_point_blocks_the_step_until_the_owner_approves`, `a_hand_off_keeps_the_hard_rules` (unit) and `a_job_runs_through_two_steps_with_an_approval_point_in_between` (PG, `handlers/company_playbooks.rs`).

This audit was read from the code. "Test" names the test that fails if the guard is removed. "Lane" says where CI runs it: **unit** (`just test-unit`), **PG** (the Postgres lane, `postgres_tests` modules), **desktop** (`pnpm test` and the browser broker workflow).

## Summary

| Path | Rule | Gate | Proven by a failing-without-guard test |
| --- | --- | --- | --- |
| WhatsApp batch send | 1 | relay | yes (PG) |
| WhatsApp agent reply, follow-up, file, link | 1 | relay | yes (PG) |
| WhatsApp new chat opened by an agent outside a batch | 1 | relay | yes (PG), added in this PR |
| A managed agent holding an admin role row | 1 | relay | yes (PG), guard and test added in this PR |
| Plan approval, step approval points | 1, 2, 3 | relay | yes (unit and PG), new in this PR |
| Playbook versions, running copy approval points | 1, 2, 3 | relay | yes (unit and PG), C3-COF3-PLAYBOOKS |
| Discovery search and save | 2 | relay, monthly company cap only | cap yes (PG); no approval step by design |
| Credits gateway inference | 2 | relay, owner pays, no per-call approval | session and balance yes (PG); allowances not enforced (open) |
| Payments (credit checkout) | 2 | relay, account holder on the provider page | partly (open: agent key refusal untested) |
| Worker runs | 4 | local process with no tools | yes (unit), added in this PR |
| Browser Send, Pay, Submit, upload, download | 1, 2, 3 | desktop on-screen confirmation | yes (desktop), Enter-to-send closed in this PR |
| Browser with nobody on screen | 1, 2, 3 | desktop, refused or denied on timeout | yes (desktop) |

## A. WhatsApp (contract: `docs/whatsapp-outreach.md`)

| Path | Entry | Who | Guard | Test and lane |
| --- | --- | --- | --- | --- |
| The only Graph send | `sender::process_community` calls `ReqwestGraph::send` | relay worker | Reads only rows in state `queued` or `ready` (`buzz-db/src/store/whatsapp.rs`, the sender query). Agent messages are `draft`, batch rows are `held`. A crash between the call and the record leaves `sending`, then `unconfirmed`, never resent. | `a_crash_between_the_graph_call_and_the_record_never_sends_twice`, `pending_batch_never_sends_and_approved_rows_are_paced_capped_and_roll_over`, `agent_messages_are_drafts_the_owner_approves_edits_or_rejects` (all PG, `whatsapp/postgres_tests.rs`) assert `send_count` stays 0 for drafts and held rows |
| Send request 47050 | `whatsapp_commands::handle_send`, `sender::enqueue_send` | owner or admin: queued at once (their own message is the approval). Outreach agent: draft only. Others refused. | `Access::can_send`, `sender::initial_state`, `sender::check_send` (pause, opt-out, one message at a time, 24 hour window, new chat needs a batch) | PG: `agent_messages_are_drafts_...`, `free_text_needs_the_window_and_never_two_messages_in_a_row`, **`an_outreach_agent_cannot_open_a_new_chat_outside_an_approved_batch` (new)**. Unit tests in `sender.rs` now run in the unit lane (see below). |
| Draft and batch decision 47049 | `handle_draft_decision`, `handle_decision` | owner or admin only | `Access::is_owner_admin`; approval re-runs `check_send` | PG: `agent_messages_are_drafts_...` (agent refused, rejected draft never sent), `pending_batch_never_sends_...` |
| Batch create 47048 | `handle_batch` | owner, admin, Outreach agent | batch `pending`, rows `held`; opted-out and paused numbers refused | PG `pending_batch_never_sends_...` |
| Role resolution | `whatsapp::access_for` | any caller | **A managed agent never gets `OwnerAdmin`, whatever role row it holds (guard added in this PR).** Without it an agent given an admin row would have its messages queued and sent at once. | PG **`a_managed_agent_with_an_admin_role_row_still_only_drafts` (new)**: the message is a draft, nothing reaches Graph, and the agent cannot approve its own draft |
| Settings, cap, template rename 47051 | `handle_settings` | owner or admin; agents may only propose a title | `is_owner_admin` | PG `template_titles_default_from_the_body_rename_and_survive_sync` |
| Contact stage and label 47052 | `handle_contact_update` | owner, admin, their agents, Outreach members; plain members refused; audited | `Access::can_send` | PG `only_people_who_may_reply_can_change_a_stage_or_name_and_every_change_is_audited` |
| Connect, disconnect | `api/whatsapp.rs` | owner or admin | `require_owner_admin` | PG `secrets_stay_sealed_and_out_of_every_response` |
| Inbound webhook | `api/whatsapp.rs` | Meta | HMAC check; no send call in `inbound.rs` or `channel.rs` | PG `webhook_checks_the_signature_answers_the_challenge_and_dedupes` |

Outreach unit tests (`whatsapp::sender::tests`, `whatsapp::tests::access_levels_gate_the_right_actions`, `handlers::whatsapp_commands::tests`) ran in no CI lane before this PR. They are now in the buzz-relay filter of `just test-unit`.

Note on rule 1: approving a batch releases the first message of every row, up to 500 rows. This is the owner's 29 Oct decision. The daily new-chat cap and the 08:00 to 18:00 pacing are the only bound.

## B. Plans (new in this PR)

`buzz_core::company_plans::apply_plan_action` is the one state machine; the relay broker (`handlers/company_plans.rs`) resolves the caller and the co-founder switch and applies it.

| Rule | Guard | Test |
| --- | --- | --- |
| Only an owner or admin approves, rejects or edits another's proposal, or approves a step's approval point. A managed agent never does, even with an admin role row. | `PlanActorRole`, `require_admin`; the broker sets `ManagedAgent` before it looks at the role row | unit `a_managed_agent_can_never_approve_even_with_an_admin_role_row`; PG `an_agent_and_a_member_can_never_approve_a_plan` |
| A step with an approval point cannot start until the owner approved it | `step_transition_allowed` | unit `a_gated_step_cannot_start_until_the_owner_approves_its_point`; PG `an_approval_point_gates_its_step_until_the_owner_approves` |
| Plans, revisions and approvals need co-founder mode on; approved work in flight finishes | `require_cofounder` | unit `a_plan_is_only_proposed_while_cofounder_mode_is_on`, `switching_off_stops_new_approvals_but_approved_work_finishes`; PG `a_plan_cannot_be_proposed_while_cofounder_mode_is_off` |
| A step that spends needs an approval point or fits inside the plan budget the owner approves | `validate_plan_proposal` | unit `spending_needs_an_approval_point_or_a_budget_that_covers_it` |
| A worker step can never spend or carry an outreach or spend approval point | `validate_step` | unit `a_worker_step_can_never_spend_or_send` |
| A stale approval (the plan was edited since) conflicts | `check_revision` | unit `approving_a_stale_revision_conflicts`; PG `a_stale_plan_write_conflicts_and_cannot_overwrite_a_decision` |
| Who approved what and when is kept | `PlanApprovalRecord` in the head, append-only | unit `an_admin_approval_is_recorded_with_who_when_and_revision`; CLI `colony plans approvals` |

## C. Discovery

| Path | Entry | Who | Guard | Test and lane |
| --- | --- | --- | --- | --- |
| `POST /discovery/search` | `api/discovery.rs` `run_search` | any member or agent | NIP-98 plus membership; per-member rate limit; per-company monthly cap checked before the provider call and counted after | PG `search_over_monthly_cap_returns_429_with_reset`, `cap_is_per_company_not_per_member`, `failed_provider_call_is_not_counted` |
| `colony discovery search --save` | `buzz-cli` `discovery.rs` | whoever runs the CLI | writes prospect records inside the company; contacts nobody | CLI unit tests |

Searches are not a company spend (spec section 14). They are bounded by the monthly company cap, which Colony absorbs.

**Open:** the co-founder switch `approve_every_discovery_campaign` is stored but read by no relay code, so it gates nothing. The per-member rate limiter `enforce_search_admission` has no test.

## D. Credits gateway, AI spend, payments

| Path | Entry | Guard | Test |
| --- | --- | --- | --- |
| Create session | `credits_gateway.rs` | flag, NIP-98, relay membership, verified account that owns the agent | PG `session_identity_community_expiry_and_ownership_are_enforced` |
| Managed inference | `credits_gateway.rs` `start_inference` | agent-signed request, active session bound to agent and community, owner pays, hold before the call, 402 when the balance is short, daily cap | PG `real_route_rejects_anonymous_tampered_and_empty_balance_before_upstream`, `global_daily_cap_refuses...` |
| Allowance and spend records | `company_spend.rs` | owner or admin writes; usage reports checked against the owner's agent | e2e `company_spend_records_require_authority_and_verified_employee_turn_evidence` |
| Credit checkout | `api/payments.rs` | verified account holder; server-priced packs; the relay only opens a hosted provider page where a person pays; agent keys have no account row | PG `stripe_checkout_http_rejects_unknown_and_payfast_packs_without_creating_an_intent` |

**Open:** employee allowances are stored but not read by the gateway, the harness or the CLI when a call is made, so setting an allowance does not stop a spend. There is no test that an agent key is refused at checkout, and none for `revoke_session`.

## E. Worker runs (rule 4)

| Path | Guard | Test |
| --- | --- | --- |
| `buzz-agent run-once` | The only model call passes an empty tool list; no MCP server, no browser, no shell, no relay client is built. A tool call the model makes anyway is refused and costs a round; the refused call is never replayed. At most 8 rounds, 16000 tokens, 900 seconds. The only side effect is the output file. | **unit `a_worker_run_offers_no_tools_and_refuses_a_tool_call` and `a_worker_run_that_only_calls_tools_ends_failed` (new)**, driving the real `run_once::answer` against a stub provider and reading the posted request bodies |
| `colony workers spawn` | at most 5 running per employee; record written before launch | `spawn_rejects_sixth_concurrent_worker` |
| `colony workers spawn` | one request is one run: a second spawn while one of the employee's runs is live is refused unless `--another`; `--wait` reads the run for at most 90 seconds and the run is always supervised by a detached process, so a cut-off shell cannot leave a run looking alive | `a_second_run_is_refused_while_one_is_running`, `wait_returns_the_result_once_the_run_ends` |
| Worker record 47062 | signer is the employee or an owner or admin; creates no member, position or agent | e2e `agent_writes_own_worker_record`, `agent_cannot_write_another_agents_worker_record` |
| Worker steps in a plan | cannot spend, cannot carry an outreach or spend approval point | unit `a_worker_step_can_never_spend_or_send` |

A worker has no identity of its own. Its model spend runs on the employee's provider and is bounded only by the limits above. The child process inherits the parent environment (`workers.rs`, no `env_clear`); it has no tool that could use it.

## F. Built-in browser (desktop on-screen confirmation)

Code: `desktop/electron/browser-broker/` (`classifier.mjs`, `broker-core.mjs`). Design: `docs/work-area-browser-design.md`.

| Path | Guard | Test |
| --- | --- | --- |
| Click or type on a consequential control (pay, send, publish, transfer, delete, permission) | `classifyAction` names, then `guardedElementAction` parks the call and re-verifies the page and element after confirmation | `classifier.test.mjs`, `broker-core.test.mjs` ("a consequential click waits for the person and runs once after confirm", "rejecting a confirmation cancels the action") |
| Credential and payment forms, cross-origin form posts, uploads, downloads | `classifyAction` | `classifier.test.mjs` |
| Credential fields and secret-looking text | refused outright | "typing into credential fields and secret text is refused" |
| **Enter pressed in a box with no form** (how chat and mail composers send) | **now confirms (`enter_submit_no_form`); only a search box may press Enter freely. Before this PR it was allowed.** | **`classifier.test.mjs` "pressing Enter in a box with no form needs confirmation, except in a search box" and `broker-core.test.mjs` "pressing Enter in a box with no form waits for the person and never types if denied" (new)**; both fail with the guard removed |
| Nobody on screen | no listener registered: refused at once. A listener but no answer: denied after 120 seconds | "with nobody to ask, a consequential action is refused immediately", "an unanswered confirmation times out as denied" |
| Who can confirm | only the trusted main window and its main frame | `electron-host.test.mjs` "broker IPC accepts only the registered main window main frame" |

**Open:**

- "Nobody on screen" means no event listener, not "the window is hidden". A hidden or minimized window parks the action for 120 seconds, then denies. This is safe but slow.
- `navigate` is classed read-only, so a state-changing GET passes, and default access auto-approves the origin the agent asks for.
- An agent with a shell can bypass the browser entirely (design doc residual risk R1). Rule 3 (taste work) rests on the browser and shell paths: Colony has no publishing integration of its own.
- The harness consent gate (`buzz-acp/src/tool_permissions.rs`) matches fixed titles such as `spend_money` and `message_outsider`; other tools are allowed once.

## G. Other outward and egress paths

| Path | Guard | Note |
| --- | --- | --- |
| `colony messages send`, `dms`, `social`, `notes`, `gifs share` | channel membership; agent chat text capped at 60 words | events stay inside the company relay; `gifs share` calls the GIF provider through the relay |
| `colony upload` and media reads | NIP-98 plus membership | storage only |
| `colony money` invoice and follow-up commands | owner or admin only, records only ("approve follow-up without sending email") | no send |
| `colony agents draft-create` and `draft-update` | open an owner-reviewed draft in the app | the owner approves in the desktop |
| Asks: money, hire, tool, secret, duty | `ask_resolution_denied_reason`: only owner or admin resolve; agents never | `authority_follows_owner_decision_d2` (unit) |
| Harness tool consent | fail-closed for named sensitive tools; fresh ask with a 4 minute expiry | see the open item above |
| Relay email (Resend) | unauthenticated signup and reset codes to the address typed, rate limited | not an agent path |
| Workflow `call_webhook` | channel owner or admin saves it; SSRF check; no per-run approval | **open:** no relay-level test of the role check |
| Push gateway, KLIPY, Outscraper, Stripe, PayFast, OpenRouter | each listed above or member-gated | |

## Open items for the coordinator

None of these is fixed in this PR. Each needs a decision or a larger change.

1. **Allowances are advisory.** Credits beyond a set budget are not stopped. Enforcing at the gateway changes every agent's behaviour, so it needs the owner's call.
2. **`approve_every_discovery_campaign` gates nothing.** Enforcing it means an approval record for a Discovery campaign.
3. **Hidden-window browser confirmation** waits 120 seconds instead of refusing at once.
4. **Shell bypass** of the browser (R1) and the name-matched harness consent gate.
5. Missing tests: Discovery per-member rate limiter, credits `revoke_session`, an agent key at payments checkout, the workflow `call_webhook` role check.
