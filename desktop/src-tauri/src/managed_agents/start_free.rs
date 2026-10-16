//! Start free: the user's agents run on OpenCode's free model and must never
//! fall back to another model when that model disappears.

/// Provider id saved by the Start free onboarding choice.
pub(crate) const START_FREE_PROVIDER: &str = "opencode-free";
/// Runtime id of Colony's own OpenCode.
const START_FREE_RUNTIME: &str = "opencode";
/// The only model a Start free agent may run on.
pub(crate) const START_FREE_MODEL: &str = "opencode/deepseek-v4.1-flash-free";

fn is_start_free(runtime_id: Option<&str>, provider: Option<&str>) -> bool {
    runtime_id == Some(START_FREE_RUNTIME) && provider.map(str::trim) == Some(START_FREE_PROVIDER)
}

/// Set or clear buzz-acp's strict-model flag. Only an OpenCode agent on the
/// Start free provider is strict; every other runtime or provider is cleared.
/// buzz-acp parses the flag as a clap bool, so the value must be "true".
pub(crate) fn apply_start_free_env(
    command: &mut std::process::Command,
    runtime_id: Option<&str>,
    provider: Option<&str>,
    model: Option<&str>,
) {
    if is_start_free(runtime_id, provider) {
        command.env("BUZZ_ACP_REQUIRE_MODEL", "true");
        if model.is_none() {
            // Start free means the free model; never let OpenCode pick its default.
            command.env("BUZZ_ACP_MODEL", START_FREE_MODEL);
        }
    } else {
        command.env_remove("BUZZ_ACP_REQUIRE_MODEL");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(command: &std::process::Command, key: &str) -> Option<Option<String>> {
        command
            .get_envs()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.map(|value| value.to_string_lossy().into_owned()))
    }

    #[test]
    fn require_model_env_only_for_opencode_on_the_free_provider() {
        let mut free = std::process::Command::new("true");
        apply_start_free_env(
            &mut free,
            Some("opencode"),
            Some("opencode-free"),
            Some(START_FREE_MODEL),
        );
        // clap's bool parser accepts only "true"/"false"; "1" crashed every spawn.
        assert_eq!(
            env_of(&free, "BUZZ_ACP_REQUIRE_MODEL"),
            Some(Some("true".into()))
        );
        assert_eq!(env_of(&free, "BUZZ_ACP_MODEL"), None, "explicit model kept");

        for (runtime, provider) in [
            (Some("claude"), Some("opencode-free")),
            (Some("buzz-agent"), Some("opencode-free")),
            (Some("opencode"), Some("openrouter")),
            (None, None),
        ] {
            let mut other = std::process::Command::new("true");
            other.env("BUZZ_ACP_REQUIRE_MODEL", "true");
            apply_start_free_env(&mut other, runtime, provider, None);
            assert_eq!(
                env_of(&other, "BUZZ_ACP_REQUIRE_MODEL"),
                Some(None),
                "cleared for {runtime:?}/{provider:?}"
            );
        }
    }

    #[test]
    fn start_free_without_a_model_pins_the_free_model() {
        let mut command = std::process::Command::new("true");
        apply_start_free_env(&mut command, Some("opencode"), Some("opencode-free"), None);
        assert_eq!(
            env_of(&command, "BUZZ_ACP_MODEL"),
            Some(Some(START_FREE_MODEL.into()))
        );
    }
}
