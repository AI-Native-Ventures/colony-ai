use std::collections::HashSet;

use crate::managed_agents::{AgentModelInfo, AgentModelsResponse};

pub(super) fn parse_codex_model_catalog(
    raw: &str,
    selected_model: Option<String>,
) -> Result<AgentModelsResponse, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("invalid Codex model catalog: {error}"))?;
    let entries = value
        .get("models")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Codex model catalog has no models array".to_string())?;

    let mut models = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries {
        let Some(slug) = entry
            .get("slug")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|slug| is_safe_catalog_id(slug) && !slug.contains('[') && !slug.contains(']'))
        else {
            continue;
        };
        if entry
            .get("visibility")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|visibility| visibility == "hidden")
        {
            continue;
        }

        let display_name = entry
            .get("display_name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| is_safe_catalog_label(name))
            .map(readable_codex_name)
            .unwrap_or_else(|| readable_model_name(slug));

        let mut efforts = entry
            .get("supported_reasoning_levels")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|level| {
                level
                    .get("effort")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|effort| is_codex_effort(effort))
                    .map(str::to_ascii_lowercase)
            })
            .collect::<Vec<_>>();
        if let Some(default_effort) = entry
            .get("default_reasoning_level")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|effort| is_codex_effort(effort))
            .map(str::to_ascii_lowercase)
        {
            if efforts.is_empty() {
                efforts.push(default_effort);
            }
        }

        let default_effort = entry
            .get("default_reasoning_level")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .map(str::to_ascii_lowercase);
        for effort in efforts {
            let id = format!("{slug}[{effort}]");
            if seen.insert(id.clone()) {
                let name = if default_effort.as_deref() == Some(effort.as_str()) {
                    display_name.clone()
                } else {
                    format!("{display_name} ({})", readable_effort(&effort))
                };
                models.push(AgentModelInfo {
                    id,
                    name: Some(name),
                    description: None,
                });
            }
        }
    }

    if models.is_empty() {
        return Err("Codex model catalog contains no visible models".to_string());
    }

    Ok(AgentModelsResponse {
        agent_name: "Codex".to_string(),
        agent_version: "codex-cli-catalog".to_string(),
        supports_switching: true,
        models,
        agent_default_model: None,
        selected_model,
    })
}

pub(super) fn parse_opencode_model_list(
    raw: &str,
    selected_model: Option<String>,
) -> Result<AgentModelsResponse, String> {
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    let mut agent_default_model = None;

    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let (line, marked_default) = strip_default_marker(line);
        let line = line
            .strip_prefix("- ")
            .or_else(|| line.strip_prefix("• "))
            .unwrap_or(line)
            .trim();
        let (id, display_name) = line
            .split_once("\t")
            .map(|(id, name)| (id.trim(), Some(name.trim())))
            .unwrap_or_else(|| {
                let mut parts = line.split_whitespace();
                (parts.next().unwrap_or(""), None)
            });
        if !is_safe_catalog_id(id) || !id.contains('/') || id.starts_with('/') || id.ends_with('/')
        {
            continue;
        }
        if id.eq_ignore_ascii_case("model") || id.eq_ignore_ascii_case("models") {
            continue;
        }

        if marked_default && agent_default_model.is_none() {
            agent_default_model = Some(id.to_string());
        }
        if seen.insert(id.to_string()) {
            models.push(AgentModelInfo {
                id: id.to_string(),
                name: display_name
                    .filter(|name| is_safe_catalog_label(name))
                    .map(str::to_string)
                    .or_else(|| Some(readable_model_name(id.rsplit('/').next().unwrap_or(id)))),
                description: None,
            });
        }
    }

    if models.is_empty() {
        return Err("OpenCode model list contains no provider/model entries".to_string());
    }

    Ok(AgentModelsResponse {
        agent_name: "OpenCode".to_string(),
        agent_version: "opencode-cli-model-list".to_string(),
        supports_switching: true,
        models,
        agent_default_model,
        selected_model,
    })
}

pub(super) fn merge_claude_code_aliases(response: &mut AgentModelsResponse) {
    const ALIASES: [(&str, &str); 3] = [
        ("sonnet", "Claude Sonnet"),
        ("opus", "Claude Opus"),
        ("haiku", "Claude Haiku"),
    ];
    let mut seen = response
        .models
        .iter()
        .map(|model| model.id.clone())
        .collect::<HashSet<_>>();
    for (id, name) in ALIASES {
        if seen.insert(id.to_string()) {
            response.models.push(AgentModelInfo {
                id: id.to_string(),
                name: Some(name.to_string()),
                description: None,
            });
        }
    }
    response.supports_switching = !response.models.is_empty();
}

