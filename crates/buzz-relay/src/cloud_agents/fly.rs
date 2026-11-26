//! Fly Machines implementation of [`CloudHost`].
//!
//! One Fly app holds every agent machine, on its own isolated network. Each
//! agent gets one volume (mounted at `/data`) and one machine. Machines are
//! created stopped with restart policy `no`, so a machine that exits (the
//! harness exits after ten idle minutes) stays stopped until the relay starts it
//! again. The machine's own config never holds a secret: only the boot URL and
//! one single-use boot token, written by [`FlyHost::start`] just before the
//! machine starts.
//!
//! Calls are bounded: 15 seconds each, one in flight per machine. A 429, a 5xx
//! or a network failure is [`HostError::Transient`] and the journal retries it
//! with backoff; any other refusal is [`HostError::Permanent`].

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::{Method, StatusCode};
use serde_json::{json, Value};

use super::config::FlyConfig;
use super::host::{BootEnvelope, CloudHost, HostError, MachineRef, MachineSpec, MachineState};

/// Seconds before a Machines API call is given up.
const REQUEST_TIMEOUT_SECS: u64 = 15;
/// Where the agent volume is mounted.
const MOUNT_PATH: &str = "/data";
/// Metadata key that names the agent a machine belongs to.
pub const AGENT_METADATA_KEY: &str = "colony_agent";

/// Machines API client for the agent app.
pub struct FlyHost {
    config: FlyConfig,
    http: reqwest::Client,
    /// One lock per machine id: the API is serial per machine, and a stop that
    /// races a start would leave the machine in a state nobody asked for.
    machine_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl FlyHost {
    /// Builds the client. Fails only if the HTTP client cannot be built.
    pub fn new(config: FlyConfig) -> Result<Self, HostError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| HostError::Permanent(format!("http client: {error}")))?;
        Ok(Self {
            config,
            http,
            machine_locks: Mutex::new(HashMap::new()),
        })
    }

    fn machine_lock(&self, machine_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self
            .machine_locks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Arc::clone(locks.entry(machine_id.to_owned()).or_default())
    }

    fn url(&self, path: &str) -> String {
        format!("{}/apps/{}{path}", self.config.api_base, self.config.app)
    }

    /// Sends one request and returns the status with the parsed JSON body (or
    /// `Null` when there is none). Never logs a body: machine configs can hold
    /// the boot token.
    async fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<(StatusCode, Value), HostError> {
        let mut request = self
            .http
            .request(method, self.url(path))
            .bearer_auth(self.config.api_token());
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(|error| {
            // reqwest errors can carry the URL, never the token; the URL holds
            // only the app name and ids.
            HostError::Transient(format!("fly request failed: {error}"))
        })?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| HostError::Transient(format!("fly response unreadable: {error}")))?;
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        Ok((status, value))
    }

    /// Maps a non-success status to the right error. Never includes the body.
    fn refuse(what: &str, status: StatusCode) -> HostError {
        let text = format!("fly {what} answered {status}");
        if status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::REQUEST_TIMEOUT
            || status.is_server_error()
        {
            HostError::Transient(text)
        } else {
            HostError::Permanent(text)
        }
    }

    fn id_of(value: &Value, what: &str) -> Result<String, HostError> {
        value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 64)
            .map(str::to_owned)
            .ok_or_else(|| HostError::Permanent(format!("fly {what} answered with no id")))
    }

    /// The machine's current config, from the API.
    async fn machine_config(&self, machine_id: &str) -> Result<Value, HostError> {
        let (status, body) = self
            .call(Method::GET, &format!("/machines/{machine_id}"), None)
            .await?;
        if !status.is_success() {
            return Err(Self::refuse("machine read", status));
        }
        body.get("config")
            .cloned()
            .filter(Value::is_object)
            .ok_or_else(|| HostError::Permanent("fly machine has no config".into()))
    }

    /// Volume names allow lowercase letters, digits and underscores, 30 at most.
    fn volume_name(agent_pubkey: &str) -> String {
        format!("a_{}", &agent_pubkey[..agent_pubkey.len().min(28)])
    }
}

