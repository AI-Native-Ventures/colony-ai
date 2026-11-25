//! Cloud boot: how a harness on a Colony cloud machine gets its secrets.
//!
//! A cloud machine is configured with exactly two variables,
//! `COLONY_CLOUD_BOOT_URL` and a single-use `COLONY_CLOUD_BOOT_TOKEN`. Before
//! the normal harness starts, [`run_boot_if_requested`] redeems the token at the
//! relay (`POST /api/cloud-agents/boot`, bearer auth), receives the environment
//! the harness runs with (agent key, relay URL, AI session, placement home and
//! generation, ...), applies it to this process, clears the boot variables, and
//! lets startup continue as for any other harness.
//!
//! The token is single use, so a failed redeem is retried once after a short
//! pause and then the process exits non-zero. There is no retry loop: the relay
//! starts a fresh machine with a fresh token on the next wake.
//!
//! The harness also carries a *home fence* credential (the boot env's
//! `COLONY_CLOUD_HOME_TOKEN`). It is installed once by [`install_home_token`]
//! and added to the NIP-42 AUTH event as `["colony_home", token]`, so the relay
//! can refuse every other connection that claims to be this agent while it is
//! placed in the cloud. Machines never present it on the Mac.

use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::Duration;

use zeroize::Zeroizing;

/// Variable holding the boot URL on a cloud machine.
pub const BOOT_URL_VAR: &str = "COLONY_CLOUD_BOOT_URL";
/// Variable holding the single-use boot token on a cloud machine.
pub const BOOT_TOKEN_VAR: &str = "COLONY_CLOUD_BOOT_TOKEN";
/// Variable (set by the boot response) holding the home fence token.
pub const HOME_TOKEN_VAR: &str = "COLONY_CLOUD_HOME_TOKEN";
/// Name of the tag carrying the home fence token in the AUTH event.
pub const HOME_TAG_NAME: &str = "colony_home";

/// Pause before the single retry of a failed redeem.
pub const RETRY_DELAY: Duration = Duration::from_secs(2);
/// Per-request timeout for the boot call.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Largest boot response accepted. The env map is small; this only bounds a
/// misbehaving server.
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// Why a cloud boot failed.
#[derive(Debug, thiserror::Error)]
pub enum BootError {
    /// `COLONY_CLOUD_BOOT_TOKEN` is set but `COLONY_CLOUD_BOOT_URL` is not.
    #[error("missing {BOOT_URL_VAR}")]
    MissingUrl,
    /// The request failed before a response arrived.
    #[error("cloud boot request failed: {0}")]
    Http(String),
    /// The relay answered with a non-success status.
    #[error("cloud boot refused with status {0}")]
    Status(u16),
    /// The response was not the expected `{"env": {...}}` object.
    #[error("cloud boot response was not understood: {0}")]
    BadBody(String),
    /// The response asked for an environment variable that is not allowed.
    #[error("cloud boot env variable not allowed: {0}")]
    ForbiddenVar(String),
    /// A runtime for the boot call could not be built.
    #[error("cloud boot runtime failed: {0}")]
    Runtime(String),
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct BootResponse {
    env: BTreeMap<String, String>,
}

/// Redeem `token` at `boot_url` once. The returned values are zeroized on drop.
///
/// The relay answers `200 {"env": {...}}` exactly once per token; a second use
/// or an expired token is a `401`, reported as [`BootError::Status`].
pub async fn fetch_env(
    boot_url: &str,
    token: &str,
) -> Result<BTreeMap<String, Zeroizing<String>>, BootError> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| BootError::Http(e.to_string()))?;
    let mut response = client
        .post(boot_url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| BootError::Http(e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(BootError::Status(status.as_u16()));
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| BootError::Http(e.to_string()))?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            body.iter_mut().for_each(|b| *b = 0);
            return Err(BootError::BadBody("response too large".into()));
        }
        body.extend_from_slice(&chunk);
    }
    let parsed = serde_json::from_slice::<BootResponse>(&body);
    body.iter_mut().for_each(|b| *b = 0);
    let parsed = parsed.map_err(|e| BootError::BadBody(e.to_string()))?;
    let mut out = BTreeMap::new();
    for (name, value) in parsed.env {
        out.insert(name, Zeroizing::new(value));
    }
    Ok(out)
}