pub(super) fn fallback_claude_model_catalog(selected_model: Option<String>) -> AgentModelsResponse {
    let mut response = AgentModelsResponse {
        agent_name: "Claude Code".to_string(),
        agent_version: "known-alias-fallback".to_string(),
        models: Vec::new(),
        agent_default_model: None,
        selected_model,
        supports_switching: false,
    };
    merge_claude_code_aliases(&mut response);
    response
}

pub(super) fn merge_model_responses(
    mut preferred: AgentModelsResponse,
    secondary: AgentModelsResponse,
) -> AgentModelsResponse {
    let mut seen = preferred
        .models
        .iter()
        .map(|model| model.id.clone())
        .collect::<HashSet<_>>();
    for model in secondary.models {
        if seen.insert(model.id.clone()) {
            preferred.models.push(model);
        }
    }
    if preferred.agent_default_model.is_none() {
        preferred.agent_default_model = secondary.agent_default_model;
    }
    if preferred.selected_model.is_none() {
        preferred.selected_model = secondary.selected_model;
    }
    preferred.supports_switching = !preferred.models.is_empty();
    preferred
}

pub(super) fn fallback_codex_model_catalog(selected_model: Option<String>) -> AgentModelsResponse {
    const FALLBACK_MODELS: [(&str, &str, &[&str]); 2] = [
        ("gpt-5.5", "GPT-5.5", &["low", "medium", "high"]),
        (
            "gpt-6-luna",
            "GPT-6 Luna",
            &["low", "medium", "high", "xhigh", "max"],
        ),
    ];
    let mut models = Vec::new();
    for (slug, display_name, efforts) in FALLBACK_MODELS {
        for effort in efforts {
            models.push(AgentModelInfo {
                id: format!("{slug}[{effort}]"),
                name: Some(if *effort == "medium" {
                    display_name.to_string()
                } else {
                    format!("{display_name} ({})", readable_effort(effort))
                }),
                description: None,
            });
        }
    }
    AgentModelsResponse {
        agent_name: "Codex".to_string(),
        agent_version: "known-model-fallback".to_string(),
        models,
        agent_default_model: None,
        selected_model,
        supports_switching: true,
    }
}

pub(super) fn fallback_opencode_model_catalog(
    selected_model: Option<String>,
) -> AgentModelsResponse {
    let models = [
        ("opencode/beam-free", "Beam Free"),
        ("opencode/big-pickle", "Big Pickle"),
    ]
    .into_iter()
    .map(|(id, name)| AgentModelInfo {
        id: id.to_string(),
        name: Some(name.to_string()),
        description: None,
    })
    .collect();
    AgentModelsResponse {
        agent_name: "OpenCode".to_string(),
        agent_version: "known-model-fallback".to_string(),
        models,
        agent_default_model: None,
        selected_model,
        supports_switching: true,
    }
}

fn strip_default_marker(line: &str) -> (&str, bool) {
    if let Some(rest) = line.strip_prefix("* ") {
        return (rest.trim(), true);
    }
    if let Some(rest) = line.strip_suffix(" (default)") {
        return (rest.trim(), true);
    }
    if let Some(rest) = line.strip_suffix(" [default]") {
        return (rest.trim(), true);
    }
    (line, false)
}

fn is_codex_effort(effort: &str) -> bool {
    matches!(
        effort.to_ascii_lowercase().as_str(),
        "low" | "medium" | "high" | "xhigh" | "max"
    )
}

fn is_safe_catalog_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 192
        && value
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
}

fn is_safe_catalog_label(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 160
        && value.chars().all(|character| !character.is_control())
}

fn readable_effort(effort: &str) -> String {
    match effort.to_ascii_lowercase().as_str() {
        "low" => "Low".to_string(),
        "medium" => "Medium".to_string(),
        "high" => "High".to_string(),
        "xhigh" => "Extra high".to_string(),
        "max" => "Max".to_string(),
        _ => readable_model_name(effort),
    }
}

fn readable_codex_name(name: &str) -> String {
    let Some(rest) = name.strip_prefix("GPT-") else {
        return name.to_string();
    };
    let version_end = rest
        .char_indices()
        .take_while(|(_, character)| character.is_ascii_digit() || *character == '.')
        .map(|(index, character)| index + character.len_utf8())
        .last()
        .unwrap_or(0);
    if version_end == 0 || !rest[version_end..].starts_with('-') {
        return name.to_string();
    }
    let suffix = rest[version_end + 1..].replace('-', " ");
    if suffix.is_empty() {
        name.to_string()
    } else {
        format!("GPT-{} {suffix}", &rest[..version_end])
    }
}

fn readable_model_name(model_id: &str) -> String {
    model_id
        .split(|character| character == '-' || character == '_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut characters = part.chars();
            match characters.next() {
                Some(first) => first.to_uppercase().chain(characters).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
#[path = "agent_model_catalog_tests.rs"]
mod tests;
