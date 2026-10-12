use std::fs;

use tauri::AppHandle;

use crate::{
    managed_agents::{AgentDefinition, CompanyRoleMetadata, RoleDutyTemplate, RoleOnHire},
    util::now_iso,
};

struct BuiltInPersona {
    id: &'static str,
    display_name: &'static str,
    avatar_url: Option<&'static str>,
    system_prompt: &'static str,
    name_pool: &'static [&'static str],
    model: Option<&'static str>,
    runtime: Option<&'static str>,
    default_active: bool,
    /// The role a hire copies. Code-owned: `merge_personas` refreshes the
    /// stored built-in from it on every load.
    company_role: Option<fn() -> CompanyRoleMetadata>,
}

pub(crate) const SCOUT_SYSTEM_PROMPT: &str =
    include_str!("../../../src/features/onboarding/assets/scout-instructions.txt");
const FIZZ_SYSTEM_PROMPT: &str = SCOUT_SYSTEM_PROMPT;
const SCOUT_PREVIOUS_SYSTEM_PROMPT: &str = "You are Scout, the user's Chief of Staff. Help the user get oriented, plan work, create, research, and finish tasks. Be warm, practical, and concise. Be candid about uncertainty.";
pub(super) const SCOUT_LEGACY_SYSTEM_PROMPT: &str = "You are Fizz, an energetic maker who turns ideas into action. Be upbeat, practical, and decisive. Help users plan, create, solve problems, and finish work. Add occasional bee wordplay or \u{1f41d}\u{2728}\u{2014}keep it charming, never distracting.";

const HONEY_SYSTEM_PROMPT: &str = "You are Honey, a warm and thoughtful communicator. Help users write clearly, organize ideas, brainstorm, summarize, and prepare for conversations. Be kind, creative, and concise. Add occasional bee wordplay or 🍯🐝. keep it sweet, never excessive.";

// Keep the published NIP-33 coordinate stable so existing Pollen agents and
// references are upgraded in place instead of being orphaned by the rename.
pub(crate) const POLLEN_PERSONA_ID: &str = "builtin:bumble";
pub(crate) const POLLEN_DISPLAY_NAME: &str = "Pollen";
pub(crate) const POLLEN_SYSTEM_PROMPT: &str = "You are Pollen, a curious and adventurous researcher. Explore questions, compare options, check assumptions, and explain what you find clearly. Be candid when uncertain and favor useful evidence. Add occasional bee wordplay or 🐝🔎. keep it playful, never chaotic.";
pub(crate) const POLLEN_LEGACY_DISPLAY_NAME: &str = "Bumble";
pub(crate) const POLLEN_LEGACY_SYSTEM_PROMPT: &str = "You are Bumble, a curious and adventurous researcher. Explore questions, compare options, check assumptions, and explain what you find clearly. Be candid when uncertain and favor useful evidence. Add occasional bee wordplay or 🐝🔎. keep it playful, never chaotic.";
// The embedded bytes are unchanged by the display-name migration. Keep the
// original storage symbol as the compatibility source and expose the current
// product name everywhere it is consumed.

const BUILT_IN_PERSONAS: &[BuiltInPersona] = &[
    BuiltInPersona {
        id: "builtin:fizz",
        display_name: "Scout",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: FIZZ_SYSTEM_PROMPT,
        name_pool: &["Scout"],
        model: None,
        runtime: None,
        default_active: true,
        company_role: None,
    },
    BuiltInPersona {
        id: "builtin:honey",
        display_name: "Writer",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: "You are a writing assistant. Help the user communicate clearly, summarize information, and prepare useful drafts. Be calm, thoughtful, and concise.",
        name_pool: &["Writer"],
        model: None,
        runtime: None,
        default_active: false,
        company_role: None,
    },
    BuiltInPersona {
        id: POLLEN_PERSONA_ID,
        display_name: "Researcher",
        avatar_url: Some(include_str!("scout_avatar.txt")),
        system_prompt: "You are a research assistant. Compare sources, check assumptions, and explain findings clearly. Be candid about uncertainty and provide useful evidence.",
        name_pool: &["Researcher"],
        model: None,
        runtime: None,
        default_active: false,
        company_role: None,
    },
];

/// Persona id of the real-run gate's fixture employee.
pub(crate) const TEST_EMPLOYEE_PERSONA_ID: &str = "builtin:test-employee";
/// `1` turns the fixture role pack on (real-run gate only).
pub(crate) const FIXTURE_ROLE_PACKS_ENV: &str = "COLONY_FIXTURE_ROLE_PACKS";
/// The fixture's daily note time, `HH:MM` in the company time zone (gate only).
pub(crate) const FIXTURE_DUTY_TIME_ENV: &str = "COLONY_FIXTURE_DUTY_TIME";
const DEFAULT_FIXTURE_DUTY_TIME: &str = "09:00";

