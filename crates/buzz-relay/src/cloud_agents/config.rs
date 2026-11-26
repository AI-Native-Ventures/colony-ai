//! Cloud agents configuration, read once from the relay environment.
//!
//! Everything defaults to off: with no variables set the relay behaves exactly
//! as it did before cloud agents existed. An invalid value is a startup error,
//! never a silent default, so a typo can not switch the feature on or point it
//! at the wrong machine image.

use std::fmt;
use std::sync::Arc;

use buzz_core::agent_placement::{is_valid_cloud_model, CLOUD_MODEL_FREE};
use zeroize::Zeroizing;

use crate::config::ConfigError;

/// Default cloud agents per account during the beta.
pub const DEFAULT_MAX_PER_ACCOUNT: i64 = 2;
/// Default cap on machines that exist on the host.
pub const DEFAULT_MAX_MACHINES: i64 = 100;
/// Most accounts the beta allowlist may name.
pub const MAX_ALLOWLIST: usize = 64;
/// Default Fly app that holds the agent machines.
pub const DEFAULT_FLY_APP: &str = "colony-agents";
/// Default Fly region.
pub const DEFAULT_FLY_REGION: &str = "iad";
/// Default Machines API base.
pub const DEFAULT_FLY_API_BASE: &str = "https://api.machines.dev/v1";
/// Default machine memory in MB.
pub const DEFAULT_MEMORY_MB: u32 = 1024;
/// Default volume size in GB.
pub const DEFAULT_VOLUME_GB: u32 = 1;

/// Whether cloud agents are available, and to whom.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CloudMode {
    /// No flips to the cloud, no wakes; running machines are stopped.
    #[default]
    Off,
    /// Only accounts on the beta allowlist.
    Allowlist,
    /// Every verified account.
    On,
}

/// Where and how agent machines run on Fly.
#[derive(Clone)]
pub struct FlyConfig {
    /// Fly app that holds the agent machines.
    pub app: String,
    /// Fly region for new machines and volumes.
    pub region: String,
    /// Machine memory in MB.
    pub memory_mb: u32,
    /// Volume size in GB.
    pub volume_gb: u32,
    /// Machine image, pinned by digest (`...@sha256:<64 hex>`).
    pub image: String,
    /// Machines API base URL.
    pub api_base: String,
    api_token: Arc<Zeroizing<String>>,
}

impl FlyConfig {
    /// Builds a Fly configuration. The token is kept in zeroizing memory.
    pub fn new(
        app: String,
        region: String,
        memory_mb: u32,
        volume_gb: u32,
        image: String,
        api_base: String,
        api_token: String,
    ) -> Self {
        Self {
            app,
            region,
            memory_mb,
            volume_gb,
            image,
            api_base,
            api_token: Arc::new(Zeroizing::new(api_token)),
        }
    }

    /// The Fly API token. Never log it.
    pub fn api_token(&self) -> &str {
        self.api_token.as_str()
    }
}

impl fmt::Debug for FlyConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FlyConfig")
            .field("app", &self.app)
            .field("region", &self.region)
            .field("memory_mb", &self.memory_mb)
            .field("volume_gb", &self.volume_gb)
            .field("image", &self.image)
            .field("api_base", &self.api_base)
            .field("api_token", &"[REDACTED]")
            .finish()
    }
}

/// Cloud agents settings.
#[derive(Debug, Clone)]
pub struct CloudAgentsConfig {
    /// Who may use cloud agents.
    pub mode: CloudMode,
    /// Lowercased verified account emails that may use cloud agents in
    /// [`CloudMode::Allowlist`].
    pub allowlist: Vec<String>,
    /// Cloud agents one account may have at once.
    pub max_per_account: i64,
    /// Most machines that may exist on the host at once.
    pub max_machines: i64,
    /// Fly settings; `None` until a token and image are configured.
    pub fly: Option<FlyConfig>,
    /// Default cloud model, when set and on the allowed list.
    pub default_model: Option<String>,
    /// Models the credits gateway allows (`COLONY_CREDITS_ALLOWED_MODELS`).
    pub allowed_models: Vec<String>,
}

impl Default for CloudAgentsConfig {
    fn default() -> Self {
        Self {
            mode: CloudMode::Off,
            allowlist: Vec::new(),
            max_per_account: DEFAULT_MAX_PER_ACCOUNT,
            max_machines: DEFAULT_MAX_MACHINES,
            fly: None,
            default_model: None,
            allowed_models: Vec::new(),
        }
    }
}