#[async_trait::async_trait]
impl CloudHost for FlyHost {
    async fn ensure(&self, spec: &MachineSpec) -> Result<MachineRef, HostError> {
        let volume_body = json!({
            "name": Self::volume_name(&spec.agent_pubkey),
            "region": spec.region,
            "size_gb": spec.volume_gb,
        });
        let (status, volume) = self
            .call(Method::POST, "/volumes", Some(&volume_body))
            .await?;
        if !status.is_success() {
            return Err(Self::refuse("volume create", status));
        }
        let volume_id = Self::id_of(&volume, "volume create")?;

        let machine_body = json!({
            "name": format!("agent-{}", &spec.agent_pubkey[..spec.agent_pubkey.len().min(16)]),
            "region": spec.region,
            "skip_launch": true,
            "config": {
                "image": spec.image,
                "guest": {"cpu_kind": "shared", "cpus": 1, "memory_mb": spec.memory_mb},
                "restart": {"policy": "no"},
                "auto_destroy": false,
                "mounts": [{"volume": volume_id, "path": MOUNT_PATH}],
                "metadata": {AGENT_METADATA_KEY: spec.agent_pubkey},
            }
        });
        let (status, machine) = match self
            .call(Method::POST, "/machines", Some(&machine_body))
            .await
        {
            Ok(result) => result,
            Err(error) => {
                self.discard_volume(&volume_id).await;
                return Err(error);
            }
        };
        if !status.is_success() {
            self.discard_volume(&volume_id).await;
            return Err(Self::refuse("machine create", status));
        }
        let machine_id = match Self::id_of(&machine, "machine create") {
            Ok(id) => id,
            Err(error) => {
                self.discard_volume(&volume_id).await;
                return Err(error);
            }
        };
        Ok(MachineRef {
            machine_id,
            volume_id,
        })
    }

    async fn start(&self, machine: &MachineRef, boot: &BootEnvelope) -> Result<(), HostError> {
        let lock = self.machine_lock(&machine.machine_id);
        let _guard = lock.lock().await;
        let mut config = self.machine_config(&machine.machine_id).await?;
        // The boot env is the only env a machine config ever holds: replace
        // whatever was there, do not merge into it.
        config["env"] = json!({
            "COLONY_CLOUD_BOOT_URL": boot.boot_url,
            "COLONY_CLOUD_BOOT_TOKEN": boot.boot_token.as_str(),
        });
        let update = json!({"config": config, "skip_launch": true});
        let path = format!("/machines/{}", machine.machine_id);
        let (status, _) = self.call(Method::POST, &path, Some(&update)).await?;
        if !status.is_success() {
            return Err(Self::refuse("machine update", status));
        }
        let (status, _) = self
            .call(Method::POST, &format!("{path}/start"), None)
            .await?;
        if !status.is_success() {
            return Err(Self::refuse("machine start", status));
        }
        Ok(())
    }

    async fn stop(&self, machine: &MachineRef) -> Result<(), HostError> {
        let lock = self.machine_lock(&machine.machine_id);
        let _guard = lock.lock().await;
        let (status, _) = self
            .call(
                Method::POST,
                &format!("/machines/{}/stop", machine.machine_id),
                None,
            )
            .await?;
        // Already stopped (or gone) is the state we wanted.
        if status.is_success() || status == StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(Self::refuse("machine stop", status))
    }

    async fn destroy(&self, machine: &MachineRef) -> Result<(), HostError> {
        let lock = self.machine_lock(&machine.machine_id);
        let _guard = lock.lock().await;
        let (status, _) = self
            .call(
                Method::DELETE,
                &format!("/machines/{}?force=true", machine.machine_id),
                None,
            )
            .await?;
        if !(status.is_success() || status == StatusCode::NOT_FOUND) {
            return Err(Self::refuse("machine destroy", status));
        }
        let (status, _) = self
            .call(
                Method::DELETE,
                &format!("/volumes/{}", machine.volume_id),
                None,
            )
            .await?;
        if status.is_success() || status == StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(Self::refuse("volume destroy", status))
    }

    async fn state(&self, machine: &MachineRef) -> Result<MachineState, HostError> {
        let (status, body) = self
            .call(
                Method::GET,
                &format!("/machines/{}", machine.machine_id),
                None,
            )
            .await?;
        if status == StatusCode::NOT_FOUND {
            return Ok(MachineState::Destroyed);
        }
        if !status.is_success() {
            return Err(Self::refuse("machine read", status));
        }
        Ok(match body.get("state").and_then(Value::as_str) {
            Some("started") => MachineState::Started,
            Some("stopped") => MachineState::Stopped,
            Some("suspended") => MachineState::Suspended,
            Some("destroyed") => MachineState::Destroyed,
            _ => MachineState::Unknown,
        })
    }

    async fn list(&self) -> Result<Vec<MachineRef>, HostError> {
        let (status, body) = self.call(Method::GET, "/machines", None).await?;
        if !status.is_success() {
            return Err(Self::refuse("machine list", status));
        }
        let machines = body
            .as_array()
            .ok_or_else(|| HostError::Permanent("fly machine list is not an array".into()))?;
        Ok(machines
            .iter()
            .filter_map(|machine| {
                let machine_id = machine.get("id")?.as_str()?.to_owned();
                let volume_id = machine
                    .pointer("/config/mounts/0/volume")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                Some(MachineRef {
                    machine_id,
                    volume_id,
                })
            })
            .collect())
    }
}