const TEST_EMPLOYEE_SYSTEM_PROMPT: &str = "You are a test employee that shows Colony runs a team by itself. When you are hired, reply once in your conversation with one short sentence saying you are ready. When your Daily note routine wakes you, post one short note in your conversation saying the daily note ran, with today's date. Never post anything else.";

/// Built-ins that exist only when the real-run gate turns them on.
const FIXTURE_PERSONAS: &[BuiltInPersona] = &[BuiltInPersona {
    id: TEST_EMPLOYEE_PERSONA_ID,
    display_name: "Test Employee",
    avatar_url: Some(include_str!("scout_avatar.txt")),
    system_prompt: TEST_EMPLOYEE_SYSTEM_PROMPT,
    name_pool: &["Gate Tester"],
    model: None,
    runtime: None,
    default_active: true,
    company_role: Some(test_employee_role),
}];

/// Whether `value` (of `COLONY_FIXTURE_ROLE_PACKS`) turns the fixture on: only `1`.
pub(crate) fn fixture_role_packs_enabled_from(value: Option<&str>) -> bool {
    value == Some("1")
}

fn fixture_role_packs_enabled() -> bool {
    fixture_role_packs_enabled_from(std::env::var(FIXTURE_ROLE_PACKS_ENV).ok().as_deref())
}

fn is_clock(value: &str) -> bool {
    let Some((hour, minute)) = value.split_once(':') else {
        return false;
    };
    hour.len() == 2
        && minute.len() == 2
        && hour.parse::<u8>().is_ok_and(|hour| hour < 24)
        && minute.parse::<u8>().is_ok_and(|minute| minute < 60)
}

/// The fixture routine's schedule: `Every day at HH:MM` from the gate, else 09:00.
pub(crate) fn fixture_duty_schedule_from(value: Option<&str>) -> String {
    let time = value
        .map(str::trim)
        .filter(|time| is_clock(time))
        .unwrap_or(DEFAULT_FIXTURE_DUTY_TIME);
    let schedule = format!("Every day at {time}");
    if buzz_core_pkg::company_duties::parse_readable_schedule(&schedule).is_some() {
        schedule
    } else {
        format!("Every day at {DEFAULT_FIXTURE_DUTY_TIME}")
    }
}