impl CloudAgentsConfig {
    /// Reads the configuration from `lookup` (the process environment in
    /// production). Unset means off.
    pub fn from_env(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |name: &str| {
            lookup(name)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        let mode = match get("COLONY_CLOUD_AGENTS").as_deref() {
            None => CloudMode::Off,
            Some(value) => match value.to_ascii_lowercase().as_str() {
                "off" => CloudMode::Off,
                "allowlist" => CloudMode::Allowlist,
                "on" => CloudMode::On,
                _ => {
                    return Err(invalid("COLONY_CLOUD_AGENTS must be off, allowlist or on"));
                }
            },
        };
        let allowlist = parse_allowlist(get("COLONY_CLOUD_AGENTS_ALLOWLIST"));
        let max_per_account = parse_bounded(
            "COLONY_CLOUD_AGENTS_MAX_PER_ACCOUNT",
            get("COLONY_CLOUD_AGENTS_MAX_PER_ACCOUNT"),
            DEFAULT_MAX_PER_ACCOUNT,
            1..=100,
        )?;
        let max_machines = parse_bounded(
            "COLONY_CLOUD_AGENTS_MAX_MACHINES",
            get("COLONY_CLOUD_AGENTS_MAX_MACHINES"),
            DEFAULT_MAX_MACHINES,
            1..=10_000,
        )?;
        let fly = parse_fly(&get)?;
        let allowed_models = parse_allowed_models(get("COLONY_CREDITS_ALLOWED_MODELS"));
        // Free AI first (owner decision, 25 Nov 2026): a new cloud agent starts on
        // `colony-free` unless the operator names another default.
        let default_model = match get("COLONY_CLOUD_DEFAULT_MODEL") {
            None => Some(CLOUD_MODEL_FREE.to_owned()),
            Some(model) if !is_valid_cloud_model(&model) => {
                return Err(invalid("COLONY_CLOUD_DEFAULT_MODEL is not a model name"));
            }
            Some(model) if model != CLOUD_MODEL_FREE && !allowed_models.contains(&model) => {
                // Keep running: the gateway refuses a model that is not allowed,
                // so a default that is not on the list could only fail every
                // wake. Say so loudly and fall back to the free route.
                tracing::error!(
                    "COLONY_CLOUD_DEFAULT_MODEL is not in COLONY_CREDITS_ALLOWED_MODELS; \
                     cloud agents default to the free route"
                );
                Some(CLOUD_MODEL_FREE.to_owned())
            }
            Some(model) => Some(model),
        };
        Ok(Self {
            mode,
            allowlist,
            max_per_account,
            max_machines,
            fly,
            default_model,
            allowed_models,
        })
    }

    /// Whether the account with this verified email may put an agent in the
    /// cloud right now. `email` is `None` for a key with no verified account.
    pub fn allows_account(&self, email: Option<&str>) -> bool {
        match self.mode {
            CloudMode::Off => false,
            CloudMode::On => true,
            CloudMode::Allowlist => email
                .map(|email| email.trim().to_ascii_lowercase())
                .is_some_and(|email| self.allowlist.contains(&email)),
        }
    }

    /// Whether `model` is on the credits gateway's allowed list.
    pub fn model_allowed(&self, model: &str) -> bool {
        model == CLOUD_MODEL_FREE || self.allowed_models.iter().any(|allowed| allowed == model)
    }

    /// The models an owner may pick for a cloud agent: the free route first,
    /// then every model the credits gateway allows.
    pub fn selectable_models(&self) -> Vec<String> {
        std::iter::once(CLOUD_MODEL_FREE.to_owned())
            .chain(
                self.allowed_models
                    .iter()
                    .filter(|model| model.as_str() != CLOUD_MODEL_FREE)
                    .cloned(),
            )
            .collect()
    }
}

fn invalid(message: &str) -> ConfigError {
    ConfigError::InvalidValue(message.to_owned())
}

fn parse_allowlist(raw: Option<String>) -> Vec<String> {
    let mut accounts: Vec<String> = Vec::new();
    for item in raw.unwrap_or_default().split(',') {
        let email = item.trim().to_ascii_lowercase();
        if email.is_empty() || accounts.contains(&email) {
            continue;
        }
        if !email.contains('@') || email.len() > 254 {
            // Never log the value: it may be a mistyped address.
            tracing::error!("COLONY_CLOUD_AGENTS_ALLOWLIST entry ignored: not an email address");
            continue;
        }
        if accounts.len() == MAX_ALLOWLIST {
            tracing::error!(
                "COLONY_CLOUD_AGENTS_ALLOWLIST lists more than 64 accounts; extras ignored"
            );
            break;
        }
        accounts.push(email);
    }
    accounts
}

fn parse_bounded(
    name: &str,
    raw: Option<String>,
    default: i64,
    range: std::ops::RangeInclusive<i64>,
) -> Result<i64, ConfigError> {
    let Some(raw) = raw else {
        return Ok(default);
    };
    match raw.parse::<i64>() {
        Ok(value) if range.contains(&value) => Ok(value),
        _ => Err(ConfigError::InvalidValue(format!(
            "{name} must be a whole number from {} to {}",
            range.start(),
            range.end()
        ))),
    }
}

fn parse_allowed_models(raw: Option<String>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    match serde_json::from_str::<Vec<String>>(&raw) {
        Ok(models) => models,
        Err(_) => {
            tracing::error!(
                "COLONY_CREDITS_ALLOWED_MODELS is not a JSON array of names; \
                 cloud agents see no allowed models"
            );
            Vec::new()
        }
    }
}

fn parse_fly(get: &impl Fn(&str) -> Option<String>) -> Result<Option<FlyConfig>, ConfigError> {
    let token = get("COLONY_CLOUD_FLY_API_TOKEN");
    let image = get("COLONY_CLOUD_AGENT_IMAGE");
    let (token, image) = match (token, image) {
        (None, None) => return Ok(None),
        (Some(token), Some(image)) => (token, image),
        _ => {
            return Err(invalid(
                "COLONY_CLOUD_FLY_API_TOKEN and COLONY_CLOUD_AGENT_IMAGE must be set together",
            ));
        }
    };
    if !is_digest_pinned(&image) {
        return Err(invalid(
            "COLONY_CLOUD_AGENT_IMAGE must be pinned by digest (name@sha256:<64 hex>)",
        ));
    }
    let app = get("COLONY_CLOUD_FLY_APP").unwrap_or_else(|| DEFAULT_FLY_APP.to_owned());
    if !is_dns_label(&app) {
        return Err(invalid("COLONY_CLOUD_FLY_APP is not a Fly app name"));
    }
    let region = get("COLONY_CLOUD_FLY_REGION").unwrap_or_else(|| DEFAULT_FLY_REGION.to_owned());
    if region.len() != 3 || !region.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(invalid("COLONY_CLOUD_FLY_REGION is not a Fly region code"));
    }
    let memory_mb = parse_bounded(
        "COLONY_CLOUD_MACHINE_MEMORY_MB",
        get("COLONY_CLOUD_MACHINE_MEMORY_MB"),
        i64::from(DEFAULT_MEMORY_MB),
        256..=8192,
    )?;
    let volume_gb = parse_bounded(
        "COLONY_CLOUD_VOLUME_GB",
        get("COLONY_CLOUD_VOLUME_GB"),
        i64::from(DEFAULT_VOLUME_GB),
        1..=100,
    )?;
    let api_base =
        get("COLONY_CLOUD_FLY_API_BASE").unwrap_or_else(|| DEFAULT_FLY_API_BASE.to_owned());
    if !is_acceptable_api_base(&api_base) {
        return Err(invalid(
            "COLONY_CLOUD_FLY_API_BASE must be an https URL (http only for a loopback test host)",
        ));
    }
    Ok(Some(FlyConfig::new(
        app,
        region,
        u32::try_from(memory_mb).map_err(|_| invalid("COLONY_CLOUD_MACHINE_MEMORY_MB"))?,
        u32::try_from(volume_gb).map_err(|_| invalid("COLONY_CLOUD_VOLUME_GB"))?,
        image,
        api_base.trim_end_matches('/').to_owned(),
        token,
    )))
}

