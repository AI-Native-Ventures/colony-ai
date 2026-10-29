# Co-founder mode Phase 1 (foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-company co-founder switch, the five function slots with a radial company map and function pages, agent-run Discovery searches with a per-company cap, and visible, budgeted worker runs.

**Architecture:** Three new relay-signed company records (co-founder settings, function slots, worker runs) follow the existing company-record pattern (member-signed action, relay validates and authorises, relay writes the head with a replace precondition). Agents use them through new `colony` CLI groups; the desktop reads the heads for the map, function pages and the settings switch. Worker runs are a one-shot `buzz-agent` mode launched by the CLI with the agent's own provider env and no tools.

**Tech Stack:** Rust (buzz-core, buzz-relay, buzz-sdk, buzz-cli, buzz-agent), Postgres migration for the Discovery counter, React 19 + TanStack Router desktop renderer, Playwright mock-mode e2e.

**Spec:** `docs/superpowers/specs/2026-10-29-cofounder-mode-design.md` (sections 5, 7, 9, 13, 14). Master plan: `00-master.md`.

## Global Constraints

- Kinds: co-founder block only, heads 30670 to 30679, actions 47060 to 47069. This phase uses 30670/47060 (co-founder settings), 30671/47061 (function slot), 30672/47062 (worker run). Add each to every list in `crates/buzz-core/src/kind.rs` (`COMPANY_RECORD_KINDS` :799, `is_company_command_kind` :828, `is_company_global_kind` :848, `ALL_KINDS` :978, range asserts :1327+), `desktop/src/shared/constants/kinds.ts`, `docs/company-records.md`.
- New kinds only; never add keys to existing record types (older desktops fail whole lists on unknown keys).
- Function order and ids are fixed: `sales`, `operations`, `customer_success`, `finance`, `brand`; display names Sales, Operations, Customer Success, Finance, Brand.
- Co-founder mode is OFF by default per company; only owner and admins change it or assign slots.
- Workers: no shell, no browser, no outward action, no spending; bounded tokens, rounds and time; never in the team list.
- `colony work` already exists (work tracking, kind 30652); the worker command group is `colony workers`.
- UI matches the approved boards (CFExperimentalFeatures, CFExperimentalFeaturesOn, CFCompanyMapRadial, CFFunctionSales, CFFunctionFinance); shipped app style wins; no em dashes in copy.
- Rules for all workers: PR into develop, never merge, GitHub CI is the gate, no local cargo, no production DB/Fly/relay writes, no real Discovery searches (fake upstream only), never read or print a key; `LEFTHOOK=0 git commit -s` with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A member or an agent (not owner/admin) tries to switch co-founder mode or assign a slot: the relay refuses with a clear reason and the UI shows the control read-only. Tests in Tasks 1, 2, 5.
2. A slot's lead agent is later removed from the team: the map shows that slot empty with a soft +, never a broken avatar or a crash. Test in Task 5.
3. The Discovery monthly cap is reached mid-search: the CLI exits with code 2 and "Discovery limit reached for this month, resets <date>", and no partial leads are saved twice on retry. Tests in Task 3.
4. A worker run crashes or exceeds its time: its record ends `failed` with a reason, and a `running` record older than its deadline is shown as failed by readers. Tests in Task 4 and Task 5.
5. A 3.0.12 desktop reads a company with the new kinds: its existing lists still load (the new kinds are separate records). Test in Task 1 (desktop parse of existing kinds unaffected).

---

### Task 1: Co-founder settings record

**Files:**
- Create: `crates/buzz-core/src/company_cofounder.rs`, `crates/buzz-relay/src/handlers/company_cofounder.rs`, `crates/buzz-cli/src/commands/cofounder.rs`
- Modify: `crates/buzz-core/src/kind.rs`, `crates/buzz-core/src/lib.rs`, `crates/buzz-relay/src/handlers/command_executor.rs:62-73`, `crates/buzz-relay/src/handlers/ingest.rs:528,703`, `crates/buzz-sdk/src/company_records.rs`, `crates/buzz-cli/src/lib.rs` (Cmd enum :240, dispatch :3175), `crates/buzz-cli/src/commands/mod.rs`, `desktop/src/shared/constants/kinds.ts`, `docs/company-records.md`
- Test: unit tests in `company_cofounder.rs`, relay tests beside the handler (follow `handlers/company_records.rs` tests), CLI tests in `cofounder.rs`

