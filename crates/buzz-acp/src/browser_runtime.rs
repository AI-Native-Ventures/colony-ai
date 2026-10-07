//! Main-owned browser launch configuration and immutable ACP session identity.

use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::acp::{AcpError, EnvVar, McpServer};
use crate::scope::SessionScope;

const DOMAIN: &[u8] = b"colony-browser/session/v1\n";
const LAUNCH_KEYS: &[&str] = &[
    "COLONY_BROWSER_MCP_COMMAND",
    "COLONY_BROWSER_MCP_SCRIPT",
    "COLONY_BROWSER_MCP_RUN_AS_NODE",
    "COLONY_BROWSER_BROKER_SOCKET",
    "COLONY_BROWSER_BROKER_MASTER",
];

fn invalid_identity() -> AcpError {
    AcpError::Protocol("Invalid browser session identity".into())
}

fn community_origin(relay: &str) -> Result<String, AcpError> {
    if relay.is_empty()
        || relay.encode_utf16().count() > 2048
        || relay.chars().any(|ch| ch <= '\u{20}' || ch == '\u{7f}')
    {
        return Err(invalid_identity());
    }
    let mut url = url::Url::parse(relay).map_err(|_| invalid_identity())?;
    if !matches!(url.scheme(), "http" | "https" | "ws" | "wss")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host().is_none()
    {
        return Err(invalid_identity());
    }
    match url.scheme() {
        "ws" => url.set_scheme("http").map_err(|_| invalid_identity())?,
        "wss" => url.set_scheme("https").map_err(|_| invalid_identity())?,
        _ => {}
    }
    Ok(url.origin().ascii_serialization())
}

fn credential(master: &str, agent: &str, task: &str, origin: &str) -> Result<String, AcpError> {
    if !(16..=256).contains(&master.encode_utf16().count())
        || agent.len() != 64
        || !agent
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid_identity());
    }
    let key = serde_json::to_string(&[agent, task, origin])?;
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(master.as_bytes())
        .map_err(|_| invalid_identity())?;
    mac.update(DOMAIN);
    mac.update(key.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

fn with_browser_server(
    mut servers: Vec<McpServer>,
    scope: Option<&SessionScope>,
    channel_type: Option<&str>,
    agent: &str,
    relay: &str,
    get_env: impl Fn(&str) -> Option<String>,
) -> Result<Vec<McpServer>, AcpError> {
    // A supplied server must never impersonate the managed browser authority.
    servers.retain(|server| !server.name.eq_ignore_ascii_case("colony-browser"));
    if get_env("COLONY_BROWSER_AGENT").as_deref() != Some("1") {
        return Ok(servers);
    }
    let task = match scope {
        Some(SessionScope::Thread {
            channel_id,
            root_event_id,
        }) => {
            if root_event_id.len() != 64
                || !root_event_id
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(invalid_identity());
            }
            format!("thread:{channel_id}:{root_event_id}")
        }
        Some(SessionScope::Conversation { channel_id }) if channel_type == Some("dm") => {
            format!("conversation:{channel_id}")
        }
        _ => return Ok(servers),
    };
    let Some(launch) = LAUNCH_KEYS
        .iter()
        .map(|key| get_env(key))
        .collect::<Option<Vec<_>>>()
    else {
        // Bare CLI and remote harnesses have no main-owned local browser host.
        return Ok(servers);
    };
    if launch.iter().any(|value| {
        value.is_empty()
            || value.encode_utf16().count() > 4096
            || value.chars().any(|ch| ch < '\u{20}' || ch == '\u{7f}')
    }) || !matches!(launch[2].as_str(), "0" | "1")
    {
        return Err(invalid_identity());
    }
    let origin = community_origin(relay)?;
    let secret = credential(&launch[4], agent, &task, &origin)?;
    let mut env = vec![
        EnvVar {
            name: "COLONY_BROWSER_BROKER_SOCKET".into(),
            value: launch[3].clone(),
        },
        EnvVar {
            name: "COLONY_BROWSER_BROKER_SECRET".into(),
            value: secret,
        },
        EnvVar {
            name: "COLONY_BROWSER_AGENT_ID".into(),
            value: agent.into(),
        },
        EnvVar {
            name: "COLONY_BROWSER_TASK_ID".into(),
            value: task,
        },
        EnvVar {
            name: "COLONY_BROWSER_COMMUNITY_ORIGIN".into(),
            value: origin,
        },
    ];
    if launch[2] == "1" {
        env.push(EnvVar {
            name: "ELECTRON_RUN_AS_NODE".into(),
            value: "1".into(),
        });
    }
    servers.push(McpServer {
        name: "colony-browser".into(),
        command: launch[0].clone(),
        args: vec![launch[1].clone()],
        env,
    });
    Ok(servers)
}