/// `name@sha256:<64 lowercase hex>` with a non-empty name and no whitespace.
fn is_digest_pinned(image: &str) -> bool {
    let Some((name, digest)) = image.rsplit_once("@sha256:") else {
        return false;
    };
    !name.is_empty()
        && !image.chars().any(char::is_whitespace)
        && digest.len() == 64
        && digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_dns_label(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 63
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

fn is_acceptable_api_base(base: &str) -> bool {
    let Ok(parsed) = url::Url::parse(base) else {
        return false;
    };
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return false;
    }
    match parsed.scheme() {
        "https" => parsed.host_str().is_some(),
        "http" => matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIGEST: &str = "registry.fly.io/colony-agents@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn env(pairs: &[(&'static str, &str)]) -> impl Fn(&str) -> Option<String> {
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        }
    }

    #[test]
    fn everything_defaults_to_off() {
        let config = CloudAgentsConfig::from_env(env(&[])).expect("defaults");
        assert_eq!(config.mode, CloudMode::Off);
        assert_eq!(config.max_per_account, 2);
        assert_eq!(config.max_machines, 100);
        assert!(config.fly.is_none());
        assert_eq!(config.default_model.as_deref(), Some("colony-free"));
        assert!(!config.allows_account(Some("owner@example.com")));
    }

    #[test]
    fn an_invalid_mode_is_an_error_not_a_default() {
        for value in ["yes", "true", "1", "enabled"] {
            assert!(
                CloudAgentsConfig::from_env(env(&[("COLONY_CLOUD_AGENTS", value)])).is_err(),
                "{value}"
            );
        }
        for (value, mode) in [
            ("off", CloudMode::Off),
            ("Allowlist", CloudMode::Allowlist),
            (" ON ", CloudMode::On),
        ] {
            let config = CloudAgentsConfig::from_env(env(&[("COLONY_CLOUD_AGENTS", value)]))
                .expect("valid mode");
            assert_eq!(config.mode, mode);
        }
    }

    #[test]
    fn allowlist_mode_admits_only_listed_verified_accounts() {
        let config = CloudAgentsConfig::from_env(env(&[
            ("COLONY_CLOUD_AGENTS", "allowlist"),
            (
                "COLONY_CLOUD_AGENTS_ALLOWLIST",
                " Owner@Example.com, owner@example.com, not-an-email, test@example.com ",
            ),
        ]))
        .expect("config");
        assert_eq!(
            config.allowlist,
            vec!["owner@example.com", "test@example.com"]
        );
        assert!(config.allows_account(Some("OWNER@example.com")));
        assert!(!config.allows_account(Some("someone@example.com")));
        assert!(
            !config.allows_account(None),
            "an unverified key is not on the list"
        );
    }

    #[test]
    fn the_allowlist_holds_at_most_64_accounts() {
        let many = (0..70)
            .map(|n| format!("user{n}@example.com"))
            .collect::<Vec<_>>()
            .join(",");
        let config = CloudAgentsConfig::from_env(env(&[
            ("COLONY_CLOUD_AGENTS", "allowlist"),
            ("COLONY_CLOUD_AGENTS_ALLOWLIST", many.as_str()),
        ]))
        .expect("config");
        assert_eq!(config.allowlist.len(), 64);
    }

    #[test]
    fn on_mode_admits_every_account_and_off_admits_none() {
        let on = CloudAgentsConfig::from_env(env(&[("COLONY_CLOUD_AGENTS", "on")])).unwrap();
        assert!(on.allows_account(None));
        let off = CloudAgentsConfig::from_env(env(&[("COLONY_CLOUD_AGENTS", "off")])).unwrap();
        assert!(!off.allows_account(Some("owner@example.com")));
    }

    #[test]
    fn caps_are_settings_with_bounds() {
        let config = CloudAgentsConfig::from_env(env(&[
            ("COLONY_CLOUD_AGENTS_MAX_PER_ACCOUNT", "5"),
            ("COLONY_CLOUD_AGENTS_MAX_MACHINES", "20"),
        ]))
        .expect("config");
        assert_eq!((config.max_per_account, config.max_machines), (5, 20));
        for (name, value) in [
            ("COLONY_CLOUD_AGENTS_MAX_PER_ACCOUNT", "0"),
            ("COLONY_CLOUD_AGENTS_MAX_PER_ACCOUNT", "many"),
            ("COLONY_CLOUD_AGENTS_MAX_MACHINES", "-1"),
        ] {
            assert!(CloudAgentsConfig::from_env(env(&[(name, value)])).is_err());
        }
    }

    #[test]
    fn fly_needs_token_and_digest_pinned_image_together() {
        assert!(CloudAgentsConfig::from_env(env(&[("COLONY_CLOUD_FLY_API_TOKEN", "t")])).is_err());
        assert!(CloudAgentsConfig::from_env(env(&[("COLONY_CLOUD_AGENT_IMAGE", DIGEST)])).is_err());
        assert!(CloudAgentsConfig::from_env(env(&[
            ("COLONY_CLOUD_FLY_API_TOKEN", "t"),
            (
                "COLONY_CLOUD_AGENT_IMAGE",
                "registry.fly.io/colony-agents:latest"
            ),
        ]))
        .is_err());
        let config = CloudAgentsConfig::from_env(env(&[
            ("COLONY_CLOUD_FLY_API_TOKEN", "secret-token"),
            ("COLONY_CLOUD_AGENT_IMAGE", DIGEST),
        ]))
        .expect("config");
        let fly = config.fly.expect("fly configured");
        assert_eq!(fly.app, "colony-agents");
        assert_eq!(fly.region, "iad");
        assert_eq!((fly.memory_mb, fly.volume_gb), (1024, 1));
        assert_eq!(fly.api_base, "https://api.machines.dev/v1");
        assert_eq!(fly.api_token(), "secret-token");
        assert!(!format!("{fly:?}").contains("secret-token"));
    }

    #[test]
    fn fly_api_base_must_be_https_or_a_loopback_test_host() {
        for base in [
            "http://api.machines.dev/v1",
            "ftp://example.com",
            "https://user:pw@api.machines.dev/v1",
            "nonsense",
        ] {
            assert!(
                CloudAgentsConfig::from_env(env(&[
                    ("COLONY_CLOUD_FLY_API_TOKEN", "t"),
                    ("COLONY_CLOUD_AGENT_IMAGE", DIGEST),
                    ("COLONY_CLOUD_FLY_API_BASE", base),
                ]))
                .is_err(),
                "{base}"
            );
        }
        let config = CloudAgentsConfig::from_env(env(&[
            ("COLONY_CLOUD_FLY_API_TOKEN", "t"),
            ("COLONY_CLOUD_AGENT_IMAGE", DIGEST),
            ("COLONY_CLOUD_FLY_API_BASE", "http://127.0.0.1:4010/v1/"),
        ]))
        .expect("loopback test host");
        assert_eq!(
            config.fly.expect("fly").api_base,
            "http://127.0.0.1:4010/v1"
        );
    }

    #[test]
    fn colony_free_is_the_default_and_always_selectable() {
        let config = CloudAgentsConfig::from_env(env(&[(
            "COLONY_CREDITS_ALLOWED_MODELS",
            r#"["deepseek/deepseek-v4.1-flash","free/a"]"#,
        )]))
        .expect("config");
        assert_eq!(config.default_model.as_deref(), Some("colony-free"));
        // Not a gateway model, so it is allowed without being on the list.
        assert!(config.model_allowed("colony-free"));
        assert_eq!(
            config.selectable_models(),
            vec!["colony-free", "deepseek/deepseek-v4.1-flash", "free/a"],
            "the free route is first, paid models stay selectable"
        );
        let empty = CloudAgentsConfig::from_env(env(&[])).expect("config");
        assert_eq!(empty.selectable_models(), vec!["colony-free"]);
        assert!(!empty.model_allowed("other/model"));
    }

    #[test]
    fn the_default_model_must_be_on_the_allowed_list() {
        let allowed = r#"["deepseek/deepseek-v4.1-flash","free/a"]"#;
        let config = CloudAgentsConfig::from_env(env(&[
            ("COLONY_CREDITS_ALLOWED_MODELS", allowed),
            ("COLONY_CLOUD_DEFAULT_MODEL", "deepseek/deepseek-v4.1-flash"),
        ]))
        .expect("config");
        assert_eq!(
            config.default_model.as_deref(),
            Some("deepseek/deepseek-v4.1-flash")
        );
        assert!(config.model_allowed("free/a"));
        assert!(!config.model_allowed("other/model"));

        let not_allowed = CloudAgentsConfig::from_env(env(&[
            ("COLONY_CREDITS_ALLOWED_MODELS", r#"["free/a"]"#),
            ("COLONY_CLOUD_DEFAULT_MODEL", "deepseek/deepseek-v4.1-flash"),
        ]))
        .expect("config still loads");
        assert_eq!(
            not_allowed.default_model.as_deref(),
            Some("colony-free"),
            "a default the gateway would refuse falls back to the free route"
        );

        assert!(
            CloudAgentsConfig::from_env(env(&[("COLONY_CLOUD_DEFAULT_MODEL", "bad model")]))
                .is_err()
        );
    }
}
