//! The persona creation command surface, split from `mod.rs` (file-size cap)
//! as the sibling of [`super::update`].

use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    managed_agents::{
        apply_persona_behavior, load_personas, save_personas, try_regenerate_nest,
        validate_agent_definition_text, validate_company_role_metadata, AgentDefinition,
        CatalogSource, CreatePersonaRequest,
    },
    util::now_iso,
};

use super::{normalize_description, pending, retain_persona_pending, trim_optional, trim_required};

#[tauri::command]
pub async fn create_persona(
    input: CreatePersonaRequest,
    app: AppHandle,
) -> Result<AgentDefinition, String> {
    tokio::task::spawn_blocking(move || create_persona_blocking(input, &app))
        .await
        .map_err(|e| format!("spawn_blocking failed: {e}"))?
}

/// The storage transaction behind the native `create_persona` command.
///
/// Keeping the command wrapper as a thin async boundary lets a headless Tauri
/// runtime exercise the exact validation, persistence, retention, and nest
/// regeneration path without duplicating it in a test-only implementation.
pub(super) fn create_persona_blocking<R: tauri::Runtime>(
    input: CreatePersonaRequest,
    app: &tauri::AppHandle<R>,
) -> Result<AgentDefinition, String> {
    use tauri::Manager;

    let state = app.state::<AppState>();
    let display_name = trim_required(&input.display_name, "Display name")?;
    // System prompt optional: core memory is auto-injected. Empty is valid.
    // Preserve it byte-for-byte: shared/import review surfaces show this
    // exact string before the ACP harness executes it.
    let system_prompt = input.system_prompt.clone();
    validate_agent_definition_text(&display_name, &system_prompt)?;
    let description = normalize_description(input.description)?;
    let company_role = input
        .company_role
        .map(|role| {
            validate_company_role_metadata(&role)?;
            Ok::<_, String>(role)
        })
        .transpose()?;
    let avatar_url = trim_optional(input.avatar_url);
    let runtime = trim_optional(input.runtime);
    let model = trim_optional(input.model);
    let provider = trim_optional(input.provider);
    // Normalized before the store is touched: a coordinate that can't match
    // a publication is worse than no coordinate, because it silently
    // re-enables the duplicate add it exists to prevent.
    let catalog_source = input
        .catalog_source
        .map(CatalogSource::normalized)
        .transpose()?;
    let now = now_iso();
    let _store_guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut personas = load_personas(app)?;
    pending::project_active_persona_sharing(app, &state, &mut personas);
    let name_pool: Vec<String> = input
        .name_pool
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    crate::managed_agents::validate_user_env_keys(&input.env_vars)?;
    let mut persona = AgentDefinition {
        company_role,
        id: Uuid::new_v4().to_string(),
        display_name,
        avatar_url,
        description,
        system_prompt,
        runtime,
        model,
        provider,
        name_pool,
        is_builtin: false,
        is_active: true,
        shared: false,
        source_team: None,
        source_team_persona_slug: None,
        catalog_source,
        // Team-publication provenance is set only by
        // `add_team_from_catalog`, never by an ordinary create.
        team_catalog_source: None,
        env_vars: input.env_vars,
        respond_to: None,
        respond_to_allowlist: Vec::new(),
        parallelism: None,
        session_policy: crate::managed_agents::AcpSessionPolicy::Channel,
        created_at: now.clone(),
        updated_at: now,
    };
    apply_persona_behavior(&mut persona, input.behavior)?;
    personas.push(persona.clone());
    save_personas(app, &personas)?;
    retain_persona_pending(app, &state, &persona);
    try_regenerate_nest(app);
    Ok(persona)
}

#[cfg(test)]
mod production_seam_tests {
    use std::collections::BTreeMap;

    use super::create_persona_blocking;
    use crate::{
        app_state::build_app_state,
        managed_agents::{
            CompanyRoleMetadata, CompanyRoleTool, CompanyToolRisk, CreatePersonaRequest,
        },
    };

    /// Overrides a process-wide path variable while the managed-agent test
    /// mutex is held, then restores its exact prior value on every exit path.
    struct EnvVarGuard {
        key: String,
        prior: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &str, value: &std::path::Path) -> Self {
            let prior = std::env::var_os(key);
            std::env::set_var(key, value);
            Self {
                key: key.to_string(),
                prior,
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.prior {
                Some(value) => std::env::set_var(&self.key, value),
                None => std::env::remove_var(&self.key),
            }
        }
    }

    #[test]
    fn create_persona_preserves_company_role_after_list() {
        // This drives the native command pair a desktop client uses. Removing
        // the company-role mapping from AgentDefinition::into_agent_record or
        // ManagedAgentRecord::to_definition_view makes the reloaded assertion
        // below fail, so this is not a mock-only catalog check.
        let _env_guard = crate::managed_agents::lock_path_mutex();
        let temp = tempfile::tempdir().expect("temporary app data directory");
        let home = temp.path().join("home");
        std::fs::create_dir_all(&home).expect("temporary home directory");
        let _home_guard = EnvVarGuard::set("HOME", &home);
        let _xdg_guard = EnvVarGuard::set("XDG_DATA_HOME", &home);

        let app = tauri::test::mock_builder()
            .manage(build_app_state())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app builds headless");
        let role = CompanyRoleMetadata {
            job: "Hospitality research".to_string(),
            skills: vec!["Market research".to_string(), "Synthesis".to_string()],
            tools: vec![CompanyRoleTool {
                name: "Web search".to_string(),
                risk: CompanyToolRisk::Low,
            }],
            worker_menu: vec!["buzz-agent".to_string()],
            default_allowance: Some("50".to_string()),
        };

        let created = create_persona_blocking(
            CreatePersonaRequest {
                display_name: "Hospitality researcher".to_string(),
                avatar_url: None,
                description: Some("Finds hospitality market evidence.".to_string()),
                company_role: Some(role.clone()),
                system_prompt: "Research hospitality accounts.".to_string(),
                runtime: Some("buzz-agent".to_string()),
                model: None,
                provider: None,
                name_pool: Vec::new(),
                env_vars: BTreeMap::new(),
                behavior: None,
                catalog_source: None,
            },
            app.handle(),
        )
        .expect("create_persona must persist the role pack");
        assert_eq!(created.company_role.as_ref(), Some(&role));

        let reloaded = super::super::list_personas_blocking(app.handle())
            .expect("list_personas must read the stored role pack");
        let listed = reloaded
            .iter()
            .find(|persona| persona.id == created.id)
            .expect("the created persona must be listed");
        assert_eq!(listed.company_role.as_ref(), Some(&role));
    }
}
