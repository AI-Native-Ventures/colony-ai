//! A money rails connection: one payment provider for one business.
//!
//! The relay keeps the full [`ConnectionConfig`] (non secret) in a table next to the sealed
//! secrets, and publishes [`ConnectionHead`] (kind 30683) as the community-wide projection.
//! The head never carries a key, a signing secret, a notice address or a full recipe body.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::notice::{notice_map_hash, validate_notice_map, NoticeMap, SignatureConfig};
use super::recipe::{recipe_hash, validate_recipe, Recipe, RecipePurpose};
use super::{clean_text, valid_host, ActorRole, MoneyError, Route, MONEY_RAILS_SCHEMA_VERSION};

/// Most recipes one connection keeps.
pub const MAX_RECIPES: usize = 16;

/// Connection health.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    /// Working.
    Connected,
    /// A secret failed to open or recent runs failed.
    NeedsAttention,
    /// Disconnected; the head stays for history, the secrets are gone.
    Disconnected,
}

/// Where a recipe or notice map is in the approval flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    /// Proposed by Scout or the owner; never runs.
    Proposed,
    /// Approved by the owner; this exact body may run.
    Approved,
    /// Revoked by the owner.
    Revoked,
    /// Refused by the refusal list or the host lock.
    Refused,
}

/// How the relay authenticates to the provider API. Serialised as its wire string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthScheme {
    /// `Authorization: Bearer <key>`.
    Bearer,
    /// HTTP basic with the key as user name and an empty password.
    Basic,
    /// The key in a named header.
    Header(String),
}

impl AuthScheme {
    /// The wire form: `bearer`, `basic` or `header:<Header-Name>`.
    pub fn as_wire(&self) -> String {
        match self {
            Self::Bearer => "bearer".to_owned(),
            Self::Basic => "basic".to_owned(),
            Self::Header(name) => format!("header:{name}"),
        }
    }

    /// Parses the wire form.
    pub fn parse(text: &str) -> Result<Self, MoneyError> {
        match text {
            "bearer" => Ok(Self::Bearer),
            "basic" => Ok(Self::Basic),
            other => match other.strip_prefix("header:") {
                Some(name)
                    if !name.is_empty()
                        && name.len() <= 64
                        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                        && !["authorization", "cookie", "host"]
                            .contains(&name.to_ascii_lowercase().as_str()) =>
                {
                    Ok(Self::Header(name.to_owned()))
                }
                _ => Err(MoneyError::invalid(
                    "money_invalid_input",
                    "authScheme must be bearer, basic or header:<Header-Name>",
                )),
            },
        }
    }
}

impl Serialize for AuthScheme {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for AuthScheme {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Self::parse(&text).map_err(|error| serde::de::Error::custom(error.message))
    }
}

/// A recipe with its approval state, as the relay stores it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StoredRecipe {
    /// The recipe body.
    pub recipe: Recipe,
    /// Approval state.
    pub status: ApprovalStatus,
    /// SHA-256 of the exact body.
    pub recipe_hash: String,
    /// Who proposed it.
    pub proposed_by: String,
    /// Who approved it.
    #[serde(default)]
    pub approved_by: Option<String>,
    /// When it was approved, Unix seconds.
    #[serde(default)]
    pub approved_at: Option<i64>,
    /// Refusal code when `status` is `refused`.
    #[serde(default)]
    pub refusal: Option<String>,
}

/// A notice map with its approval state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StoredNoticeMap {
    /// The map.
    pub map: NoticeMap,
    /// Approval state.
    pub status: ApprovalStatus,
    /// SHA-256 of the exact map.
    pub map_hash: String,
    /// Who proposed it.
    pub proposed_by: String,
    /// Who approved it.
    #[serde(default)]
    pub approved_by: Option<String>,
}

