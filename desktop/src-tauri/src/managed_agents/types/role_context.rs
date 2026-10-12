//! The role context a hired employee runs with. It is stored on the
//! employee's record and exported to the harness as `COLONY_ROLE_CONTEXT`
//! (see `runtime::employee_env`).

use serde::{Deserialize, Serialize};

/// Days a new employee's first plan covers when nothing else is said.
const DEFAULT_PLAN_HORIZON_DAYS: u8 = 14;

fn default_plan_horizon_days() -> u8 {
    DEFAULT_PLAN_HORIZON_DAYS
}

/// What a hired employee needs to know about its role.
///
/// Serialized as camelCase with every key present (`null` or `[]` when
/// empty): that is the JSON the harness reads. Loading tolerates missing
/// optional keys, so a record written by another build still loads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleContext {
    /// The employee's configured title.
    pub title: String,
    /// The role's job, from the hired role pack.
    pub job: String,
    /// The outcome the role owns (the title of its goal).
    #[serde(default)]
    pub owns: Option<String>,
    /// Actions that always need a person first.
    #[serde(default)]
    pub ask_before: Vec<String>,
    /// Display name of the employee's manager, when it has one.
    #[serde(default)]
    pub manager_name: Option<String>,
    /// UUID of the employee's home channel.
    #[serde(default)]
    pub home_channel_id: Option<String>,
    /// UUID of the employee's goal, which is the hire id.
    #[serde(default)]
    pub goal_id: Option<String>,
    /// What the employee studies first.
    #[serde(default)]
    pub on_hire_sources: Vec<String>,
    /// Days the first plan covers, 1 to 30.
    #[serde(default = "default_plan_horizon_days")]
    pub plan_horizon_days: u8,
}

/// Bounds for a role context, matching the role pack v2 rules it is built from.
pub fn validate_role_context(context: &RoleContext) -> Result<(), String> {
    let text = |value: &str, max: usize| !value.trim().is_empty() && value.chars().count() <= max;
    if !text(&context.title, 120) {
        return Err("role context title must be 1 to 120 characters".to_string());
    }
    if !text(&context.job, 2_000) {
        return Err("role context job must be 1 to 2000 characters".to_string());
    }
    if context.owns.as_deref().is_some_and(|owns| !text(owns, 500)) {
        return Err("role context owns must be 1 to 500 characters".to_string());
    }
    if context.ask_before.len() > 16 || context.ask_before.iter().any(|item| !text(item, 120)) {
        return Err(
            "role context ask-before entries must be 1 to 120 characters and limited to 16"
                .to_string(),
        );
    }
    if context
        .manager_name
        .as_deref()
        .is_some_and(|name| !text(name, 120))
    {
        return Err("role context manager name must be 1 to 120 characters".to_string());
    }
    for (label, id) in [
        ("home channel", &context.home_channel_id),
        ("goal", &context.goal_id),
    ] {
        if id
            .as_deref()
            .is_some_and(|value| uuid::Uuid::parse_str(value).is_err())
        {
            return Err(format!("role context {label} must be a UUID"));
        }
    }
    if context.on_hire_sources.len() > 8
        || context
            .on_hire_sources
            .iter()
            .any(|source| !text(source, 200))
    {
        return Err(
            "role context on-hire sources must be 1 to 200 characters and limited to 8".to_string(),
        );
    }
    if !(1..=30).contains(&context.plan_horizon_days) {
        return Err("role context plan horizon must be 1 to 30 days".to_string());
    }
    Ok(())
}