/// The fixture's role pack.
fn test_employee_role() -> CompanyRoleMetadata {
    CompanyRoleMetadata {
        job: "Post one short note in your conversation every day, so the owner can see the team runs by itself.".to_string(),
        skills: vec!["Writing one short note".to_string()],
        tools: Vec::new(),
        worker_menu: vec![
            "claude".to_string(),
            "codex".to_string(),
            "buzz-agent".to_string(),
        ],
        default_allowance: None,
        owns: Some("One short note in the home channel every day".to_string()),
        channel: Some("test-employee".to_string()),
        duties: vec![RoleDutyTemplate {
            title: "Daily note".to_string(),
            schedule_text: fixture_duty_schedule_from(
                std::env::var(FIXTURE_DUTY_TIME_ENV).ok().as_deref(),
            ),
            instructions: "Post one short note in this conversation saying the daily note ran, with today's date.".to_string(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["business profile".to_string()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["posting anywhere other than this conversation".to_string()],
        home: Some("test.note".to_string()),
    }
}

/// The code-owned built-ins: the launch personas, then the fixture when the
/// real-run gate turned it on.
fn built_in_personas() -> Vec<&'static BuiltInPersona> {
    let fixtures: &'static [BuiltInPersona] = if fixture_role_packs_enabled() {
        FIXTURE_PERSONAS
    } else {
        &[]
    };
    BUILT_IN_PERSONAS.iter().chain(fixtures.iter()).collect()
}

pub(crate) fn built_in_persona_avatar_url(id: &str) -> Option<&'static str> {
    built_in_personas()
        .into_iter()
        .find(|persona| persona.id == id)
        .and_then(|persona| persona.avatar_url)
}

const RETIRED_PERSONAS: &[(&str, &str)] = &[
    (
        "builtin:solo",
        "",
    ),
    (
        "builtin:kit",
        "",
    ),
    (
        "builtin:scout",
        "",
    ),
    (
        "builtin:orchestrator",
        "You are an orchestration agent. Coordinate multi-step work across specialized agents, keep the overall plan moving, and synthesize results into a clear final outcome. When another agent should take a task, @mention them explicitly with the assignment, expected deliverable, and any relevant constraints or deadlines.",
    ),
    (
        "builtin:researcher",
        "You are a research agent. Gather relevant information, compare sources, call out uncertainty, and return concise findings with evidence.",
    ),
    (
        "builtin:planner",
        "You are a planning agent. Turn ambiguous requests into structured plans with milestones, dependencies, risks, and clear next actions. Do not implement the work yourself unless asked.",
    ),
    (
        "builtin:implementer",
        "You are a builder agent. Execute tasks directly, make code and configuration changes carefully, validate the result, and explain important decisions and follow-up items.",
    ),
    (
        "builtin:refactor",
        "You are a refactoring agent. Improve structure, naming, duplication, and module boundaries without changing externally observable behavior. Keep changes incremental, preserve compatibility, and add or update validation when behavior could drift.",
    ),
    (
        "builtin:reviewer",
        "You are a review agent. Inspect plans, code, and outputs for bugs, regressions, edge cases, security issues, and missing tests. Prioritize findings by severity, cite concrete evidence, and keep summaries secondary to the actual review.",
    ),
];

fn built_in_persona_records(now: &str) -> Vec<AgentDefinition> {
    persona_records(&built_in_personas(), now)
}

fn persona_records(built_ins: &[&'static BuiltInPersona], now: &str) -> Vec<AgentDefinition> {
    built_ins
        .iter()
        .map(|persona| AgentDefinition {
            company_role: persona.company_role.map(|role| role()),
            id: persona.id.to_string(),
            display_name: persona.display_name.to_string(),
            avatar_url: persona.avatar_url.map(|s| s.to_string()),
            description: None,
            system_prompt: persona.system_prompt.trim().to_string(),
            runtime: persona.runtime.map(|s| s.to_string()),
            model: persona.model.map(|s| s.to_string()),
            provider: None,
            name_pool: persona.name_pool.iter().map(|s| s.to_string()).collect(),
            is_builtin: true,
            is_active: persona.default_active,
            shared: false,
            source_team: None,
            source_team_persona_slug: None,
            catalog_source: None,
            team_catalog_source: None,
            env_vars: std::collections::BTreeMap::new(),
            respond_to: None,
            respond_to_allowlist: Vec::new(),
            parallelism: None,
            session_policy: super::AcpSessionPolicy::Channel,
            created_at: now.to_string(),
            updated_at: now.to_string(),
        })
        .collect()
}

pub(crate) fn built_in_persona_definition(id: &str, now: &str) -> Option<AgentDefinition> {
    built_in_persona_records(now)
        .into_iter()
        .find(|persona| persona.id == id)
}

fn built_in_order(id: &str) -> Option<usize> {
    built_in_personas()
        .iter()
        .position(|persona| persona.id == id)
}

fn sort_personas(records: &mut [AgentDefinition]) {
    records.sort_by(|left, right| {
        let left_builtin = if left.is_builtin { 0 } else { 1 };
        let right_builtin = if right.is_builtin { 0 } else { 1 };

        left_builtin
            .cmp(&right_builtin)
            .then_with(
                || match (built_in_order(&left.id), built_in_order(&right.id)) {
                    (Some(left_order), Some(right_order)) => left_order.cmp(&right_order),
                    _ => std::cmp::Ordering::Equal,
                },
            )
            .then_with(|| {
                left.display_name
                    .to_lowercase()
                    .cmp(&right.display_name.to_lowercase())
            })
            .then_with(|| left.id.cmp(&right.id))
    });
}

pub(crate) fn is_stock_scout_prompt(prompt: &str) -> bool {
    matches!(prompt.trim(), "" | SCOUT_PREVIOUS_SYSTEM_PROMPT | SCOUT_LEGACY_SYSTEM_PROMPT)
        || prompt.trim() == SCOUT_SYSTEM_PROMPT.trim()
        || prompt.trim() == "You are Scout, an energetic maker who turns ideas into action. Be upbeat, practical, and decisive. Help users plan, create, solve problems, and finish work."
}

fn merge_personas(stored: Vec<AgentDefinition>, now: &str) -> (Vec<AgentDefinition>, bool) {
    merge_personas_with(stored, now, &built_in_personas())
}

/// [`merge_personas`] against an explicit built-in list, so tests can merge
/// the fixture without touching the process environment.
fn merge_personas_with(
    mut stored: Vec<AgentDefinition>,
    now: &str,
    built_ins: &[&'static BuiltInPersona],
) -> (Vec<AgentDefinition>, bool) {
    let mut changed = false;

    for built_in in persona_records(built_ins, now) {
        if let Some(existing) = stored.iter_mut().find(|record| record.id == built_in.id) {
            if !existing.is_builtin {
                existing.is_builtin = true;
                changed = true;
            }
            // A built-in's company role is code-owned: refresh it on every load.
            if existing.company_role != built_in.company_role {
                existing.company_role = built_in.company_role.clone();
                existing.updated_at = now.to_string();
                changed = true;
            }
        } else {
            stored.push(built_in);
            changed = true;
        }
    }

    for record in &mut stored {
        if record.id == "builtin:fizz" && is_stock_scout_prompt(&record.system_prompt) {
            if is_stock_scout_prompt(&record.system_prompt)
                && record.system_prompt != SCOUT_SYSTEM_PROMPT.trim()
            {
                record.system_prompt = SCOUT_SYSTEM_PROMPT.trim().to_string();
                record.updated_at = now.to_string();
                changed = true;
            }
            if record.display_name == "Fizz" {
                record.display_name = "Scout".to_string();
                record.name_pool = record
                    .name_pool
                    .iter()
                    .map(|name| {
                        if name == "Fizz" {
                            "Scout".to_string()
                        } else {
                            name.clone()
                        }
                    })
                    .collect();
                record.avatar_url = built_in_persona_avatar_url("builtin:fizz").map(str::to_string);
                record.updated_at = now.to_string();
                changed = true;
            }
        }
        if matches!(record.id.as_str(), "builtin:honey" | "builtin:bumble")
            && matches!(
                record.system_prompt.as_str(),
                HONEY_SYSTEM_PROMPT | POLLEN_SYSTEM_PROMPT | POLLEN_LEGACY_SYSTEM_PROMPT
            )
        {
            if let Some(built_in) = built_in_persona_definition(&record.id, now) {
                if matches!(
                    record.system_prompt.as_str(),
                    HONEY_SYSTEM_PROMPT | POLLEN_SYSTEM_PROMPT | POLLEN_LEGACY_SYSTEM_PROMPT
                ) {
                    record.system_prompt = built_in.system_prompt;
                    record.is_active = false;
                    record.updated_at = now.to_string();
                    changed = true;
                }
                if matches!(record.display_name.as_str(), "Honey" | "Pollen" | "Bumble") {
                    record.display_name = built_in.display_name;
                    record.name_pool = built_in.name_pool;
                    record.avatar_url =
                        built_in_persona_avatar_url("builtin:fizz").map(str::to_string);
                    record.updated_at = now.to_string();
                    changed = true;
                }
            }
        }
    }

    // Demote any stored persona still flagged as built-in whose id is no
    // longer in BUILT_IN_PERSONAS (e.g. a built-in that has been retired).
    // The record stays so existing managed-agent and team references keep
    // working; the user can delete it from the catalog like any custom
    // persona once they no longer need it.
    for record in stored.iter_mut() {
        if record.is_builtin && !built_ins.iter().any(|persona| persona.id == record.id) {
            record.is_builtin = false;
            record.updated_at = now.to_string();
            changed = true;
        }
    }

    // Soft-deprecate retired built-in personas that were replaced by
    // Fizz. Runs after demotion so the records are already
    // marked as non-builtin.
    if migrate_retired_personas(&mut stored, now) {
        changed = true;
    }

    sort_personas(&mut stored);
    (stored, changed)
}

/// Soft-deprecate retired built-in personas by appending " (retired)" to
/// their display name and marking them inactive. Never removes records .
/// the cost is extra records for pre-transition users, but this
/// eliminates dangling `persona_id` references in managed-agents.json
/// and teams.json.
fn migrate_retired_personas(stored: &mut [AgentDefinition], now: &str) -> bool {
    let mut changed = false;

    for record in stored.iter_mut() {
        if let Some((_, original_prompt)) = RETIRED_PERSONAS.iter().find(|(id, _)| *id == record.id)
        {
            let retired_suffix = " (retired)";
            let needs_suffix = !record.display_name.ends_with(retired_suffix);
            if needs_suffix || record.is_active {
                let was_unmodified = record.system_prompt == *original_prompt;
                eprintln!(
                    "buzz-desktop: persona-migration: retiring {} persona '{}' → '{} (retired)'",
                    if was_unmodified {
                        "unmodified"
                    } else {
                        "customized"
                    },
                    record.display_name,
                    record.display_name,
                );
                if needs_suffix {
                    record.display_name = format!("{}{}", record.display_name, retired_suffix);
                }
                record.is_active = false;
                record.updated_at = now.to_string();
                changed = true;
            }
        }
    }

    changed
}

pub fn ensure_persona_is_active(
    personas: &[AgentDefinition],
    persona_id: &str,
) -> Result<(), String> {
    let persona = personas
        .iter()
        .find(|candidate| candidate.id == persona_id)
        .ok_or_else(|| format!("agent {persona_id} not found"))?;

    if !persona.is_active {
        return Err(format!("{} is not in My Agents.", persona.display_name));
    }

    Ok(())
}

pub fn ensure_persona_ids_are_active(
    personas: &[AgentDefinition],
    persona_ids: &[String],
) -> Result<(), String> {
    for persona_id in persona_ids {
        ensure_persona_is_active(personas, persona_id)?;
    }

    Ok(())
}

pub fn validate_persona_deletion(
    persona: &AgentDefinition,
    referenced_by_team: bool,
) -> Result<(), String> {
    if persona.is_builtin {
        return Err("Built-in agents cannot be deleted.".to_string());
    }

    if persona.source_team.is_some() {
        return Err(format!(
            "{} belongs to a team. Delete the team to remove all team agents together.",
            persona.display_name
        ));
    }

    if referenced_by_team {
        return Err(format!(
            "{} is still referenced by a team. Remove it from those teams first.",
            persona.display_name
        ));
    }

    Ok(())
}

pub fn validate_persona_activation_change(
    persona: &AgentDefinition,
    active: bool,
    referenced_by_managed_agent: bool,
    referenced_by_team: bool,
) -> Result<(), String> {
    if !persona.is_builtin {
        return Err("Only built-in agents can be added to or removed from My Agents.".to_string());
    }

    if !active && referenced_by_managed_agent {
        return Err(format!(
            "{} is still assigned to a managed agent. Remove or reassign those agents first.",
            persona.display_name
        ));
    }

    if !active && referenced_by_team {
        return Err(format!(
            "{} is still referenced by a team. Remove it from those teams first.",
            persona.display_name
        ));
    }

    Ok(())
}

pub fn load_personas<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<AgentDefinition>, String> {
    let now = now_iso();

    // Post-fold: definitions live in the unified agent store, presented in
    // the legacy shape. Pre-fold stores are converted by
    // `fold_personas_into_agent_store` in boot migrations before any caller
    // reaches this shim.
    let records = crate::managed_agents::storage::load_factory_agent_definitions(app)?
        .iter()
        .filter_map(|record| record.to_definition_view())
        .collect();

    let (records, changed) = merge_personas(records, &now);
    if changed {
        save_personas(app, &records)?;
    }

    Ok(records)
}

/// Resolve persona definitions for Factory without writing merged built-ins
/// back to the managed-agent store.
pub(crate) fn load_factory_personas<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<AgentDefinition>, String> {
    let records = crate::managed_agents::storage::load_agent_definitions(app)?
        .iter()
        .filter_map(|record| record.to_definition_view())
        .collect();
    Ok(merge_personas(records, &now_iso()).0)
}

/// Read the raw persona records at `path` .  no built-in merge, no write-back.
/// The single disk-read seam for persona definitions: `load_personas` layers
/// the built-in merge on top, and the boot-time readers that need raw records
/// without an `AppHandle` (`event_sync`, `migration::load_persona_runtimes`)
/// call it directly. The A2 store fold retargets THIS function at the unified
/// store; its callers stay unchanged.
pub(crate) fn load_personas_from_path(
    path: &std::path::Path,
) -> Result<Vec<AgentDefinition>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("failed to read persona store: {error}"))?;
    serde_json::from_str::<Vec<AgentDefinition>>(&content)
        .map_err(|error| format!("failed to parse persona store: {error}"))
}

pub fn save_personas<R: tauri::Runtime>(
    app: &AppHandle<R>,
    records: &[AgentDefinition],
) -> Result<(), String> {
    let mut sorted = records.to_vec();
    sort_personas(&mut sorted);

    // Post-fold: persona saves write key-less definition records into the
    // unified agent store (instances preserved by `save_agent_definitions`).
    let definitions: Vec<_> = sorted
        .into_iter()
        .map(|persona| persona.into_agent_record())
        .collect();
    crate::managed_agents::storage::save_agent_definitions(app, &definitions)
}

#[cfg(test)]
mod tests;
