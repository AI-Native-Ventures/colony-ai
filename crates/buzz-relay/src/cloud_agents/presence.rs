//! Whether an agent is connected to the relay right now.
//!
//! The doorbell and the reconciler both ask "does this agent have presence?".
//! They ask through a small trait so tests do not need Redis, and so the rule
//! lives in one place: presence is the Redis key the harness keeps alive, with
//! a 180 second expiry.

use std::sync::Arc;

use buzz_core::tenant::TenantContext;
use buzz_pubsub::PubSubManager;

/// A source of "is this agent online".
#[async_trait::async_trait]
pub trait PresenceSource: Send + Sync {
    /// `Ok(true)` when the agent has presence. An error means the answer is
    /// unknown, and callers must not treat it as "offline".
    async fn is_online(&self, tenant: &TenantContext, agent_pubkey: &[u8]) -> Result<bool, String>;
}

/// Presence read from the relay's Redis.
pub struct PubsubPresence {
    pubsub: Arc<PubSubManager>,
}

impl PubsubPresence {
    /// Reads presence through `pubsub`.
    pub fn new(pubsub: Arc<PubSubManager>) -> Self {
        Self { pubsub }
    }
}

#[async_trait::async_trait]
impl PresenceSource for PubsubPresence {
    async fn is_online(&self, tenant: &TenantContext, agent_pubkey: &[u8]) -> Result<bool, String> {
        let key = nostr::PublicKey::from_slice(agent_pubkey)
            .map_err(|error| format!("agent key: {error}"))?;
        self.pubsub
            .get_presence(tenant, &key)
            .await
            .map(|status| status.is_some_and(|status| status != "offline"))
            .map_err(|error| format!("presence read failed: {error}"))
    }
}

/// A fixed set of online agents, for tests.
#[cfg(test)]
#[derive(Default)]
pub struct FakePresence {
    online: std::sync::Mutex<std::collections::HashSet<Vec<u8>>>,
}

#[cfg(test)]
impl FakePresence {
    /// Marks an agent online or offline.
    pub fn set(&self, agent: &[u8], online: bool) {
        let mut set = self
            .online
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if online {
            set.insert(agent.to_vec());
        } else {
            set.remove(agent);
        }
    }
}

#[cfg(test)]
#[async_trait::async_trait]
impl PresenceSource for FakePresence {
    async fn is_online(
        &self,
        _tenant: &TenantContext,
        agent_pubkey: &[u8],
    ) -> Result<bool, String> {
        Ok(self
            .online
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains(agent_pubkey))
    }
}
