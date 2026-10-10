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
        auth_tag: Some("fresh-owner-authorization".into()),
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
    assert_eq!(
        env["BUZZ_AUTH_TAG"].as_deref(),
        Some("fresh-owner-authorization")
    );
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
    let agent_keys = Keys::generate();
    let agent = agent_keys.public_key().to_hex();
    let expected_owner = owner.public_key();
    let expected_agent = agent.clone();
    let expected_url = format!("{origin}/api/credits-gateway/sessions");
    let session = uuid::Uuid::new_v4();
    let server = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        for i in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            if i == 1 {
                use futures_util::{SinkExt, StreamExt};
                socket.set_nonblocking(true).unwrap();
                runtime.block_on(async {
                    tokio::time::timeout(Duration::from_secs(5), async {
                        let socket = tokio::net::TcpStream::from_std(socket).unwrap();
                        let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
                        ws.send(tokio_tungstenite::tungstenite::Message::Text(
                            serde_json::json!(["AUTH", "first-launch-challenge"])
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        let message = ws.next().await.unwrap().unwrap();
                        let frame: serde_json::Value =
                            serde_json::from_str(message.to_text().unwrap()).unwrap();
                        assert_eq!(frame[0], "AUTH");
                        let event: nostr::Event = serde_json::from_value(frame[1].clone()).unwrap();
                        event.verify().unwrap();
                        assert_eq!(event.pubkey.to_hex(), expected_agent);
                        let tag = event
                            .tags
                            .iter()
                            .find(|tag| tag.as_slice().first().map(String::as_str) == Some("auth"))
                            .unwrap();
                        let tag_json = serde_json::to_string(tag.as_slice()).unwrap();
                        assert_eq!(
                            buzz_sdk_pkg::nip_oa::verify_auth_tag(&tag_json, &event.pubkey)
                                .unwrap(),
                            expected_owner
                        );
                        ws.send(tokio_tungstenite::tungstenite::Message::Text(
                            serde_json::json!(["OK", event.id.to_hex(), true, ""])
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        let _ = ws.next().await;
                    })
                    .await
                    .unwrap();
                });
                continue;
            }
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
            if i == 2 {
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
    let authorization = authorize(&origin, &agent_keys, &owner).unwrap();
    assert_eq!(authorization.session_id, session);
    assert_eq!(authorization.model, "server-model");
    server.join().unwrap();
}

fn exercise_probe_cleanup(
    cancel_after_check: Option<usize>,
    missing_command: bool,
    cleanup_failure: bool,
    timeout: bool,
) {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use nostr::JsonUtil;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let owner = Keys::generate();
    let expected_owner = owner.public_key();
    let expected_url = format!("{origin}/api/credits-gateway/sessions");
    let session = uuid::Uuid::new_v4();
    let server = std::thread::spawn(move || {
        let mut expected_agent = String::new();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        listener.set_nonblocking(true).unwrap();
        for i in 0..4 {
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            let (mut socket, _) = loop {
                match listener.accept() {
                    Ok(socket) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "probe did not reach expected network step"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("fake relay accept failed: {error}"),
                }
            };
            socket.set_nonblocking(false).unwrap();
            if i == 1 {
                use futures_util::{SinkExt, StreamExt};
                socket.set_nonblocking(true).unwrap();
                runtime.block_on(async {
                    tokio::time::timeout(Duration::from_secs(5), async {
                        let socket = tokio::net::TcpStream::from_std(socket).unwrap();
                        let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
                        ws.send(tokio_tungstenite::tungstenite::Message::Text(
                            serde_json::json!(["AUTH", "first-launch-challenge"])
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        let message = ws.next().await.unwrap().unwrap();
                        let frame: serde_json::Value =
                            serde_json::from_str(message.to_text().unwrap()).unwrap();
                        assert_eq!(frame[0], "AUTH");
                        let event: nostr::Event = serde_json::from_value(frame[1].clone()).unwrap();
                        event.verify().unwrap();
                        expected_agent = event.pubkey.to_hex();
                        let tag = event
                            .tags
                            .iter()
                            .find(|tag| tag.as_slice().first().map(String::as_str) == Some("auth"))
                            .unwrap();
                        let tag_json = serde_json::to_string(tag.as_slice()).unwrap();
                        assert_eq!(
                            buzz_sdk_pkg::nip_oa::verify_auth_tag(&tag_json, &event.pubkey)
                                .unwrap(),
                            expected_owner
                        );
                        ws.send(tokio_tungstenite::tungstenite::Message::Text(
                            serde_json::json!(["OK", event.id.to_hex(), true, ""])
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        let _ = ws.next().await;
                    })
                    .await
                    .unwrap();
                });
                continue;
            }
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
            if i >= 2 {
                assert!(headers.starts_with(if i == 2 {
                    "POST /api/credits-gateway/sessions "
                } else {
                    "POST /api/credits-gateway/sessions/revoke "
                }));
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
                let body_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
                if i == 2 {
                    assert_eq!(body_json["agent_pubkey"], expected_agent);
                } else {
                    assert_eq!(body_json["session_id"], session.to_string());
                }
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
                assert!(tags.contains(&vec![
                    "u".into(),
                    if i == 2 {
                        expected_url.clone()
                    } else {
                        format!("{expected_url}/revoke")
                    }
                ]));
                assert!(tags.contains(&vec!["payload".into(), hex::encode(Sha256::digest(&body))]));
            } else {
                assert!(headers.starts_with("GET /api/credits-gateway/capabilities "));
            }
            let body = if i == 0 { serde_json::json!({"enabled":true,"runtime":"colony"}) } else if i == 3 { serde_json::json!({"revoked":true}) } else { serde_json::json!({"sessionId":session,"model":"server-model","expiresInSeconds":7200}) }.to_string();
            let status = if i == 3 && cleanup_failure {
                "503 Service Unavailable"
            } else {
                "200 OK"
            };
            write!(socket,"HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
    });
    let executable = if missing_command {
        std::path::PathBuf::from("colony-nonexistent-probe-binary")
    } else {
        std::env::current_exe().unwrap()
    };
    let mut command = Command::new(executable);
    command.args([
        "--exact",
        "managed_agents::credits_gateway::tests::credits_probe_child",
        "--nocapture",
    ]);
    command.env("COLONY_CREDITS_PROBE_CHILD", "1");
    if timeout {
        command.env("COLONY_CREDITS_PROBE_SLOW", "1");
    }
    command.env("COLONY_CONNECTION_MODEL", "forbidden-override");
    for key in PROVIDER_KEYS {
        command.env(key, "synthetic-stale-key");
    }
    let checks = std::sync::atomic::AtomicUsize::new(0);
    let output = run_connection_probe(
        command,
        &origin,
        &owner,
        || {
            cancel_after_check
                .is_none_or(|stop| checks.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < stop)
        },
        if timeout {
            Duration::from_millis(100)
        } else {
            Duration::from_secs(10)
        },
    );
    if cancel_after_check.is_some() || cleanup_failure {
        assert!(output.is_err());
    } else if missing_command || timeout {
        assert!(output.unwrap().is_none());
    } else {
        let output = output.unwrap().unwrap();
        assert!(
            output.status.success(),
            "probe child environment assertions failed"
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("credits-probe-child-env-ok"),
            "the exact child test did not execute"
        );
    }
    server.join().unwrap();
}

#[test]
fn credits_probe_child() {
    if std::env::var("COLONY_CREDITS_PROBE_CHILD").ok().as_deref() != Some("1") {
        return;
    }
    if std::env::var("COLONY_CREDITS_PROBE_SLOW").ok().as_deref() == Some("1") {
        std::thread::sleep(Duration::from_secs(5));
    }
    assert_eq!(
        std::env::var("BUZZ_AGENT_PROVIDER").unwrap(),
        "colony-credits"
    );
    assert_eq!(std::env::var("BUZZ_AGENT_MODEL").unwrap(), "server-model");
    assert_eq!(std::env::var("BUZZ_ACP_RUNTIME_ID").unwrap(), "buzz-agent");
    assert!(uuid::Uuid::parse_str(&std::env::var(SESSION_ENV).unwrap()).is_ok());
    assert!(nostr::Keys::parse(&std::env::var("BUZZ_PRIVATE_KEY").unwrap()).is_ok());
    assert!(std::env::var("BUZZ_RELAY_URL")
        .unwrap()
        .starts_with("http://127.0.0.1:"));
    assert!(std::env::var("COLONY_CONNECTION_MODEL").is_err());
    for key in PROVIDER_KEYS {
        assert!(std::env::var(key).is_err(), "{key} leaked");
    }
    println!("credits-probe-child-env-ok");
}

#[test]
fn native_probe_revokes_temporary_session_on_all_terminal_paths() {
    for (cancel, missing, cleanup_failure, timeout) in [
        (None, false, false, false),
        (Some(1), false, false, false),
        (Some(2), false, false, false),
        (Some(3), false, false, false),
        (None, true, false, false),
        (None, false, true, false),
        (None, false, false, true),
    ] {
        exercise_probe_cleanup(cancel, missing, cleanup_failure, timeout);
    }
    let owner = Keys::generate();
    assert!(run_connection_probe(
        Command::new("unused"),
        "invalid-relay",
        &owner,
        || false,
        Duration::from_secs(1)
    )
    .is_err());
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