/// The non secret configuration of a connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConnectionConfig {
    /// Connection id.
    pub connection_id: Uuid,
    /// Lower case provider slug, for example `stripe`.
    pub provider: String,
    /// Label shown to the owner.
    pub label: String,
    /// Route.
    pub route: Route,
    /// Health.
    pub status: ConnectionStatus,
    /// The default connection for new cards.
    pub is_default: bool,
    /// API hosts the key is locked to.
    pub api_hosts: Vec<String>,
    /// Hosts of the provider's dashboard, for the browser route.
    pub browser_hosts: Vec<String>,
    /// How the key is sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_scheme: Option<AuthScheme>,
    /// Recipes and their approval state.
    #[serde(default)]
    pub recipes: Vec<StoredRecipe>,
    /// The notice map, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice_map: Option<StoredNoticeMap>,
    /// How notice signatures are checked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<SignatureConfig>,
    /// Whether a sealed API key is held.
    pub has_api_key: bool,
    /// Whether a sealed signing secret is held.
    pub has_signing_secret: bool,
    /// Created, Unix seconds.
    pub created_at: i64,
    /// Last use, Unix seconds.
    #[serde(default)]
    pub last_used_at: Option<i64>,
    /// Version, bumped on every change.
    pub version: u32,
}

/// What the head says about a recipe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RecipeSummary {
    /// Recipe id.
    pub recipe_id: String,
    /// Title.
    pub title: String,
    /// Purpose.
    pub purpose: RecipePurpose,
    /// Method.
    pub method: String,
    /// Host.
    pub host: String,
    /// Path template.
    pub path: String,
    /// One plain sentence for the owner.
    pub plain: String,
    /// Approval state.
    pub status: ApprovalStatus,
    /// Hash of the exact body.
    pub recipe_hash: String,
    /// Who proposed it.
    pub proposed_by: String,
    /// Who approved it.
    #[serde(default)]
    pub approved_by: Option<String>,
    /// When it was approved.
    #[serde(default)]
    pub approved_at: Option<i64>,
    /// Refusal code when refused.
    #[serde(default)]
    pub refusal: Option<String>,
}

/// What the head says about the notice map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NoticeMapSummary {
    /// Approval state.
    pub status: ApprovalStatus,
    /// Hash of the exact map.
    pub map_hash: String,
}

/// Relay-authored connection head (kind 30683).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConnectionHead {
    /// Schema version.
    pub schema_version: u8,
    /// Connection id.
    pub connection_id: Uuid,
    /// Provider slug.
    pub provider: String,
    /// Label.
    pub label: String,
    /// Route.
    pub route: Route,
    /// Health.
    pub status: ConnectionStatus,
    /// Default connection.
    pub is_default: bool,
    /// API hosts.
    pub api_hosts: Vec<String>,
    /// Browser hosts.
    pub browser_hosts: Vec<String>,
    /// Auth scheme wire form, when the route is api.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_scheme: Option<String>,
    /// Recipes, summaries only.
    pub recipes: Vec<RecipeSummary>,
    /// Refused proposals (same entries as `recipes` with status `refused`), for the UI list.
    pub refused_recipes: Vec<RefusedRecipe>,
    /// A sealed API key is held.
    pub has_api_key: bool,
    /// A sealed signing secret is held.
    pub has_signing_secret: bool,
    /// A notice address exists (the address itself is not in the head).
    pub notice_address_set: bool,
    /// Notice map summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice_map: Option<NoticeMapSummary>,
    /// Last use.
    #[serde(default)]
    pub last_used_at: Option<i64>,
    /// Created.
    pub created_at: i64,
    /// Version.
    pub version: u32,
    /// Event that produced this head.
    pub source_event_id: String,
}

/// A refused recipe proposal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RefusedRecipe {
    /// Recipe id.
    pub recipe_id: String,
    /// Refusal code.
    pub reason: String,
}

fn plain_sentence(recipe: &Recipe) -> String {
    match recipe.purpose {
        RecipePurpose::CreateLink => format!(
            "Creates a payment link on {} for the amount on an approved card.",
            recipe.host
        ),
        RecipePurpose::LookupPayment => format!(
            "Looks up a payment on {} to check it was paid. Reads only.",
            recipe.host
        ),
    }
}

