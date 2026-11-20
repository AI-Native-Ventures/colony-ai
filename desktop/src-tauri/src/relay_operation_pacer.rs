//! Shared admission for Nostr operations sent by the desktop process.
//!
//! Webviews reach the relay through `native_websocket`, while archive sync and
//! native catalog reads use `native_relay_client` directly. Both can sign as
//! the active owner, so they must spend one relay budget rather than each
//! keeping a private token bucket.

use std::{collections::HashMap, sync::Arc, time::Duration};

use tokio::{
    sync::{Mutex, Semaphore},
    time::Instant,
};
use tokio_util::sync::CancellationToken;

/// A five-operation opening burst plus one token every 143 ms permits at most
/// 40 operations in any five-second interval. The relay allows 50, so this
/// reserves ten frames for independently initiated owner work.
pub(crate) const RELAY_OPERATION_INTERVAL: Duration = Duration::from_millis(143);
/// Maximum number of admitted operations in one five-second window.
#[cfg(test)]
pub(crate) const MAX_RELAY_OPERATIONS_PER_FIVE_SECONDS: usize = 40;
/// Number of operations that may start immediately on a fresh relay scope.
pub(crate) const RELAY_OPERATION_BURST_CAPACITY: usize = 5;
const MAX_QUEUED_RELAY_OPERATIONS: usize = 256;
const MAX_RELAY_OPERATION_SCOPES: usize = 32;
const SHARED_RELAY_OPERATION_SCOPE: &str = "__shared__";

struct RelayOperationBucket {
    tokens: f64,
    last_refill_at: Instant,
}

/// Bounded app-wide admission for `REQ`, `COUNT`, and `EVENT` frames.
///
/// A scope is a canonical relay URL. The app has one active owner identity at
/// a time, so deliberately sharing by relay URL is conservative when a caller
/// cannot expose its signing key at the transport boundary.
pub(crate) struct RelayOperationPacer {
    buckets: Mutex<HashMap<String, RelayOperationBucket>>,
    queue_slots: Arc<Semaphore>,
}

impl Default for RelayOperationPacer {
    fn default() -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            queue_slots: Arc::new(Semaphore::new(MAX_QUEUED_RELAY_OPERATIONS)),
        }
    }
}

impl RelayOperationPacer {
    /// Wait for one bounded admission token, stopping promptly if the owner
    /// socket or native session is cancelled.
    pub(crate) async fn acquire(
        &self,
        relay_url: &str,
        cancel: &CancellationToken,
    ) -> Result<(), String> {
        let _queue_slot = self
            .queue_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| "WebSocket relay operation queue is full".to_string())?;
        let scope = canonical_relay_scope(relay_url);

        loop {
            if cancel.is_cancelled() {
                return Err("WebSocket connection closed".to_string());
            }
            let delay = {
                let mut buckets = self.buckets.lock().await;
                let key =
                    if buckets.contains_key(&scope) || buckets.len() < MAX_RELAY_OPERATION_SCOPES {
                        scope.as_str()
                    } else {
                        SHARED_RELAY_OPERATION_SCOPE
                    };
                let now = Instant::now();
                let bucket =
                    buckets
                        .entry(key.to_string())
                        .or_insert_with(|| RelayOperationBucket {
                            tokens: RELAY_OPERATION_BURST_CAPACITY as f64,
                            last_refill_at: now,
                        });
                let elapsed = now.saturating_duration_since(bucket.last_refill_at);
                bucket.tokens = (bucket.tokens
                    + elapsed.as_secs_f64() / RELAY_OPERATION_INTERVAL.as_secs_f64())
                .min(RELAY_OPERATION_BURST_CAPACITY as f64);
                bucket.last_refill_at = now;

                if bucket.tokens >= 1.0 {
                    bucket.tokens -= 1.0;
                    return Ok(());
                }

                Duration::from_secs_f64(
                    ((1.0 - bucket.tokens) * RELAY_OPERATION_INTERVAL.as_secs_f64()).max(0.001),
                )
            };
            tokio::select! {
                _ = cancel.cancelled() => return Err("WebSocket connection closed".to_string()),
                _ = tokio::time::sleep(delay) => {}
            }
        }
    }
}

fn canonical_relay_scope(relay_url: &str) -> String {
    let Ok(mut url) = url::Url::parse(relay_url) else {
        return relay_url.to_string();
    };
    url.set_fragment(None);
    let has_default_port = (matches!(url.scheme(), "ws" | "http") && url.port() == Some(80))
        || (matches!(url.scheme(), "wss" | "https") && url.port() == Some(443));
    if has_default_port {
        let _ = url.set_port(None);
    }
    if url.path() == "/" {
        url.set_path("");
    }
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equivalent_default_port_urls_share_a_scope() {
        assert_eq!(
            canonical_relay_scope("WSS://Relay.Example:443/"),
            canonical_relay_scope("wss://relay.example"),
        );
    }

    #[tokio::test(start_paused = true)]
    async fn renderer_and_native_owner_reads_share_reserved_budget() {
        let pacer = Arc::new(RelayOperationPacer::default());
        let cancel = CancellationToken::new();
        let sent_at = Arc::new(std::sync::Mutex::new(Vec::new()));
        let start = Instant::now();
        // A main renderer can queue 48 sends in five seconds while 20-channel
        // unread catch-up can add 20 direct-native REQs in that same window.
        let sends = (0..68)
            .map(|index| {
                let pacer = Arc::clone(&pacer);
                let cancel = cancel.clone();
                let sent_at = Arc::clone(&sent_at);
                let relay_url = if index < 48 {
                    "wss://relay.example"
                } else {
                    "WSS://Relay.Example:443/"
                };
                tokio::spawn(async move {
                    pacer.acquire(relay_url, &cancel).await.unwrap();
                    sent_at.lock().unwrap().push(Instant::now());
                })
            })
            .collect::<Vec<_>>();

        for _ in 0..100 {
            tokio::task::yield_now().await;
            tokio::time::advance(RELAY_OPERATION_INTERVAL).await;
        }
        for send in sends {
            send.await.unwrap();
        }

        let within_first_window = sent_at
            .lock()
            .unwrap()
            .iter()
            .filter(|sent| sent.duration_since(start) < Duration::from_secs(5))
            .count();
        assert!(
            within_first_window <= MAX_RELAY_OPERATIONS_PER_FIVE_SECONDS,
            "combined renderer and native owner sends exceeded the reserved operation budget: {within_first_window}"
        );
    }
}
