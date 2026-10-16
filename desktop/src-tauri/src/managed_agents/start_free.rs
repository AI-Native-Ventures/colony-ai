//! Start free: the user's agents run on OpenCode's free model and must never
//! fall back to another model when that model disappears.

/// Provider id saved by the Start free onboarding choice.
pub(crate) const START_FREE_PROVIDER: &str = "opencode-free";

/// Set or clear buzz-acp's strict-model flag for the effective provider.
pub(crate) fn apply_start_free_env(command: &mut std::process::Command, provider: Option<&str>) {
    if provider.map(str::trim) == Some(START_FREE_PROVIDER) {
        command.env("BUZZ_ACP_REQUIRE_MODEL", "1");
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
    fn require_model_env_only_for_opencode_free() {
        let mut free = std::process::Command::new("true");
        apply_start_free_env(&mut free, Some("opencode-free"));
        assert_eq!(
            env_of(&free, "BUZZ_ACP_REQUIRE_MODEL"),
            Some(Some("1".into()))
        );

        let mut own = std::process::Command::new("true");
        own.env("BUZZ_ACP_REQUIRE_MODEL", "1");
        apply_start_free_env(&mut own, Some("openrouter"));
        assert_eq!(
            env_of(&own, "BUZZ_ACP_REQUIRE_MODEL"),
            Some(None),
            "removed for every other provider"
        );

        let mut none = std::process::Command::new("true");
        apply_start_free_env(&mut none, None);
        assert_eq!(env_of(&none, "BUZZ_ACP_REQUIRE_MODEL"), Some(None));
    }
}
