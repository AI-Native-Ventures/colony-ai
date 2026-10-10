use super::*;
use std::collections::BTreeMap;

#[test]
fn credits_launch_requires_flag_local_backend_and_bundled_runtime() {
    let remote = BackendKind::Provider {
        id: "test".into(),
        config: serde_json::json!({}),
    };
    assert!(validate_selection(true, true, Some("buzz-agent"), &remote).is_err());
    for selected in [false, true] {
        for flag in [false, true] {
            for runtime in [None, Some("buzz-agent"), Some("codex")] {
                assert_eq!(
                    validate_selection(selected, flag, runtime, &BackendKind::Local).is_ok(),
                    !selected || (flag && runtime == Some("buzz-agent"))
                );
            }
        }
    }
}

#[test]
fn authoritative_launch_env_is_keyless_and_scrubs_stale_authorization() {
    let authorization = Authorization {
        session_id: uuid::Uuid::new_v4(),
        model: "server-model".into(),
        expires_in_seconds: 7200,
    };
    let mut command = Command::new("unused-test-command");
    for key in PROVIDER_KEYS {
        command.env(key, "synthetic-stale-key");
    }
    command
        .env(SESSION_ENV, "stale-session")
        .env(MODEL_ENV, "customer-model")
        .env("BUZZ_AGENT_PROVIDER", "openrouter")
        .env("BUZZ_ACP_SETUP_PAYLOAD", "stale-setup");
    apply(&mut command, Some(&authorization));
    let env: BTreeMap<_, _> = command
        .get_envs()
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                v.map(|v| v.to_string_lossy().into_owned()),
            )
        })
        .collect();
    for key in PROVIDER_KEYS {
        assert_eq!(env.get(*key), Some(&None), "{key}");
    }
    assert_eq!(
        env[SESSION_ENV].as_deref(),
        Some(authorization.session_id.to_string().as_str())
    );
    assert_eq!(
        env["BUZZ_AGENT_PROVIDER"].as_deref(),
        Some("colony-credits")
    );
    assert_eq!(env["BUZZ_AGENT_MODEL"].as_deref(), Some("server-model"));
    assert_eq!(env["BUZZ_ACP_MODEL"].as_deref(), Some("server-model"));
    assert_eq!(env["BUZZ_ACP_SETUP_PAYLOAD"], None);
    apply(&mut command, None);
    for key in [SESSION_ENV, MODEL_ENV, "COLONY_CREDITS_GATEWAY"] {
        assert_eq!(command.get_envs().find(|(k, _)| *k == key).unwrap().1, None);
    }
    for key in [SESSION_ENV, MODEL_ENV, "COLONY_CREDITS_GATEWAY"] {
        assert!(super::super::is_reserved_env_key(key));
    }
}

#[test]
fn native_authorization_checks_capability_and_signs_session_for_exact_owner_and_agent() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use nostr::JsonUtil;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let owner = Keys::generate();
    let agent = Keys::generate().public_key().to_hex();
    let expected_owner = owner.public_key();
    let expected_agent = agent.clone();
    let expected_url = format!("{origin}/api/credits-gateway/sessions");
    let session = uuid::Uuid::new_v4();
    let server = std::thread::spawn(move || {
        for i in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while !request.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() < 16384);
            }
            let headers = String::from_utf8(request).unwrap();
            if i == 1 {
                assert!(headers.starts_with("POST /api/credits-gateway/sessions "));
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|s| s.trim().parse().unwrap())
                    })
                    .unwrap();
                let mut body = vec![0; length];
                socket.read_exact(&mut body).unwrap();
                assert_eq!(
                    serde_json::from_slice::<serde_json::Value>(&body).unwrap()["agent_pubkey"],
                    expected_agent
                );
                let auth = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("authorization: Nostr "))
                    .unwrap();
                let event = nostr::Event::from_json(STANDARD.decode(auth).unwrap()).unwrap();
                event.verify().unwrap();
                assert_eq!(event.pubkey, expected_owner);
                let tags: Vec<_> = event
                    .tags
                    .iter()
                    .map(|tag| tag.as_slice().to_vec())
                    .collect();
                assert!(tags.contains(&vec!["u".into(), expected_url.clone()]));
                assert!(tags.contains(&vec!["payload".into(), hex::encode(Sha256::digest(&body))]));
            } else {
                assert!(headers.starts_with("GET /api/credits-gateway/capabilities "));
            }
            let body = if i == 0 { serde_json::json!({"enabled":true,"runtime":"colony"}) } else { serde_json::json!({"sessionId":session,"model":"server-model","expiresInSeconds":7200}) }.to_string();
            write!(socket,"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
    });
    let authorization = authorize(&origin, &agent, &owner).unwrap();
    assert_eq!(authorization.session_id, session);
    assert_eq!(authorization.model, "server-model");
    server.join().unwrap();
}

#[test]
fn credits_readiness_and_saved_choice_need_no_key_or_customer_model() {
    use crate::managed_agents::{agent_readiness, readiness::EffectiveAgentEnv};
    let effective = EffectiveAgentEnv {
        effective_command: "buzz-agent".into(),
        config_file_path: None,
        env: BTreeMap::from([("BUZZ_AGENT_PROVIDER".into(), "colony-credits".into())]),
    };
    let requirements = agent_readiness(&effective).requirements().to_vec();
    assert!(
        !requirements.iter().any(|r| matches!(
            r,
            crate::managed_agents::Requirement::EnvKey { .. }
                | crate::managed_agents::Requirement::NormalizedField { .. }
        )),
        "{requirements:?}"
    );
    let global = crate::managed_agents::GlobalAgentConfig {
        provider: Some("colony-credits".into()),
        ..Default::default()
    };
    let bytes = serde_json::to_vec(&global).unwrap();
    let restored: crate::managed_agents::GlobalAgentConfig =
        serde_json::from_slice(&bytes).unwrap();
    assert_eq!(restored.provider.as_deref(), Some("colony-credits"));
    assert!(restored.env_vars.is_empty());
    assert!(restored.model.is_none());
}