**Interfaces:**
- Produces (buzz-core):
  - `pub const KIND_COFOUNDER_HEAD: u32 = 30670; pub const KIND_COFOUNDER_ACTION: u32 = 47060;`
  - `pub const COFOUNDER_D_TAG: &str = "company:cofounder";`
  - `pub enum MoneyPreference { CheapestFirst, BestOption }` (serde `snake_case`)
  - `pub struct ApprovalSwitches { pub approve_every_hire: bool, pub approve_playbook_changes: bool, pub approve_every_discovery_campaign: bool }`
  - `pub struct CofounderSettings { pub enabled: bool, pub money_preference: MoneyPreference, pub approval_switches: ApprovalSwitches }` with `impl Default` = disabled, CheapestFirst, all false
  - `pub struct CofounderAction { pub schema_version: u32, pub settings: CofounderSettings, pub expected_head_event_id: Option<String> }`
  - `pub struct CofounderHead { pub schema_version: u32, pub settings: CofounderSettings, pub updated_by_pubkey: String, pub updated_at: i64 }`
  - `pub fn validate_cofounder_action(action: &CofounderAction) -> Result<(), CompanyRecordError>`
  - All structs `#[serde(deny_unknown_fields)]`, schema version `COMPANY_RECORD_SCHEMA_VERSION`.
- Produces (sdk): `pub fn build_cofounder_action(settings: &CofounderSettings, expected_head_event_id: Option<&str>) -> Result<EventBuilder, SdkError>`
- Produces (CLI): `colony cofounder get` (prints the head JSON, or the defaults with `"exists": false`), `colony cofounder set --enabled true|false [--money cheapest-first|best-option] [--approve-every-hire ..] [--approve-playbook-changes ..] [--approve-every-discovery-campaign ..]` (read-modify-write with the expected head).