impl ConnectionConfig {
    /// The community-wide head for this configuration.
    pub fn to_head(&self, source_event_id: &str) -> ConnectionHead {
        let recipes = self
            .recipes
            .iter()
            .map(|stored| RecipeSummary {
                recipe_id: stored.recipe.recipe_id.clone(),
                title: stored.recipe.title.clone(),
                purpose: stored.recipe.purpose,
                method: stored.recipe.method.to_ascii_uppercase(),
                host: stored.recipe.host.clone(),
                path: stored.recipe.path.clone(),
                plain: plain_sentence(&stored.recipe),
                status: stored.status,
                recipe_hash: stored.recipe_hash.clone(),
                proposed_by: stored.proposed_by.clone(),
                approved_by: stored.approved_by.clone(),
                approved_at: stored.approved_at,
                refusal: stored.refusal.clone(),
            })
            .collect();
        let refused_recipes = self
            .recipes
            .iter()
            .filter(|stored| stored.status == ApprovalStatus::Refused)
            .map(|stored| RefusedRecipe {
                recipe_id: stored.recipe.recipe_id.clone(),
                reason: stored.refusal.clone().unwrap_or_default(),
            })
            .collect();
        ConnectionHead {
            schema_version: MONEY_RAILS_SCHEMA_VERSION,
            connection_id: self.connection_id,
            provider: self.provider.clone(),
            label: self.label.clone(),
            route: self.route,
            status: self.status,
            is_default: self.is_default,
            api_hosts: self.api_hosts.clone(),
            browser_hosts: self.browser_hosts.clone(),
            auth_scheme: self.auth_scheme.as_ref().map(AuthScheme::as_wire),
            recipes,
            refused_recipes,
            has_api_key: self.has_api_key,
            has_signing_secret: self.has_signing_secret,
            notice_address_set: true,
            notice_map: self.notice_map.as_ref().map(|stored| NoticeMapSummary {
                status: stored.status,
                map_hash: stored.map_hash.clone(),
            }),
            last_used_at: self.last_used_at,
            created_at: self.created_at,
            version: self.version,
            source_event_id: source_event_id.to_owned(),
        }
    }

    /// The approved recipe for a purpose, if any (the first one wins).
    pub fn approved_recipe(&self, purpose: RecipePurpose) -> Option<&StoredRecipe> {
        self.recipes.iter().find(|stored| {
            stored.status == ApprovalStatus::Approved && stored.recipe.purpose == purpose
        })
    }

    /// The approved recipe with this id.
    pub fn approved_recipe_by_id(&self, recipe_id: &str) -> Option<&StoredRecipe> {
        self.recipes.iter().find(|stored| {
            stored.status == ApprovalStatus::Approved && stored.recipe.recipe_id == recipe_id
        })
    }

    /// The approved notice map, if any.
    pub fn approved_notice_map(&self) -> Option<&NoticeMap> {
        self.notice_map
            .as_ref()
            .filter(|stored| stored.status == ApprovalStatus::Approved)
            .map(|stored| &stored.map)
    }
}

/// Validates the fields common to every new connection.
pub fn validate_new_connection(
    provider: &str,
    label: &str,
    route: Route,
    api_hosts: &[String],
    browser_hosts: &[String],
) -> Result<(), MoneyError> {
    let slug_ok = !provider.is_empty()
        && provider.len() <= 48
        && provider
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !slug_ok {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "provider must be lower case letters, digits and dashes",
        ));
    }
    if !clean_text(label, 80) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "label must be 1 to 80 characters",
        ));
    }
    if api_hosts.len() > 4 || browser_hosts.len() > 4 {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "at most 4 hosts per list",
        ));
    }
    for host in api_hosts.iter().chain(browser_hosts.iter()) {
        if !valid_host(host) {
            return Err(MoneyError::invalid(
                "money_host_not_allowed",
                format!("{host} is not a public host name (no scheme, path, port or IP address)"),
            ));
        }
    }
    match route {
        Route::Api if api_hosts.is_empty() => Err(MoneyError::invalid(
            "money_invalid_input",
            "an API connection needs at least one API host",
        )),
        Route::Browser if browser_hosts.is_empty() => Err(MoneyError::invalid(
            "money_invalid_input",
            "a browser connection needs at least one dashboard host",
        )),
        _ => Ok(()),
    }
}

