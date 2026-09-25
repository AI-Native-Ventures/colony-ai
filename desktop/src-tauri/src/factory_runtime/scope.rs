use super::*;

/// Native-owned authorization scope for persisted Factory runs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryScope {
    pub relay_url: String,
    pub identity_pubkey: String,
    pub business_community_id: String,
    pub client_channel_id: Option<String>,
}

impl FactoryScope {
    pub(super) fn db_values(&self) -> (&str, &str, &str, &str) {
        (
            &self.relay_url,
            &self.identity_pubkey,
            &self.business_community_id,
            self.client_channel_id.as_deref().unwrap_or(""),
        )
    }

    pub(super) fn business_membership_key(&self) -> FactoryMembershipKey {
        FactoryMembershipKey {
            relay_url: self.relay_url.clone(),
            identity_pubkey: self.identity_pubkey.clone(),
            subject: FactoryMembershipSubject::BusinessCommunity(
                self.business_community_id.clone(),
            ),
        }
    }

    pub(super) fn membership_key(&self) -> Option<FactoryMembershipKey> {
        self.client_channel_id
            .as_ref()
            .map(|channel_id| FactoryMembershipKey {
                relay_url: self.relay_url.clone(),
                identity_pubkey: self.identity_pubkey.clone(),
                subject: FactoryMembershipSubject::ClientChannel(channel_id.clone()),
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum FactoryMembershipSubject {
    BusinessCommunity(String),
    ClientChannel(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct FactoryMembershipKey {
    relay_url: String,
    identity_pubkey: String,
    subject: FactoryMembershipSubject,
}

#[derive(Debug, Deserialize)]
pub(super) struct FactoryBusinessMembershipResponse {
    pub(super) owner_pubkey: String,
    pub(super) communities: Vec<FactoryBusinessMembership>,
}

#[derive(Debug, Deserialize)]
pub(super) struct FactoryBusinessMembership {
    pub(super) id: String,
}

pub(super) fn response_contains_business_membership(
    response: &FactoryBusinessMembershipResponse,
    identity_pubkey: &str,
    business_community_id: &str,
) -> Result<bool, String> {
    if response.communities.len() > MAX_BUSINESS_MEMBERSHIP_COMMUNITIES {
        return Err("business membership response contains too many communities".to_string());
    }
    Ok(response.owner_pubkey.eq_ignore_ascii_case(identity_pubkey)
        && response
            .communities
            .iter()
            .any(|community| community.id == business_community_id))
}

#[derive(Clone)]
pub(super) struct MembershipCache {
    pub(super) entries: Arc<Mutex<HashMap<FactoryMembershipKey, (Instant, bool)>>>,
    pub(super) generations: Arc<Mutex<HashMap<FactoryMembershipKey, u64>>>,
    pub(super) next_generation: Arc<AtomicU64>,
}

impl MembershipCache {
    pub(super) async fn verify_with<F, Fut>(
        &self,
        key: FactoryMembershipKey,
        force_refresh: bool,
        now: Instant,
        verify: F,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<bool, String>>,
    {
        if !force_refresh {
            if let Some((_, is_member)) = self
                .entries
                .lock()
                .map_err(|error| error.to_string())?
                .get(&key)
                .copied()
                .filter(|(expires_at, _)| *expires_at > now)
            {
                return Ok(is_member);
            }
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        {
            let mut generations = self.generations.lock().map_err(|error| error.to_string())?;
            generations.insert(key.clone(), generation);
            self.entries
                .lock()
                .map_err(|error| error.to_string())?
                .remove(&key);
        }

        let is_member = match verify().await {
            Ok(is_member) => is_member,
            Err(error) => {
                let mut generations = self
                    .generations
                    .lock()
                    .map_err(|failure| failure.to_string())?;
                if generations.get(&key) == Some(&generation) {
                    generations.remove(&key);
                }
                return Err(error);
            }
        };
        let mut generations = self.generations.lock().map_err(|error| error.to_string())?;
        if generations.get(&key) != Some(&generation) {
            return Err("Factory membership verification was superseded".to_string());
        }
        let mut entries = self.entries.lock().map_err(|error| error.to_string())?;
        entries.retain(|_, (expires_at, _)| *expires_at > now);
        if entries.len() >= MAX_MEMBERSHIP_CACHE_ENTRIES {
            entries.clear();
        }
        entries.insert(key.clone(), (now + FACTORY_MEMBERSHIP_TTL, is_member));
        generations.remove(&key);
        Ok(is_member)
    }

    pub(super) async fn verify_for_bind<F, Fut>(
        &self,
        key: FactoryMembershipKey,
        now: Instant,
        verify: F,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<bool, String>>,
    {
        self.verify_with(key, true, now, verify).await
    }

    pub(super) fn has_fresh_membership(&self, scope: &FactoryScope, now: Instant) -> bool {
        let Ok(entries) = self.entries.lock() else {
            return false;
        };
        let is_fresh_member = |key: &FactoryMembershipKey| {
            entries
                .get(key)
                .is_some_and(|(expires_at, is_member)| *expires_at > now && *is_member)
        };
        is_fresh_member(&scope.business_membership_key())
            && scope.membership_key().as_ref().is_none_or(is_fresh_member)
    }

    pub(super) fn invalidate_scope(&self, scope: &FactoryScope) {
        let Ok(mut generations) = self.generations.lock() else {
            return;
        };
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.remove(&scope.business_membership_key());
        generations.remove(&scope.business_membership_key());
        if let Some(key) = scope.membership_key() {
            entries.remove(&key);
            generations.remove(&key);
        }
    }
}

#[derive(Clone)]
pub(super) struct FactoryEventAuthority {
    pub(super) active_scope: Arc<Mutex<Option<FactoryScope>>>,
    pub(super) memberships: MembershipCache,
}

impl FactoryEventAuthority {
    pub(super) fn is_active(&self, scope: &FactoryScope) -> bool {
        self.active_scope
            .lock()
            .ok()
            .is_some_and(|active| active.as_ref() == Some(scope))
            && self.memberships.has_fresh_membership(scope, Instant::now())
    }

    pub(super) fn while_active(&self, scope: &FactoryScope, send: impl FnOnce()) -> bool {
        let Ok(active) = self.active_scope.lock() else {
            return false;
        };
        if active.as_ref() != Some(scope)
            || !self.memberships.has_fresh_membership(scope, Instant::now())
        {
            return false;
        }
        send();
        true
    }
}

pub(super) fn native_scope_is_current(app: &AppHandle, scope: &FactoryScope) -> bool {
    let state = app.state::<crate::app_state::AppState>();
    let Ok(keys) = state.signing_keys() else {
        return false;
    };
    crate::relay::relay_ws_url_with_override(&state) == scope.relay_url
        && keys
            .public_key()
            .to_hex()
            .eq_ignore_ascii_case(&scope.identity_pubkey)
}

/// Clear Factory access while the serialized native workspace switch applies.
pub(super) fn clear_scope_for_workspace(app: &AppHandle) -> Result<(), String> {
    app.state::<FactoryRuntime>().activate_scope(None)
}

/// Bind Factory to the relay and identity already installed by `apply_workspace`.
/// A renderer cannot bind a scope by calling a Factory command or supplying an
/// identity. Optional client channels are proved through an authenticated
/// native NIP-42 query before the scope becomes active.
pub(super) async fn bind_scope_for_workspace(
    app: &AppHandle,
    requested_relay_url: &str,
    business_community_id: Option<String>,
    client_channel_id: Option<String>,
) -> Result<(), String> {
    let runtime = app.state::<FactoryRuntime>();
    runtime.activate_scope(None)?;
    let state = app.state::<crate::app_state::AppState>();
    let relay_url = crate::relay::relay_ws_url_with_override(&state);
    if relay_url != requested_relay_url {
        return Err("Factory workspace relay changed during context binding".to_string());
    }
    let keys = state.signing_keys()?;
    let Some(business_community_id) = business_community_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        if client_channel_id.is_some() {
            return Err("client channel requires an active business workspace".to_string());
        }
        return Ok(());
    };
    if business_community_id.len() > 128 {
        return Err("invalid business community id".to_string());
    }
    let client_channel_id = client_channel_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if client_channel_id
        .as_ref()
        .is_some_and(|value| value.len() > 128)
    {
        return Err("invalid client channel id".to_string());
    }
    let scope = FactoryScope {
        relay_url,
        identity_pubkey: keys.public_key().to_hex(),
        business_community_id,
        client_channel_id,
    };
    verify_cached_business_membership(&runtime, &scope, true, || async {
        verify_business_community_membership(&state, &scope).await
    })
    .await?;
    verify_client_channel_membership(&state, app, &runtime, &scope, keys, true).await?;
    if !native_scope_is_current(app, &scope) {
        runtime.activate_scope(None)?;
        return Err(
            "Factory workspace relay or identity changed during context binding".to_string(),
        );
    }
    runtime.activate_scope(Some(scope))
}

async fn verify_business_community_membership(
    state: &crate::app_state::AppState,
    scope: &FactoryScope,
) -> Result<bool, String> {
    let response: FactoryBusinessMembershipResponse = crate::relay::get_relay_json_bounded(
        state,
        "/api/communities/mine?scope=member",
        MAX_BUSINESS_MEMBERSHIP_RESPONSE_BYTES,
    )
    .await?;
    response_contains_business_membership(
        &response,
        &scope.identity_pubkey,
        &scope.business_community_id,
    )
}

async fn verify_client_channel_membership(
    state: &crate::app_state::AppState,
    app: &AppHandle,
    runtime: &FactoryRuntime,
    scope: &FactoryScope,
    keys: nostr::Keys,
    force_refresh: bool,
) -> Result<(), String> {
    if scope.client_channel_id.is_none() {
        return Ok(());
    }
    let native_relay_client = app.state::<crate::native_relay_client::NativeRelayClient>();
    let verify = || async {
        let relay_pubkey = crate::commands::fetch_relay_self_at(state, &scope.relay_url)
            .await?
            .ok_or_else(|| "relay does not advertise a signing identity".to_string())?;
        let expected_relay_pubkey = relay_pubkey.clone();
        let channel_id = scope.client_channel_id.clone().unwrap_or_default();
        let session = native_relay_client
            .session(scope.relay_url.clone(), keys)
            .await;
        let events = session
            .fetch_events(
                serde_json::json!({
                    "authors": [relay_pubkey],
                    "kinds": [39002],
                    "#d": [channel_id],
                    "limit": 1
                }),
                Duration::from_secs(10),
            )
            .await?;
        let pubkey = scope.identity_pubkey.to_ascii_lowercase();
        let verified = tauri::async_runtime::spawn_blocking(move || {
            events.into_iter().any(|event| {
                event.kind == nostr::Kind::Custom(39002)
                    && event.verify().is_ok()
                    && event
                        .pubkey
                        .to_hex()
                        .eq_ignore_ascii_case(&expected_relay_pubkey)
                    && event.tags.iter().any(|tag| {
                        let values = tag.as_slice();
                        values.first().is_some_and(|name| name == "d")
                            && values.get(1).is_some_and(|value| value == &channel_id)
                    })
                    && event.tags.iter().any(|tag| {
                        let values = tag.as_slice();
                        values.first().is_some_and(|name| name == "p")
                            && values
                                .get(1)
                                .is_some_and(|member| member.eq_ignore_ascii_case(&pubkey))
                    })
            })
        })
        .await
        .map_err(|error| format!("Factory membership verification failed: {error}"))?;
        Ok(verified)
    };
    verify_cached_client_membership(runtime, scope, force_refresh, verify).await
}

pub(super) async fn verify_cached_client_membership<F, Fut>(
    runtime: &FactoryRuntime,
    scope: &FactoryScope,
    force_refresh: bool,
    verify: F,
) -> Result<(), String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<bool, String>>,
{
    let Some(key) = scope.membership_key() else {
        return Ok(());
    };
    let now = Instant::now();
    let is_member = if force_refresh {
        runtime.memberships.verify_for_bind(key, now, verify).await
    } else {
        runtime
            .memberships
            .verify_with(key, false, now, verify)
            .await
    };
    match is_member {
        Ok(true) => Ok(()),
        Ok(false) => {
            runtime.invalidate_scope(scope)?;
            Err("current identity is not a member of the client channel".to_string())
        }
        Err(error) => {
            runtime.invalidate_scope(scope)?;
            Err(format!(
                "Factory client membership could not be revalidated: {error}"
            ))
        }
    }
}

pub(super) async fn verify_cached_business_membership<F, Fut>(
    runtime: &FactoryRuntime,
    scope: &FactoryScope,
    force_refresh: bool,
    verify: F,
) -> Result<(), String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<bool, String>>,
{
    let key = scope.business_membership_key();
    let now = Instant::now();
    let membership = if force_refresh {
        runtime.memberships.verify_for_bind(key, now, verify).await
    } else {
        runtime
            .memberships
            .verify_with(key, false, now, verify)
            .await
    };
    match membership {
        Ok(true) => Ok(()),
        Ok(false) => {
            runtime.invalidate_scope(scope)?;
            Err("current identity is not a member of the business community".to_string())
        }
        Err(error) => {
            runtime.invalidate_scope(scope)?;
            Err(format!(
                "Factory business membership could not be revalidated: {error}"
            ))
        }
    }
}

pub(super) async fn revalidate_factory_scope_memberships<BF, BFut, CF, CFut>(
    runtime: &FactoryRuntime,
    scope: &FactoryScope,
    force_refresh: bool,
    verify_business: BF,
    verify_client: CF,
) -> Result<(), String>
where
    BF: FnOnce() -> BFut,
    BFut: Future<Output = Result<bool, String>>,
    CF: FnOnce() -> CFut,
    CFut: Future<Output = Result<(), String>>,
{
    verify_cached_business_membership(runtime, scope, force_refresh, verify_business).await?;
    if scope.client_channel_id.is_some() {
        verify_client().await?;
    }
    Ok(())
}

pub(super) async fn authorize_active_factory_scope<BF, BFut, CF, CFut>(
    runtime: &FactoryRuntime,
    scope: &FactoryScope,
    force_refresh: bool,
    verify_business: BF,
    verify_client: CF,
) -> Result<(), String>
where
    BF: FnOnce() -> BFut,
    BFut: Future<Output = Result<bool, String>>,
    CF: FnOnce() -> CFut,
    CFut: Future<Output = Result<(), String>>,
{
    let active = runtime.active_scope()?;
    if &active != scope {
        return Err("Factory workspace scope changed before membership verification".to_string());
    }
    revalidate_factory_scope_memberships(
        runtime,
        scope,
        force_refresh,
        verify_business,
        verify_client,
    )
    .await?;
    if !runtime.event_authority().is_active(scope) {
        return Err("Factory workspace scope changed during authorization".to_string());
    }
    Ok(())
}

pub(super) async fn require_factory_scope(
    state: &crate::app_state::AppState,
    app: &AppHandle,
    runtime: &FactoryRuntime,
    force_membership_refresh: bool,
) -> Result<FactoryScope, String> {
    let scope = runtime.active_scope()?;
    if !native_scope_is_current(app, &scope) {
        runtime.activate_scope(None)?;
        return Err("Factory workspace scope no longer matches the native identity".to_string());
    }
    let keys = state.signing_keys()?;
    authorize_active_factory_scope(
        runtime,
        &scope,
        force_membership_refresh,
        || async { verify_business_community_membership(state, &scope).await },
        || async {
            verify_client_channel_membership(
                state,
                app,
                runtime,
                &scope,
                keys,
                force_membership_refresh,
            )
            .await
        },
    )
    .await?;
    if !native_scope_is_current(app, &scope) {
        return Err("Factory workspace scope changed during authorization".to_string());
    }
    Ok(scope)
}