- [ ] **Step 1: Write failing core tests** `cofounder_defaults_are_off_and_cheapest_first` (assert `CofounderSettings::default().enabled == false` and `money_preference == CheapestFirst`), `cofounder_action_rejects_unknown_fields` (JSON with an extra key fails to parse), `cofounder_action_rejects_wrong_schema_version` (version 2 -> `Err`).
- [ ] **Step 2: Run** `cargo test -p buzz-core company_cofounder` in CI (or the worker's CI run). Expected: FAIL (module missing).
- [ ] **Step 3: Implement the module and kinds** in the files above; register the kinds in every list named in Global Constraints.
- [ ] **Step 4: Write failing relay tests** `cofounder_set_by_owner_writes_head`, `cofounder_set_by_admin_writes_head`, `cofounder_set_by_member_is_denied` (reason "only the owner or an admin can change co-founder mode"), `cofounder_set_by_agent_is_denied`, `cofounder_set_with_stale_expected_head_conflicts` (write conflict, exit code 5 in CLI terms).
- [ ] **Step 5: Implement** `handle` in `handlers/company_cofounder.rs` with the same signature as `handlers/company_records.rs::handle` (:33) (authorise with the same owner/admin lookup `handlers/company_records.rs:403` uses; write the head with `ParameterizedReplacePrecondition`); route it in `command_executor.rs`.
- [ ] **Step 6: Add the SDK builder and CLI group**; CLI tests `cofounder_set_requires_enabled_flag`, `cofounder_get_without_head_prints_defaults`.
- [ ] **Step 7: Run all three test sets green in CI; commit** `feat(company): per-company co-founder settings record`.

### Task 2: Function slot records

**Files:**
- Create: `crates/buzz-core/src/company_functions.rs`, `crates/buzz-relay/src/handlers/company_functions.rs`, `crates/buzz-cli/src/commands/functions.rs`
- Modify: the same registration files as Task 1
- Test: beside each new file

**Interfaces:**
- Consumes: Task 1's registration pattern and owner/admin authorisation helper.
- Produces (buzz-core):
  - `pub const KIND_COMPANY_FUNCTION_HEAD: u32 = 30671; pub const KIND_COMPANY_FUNCTION_ACTION: u32 = 47061;`
  - `pub enum CompanyFunction { Sales, Operations, CustomerSuccess, Finance, Brand }` (serde `snake_case`; `pub const ALL: [CompanyFunction; 5]` in that order; `fn display_name(&self) -> &'static str`)
  - `pub fn function_d_tag(f: CompanyFunction) -> String` returning `company:function:{snake_case id}`; `pub fn validate_function_d_tag(tag: &str) -> Result<CompanyFunction, CompanyRecordError>`
  - `pub enum SlotState { Empty, CoveredByScout, Filled }`
  - `pub enum FunctionActionKind { AssignLead, CoverByScout, Clear }`
  - `pub struct FunctionAction { pub schema_version: u32, pub function: CompanyFunction, pub kind: FunctionActionKind, pub lead_pubkey: Option<String>, pub expected_head_event_id: Option<String> }`
  - `pub struct FunctionHead { pub schema_version: u32, pub function: CompanyFunction, pub state: SlotState, pub lead_pubkey: Option<String>, pub updated_by_pubkey: String, pub updated_at: i64 }`
  - `pub fn validate_function_action(a: &FunctionAction) -> Result<(), CompanyRecordError>`: `AssignLead` requires a 64-hex `lead_pubkey`; `CoverByScout` and `Clear` require `None`.
- Produces (CLI): `colony functions list` (all five, missing heads shown as `empty`), `colony functions get <function>`, `colony functions assign <function> --lead <pubkey>`, `colony functions cover <function>`, `colony functions clear <function>`.

- [ ] **Step 1: Failing core tests** `function_d_tags_round_trip_for_all_five`, `assign_without_lead_is_invalid`, `cover_with_lead_is_invalid`, `function_order_is_sales_operations_customer_success_finance_brand`.
- [ ] **Step 2: Implement core module**; run green.
- [ ] **Step 3: Failing relay tests** `assign_by_owner_sets_filled_with_lead`, `assign_to_non_member_is_denied` (reason "the lead must be a member or an agent of this company"), `assign_by_member_is_denied`, `cover_sets_covered_by_scout_and_clears_lead`, `clear_sets_empty`.
- [ ] **Step 4: Implement** `handlers/company_functions.rs::handle` (same signature as `handlers/company_records.rs::handle`), membership check through the community member list or the company's agents (the same lookup `handlers/company_hires.rs` uses for attach); route it.
- [ ] **Step 5: CLI group + tests** `functions_list_shows_five_rows_in_order`, `functions_assign_requires_lead`.
- [ ] **Step 6: Docs**: add both records to `docs/company-records.md` and the agent skill `desktop/src-tauri/src/managed_agents/nest_skill.md` (bump `NEST_SKILL_VERSION`): agents read `colony cofounder get` and `colony functions list`; only people change them in Phase 1.
- [ ] **Step 7: CI green; commit** `feat(company): function slot records and colony functions`.

### Task 3: Discovery search for agents with a per-company cap

**Files:**
- Create: `crates/buzz-cli/src/commands/discovery.rs`, migration under `migrations/` plus `schema/schema.sql` update, `crates/buzz-db/src/discovery_usage.rs`
- Modify: `crates/buzz-relay/src/api/discovery.rs` (`enforce_search_admission` :565, handler), `crates/buzz-relay/src/config.rs` (:1098 area), `crates/buzz-cli/src/lib.rs`, `crates/buzz-cli/src/commands/mod.rs`, `nest_skill.md`
- Test: relay tests in `discovery.rs`, db test, CLI tests

**Interfaces:**
- Consumes: `POST /discovery/search` (`SearchRequest` :95, response :128), `client.rs` `post_json_authed` :884, `buzz_sdk::business_records::build_prospect_action`, the desktop mapping rules in `desktop/src/features/discovery/discoveryMapping.ts` (mirror them in Rust; keep field names identical).
- Produces:
  - Relay env `BUZZ_DISCOVERY_COMPANY_MONTHLY_RESULTS` (default 2000). Over the cap: HTTP 429 body `{"error":"monthly_limit","resets_at":"<RFC3339 first day of next month UTC>"}`.
  - `pub async fn add_discovery_results(pool: &PgPool, community_id: Uuid, month: NaiveDate, results: i32) -> Result<i32, DbError>` (returns the new month total) and `pub async fn discovery_results_this_month(...) -> Result<i32, DbError>`; table `discovery_usage(community_id uuid, month date, results int, primary key (community_id, month))`.
  - CLI `colony discovery search --query <text> --location <text> [--country <name|code>] [--limit 1..50] [--pages 1..5] [--save]`: prints places JSON; with `--save` creates one prospect per place in the company's Sales channel, skipping places whose external id already has a lead (`outscraper:<place_id>`), and prints `{saved, skipped_existing}`.

- [ ] **Step 1: Failing relay tests** with the existing fake upstream: `search_counts_results_per_company_month`, `search_over_monthly_cap_returns_429_with_reset`, `cap_is_per_company_not_per_member`.
- [ ] **Step 2: Implement** the table (follow AGENTS.md gotcha 7 for pgschema), db functions, admission check before the upstream call and the counter update after a successful response.
- [ ] **Step 3: Failing CLI tests** `search_builds_request_like_desktop` (same JSON as `buildSearchRequest`), `save_skips_existing_outscraper_ids`, `monthly_limit_maps_to_exit_code_2_with_message` ("Discovery limit reached for this month, resets 2026-11-01").
- [ ] **Step 4: Implement the CLI group**; agent docs: when to search, `--save` puts leads in Sales, searches are covered by the Discovery subscription and capped per month.
- [ ] **Step 5: Note in the PR**: the Discovery subscription check (owner decision: Colony absorbs search cost and sells Discovery access monthly) arrives with billing in a later phase; until then the monthly cap is the cost guard.
- [ ] **Step 6: CI green; commit** `feat(discovery): colony discovery search for agents with a monthly company cap`.

### Task 4: Worker runs

**Files:**
- Create: `crates/buzz-core/src/company_workers.rs`, `crates/buzz-relay/src/handlers/company_workers.rs`, `crates/buzz-cli/src/commands/workers.rs`, `crates/buzz-agent/src/run_once.rs`
- Modify: registration files as Task 1; `crates/buzz-agent/src/config.rs` (:636-751), `crates/sprig/src/main.rs` (argv0 dispatch to buzz-agent) and the buzz-agent entry it calls, for the `run-once` subcommand; `nest_skill.md`
- Test: beside each file; buzz-agent test with its existing fake provider

**Interfaces:**
- Produces (buzz-core):
  - `pub const KIND_WORKER_RUN_HEAD: u32 = 30672; pub const KIND_WORKER_RUN_ACTION: u32 = 47062;` d-tag `company:worker:{worker_id}` (uuid)
  - `pub enum WorkerStatus { Running, Done, Failed, Cancelled }`
  - `pub struct WorkerRun { pub worker_id: String, pub parent_pubkey: String, pub label: String, pub model: String, pub status: WorkerStatus, pub started_at: i64, pub deadline_at: i64, pub finished_at: Option<i64>, pub input_tokens: u64, pub output_tokens: u64, pub cost_usd: Option<f64>, pub output_text: Option<String>, pub failure_reason: Option<String> }`
  - `pub const MAX_WORKER_OUTPUT_BYTES: usize = 16_384;` (longer output is cut and ends with "[output cut, full text in <path>]")
  - `pub fn worker_effective_status(run: &WorkerRun, now: i64) -> WorkerStatus` (Running past `deadline_at` reads as Failed)
- Relay rule: the signer must be `parent_pubkey` (the agent itself) or owner/admin; a worker record never creates a member, position or managed agent.
- Produces (buzz-agent): `buzz-agent run-once --prompt-file <path> --output-file <path> --max-rounds <n> --max-output-tokens <n> --timeout-secs <n>` using the provider env already set for the employee (`BUZZ_AGENT_PROVIDER`, `BUZZ_AGENT_MODEL`, Colony credits session), with NO MCP servers and no tools; prints one JSON line `{"status":"done"|"failed","input_tokens":n,"output_tokens":n,"error":null|"..."}`.
- Produces (CLI): `colony workers spawn --label <text> (--brief <text> | --brief-file <path>) [--model <id>] [--max-output-tokens 1..16000 (default 4000)] [--max-rounds 1..8 (default 4)] [--timeout-secs 30..900 (default 600)] [--wait]`, `colony workers list [--mine]`, `colony workers get <id>`, `colony workers cancel <id>`. At most 5 running workers per agent (local lock files under the agent's nest).

- [ ] **Step 1: Failing core tests** `running_past_deadline_reads_failed`, `output_over_limit_is_rejected_by_validation`, `worker_run_rejects_unknown_fields`.
- [ ] **Step 2: Implement core module and kinds.**
- [ ] **Step 3: Failing relay tests** `agent_writes_own_worker_record`, `agent_cannot_write_another_agents_worker_record`, `worker_record_never_appears_in_team_list` (team list query unchanged with worker heads present).
- [ ] **Step 4: Implement relay handler.**
- [ ] **Step 5: Failing buzz-agent tests** with the fake provider: `run_once_writes_output_and_usage`, `run_once_has_no_tools` (a tool call request from the model is refused and the run still finishes), `run_once_times_out_with_failed_status`.
- [ ] **Step 6: Implement `run_once.rs` and the subcommand.**
- [ ] **Step 7: Failing CLI tests** `spawn_rejects_sixth_concurrent_worker`, `spawn_records_running_then_done`, `spawn_crash_records_failed_with_reason`, `max_output_tokens_over_16000_is_refused`.
- [ ] **Step 8: Implement CLI group**; agent docs: when to use workers (research, drafts, variations), workers cannot act or spend, check output before handing it up, cost shows to the owner.
- [ ] **Step 9: CI green; commit** `feat(workers): budgeted worker runs for employees`.

### Task 5: Desktop: switch, company map, function pages, workers

**Files:**
- Create: `desktop/src/features/cofounder/cofounderRecords.ts`, `desktop/src/features/cofounder/hooks.ts`, `desktop/src/features/cofounder/functions.ts` (constants), `desktop/src/features/cofounder/ui/CompanyMapScreen.tsx`, `desktop/src/features/cofounder/ui/FunctionScreen.tsx`, `desktop/src/features/cofounder/ui/WorkerList.tsx`, `desktop/src/features/cofounder/ui/CofounderSettingRow.tsx`, route files `desktop/src/app/routes/company.map.tsx`, `desktop/src/app/routes/company.function.$function.tsx`, e2e `desktop/tests/e2e/cofounder-map.spec.ts`
- Modify: `desktop/src/app/routes.ts`, `desktop/src/app/topBarBreadcrumbs.ts:33`, `desktop/src/features/settings/ui/ExperimentalFeaturesCard.tsx`, `desktop/src/features/sidebar/ui/sidebarDestinations.tsx:128`, e2e bridge mocks (`desktop/src/testing/e2eBridge.ts`)

**Interfaces:**
- Consumes: heads from Tasks 1, 2, 4 (kinds 30670, 30671, 30672) via the relay query patterns in `features/company-asks/askRecords.ts`; role via `useMyRelayMembershipLookupQuery`; team via `features/company-team/teamRelay.ts:70 fetchCompanyTeam`; agent avatar components already used by the sidebar DM list.
- Produces:
  - `useCofounderSettingsQuery(communityId)`, `useSetCofounderSettings()`; `useFunctionSlotsQuery(communityId): FunctionSlotView[]` (always five, in order, missing head = Empty, lead no longer on the team = Empty); `useWorkerRunsQuery(parentPubkey)`.
  - `type FunctionId = "sales" | "operations" | "customer_success" | "finance" | "brand"`; `FUNCTION_ORDER: FunctionId[]` in that order.
  - `FUNCTION_DETAILS: Record<FunctionId, { name: string; subFunctions: string[]; suggestedHire: string; hireRoleId?: string }>` with the sub-functions from spec section 7 and suggested hires (Sales: Business development; Customer Success: Client Success Manager; Finance: Bookkeeper; Brand: Brand and Content Lead; Operations: covered by Scout until the playbook phase).

- [ ] **Step 1: Failing e2e (mock mode, smoke and integration projects, `COLONY_E2E_PORT=4373`)**: `owner sees co-founder switch and turns it on` (row labelled "<company> only"); `member sees the switch read-only`; `map shows Scout, five circles in order with Aya filled in Sales, Scout covering Operations, three empty`; `map shows no numbers or sub-functions` (no text matching /\d+ leads|Sub-functions/ on the map); `clicking Sales opens the Sales function page with Aya and the worker list`; `clicking Finance opens the empty page with Bookkeeper suggestion and Fill this slot linking to /hire/roles`; `a slot whose lead left the team shows empty`; `a running worker past its deadline shows Failed`.
- [ ] **Step 2: Implement records/hooks/constants, then the screens exactly to the boards** (map: logo tile centre, Scout node joined above, five branches, filled circles fully covered by the agent avatar with ring and status dot, Scout covering shows the ant with a half ring and "Covered by Scout", empty dashed circles with a soft +, filled branches accent, empty dashed; function pages per CFFunctionSales and CFFunctionFinance; workers show label, status, cost, Open output).
- [ ] **Step 3: Sidebar**: add "Company map" to the Company group only when co-founder mode is on.
- [ ] **Step 4: Screenshots** 1440 and 390, light and dark, beside the board PNGs (`/Users/mac/worktrees/.lanes/phase2/real-run-20261004/cofounder-design/shots/` once the coordinator copies them; until then the canvas). Post with `scripts/post-screenshots.sh`.
- [ ] **Step 5: CI green; commit** `feat(desktop): co-founder switch, company map and function pages`.

## Proof gate (coordinator, after merges and a packaged build)

On the owner's Horizon Labs company: switch on; assign Aya to Sales and cover Operations with Scout; open the map and both function pages; Scout runs `colony discovery search --query guesthouses --location "Melville, Johannesburg" --limit 10 --save` (owner OK for the spend) and 10 leads appear; Aya runs `colony workers spawn --label "Research: Melville guesthouses" --brief-file ...` and the worker's status, output and cost appear on the Sales page. Proof page with screenshots and the NOT-verified list.