impl FlyHost {
    /// Best effort: a volume created for a machine that could not be created is
    /// removed so a failed `ensure` leaves nothing billable behind. A failure
    /// here is logged; reconcile finds a volume that stays.
    async fn discard_volume(&self, volume_id: &str) {
        if let Err(error) = self
            .call(Method::DELETE, &format!("/volumes/{volume_id}"), None)
            .await
        {
            tracing::warn!(%error, "could not remove a volume after a failed machine create");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::{
        body::Bytes,
        extract::State,
        http::{Method as AxMethod, StatusCode as AxStatus, Uri},
        response::IntoResponse,
        Router,
    };
    use zeroize::Zeroizing;

    use super::*;

    #[derive(Clone, Debug)]
    struct Seen {
        method: String,
        path: String,
        query: String,
        body: Value,
        authorization: Option<String>,
    }

    type Script = Arc<Mutex<HashMap<String, VecDeque<(u16, Value)>>>>;
    use std::collections::VecDeque;

    #[derive(Clone)]
    struct Mock {
        seen: Arc<Mutex<Vec<Seen>>>,
        script: Script,
        hits: Arc<AtomicUsize>,
    }

    async fn handle(
        State(mock): State<Mock>,
        method: AxMethod,
        uri: Uri,
        headers: axum::http::HeaderMap,
        body: Bytes,
    ) -> impl IntoResponse {
        mock.hits.fetch_add(1, Ordering::SeqCst);
        let key = format!("{method} {}", uri.path());
        mock.seen.lock().unwrap().push(Seen {
            method: method.to_string(),
            path: uri.path().to_owned(),
            query: uri.query().unwrap_or_default().to_owned(),
            body: serde_json::from_slice(&body).unwrap_or(Value::Null),
            authorization: headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned),
        });
        let scripted = mock
            .script
            .lock()
            .unwrap()
            .get_mut(&key)
            .and_then(VecDeque::pop_front);
        let (status, body) = scripted.unwrap_or_else(|| default_answer(&key));
        (AxStatus::from_u16(status).unwrap(), axum::Json(body))
    }

    fn default_answer(key: &str) -> (u16, Value) {
        match key {
            "POST /v1/apps/colony-agents/volumes" => (200, json!({"id": "vol_1"})),
            "POST /v1/apps/colony-agents/machines" => (200, json!({"id": "mach_1"})),
            "POST /v1/apps/colony-agents/machines/mach_1" => (
                200,
                json!({"id": "mach_1", "instance_id": "01VERSION2", "state": "created"}),
            ),
            "GET /v1/apps/colony-agents/machines/mach_1" => (
                200,
                json!({"id": "mach_1", "state": "stopped", "config": {
                    "image": "img@sha256:abc", "restart": {"policy": "no"},
                    "mounts": [{"volume": "vol_1", "path": "/data"}],
                    "metadata": {"colony_agent": "aa"},
                    "env": {"STALE": "x"}
                }}),
            ),
            "GET /v1/apps/colony-agents/machines" => (
                200,
                json!([{"id": "mach_1", "config": {"mounts": [{"volume": "vol_1"}]}}]),
            ),
            _ => (200, json!({})),
        }
    }

    async fn host() -> (FlyHost, Mock, tokio::task::JoinHandle<()>) {
        let mock = Mock {
            seen: Arc::default(),
            script: Arc::default(),
            hits: Arc::default(),
        };
        let app = Router::new().fallback(handle).with_state(mock.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let config = FlyConfig::new(
            "colony-agents".into(),
            "iad".into(),
            1024,
            1,
            "registry.fly.io/colony-agents@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
            format!("http://{addr}/v1"),
            "fly-secret-token".into(),
        );
        (FlyHost::new(config).unwrap(), mock, server)
    }

    fn script(mock: &Mock, key: &str, status: u16, body: Value) {
        mock.script
            .lock()
            .unwrap()
            .entry(key.to_owned())
            .or_default()
            .push_back((status, body));
    }

    fn spec() -> MachineSpec {
        MachineSpec {
            agent_pubkey: "ab".repeat(32),
            image: "registry.fly.io/colony-agents@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
            memory_mb: 1024,
            volume_gb: 1,
            region: "iad".into(),
        }
    }

    fn machine() -> MachineRef {
        MachineRef {
            machine_id: "mach_1".into(),
            volume_id: "vol_1".into(),
        }
    }

    fn seen(mock: &Mock) -> Vec<Seen> {
        mock.seen.lock().unwrap().clone()
    }

    #[tokio::test]
    async fn fly_create_sets_restart_no_and_volume() {
        let (host, mock, _server) = host().await;
        let created = host.ensure(&spec()).await.expect("ensure");
        assert_eq!(
            created,
            MachineRef {
                machine_id: "mach_1".into(),
                volume_id: "vol_1".into()
            }
        );
        let calls = seen(&mock);
        assert_eq!(calls[0].path, "/v1/apps/colony-agents/volumes");
        assert_eq!(calls[0].body["size_gb"], 1);
        assert_eq!(calls[0].body["region"], "iad");
        let name = calls[0].body["name"].as_str().unwrap();
        assert!(
            name.len() <= 30
                && name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        );
        let machine = &calls[1].body;
        assert_eq!(machine["config"]["restart"]["policy"], "no");
        assert_eq!(machine["config"]["mounts"][0]["volume"], "vol_1");
        assert_eq!(machine["config"]["mounts"][0]["path"], "/data");
        assert_eq!(machine["config"]["guest"]["memory_mb"], 1024);
        assert_eq!(machine["config"]["guest"]["cpu_kind"], "shared");
        assert_eq!(
            machine["config"]["metadata"]["colony_agent"],
            "ab".repeat(32)
        );
        assert_eq!(machine["skip_launch"], true);
        assert!(
            machine["config"].get("env").is_none(),
            "a machine is created with no environment at all"
        );
        assert_eq!(
            calls[0].authorization.as_deref(),
            Some("Bearer fly-secret-token")
        );
    }

    #[tokio::test]
    async fn a_failed_machine_create_removes_its_volume() {
        let (host, mock, _server) = host().await;
        script(
            &mock,
            "POST /v1/apps/colony-agents/machines",
            422,
            json!({"error": "quota"}),
        );
        let error = host.ensure(&spec()).await.unwrap_err();
        assert!(matches!(error, HostError::Permanent(_)));
        let calls = seen(&mock);
        let last = calls.last().unwrap();
        assert_eq!(
            (last.method.as_str(), last.path.as_str()),
            ("DELETE", "/v1/apps/colony-agents/volumes/vol_1")
        );
    }

    #[tokio::test]
    async fn fly_start_sets_only_boot_env() {
        let (host, mock, _server) = host().await;
        host.start(
            &machine(),
            &BootEnvelope {
                boot_url: "https://relay.example/api/cloud-agents/boot".into(),
                boot_token: Zeroizing::new("boot-token-value".into()),
            },
        )
        .await
        .expect("start");
        let calls = seen(&mock);
        let update = calls
            .iter()
            .find(|c| c.method == "POST" && c.path == "/v1/apps/colony-agents/machines/mach_1")
            .expect("config update");
        let env = update.body["config"]["env"]
            .as_object()
            .expect("env object");
        let mut keys: Vec<&str> = env.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["COLONY_CLOUD_BOOT_TOKEN", "COLONY_CLOUD_BOOT_URL"]);
        assert!(
            !env.contains_key("STALE"),
            "old env is replaced, not merged"
        );
        assert_eq!(
            update.body["config"]["restart"]["policy"], "no",
            "the rest of the config is kept"
        );
        assert_eq!(update.body["skip_launch"], true);
        let order: Vec<String> = calls
            .iter()
            .map(|c| format!("{} {}", c.method, c.path))
            .collect();
        assert_eq!(
            order.last().map(String::as_str),
            Some("POST /v1/apps/colony-agents/machines/mach_1/start"),
            "the machine starts only after its env is written"
        );
    }

    fn boot() -> BootEnvelope {
        BootEnvelope {
            boot_url: "https://relay.example/api/cloud-agents/boot".into(),
            boot_token: Zeroizing::new("boot-token-value".into()),
        }
    }

    #[tokio::test]
    async fn fly_start_waits_for_the_updated_version_before_starting() {
        let (host, mock, _server) = host().await;
        host.start(&machine(), &boot()).await.expect("start");
        let calls = seen(&mock);
        let order: Vec<String> = calls
            .iter()
            .map(|c| format!("{} {}", c.method, c.path))
            .collect();
        assert_eq!(
            order,
            [
                "GET /v1/apps/colony-agents/machines/mach_1",
                "POST /v1/apps/colony-agents/machines/mach_1",
                "GET /v1/apps/colony-agents/machines/mach_1/wait",
                "POST /v1/apps/colony-agents/machines/mach_1/start",
            ],
            "the start waits for the config update to settle"
        );
        let wait = &calls[2];
        assert!(
            wait.query.contains("instance_id=01VERSION2"),
            "waits for the version the update made: {}",
            wait.query
        );
        assert!(wait.query.contains("state=stopped"), "{}", wait.query);
        assert!(wait.query.contains("timeout=10"), "{}", wait.query);
    }

    #[tokio::test]
    async fn a_412_from_start_is_transient() {
        let (host, mock, _server) = host().await;
        script(
            &mock,
            "POST /v1/apps/colony-agents/machines/mach_1/start",
            412,
            json!({"error": "machine still updating"}),
        );
        assert!(matches!(
            host.start(&machine(), &boot()).await,
            Err(HostError::Transient(_))
        ));
    }

    #[tokio::test]
    async fn a_wait_timeout_is_transient_and_does_not_start() {
        let (host, mock, _server) = host().await;
        script(
            &mock,
            "GET /v1/apps/colony-agents/machines/mach_1/wait",
            408,
            json!({}),
        );
        assert!(matches!(
            host.start(&machine(), &boot()).await,
            Err(HostError::Transient(_))
        ));
        assert!(
            !seen(&mock).iter().any(|c| c.path.ends_with("/start")),
            "no start before the machine settled"
        );
    }

    #[tokio::test]
    async fn an_update_with_no_version_does_not_start() {
        let (host, mock, _server) = host().await;
        script(
            &mock,
            "POST /v1/apps/colony-agents/machines/mach_1",
            200,
            json!({"id": "mach_1"}),
        );
        assert!(matches!(
            host.start(&machine(), &boot()).await,
            Err(HostError::Permanent(_))
        ));
        assert!(!seen(&mock).iter().any(|c| c.path.ends_with("/start")));
    }

    #[tokio::test]
    async fn fly_429_is_transient() {
        let (host, mock, _server) = host().await;
        script(
            &mock,
            "POST /v1/apps/colony-agents/machines/mach_1/stop",
            429,
            json!({}),
        );
        assert!(matches!(
            host.stop(&machine()).await,
            Err(HostError::Transient(_))
        ));
        script(&mock, "POST /v1/apps/colony-agents/volumes", 503, json!({}));
        assert!(matches!(
            host.ensure(&spec()).await,
            Err(HostError::Transient(_))
        ));
        script(&mock, "POST /v1/apps/colony-agents/volumes", 401, json!({}));
        assert!(matches!(
            host.ensure(&spec()).await,
            Err(HostError::Permanent(_))
        ));
    }

    #[tokio::test]
    async fn fly_404_on_destroy_is_ok() {
        let (host, mock, _server) = host().await;
        script(
            &mock,
            "DELETE /v1/apps/colony-agents/machines/mach_1",
            404,
            json!({}),
        );
        script(
            &mock,
            "DELETE /v1/apps/colony-agents/volumes/vol_1",
            404,
            json!({}),
        );
        host.destroy(&machine())
            .await
            .expect("destroying what is gone succeeds");
        let calls = seen(&mock);
        assert_eq!(calls.len(), 2);
        assert!(
            calls[0].path.contains("/machines/") && calls[1].path.contains("/volumes/"),
            "machine first, then volume"
        );
    }

    #[tokio::test]
    async fn fly_state_and_list_read_the_api() {
        let (host, mock, _server) = host().await;
        assert_eq!(host.state(&machine()).await.unwrap(), MachineState::Stopped);
        script(
            &mock,
            "GET /v1/apps/colony-agents/machines/mach_1",
            404,
            json!({}),
        );
        assert_eq!(
            host.state(&machine()).await.unwrap(),
            MachineState::Destroyed
        );
        script(
            &mock,
            "GET /v1/apps/colony-agents/machines/mach_1",
            200,
            json!({"state": "replacing"}),
        );
        assert_eq!(host.state(&machine()).await.unwrap(), MachineState::Unknown);
        assert_eq!(host.list().await.unwrap(), vec![machine()]);
    }

    #[tokio::test]
    async fn an_unreachable_host_is_transient_and_the_error_hides_the_token() {
        let config = FlyConfig::new(
            "colony-agents".into(),
            "iad".into(),
            1024,
            1,
            "img@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
            "http://127.0.0.1:1/v1".into(),
            "fly-secret-token".into(),
        );
        let error = FlyHost::new(config)
            .unwrap()
            .stop(&machine())
            .await
            .unwrap_err();
        assert!(matches!(&error, HostError::Transient(_)));
        assert!(!error.to_string().contains("fly-secret-token"));
    }
}