/// The commands on a connection (kind 47074).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionOp {
    /// Create a browser route connection.
    AddBrowser,
    /// Propose a recipe.
    ProposeRecipe,
    /// Approve the exact recipe body.
    ApproveRecipe,
    /// Revoke a recipe.
    RevokeRecipe,
    /// Propose the notice map.
    ProposeNoticeMap,
    /// Approve the exact notice map.
    ApproveNoticeMap,
    /// Make this the default connection.
    SetDefault,
    /// Rename.
    Rename,
    /// Disconnect and delete the sealed secrets.
    Disconnect,
}

/// A connection command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConnectionAction {
    /// Schema version.
    pub schema_version: u8,
    /// Operation.
    pub op: ConnectionOp,
    /// Connection id.
    pub connection_id: Uuid,
    /// Head the caller saw.
    #[serde(default)]
    pub expected_head_event_id: Option<String>,
    /// `add_browser`: provider slug.
    #[serde(default)]
    pub provider: Option<String>,
    /// `add_browser` and `rename`: label.
    #[serde(default)]
    pub label: Option<String>,
    /// `add_browser`: dashboard hosts.
    #[serde(default)]
    pub browser_hosts: Option<Vec<String>>,
    /// `propose_recipe`: the recipe.
    #[serde(default)]
    pub recipe: Option<Recipe>,
    /// `approve_recipe` and `revoke_recipe`: the recipe id.
    #[serde(default)]
    pub recipe_id: Option<String>,
    /// `approve_recipe`: the hash the owner saw.
    #[serde(default)]
    pub recipe_hash: Option<String>,
    /// `propose_notice_map`: the map.
    #[serde(default)]
    pub notice_map: Option<NoticeMap>,
    /// `approve_notice_map`: the hash the owner saw.
    #[serde(default)]
    pub map_hash: Option<String>,
}

impl ConnectionAction {
    /// Static checks that need no state.
    pub fn validate(&self) -> Result<(), MoneyError> {
        if self.schema_version != MONEY_RAILS_SCHEMA_VERSION {
            return Err(MoneyError::invalid(
                "schema_version",
                "unsupported schema version",
            ));
        }
        if let Some(label) = &self.label {
            if !clean_text(label, 80) {
                return Err(MoneyError::invalid(
                    "money_invalid_input",
                    "label must be 1 to 80 characters",
                ));
            }
        }
        let need = |present: bool, what: &str| {
            if present {
                Ok(())
            } else {
                Err(MoneyError::invalid(
                    "money_invalid_input",
                    format!("{what} is required for this operation"),
                ))
            }
        };
        match self.op {
            ConnectionOp::AddBrowser => {
                need(self.provider.is_some(), "provider")?;
                need(self.label.is_some(), "label")?;
                need(self.browser_hosts.is_some(), "browserHosts")
            }
            ConnectionOp::ProposeRecipe => need(self.recipe.is_some(), "recipe"),
            ConnectionOp::ApproveRecipe => {
                need(self.recipe_id.is_some(), "recipeId")?;
                need(self.recipe_hash.is_some(), "recipeHash")
            }
            ConnectionOp::RevokeRecipe => need(self.recipe_id.is_some(), "recipeId"),
            ConnectionOp::ProposeNoticeMap => need(self.notice_map.is_some(), "noticeMap"),
            ConnectionOp::ApproveNoticeMap => need(self.map_hash.is_some(), "mapHash"),
            ConnectionOp::Rename => need(self.label.is_some(), "label"),
            ConnectionOp::SetDefault | ConnectionOp::Disconnect => Ok(()),
        }
    }

    /// The d-tag every command on this connection carries.
    pub fn d_tag(&self) -> String {
        super::connection_d_tag(self.connection_id)
    }
}

/// Who may run a connection operation (section 3 of the contract).
pub fn authorize_connection_op(op: ConnectionOp, role: ActorRole) -> Result<(), MoneyError> {
    let allowed = match op {
        ConnectionOp::ProposeRecipe | ConnectionOp::ProposeNoticeMap => role.may_prepare(),
        _ => role.is_owner_admin(),
    };
    if allowed {
        Ok(())
    } else {
        Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can do this; Scout can only propose recipes",
        ))
    }
}