/// `true` when `name` may be set from a boot response.
///
/// The relay is trusted, but a boot response must never be able to change how
/// the process loads code or finds programs: only plain upper-case variable
/// names, and nothing that steers the dynamic loader or `PATH`.
pub fn is_allowed_boot_var(name: &str) -> bool {
    let well_formed = !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        && !name.as_bytes()[0].is_ascii_digit();
    well_formed
        && !name.starts_with("LD_")
        && !name.starts_with("DYLD_")
        && !matches!(name, "PATH" | "SHELL" | "IFS" | "BASH_ENV" | "ENV")
        && name != BOOT_TOKEN_VAR
        && name != BOOT_URL_VAR
}

/// Redeem with one retry after `retry_delay`. At most two requests are made;
/// the last error is returned. Never loops.
pub async fn fetch_env_with_retry(
    boot_url: &str,
    token: &str,
    retry_delay: Duration,
) -> Result<BTreeMap<String, Zeroizing<String>>, BootError> {
    match fetch_env(boot_url, token).await {
        Ok(env) => Ok(env),
        // A refusal (expired, already used) cannot succeed on retry.
        Err(first @ BootError::Status(_)) => Err(first),
        Err(first) => {
            tracing::warn!(error = %first, "cloud boot failed, retrying once");
            tokio::time::sleep(retry_delay).await;
            fetch_env(boot_url, token).await
        }
    }
}

/// Apply a boot response through `set`. Every name is checked first so a
/// forbidden name leaves the environment untouched.
pub fn apply_env(
    env: &BTreeMap<String, Zeroizing<String>>,
    mut set: impl FnMut(&str, &str),
) -> Result<(), BootError> {
    if let Some(bad) = env.keys().find(|name| !is_allowed_boot_var(name)) {
        return Err(BootError::ForbiddenVar(bad.clone()));
    }
    for (name, value) in env {
        set(name, value.as_str());
    }
    Ok(())
}

/// Redeem the boot token into the process environment.
///
/// Does the whole job given explicit inputs so tests drive the real code path:
/// fetch with retry, apply through `set`, then clear the boot variables through
/// `unset`. `Ok(false)` means no boot was requested.
pub async fn boot_with(
    token: Option<&str>,
    boot_url: Option<&str>,
    retry_delay: Duration,
    set: impl FnMut(&str, &str),
    mut unset: impl FnMut(&str),
) -> Result<bool, BootError> {
    let Some(token) = token.filter(|t| !t.is_empty()) else {
        return Ok(false);
    };
    let url = boot_url
        .filter(|u| !u.is_empty())
        .ok_or(BootError::MissingUrl)?;
    let env = fetch_env_with_retry(url, token, retry_delay).await?;
    apply_env(&env, set)?;
    unset(BOOT_TOKEN_VAR);
    unset(BOOT_URL_VAR);
    Ok(true)
}

/// Startup hook, called from the synchronous `run()` before the main runtime
/// and before any argument or environment parsing.
///
/// When `COLONY_CLOUD_BOOT_TOKEN` is set, fetches the boot environment and
/// applies it to this process (setting variables is only sound before other
/// threads exist, hence the short-lived private runtime). A no-op otherwise.
pub fn run_boot_if_requested() -> Result<bool, BootError> {
    let token = std::env::var(BOOT_TOKEN_VAR).ok().map(Zeroizing::new);
    if token.as_ref().is_none_or(|t| t.is_empty()) {
        return Ok(false);
    }
    let boot_url = std::env::var(BOOT_URL_VAR).ok();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| BootError::Runtime(e.to_string()))?;
    runtime.block_on(boot_with(
        token.as_deref().map(String::as_str),
        boot_url.as_deref(),
        RETRY_DELAY,
        |name, value| std::env::set_var(name, value),
        |name| std::env::remove_var(name),
    ))
}