/// Append a managed browser server using the admitted task's canonical scope.
/// Only this trusted harness sees the master; the MCP child receives a derived
/// credential bound to the agent, task and canonical community origin.
pub(crate) fn mcp_servers_with_browser(
    servers: Vec<McpServer>,
    scope: Option<&SessionScope>,
    channel_type: Option<&str>,
    agent: &str,
    relay: &str,
) -> Result<Vec<McpServer>, AcpError> {
    with_browser_server(servers, scope, channel_type, agent, relay, |key| {
        std::env::var(key).ok()
    })
}

/// Browser authority is never inherited by the general agent subprocess.
/// Apply after all explicit persona overrides as well as runtime defaults.
pub(crate) fn remove_browser_agent_env(
    command: &mut tokio::process::Command,
    extra_env: &[(String, String)],
) {
    let keys = std::env::vars_os().map(|(key, _)| key).chain(
        extra_env
            .iter()
            .map(|(key, _)| std::ffi::OsString::from(key.as_str())),
    );
    for key in keys {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("COLONY_BROWSER_")
        {
            command.env_remove(key);
        }
    }
}

/// Mask browser credential fields in outbound observer copies, while leaving
/// the actual session/new wire payload untouched.
pub(crate) fn observer_safe_browser_request(value: &serde_json::Value) -> serde_json::Value {
    let mut safe = value.clone();
    if let Some(servers) = safe
        .pointer_mut("/params/mcpServers")
        .and_then(serde_json::Value::as_array_mut)
    {
        for server in servers {
            if let Some(env) = server
                .get_mut("env")
                .and_then(serde_json::Value::as_array_mut)
            {
                for entry in env {
                    let sensitive = entry
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|name| {
                            name.eq_ignore_ascii_case("COLONY_BROWSER_BROKER_SECRET")
                                || name.eq_ignore_ascii_case("COLONY_BROWSER_BROKER_MASTER")
                        });
                    if sensitive {
                        if let Some(value) = entry.get_mut("value") {
                            *value = serde_json::Value::String("[redacted]".into());
                        }
                    }
                }
            }
        }
    }
    safe
}

