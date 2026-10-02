use super::*;

#[test]
fn deepseek_requires_key_and_model_for_explicit_and_default_provider() {
    for provider in [None, Some("deepseek")] {
        let mut values = env_with(&[("DEEPSEEK_MODEL", "deepseek-chat")]);
        if let Some(provider) = provider {
            values.insert("BUZZ_AGENT_PROVIDER".into(), provider.into());
        }
        let env = make_env("buzz-agent", values.clone());
        assert!(
            buzz_agent_requirements(&env).contains(&Requirement::EnvKey {
                key: "DEEPSEEK_API_KEY".into(),
            })
        );
        values.insert("DEEPSEEK_API_KEY".into(), "fixture-key".into());
        let env = make_env("buzz-agent", values.clone());
        let missing = buzz_agent_requirements(&env);
        assert!(!missing.iter().any(|r| matches!(
            r,
            Requirement::EnvKey { .. } | Requirement::NormalizedField { .. }
        )));
        values.remove("DEEPSEEK_MODEL");
        let env = make_env("buzz-agent", values);
        assert!(
            buzz_agent_requirements(&env).contains(&Requirement::NormalizedField {
                field: "model".into()
            })
        );
    }
}

#[test]
fn process_provider_is_used_before_deepseek_default() {
    let env = make_env(
        "buzz-agent",
        env_with(&[
            ("LLM_PROVIDER", "openrouter"),
            ("OPENROUTER_MODEL", "fixture-model"),
            ("OPENROUTER_API_KEY", "fixture-key"),
        ]),
    );
    assert!(!buzz_agent_requirements(&env).iter().any(|r| matches!(
        r,
        Requirement::EnvKey { .. } | Requirement::NormalizedField { .. }
    )));
}

#[test]
fn shared_deepseek_provider_option_requires_its_key_for_goose_too() {
    let mut values = env_with(&[
        ("GOOSE_PROVIDER", "deepseek"),
        ("GOOSE_MODEL", "deepseek-chat"),
    ]);
    let env = make_env("goose", values.clone());
    assert!(
        goose_requirements(&env, None).contains(&Requirement::EnvKey {
            key: "DEEPSEEK_API_KEY".into()
        })
    );
    values.insert("DEEPSEEK_API_KEY".into(), "fixture-key".into());
    assert!(goose_requirements(&make_env("goose", values), None).is_empty());
}