/// What the relay must do besides storing the new configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionEffect {
    /// Nothing more.
    None,
    /// Clear the default flag on every other connection.
    MakeDefaultExclusive,
    /// Delete the sealed secrets in the same transaction.
    DeleteSecrets,
}

/// Applies one operation to an existing configuration. `add_browser` creates a configuration
/// and is handled by the relay, not here.
pub fn apply_connection_action(
    config: &mut ConnectionConfig,
    action: &ConnectionAction,
    actor_pubkey: &str,
    role: ActorRole,
    now: i64,
) -> Result<ConnectionEffect, MoneyError> {
    authorize_connection_op(action.op, role)?;
    if config.status == ConnectionStatus::Disconnected {
        return Err(MoneyError::conflict(
            "connection_disconnected",
            "this connection is disconnected",
        ));
    }
    let effect = match action.op {
        ConnectionOp::AddBrowser => {
            return Err(MoneyError::conflict(
                "connection_exists",
                "this connection already exists",
            ))
        }
        ConnectionOp::ProposeRecipe => {
            let recipe = action
                .recipe
                .clone()
                .ok_or_else(|| MoneyError::invalid("money_invalid_input", "recipe is required"))?;
            if config.route != Route::Api {
                return Err(MoneyError::conflict(
                    "route_mismatch",
                    "recipes belong to an API connection",
                ));
            }
            if config.recipes.len() >= MAX_RECIPES
                && !config
                    .recipes
                    .iter()
                    .any(|stored| stored.recipe.recipe_id == recipe.recipe_id)
            {
                return Err(MoneyError::invalid(
                    "recipe_size",
                    "this connection already has the most recipes it can keep",
                ));
            }
            let hash = recipe_hash(&recipe);
            let (status, refusal) = match validate_recipe(&recipe, &config.api_hosts) {
                Ok(()) => (ApprovalStatus::Proposed, None),
                Err(error) if error.kind == super::ErrorKind::Forbidden => {
                    (ApprovalStatus::Refused, Some(error.code.to_owned()))
                }
                Err(error) => return Err(error),
            };
            let stored = StoredRecipe {
                recipe,
                status,
                recipe_hash: hash,
                proposed_by: actor_pubkey.to_owned(),
                approved_by: None,
                approved_at: None,
                refusal,
            };
            match config
                .recipes
                .iter_mut()
                .find(|existing| existing.recipe.recipe_id == stored.recipe.recipe_id)
            {
                Some(existing) => *existing = stored,
                None => config.recipes.push(stored),
            }
            ConnectionEffect::None
        }
        ConnectionOp::ApproveRecipe => {
            let recipe_id = action.recipe_id.as_deref().unwrap_or_default();
            let seen_hash = action.recipe_hash.as_deref().unwrap_or_default();
            let api_hosts = config.api_hosts.clone();
            let stored = config
                .recipes
                .iter_mut()
                .find(|stored| stored.recipe.recipe_id == recipe_id)
                .ok_or_else(|| MoneyError::conflict("recipe_missing", "no such recipe"))?;
            if stored.status == ApprovalStatus::Refused {
                return Err(MoneyError::forbidden(
                    stored
                        .refusal
                        .as_deref()
                        .map_or("recipe_refused", static_code),
                    "this recipe was refused and cannot be approved",
                ));
            }
            // Atomic: the owner approves the exact body they saw, and the rules run again now.
            if recipe_hash(&stored.recipe) != stored.recipe_hash || stored.recipe_hash != seen_hash
            {
                return Err(MoneyError::conflict(
                    "recipe_changed",
                    "the recipe changed after you looked at it; review it again",
                ));
            }
            validate_recipe(&stored.recipe, &api_hosts)?;
            stored.status = ApprovalStatus::Approved;
            stored.approved_by = Some(actor_pubkey.to_owned());
            stored.approved_at = Some(now);
            ConnectionEffect::None
        }
        ConnectionOp::RevokeRecipe => {
            let recipe_id = action.recipe_id.as_deref().unwrap_or_default();
            let stored = config
                .recipes
                .iter_mut()
                .find(|stored| stored.recipe.recipe_id == recipe_id)
                .ok_or_else(|| MoneyError::conflict("recipe_missing", "no such recipe"))?;
            stored.status = ApprovalStatus::Revoked;
            ConnectionEffect::None
        }
        ConnectionOp::ProposeNoticeMap => {
            let map = action.notice_map.clone().ok_or_else(|| {
                MoneyError::invalid("money_invalid_input", "noticeMap is required")
            })?;
            validate_notice_map(&map)?;
            config.notice_map = Some(StoredNoticeMap {
                map_hash: notice_map_hash(&map),
                map,
                status: ApprovalStatus::Proposed,
                proposed_by: actor_pubkey.to_owned(),
                approved_by: None,
            });
            ConnectionEffect::None
        }
        ConnectionOp::ApproveNoticeMap => {
            let seen_hash = action.map_hash.as_deref().unwrap_or_default();
            let stored = config
                .notice_map
                .as_mut()
                .ok_or_else(|| MoneyError::conflict("notice_map_missing", "no notice map"))?;
            if notice_map_hash(&stored.map) != stored.map_hash || stored.map_hash != seen_hash {
                return Err(MoneyError::conflict(
                    "notice_map_changed",
                    "the notice map changed after you looked at it; review it again",
                ));
            }
            validate_notice_map(&stored.map)?;
            stored.status = ApprovalStatus::Approved;
            stored.approved_by = Some(actor_pubkey.to_owned());
            ConnectionEffect::None
        }
        ConnectionOp::SetDefault => {
            config.is_default = true;
            ConnectionEffect::MakeDefaultExclusive
        }
        ConnectionOp::Rename => {
            config.label = action
                .label
                .clone()
                .ok_or_else(|| MoneyError::invalid("money_invalid_input", "label is required"))?;
            ConnectionEffect::None
        }
        ConnectionOp::Disconnect => {
            config.status = ConnectionStatus::Disconnected;
            config.is_default = false;
            config.has_api_key = false;
            config.has_signing_secret = false;
            for stored in &mut config.recipes {
                if stored.status == ApprovalStatus::Approved {
                    stored.status = ApprovalStatus::Revoked;
                }
            }
            ConnectionEffect::DeleteSecrets
        }
    };
    config.version = config.version.saturating_add(1);
    Ok(effect)
}