#[cfg(test)]
#[path = "../../../test-support/brand_guard.rs"]
mod browser_brand_guard;

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn launch(key: &str) -> Option<String> {
        match key {
            "COLONY_BROWSER_AGENT" => Some("1".into()),
            "COLONY_BROWSER_MCP_COMMAND" => Some("/fixture/electron".into()),
            "COLONY_BROWSER_MCP_SCRIPT" => Some("/fixture/mcp-server.mjs".into()),
            "COLONY_BROWSER_MCP_RUN_AS_NODE" => Some("1".into()),
            "COLONY_BROWSER_BROKER_SOCKET" => Some("/fixture/browser.sock".into()),
            "COLONY_BROWSER_BROKER_MASTER" => Some("fixture-master-only-1-never-real".into()),
            _ => None,
        }
    }

    fn thread() -> SessionScope {
        SessionScope::Thread {
            channel_id: Uuid::parse_str("12345678-1234-5678-9abc-123456789abc")
                .expect("fixture UUID"),
            root_event_id: "cd".repeat(32),
        }
    }

    #[test]
    fn shared_node_hmac_vectors_match() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(
            "../../../desktop/electron/browser-broker/session-identity-vectors.json"
        ))
        .expect("shared public fixture vectors");
        for vector in vectors.as_array().expect("vector array") {
            let context = &vector["context"];
            let origin = community_origin(vector["relay"].as_str().expect("relay"))
                .expect("valid community");
            assert_eq!(
                origin.as_str(),
                context["communityOrigin"].as_str().expect("origin")
            );
            let derived = credential(
                vector["master"].as_str().expect("fixture master"),
                context["agentId"].as_str().expect("agent"),
                context["taskId"].as_str().expect("task"),
                &origin,
            )
            .expect("derive credential");
            assert_eq!(
                derived.as_str(),
                vector["credential"].as_str().expect("credential")
            );
        }
    }

    #[test]
    fn browser_server_uses_full_scope_without_master() {
        let servers = with_browser_server(
            vec![],
            Some(&thread()),
            Some("channel"),
            &"ab".repeat(32),
            "wss://RELAY.example:443/events?auth=fake",
            launch,
        )
        .expect("managed server");
        let wire = serde_json::to_value(&servers).expect("serialize servers");
        assert_eq!(wire[0]["name"], "colony-browser");
        assert_eq!(wire[0]["command"], "/fixture/electron");
        assert_eq!(wire[0]["args"][0], "/fixture/mcp-server.mjs");
        let env: std::collections::BTreeMap<_, _> = servers[0]
            .env
            .iter()
            .map(|entry| (entry.name.as_str(), entry.value.as_str()))
            .collect();
        assert!(!env.contains_key("COLONY_BROWSER_BROKER_MASTER"));
        assert_eq!(
            env["COLONY_BROWSER_BROKER_SECRET"],
            "ee5fbe4ebdbe47f4a521aa6abed74298a75a20bbd986d666185de0454f7ae43e"
        );
        assert_eq!(
            env["COLONY_BROWSER_COMMUNITY_ORIGIN"],
            "https://relay.example"
        );
        assert_eq!(env["ELECTRON_RUN_AS_NODE"], "1");
        assert!(!wire.to_string().contains("fixture-master-only"));
        let surfaces = vec![browser_brand_guard::Surface::new(
            "managed browser MCP configuration",
            wire.to_string(),
        )];
        browser_brand_guard::assert_clean(&surfaces, &[]);
        browser_brand_guard::assert_guard_is_falsifiable(&surfaces, &[]);
    }

    #[test]
    fn no_server_without_opt_in_complete_launch_and_eligible_scope() {
        let scope = thread();
        let conversation = SessionScope::Conversation {
            channel_id: scope.channel_id(),
        };
        for flag in [None, Some("0"), Some("true"), Some("01"), Some("1 ")] {
            let servers = with_browser_server(
                vec![],
                Some(&scope),
                None,
                &"a".repeat(64),
                "https://relay.example",
                |key| {
                    if key == "COLONY_BROWSER_AGENT" {
                        flag.map(str::to_owned)
                    } else {
                        launch(key)
                    }
                },
            )
            .expect("disabled server");
            assert!(servers.is_empty());
        }
        for key in LAUNCH_KEYS {
            let servers = with_browser_server(
                vec![],
                Some(&scope),
                None,
                &"a".repeat(64),
                "https://relay.example",
                |name| if name == *key { None } else { launch(name) },
            )
            .expect("missing live host");
            assert!(servers.is_empty());
        }
        for scope in [None, Some(&conversation)] {
            let servers = with_browser_server(
                vec![],
                scope,
                Some("channel"),
                &"a".repeat(64),
                "https://relay.example",
                launch,
            )
            .expect("ineligible scope");
            assert!(servers.is_empty());
        }
        assert_eq!(
            with_browser_server(
                vec![],
                Some(&conversation),
                Some("dm"),
                &"a".repeat(64),
                "https://relay.example",
                launch,
            )
            .expect("DM server")
            .len(),
            1
        );
        let servers = with_browser_server(
            vec![],
            Some(&scope),
            None,
            &"a".repeat(64),
            "https://relay.example",
            |key| {
                if key == "COLONY_BROWSER_MCP_RUN_AS_NODE" {
                    Some("0".into())
                } else {
                    launch(key)
                }
            },
        )
        .expect("native node launcher");
        assert!(!servers[0]
            .env
            .iter()
            .any(|entry| entry.name == "ELECTRON_RUN_AS_NODE"));
    }

    #[test]
    fn invalid_identity_and_launcher_fail_closed() {
        for relay in [
            "file:///fixture",
            "ftp://relay.example",
            "https://user@relay.example",
            "https://user:pass@relay.example",
            "https://relay.example/\n",
            " https://relay.example",
        ] {
            assert!(with_browser_server(
                vec![],
                Some(&thread()),
                None,
                &"a".repeat(64),
                relay,
                launch,
            )
            .is_err());
        }
        assert!(with_browser_server(
            vec![],
            Some(&thread()),
            None,
            "invalid-agent",
            "https://relay.example",
            launch,
        )
        .is_err());
        for value in ["", "short", "invalid\nfixture-value"] {
            assert!(with_browser_server(
                vec![],
                Some(&thread()),
                None,
                &"a".repeat(64),
                "https://relay.example",
                |key| {
                    if key == "COLONY_BROWSER_BROKER_MASTER" {
                        Some(value.into())
                    } else {
                        launch(key)
                    }
                },
            )
            .is_err());
        }
    }

    #[test]
    fn configured_server_cannot_impersonate_managed_browser() {
        let supplied = McpServer {
            name: "COLONY-BROWSER".into(),
            command: "/fixture/unauthorized".into(),
            args: vec![],
            env: vec![],
        };
        let disabled = with_browser_server(
            vec![supplied.clone()],
            Some(&thread()),
            None,
            &"a".repeat(64),
            "https://relay.example",
            |_| None,
        )
        .expect("disabled browser");
        assert!(disabled.is_empty());
        let enabled = with_browser_server(
            vec![supplied],
            Some(&thread()),
            None,
            &"a".repeat(64),
            "https://relay.example",
            launch,
        )
        .expect("managed browser");
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].command, "/fixture/electron");
    }
}