static HOME_TOKEN: OnceLock<Zeroizing<String>> = OnceLock::new();

/// Remember the home fence token for the lifetime of the process. Only the
/// first call has an effect. Called once at startup, never on the Mac.
pub fn install_home_token(token: &str) {
    if !token.is_empty() {
        let _ = HOME_TOKEN.set(Zeroizing::new(token.to_owned()));
    }
}

/// The home fence token, or `None` when this process is not a cloud harness.
/// Used to prove which machine is asking when it reports to the relay.
pub fn home_token() -> Option<String> {
    HOME_TOKEN
        .get()
        .map(|token| token.as_str().to_owned())
        .filter(|token| !token.is_empty())
}

/// The `["colony_home", token]` tag for the AUTH event, or `None` when this
/// process is not a cloud harness.
pub fn home_tag() -> Option<nostr::Tag> {
    home_tag_for(HOME_TOKEN.get().map(|t| t.as_str()))
}

/// Pure form of [`home_tag`] used by the AUTH event builder and by tests.
pub(crate) fn home_tag_for(token: Option<&str>) -> Option<nostr::Tag> {
    let token = token.filter(|t| !t.is_empty())?;
    nostr::Tag::parse([HOME_TAG_NAME, token]).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// One canned response per accepted connection; records each raw request.
    struct MockBoot {
        url: String,
        requests: Arc<Mutex<Vec<String>>>,
        hits: Arc<AtomicUsize>,
    }

    async fn mock_boot(responses: Vec<(u16, String)>) -> MockBoot {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let hits = Arc::new(AtomicUsize::new(0));
        let (req_log, hit_count) = (requests.clone(), hits.clone());
        tokio::spawn(async move {
            let mut responses = responses.into_iter();
            while let Ok((mut socket, _)) = listener.accept().await {
                hit_count.fetch_add(1, Ordering::SeqCst);
                let mut buf = vec![0u8; 8192];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                req_log
                    .lock()
                    .expect("lock")
                    .push(String::from_utf8_lossy(&buf[..n]).into_owned());
                let (status, body) = responses.next().unwrap_or((500, "{}".to_string()));
                let reply = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(reply.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        MockBoot {
            url: format!("http://{addr}/api/cloud-agents/boot"),
            requests,
            hits,
        }
    }

    fn ok_body() -> String {
        serde_json::json!({"env": {
            "BUZZ_RELAY_URL": "wss://relay.example.test",
            "COLONY_HOME": "cloud",
            "COLONY_PLACEMENT_GENERATION": "4",
            "COLONY_CLOUD_HOME_TOKEN": "home-token-1",
        }})
        .to_string()
    }

    #[tokio::test]
    async fn boot_env_applied_before_connect() {
        let mock = mock_boot(vec![(200, ok_body())]).await;
        let applied: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());
        let removed: Mutex<Vec<String>> = Mutex::new(Vec::new());

        let booted = boot_with(
            Some("boot-secret"),
            Some(&mock.url),
            Duration::from_millis(1),
            |k, v| {
                applied.lock().expect("lock").insert(k.into(), v.into());
            },
            |k| removed.lock().expect("lock").push(k.into()),
        )
        .await
        .expect("boot succeeds");

        assert!(booted);
        let applied = applied.into_inner().expect("lock");
        assert_eq!(applied["COLONY_HOME"], "cloud");
        assert_eq!(applied["COLONY_PLACEMENT_GENERATION"], "4");
        assert_eq!(applied["COLONY_CLOUD_HOME_TOKEN"], "home-token-1");
        // The boot variables are cleared so no child process inherits them.
        let removed = removed.into_inner().expect("lock");
        assert!(removed.contains(&BOOT_TOKEN_VAR.to_string()));
        assert!(removed.contains(&BOOT_URL_VAR.to_string()));
        // Bearer auth, POST, exactly one request.
        let requests = mock.requests.lock().expect("lock");
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("POST /api/cloud-agents/boot"));
        assert!(requests[0]
            .to_ascii_lowercase()
            .contains("authorization: bearer boot-secret"));
    }

    #[tokio::test]
    async fn boot_not_requested_without_token_is_a_no_op() {
        let booted = boot_with(
            None,
            None,
            Duration::ZERO,
            |_, _| panic!("set"),
            |_| panic!("unset"),
        )
        .await
        .expect("no-op");
        assert!(!booted);
        let booted = boot_with(
            Some(""),
            None,
            Duration::ZERO,
            |_, _| panic!("set"),
            |_| panic!("unset"),
        )
        .await
        .expect("no-op");
        assert!(!booted);
    }

    #[tokio::test]
    async fn boot_failure_exits_nonzero() {
        // Transport-level failure then a 500: one attempt plus one retry, then Err.
        let mock = mock_boot(vec![(500, "{}".into()), (500, "{}".into())]).await;
        let result = fetch_env_with_retry(&mock.url, "t", Duration::from_millis(1)).await;
        // A refusal status is not retried (the token is single use), so exactly
        // one request is made and the caller gets an error to exit non-zero on.
        assert!(matches!(result, Err(BootError::Status(500))));
        assert_eq!(mock.hits.load(Ordering::SeqCst), 1);

        // A dead address is retried exactly once.
        let dead = {
            let l = TcpListener::bind("127.0.0.1:0").await.expect("bind");
            let a = l.local_addr().expect("addr");
            drop(l);
            format!("http://{a}/api/cloud-agents/boot")
        };
        let started = std::time::Instant::now();
        let err = fetch_env_with_retry(&dead, "t", Duration::from_millis(50))
            .await
            .expect_err("dead relay fails");
        assert!(matches!(err, BootError::Http(_)));
        assert!(
            started.elapsed() >= Duration::from_millis(50),
            "retry paused"
        );

        // And the wrapper surfaces it, leaving the environment untouched.
        let result = boot_with(
            Some("t"),
            Some(&dead),
            Duration::from_millis(1),
            |_, _| panic!("must not set anything on failure"),
            |_| panic!("must not clear anything on failure"),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn boot_requires_a_url() {
        let result = boot_with(Some("t"), None, Duration::ZERO, |_, _| {}, |_| {}).await;
        assert!(matches!(result, Err(BootError::MissingUrl)));
        assert_eq!(
            BootError::MissingUrl.to_string(),
            "missing COLONY_CLOUD_BOOT_URL"
        );
    }

    #[tokio::test]
    async fn forbidden_names_leave_env_untouched() {
        for bad in [
            "PATH",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
            "lower",
            "1X",
            "",
        ] {
            assert!(!is_allowed_boot_var(bad), "{bad}");
        }
        for good in ["BUZZ_PRIVATE_KEY", "HOME", "COLONY_HOME"] {
            assert!(is_allowed_boot_var(good), "{good}");
        }
        let body = serde_json::json!({"env": {"BUZZ_RELAY_URL": "x", "LD_PRELOAD": "/evil.so"}});
        let mock = mock_boot(vec![(200, body.to_string())]).await;
        let result = boot_with(
            Some("t"),
            Some(&mock.url),
            Duration::ZERO,
            |_, _| panic!("nothing may be applied when any name is forbidden"),
            |_| {},
        )
        .await;
        assert!(matches!(result, Err(BootError::ForbiddenVar(name)) if name == "LD_PRELOAD"));
    }

    #[test]
    fn home_tag_only_when_token_present() {
        assert!(home_tag_for(None).is_none());
        assert!(home_tag_for(Some("")).is_none());
        let tag = home_tag_for(Some("tok")).expect("tag");
        assert_eq!(tag.as_slice(), ["colony_home", "tok"]);
    }
}