/// Maps a stored refusal code to the static codes the refusal list produces.
fn static_code(code: &str) -> &'static str {
    for &(_, refusal_code) in super::refusal::FORBIDDEN_WORDS {
        if refusal_code == code {
            return refusal_code;
        }
    }
    match code {
        "balance_path" => "balance_path",
        "method_not_allowed" => "method_not_allowed",
        "host_not_allowed" => "host_not_allowed",
        _ => "recipe_refused",
    }
}

/// Counts the recipes of each purpose that are approved, for the card checks.
pub fn has_approved_create_recipe(config: &ConnectionConfig) -> bool {
    config.approved_recipe(RecipePurpose::CreateLink).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::money_rails::recipe::{AmountPointer, AmountScale, BodyEncoding, Extract};

    fn config() -> ConnectionConfig {
        ConnectionConfig {
            connection_id: Uuid::new_v4(),
            provider: "stripe".to_owned(),
            label: "Stripe".to_owned(),
            route: Route::Api,
            status: ConnectionStatus::Connected,
            is_default: false,
            api_hosts: vec!["api.stripe.com".to_owned()],
            browser_hosts: vec!["dashboard.stripe.com".to_owned()],
            auth_scheme: Some(AuthScheme::Basic),
            recipes: Vec::new(),
            notice_map: None,
            signature: None,
            has_api_key: true,
            has_signing_secret: false,
            created_at: 1,
            last_used_at: None,
            version: 1,
        }
    }

    fn recipe(path: &str) -> Recipe {
        Recipe {
            recipe_id: "create-payment-link".to_owned(),
            title: "Create payment link".to_owned(),
            purpose: RecipePurpose::CreateLink,
            method: "POST".to_owned(),
            host: "api.stripe.com".to_owned(),
            path: path.to_owned(),
            query: Vec::new(),
            headers: Vec::new(),
            body_encoding: BodyEncoding::Form,
            body: "currency={{currency_lower}}&amount={{amount_minor}}".to_owned(),
            extract: Extract {
                url: Some("/url".to_owned()),
                reference: Some("/id".to_owned()),
                amount: Some(AmountPointer {
                    pointer: "/amount".to_owned(),
                    scale: AmountScale::Minor,
                }),
                currency: Some("/currency".to_owned()),
                paid: None,
            },
        }
    }

    fn action(op: ConnectionOp, config: &ConnectionConfig) -> ConnectionAction {
        ConnectionAction {
            schema_version: MONEY_RAILS_SCHEMA_VERSION,
            op,
            connection_id: config.connection_id,
            expected_head_event_id: None,
            provider: None,
            label: None,
            browser_hosts: None,
            recipe: None,
            recipe_id: None,
            recipe_hash: None,
            notice_map: None,
            map_hash: None,
        }
    }

    #[test]
    fn a_proposed_recipe_never_runs_until_the_owner_approves_the_exact_body() {
        let mut config = config();
        let mut propose = action(ConnectionOp::ProposeRecipe, &config);
        propose.recipe = Some(recipe("/v1/payment_links"));
        apply_connection_action(&mut config, &propose, "scout", ActorRole::OwnedAgent, 10)
            .expect("agent proposes");
        assert!(!has_approved_create_recipe(&config));
        assert_eq!(config.recipes[0].status, ApprovalStatus::Proposed);

        // Scout cannot approve its own proposal.
        let hash = config.recipes[0].recipe_hash.clone();
        let mut approve = action(ConnectionOp::ApproveRecipe, &config);
        approve.recipe_id = Some("create-payment-link".to_owned());
        approve.recipe_hash = Some(hash.clone());
        let denied =
            apply_connection_action(&mut config, &approve, "scout", ActorRole::OwnedAgent, 11)
                .expect_err("agent cannot approve");
        assert_eq!(denied.kind, crate::money_rails::ErrorKind::Forbidden);
        assert!(!has_approved_create_recipe(&config));

        // A stale hash is refused: a changed recipe needs a new look.
        let mut stale = approve.clone();
        stale.recipe_hash = Some("0".repeat(64));
        let conflict =
            apply_connection_action(&mut config, &stale, "owner", ActorRole::OwnerAdmin, 12)
                .expect_err("stale hash");
        assert_eq!(conflict.code, "recipe_changed");

        apply_connection_action(&mut config, &approve, "owner", ActorRole::OwnerAdmin, 13)
            .expect("owner approves");
        assert!(has_approved_create_recipe(&config));
        assert_eq!(config.recipes[0].approved_by.as_deref(), Some("owner"));
    }

    #[test]
    fn a_refund_recipe_is_stored_as_refused_and_can_never_be_approved() {
        let mut config = config();
        let mut propose = action(ConnectionOp::ProposeRecipe, &config);
        let mut bad = recipe("/v1/refunds");
        bad.recipe_id = "refund-x".to_owned();
        propose.recipe = Some(bad);
        apply_connection_action(&mut config, &propose, "scout", ActorRole::OwnedAgent, 10)
            .expect("proposal is recorded as refused");
        assert_eq!(config.recipes[0].status, ApprovalStatus::Refused);
        assert_eq!(config.recipes[0].refusal.as_deref(), Some("refund_path"));

        let hash = config.recipes[0].recipe_hash.clone();
        let mut approve = action(ConnectionOp::ApproveRecipe, &config);
        approve.recipe_id = Some("refund-x".to_owned());
        approve.recipe_hash = Some(hash);
        let error =
            apply_connection_action(&mut config, &approve, "owner", ActorRole::OwnerAdmin, 11)
                .expect_err("owner cannot approve a refused recipe");
        assert_eq!(error.code, "refund_path");
        assert!(!has_approved_create_recipe(&config));
        let head = config.to_head("e");
        assert_eq!(head.refused_recipes.len(), 1);
        assert_eq!(head.refused_recipes[0].reason, "refund_path");
    }

    #[test]
    fn a_recipe_that_slipped_a_refund_in_after_proposal_is_refused_at_approval() {
        let mut config = config();
        let mut propose = action(ConnectionOp::ProposeRecipe, &config);
        propose.recipe = Some(recipe("/v1/payment_links"));
        apply_connection_action(&mut config, &propose, "scout", ActorRole::OwnedAgent, 10)
            .expect("proposed");
        // Tamper with the stored body and keep the old hash: approval must refuse.
        config.recipes[0].recipe.path = "/v1/payouts".to_owned();
        let hash = config.recipes[0].recipe_hash.clone();
        let mut approve = action(ConnectionOp::ApproveRecipe, &config);
        approve.recipe_id = Some("create-payment-link".to_owned());
        approve.recipe_hash = Some(hash);
        let error =
            apply_connection_action(&mut config, &approve, "owner", ActorRole::OwnerAdmin, 11)
                .expect_err("changed body");
        assert_eq!(error.code, "recipe_changed");
        assert!(!has_approved_create_recipe(&config));
    }

    #[test]
    fn disconnect_revokes_recipes_and_clears_secret_flags() {
        let mut config = config();
        config.has_signing_secret = true;
        let mut propose = action(ConnectionOp::ProposeRecipe, &config);
        propose.recipe = Some(recipe("/v1/payment_links"));
        apply_connection_action(&mut config, &propose, "owner", ActorRole::OwnerAdmin, 10)
            .expect("proposed");
        let disconnect = action(ConnectionOp::Disconnect, &config);
        let effect =
            apply_connection_action(&mut config, &disconnect, "owner", ActorRole::OwnerAdmin, 11)
                .expect("disconnect");
        assert_eq!(effect, ConnectionEffect::DeleteSecrets);
        assert_eq!(config.status, ConnectionStatus::Disconnected);
        assert!(!config.has_api_key && !config.has_signing_secret);
        let again =
            apply_connection_action(&mut config, &disconnect, "owner", ActorRole::OwnerAdmin, 12)
                .expect_err("already disconnected");
        assert_eq!(again.code, "connection_disconnected");
    }

    #[test]
    fn the_head_never_carries_a_body_or_secret() {
        let mut config = config();
        let mut propose = action(ConnectionOp::ProposeRecipe, &config);
        propose.recipe = Some(recipe("/v1/payment_links"));
        apply_connection_action(&mut config, &propose, "owner", ActorRole::OwnerAdmin, 10)
            .expect("proposed");
        let json = serde_json::to_string(&config.to_head("e")).expect("head json");
        assert!(!json.contains("amount={{amount_minor}}"), "{json}");
        assert!(json.contains("\"noticeAddressSet\":true"));
        assert!(json.contains("\"hasApiKey\":true"));
        assert!(!json.contains("signingSecret"));
    }

    #[test]
    fn new_connections_are_checked() {
        let hosts = vec!["api.stripe.com".to_owned()];
        assert!(validate_new_connection("stripe", "Stripe", Route::Api, &hosts, &[]).is_ok());
        assert!(validate_new_connection("Stripe", "Stripe", Route::Api, &hosts, &[]).is_err());
        assert!(validate_new_connection("stripe", "Stripe", Route::Api, &[], &[]).is_err());
        assert!(validate_new_connection("stripe", "Stripe", Route::Browser, &hosts, &[]).is_err());
        let bad = vec!["10.0.0.1".to_owned()];
        assert!(validate_new_connection("stripe", "Stripe", Route::Api, &bad, &[]).is_err());
    }

    #[test]
    fn auth_schemes_round_trip_and_refuse_dangerous_headers() {
        for text in ["bearer", "basic", "header:X-Api-Key"] {
            let parsed = AuthScheme::parse(text).expect("scheme");
            assert_eq!(parsed.as_wire(), text);
        }
        assert!(AuthScheme::parse("header:Authorization").is_err());
        assert!(AuthScheme::parse("digest").is_err());
        let json = serde_json::to_string(&AuthScheme::Basic).expect("json");
        assert_eq!(json, "\"basic\"");
        assert_eq!(
            serde_json::from_str::<AuthScheme>("\"header:X-Key\"").expect("parse"),
            AuthScheme::Header("X-Key".to_owned())
        );
    }
}
