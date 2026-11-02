//! Inbound customer media: download it from Meta soon after it arrives and keep it in the
//! company's own media store.
//!
//! A Meta media id expires after 30 days and its download URL after minutes, so the bytes are
//! fetched promptly with the connection's token (bounded size, bounded time) and saved through
//! the same host-bound store as every other upload. Every failure leaves a durable record on
//! the message row: a failed download backs off and is retried by the sender loop, a file Meta
//! no longer has is marked gone, and a file that is too large is marked as such. Nothing is
//! dropped quietly. The token never appears in a log line or an error.

use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use buzz_core::TenantContext;
use buzz_db::whatsapp::{WhatsappConnection, WhatsappMedia};

use super::channel;
use super::connect::{note_token_expired, open_secrets};
use super::graph::{DownloadError, GraphApi, GraphError};
use crate::state::AppState;

/// Largest file that is fetched and stored. Bigger files are marked `too_large`.
pub const MAX_MEDIA_BYTES: u64 = 25 * 1024 * 1024;
/// How long the webhook waits for the first download attempt before answering Meta.
const INLINE_DEADLINE: Duration = Duration::from_secs(20);
/// Hold on a file while it is being fetched. The holder either records the result or the
/// lease runs out and the sender loop tries again.
const LEASE_SECS: f64 = 120.0;
/// Downloads started by one sender pass.
const DUE_PER_TICK: i64 = 5;
/// Follow-up link posts started by one sender pass.
const LINK_PER_TICK: i64 = 10;

/// Why a download did not produce a stored file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// Try again later (backoff). The text is a short code, never a URL or token.
    Retry(String),
    /// Do not try again by itself.
    Final {
        /// `failed` (the owner may retry) or `gone` (Meta no longer has it).
        state: &'static str,
        /// Short code shown to the owner and kept on the row.
        error: &'static str,
    },
}

/// Decide what a Graph error means for a download.
pub fn classify_graph_error(error: &GraphError) -> Failure {
    match error {
        GraphError::Rejected {
            http_status, code, ..
        } => match (*http_status, *code) {
            // The id or the file is gone: Meta keeps media for 30 days.
            (404 | 410, _) | (400, Some(100)) => Failure::Final {
                state: "gone",
                error: "not_found",
            },
            (401, _) | (_, Some(190)) => Failure::Retry("token".to_owned()),
            (status, _) => Failure::Retry(format!("rejected_{status}")),
        },
        GraphError::Unavailable(reason) => Failure::Retry(reason.chars().take(80).collect()),
    }
}

/// Ask Meta for the file and download it, within `max_bytes`. Pure of storage and database, so
/// it is tested against a stub Graph API.
pub async fn fetch_bytes(
    graph: &dyn GraphApi,
    token: &str,
    media_id: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, Failure> {
    let too_large = Failure::Final {
        state: "failed",
        error: "too_large",
    };
    let info = graph
        .media_info(token, media_id)
        .await
        .map_err(|error| classify_graph_error(&error))?;
    if info.file_size.is_some_and(|size| size > max_bytes) {
        return Err(too_large);
    }
    graph
        .download_media(token, &info.url, max_bytes)
        .await
        .map_err(|error| match error {
            DownloadError::TooLarge => too_large,
            DownloadError::Graph(error) => classify_graph_error(&error),
        })
}

/// Keep the downloaded bytes in the community media store.
async fn store(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    bytes: Vec<u8>,
) -> Result<buzz_media::StoredInbound, Failure> {
    let retry = |what: &str, error: &dyn std::fmt::Display| {
        tracing::warn!("whatsapp media {what}: {error}");
        Failure::Retry(what.to_owned())
    };
    let guard =
        buzz_deletion::acquire_serving_write(&state.db, tenant.community(), "whatsapp_media")
            .await
            .map_err(|error| retry("write_lease", &error))?;
    let stored = guard
        .protect(buzz_media::store_inbound(
            &state.media_storage,
            &state.config.media,
            tenant,
            &state.relay_keypair,
            Bytes::from(bytes),
        ))
        .await
        .map_err(|error| retry("write_lease_lost", &error))?
        .map_err(|error| retry("store", &error))?;
    guard
        .finish()
        .await
        .map_err(|error| retry("write_lease_lost", &error))?;
    Ok(stored)
}

/// Download one message's media and record the outcome on its row. Never returns an error:
/// the outcome, good or bad, is the row's state.
async fn process_one(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    token: Result<&str, &'static str>,
    media: &WhatsappMedia,
    now: DateTime<Utc>,
) {
    let community = tenant.community();
    match state
        .db
        .whatsapp_media_claim(community, media.message_id, now, LEASE_SECS)
        .await
    {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            tracing::warn!(%community, message = %media.message_id, "whatsapp media claim failed: {error}");
            return;
        }
    }
    let token = match token {
        Ok(token) => token,
        Err(reason) => {
            record_retry(state, tenant, media, reason, now).await;
            return;
        }
    };
    let Some(media_id) = media.media.get("mediaId").and_then(Value::as_str) else {
        record_final(state, tenant, media, "failed", "no_media_id").await;
        return;
    };
    let outcome = match fetch_bytes(
        state.whatsapp_graph.as_ref(),
        token,
        media_id,
        MAX_MEDIA_BYTES,
    )
    .await
    {
        Ok(bytes) => store(state, tenant, bytes).await,
        Err(failure) => Err(failure),
    };
    match outcome {
        Ok(stored) => {
            let record = json!({
                "sha256": stored.sha256,
                "ext": stored.ext,
                "mime": stored.mime,
                "size": stored.size,
                "opaque": stored.opaque,
            });
            if let Err(error) = state
                .db
                .whatsapp_media_set_stored(community, media.message_id, &record)
                .await
            {
                // The bytes are stored (content addressed), so a later pass finds them again
                // and records the same result.
                tracing::warn!(%community, message = %media.message_id, "whatsapp media result not recorded: {error}");
                record_retry(state, tenant, media, "record", now).await;
            }
        }
        Err(Failure::Retry(reason)) => {
            if reason == "token" {
                note_token_expired(state, tenant).await;
            }
            record_retry(state, tenant, media, &reason, now).await;
        }
        Err(Failure::Final { state: kind, error }) => {
            record_final(state, tenant, media, kind, error).await;
        }
    }
}

async fn record_retry(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    media: &WhatsappMedia,
    reason: &str,
    now: DateTime<Utc>,
) {
    let community = tenant.community();
    match state
        .db
        .whatsapp_media_note_failure(community, media.message_id, now, reason)
        .await
    {
        Ok((attempts, true)) => {
            tracing::error!(%community, message = %media.message_id, attempts, reason, "whatsapp media download gave up: the owner can press Retry");
        }
        Ok((attempts, false)) => {
            tracing::warn!(%community, message = %media.message_id, attempts, reason, "whatsapp media download failed, will retry");
        }
        // The claim lease keeps the row quiet until it expires, then it is tried again.
        Err(error) => {
            tracing::warn!(%community, message = %media.message_id, "whatsapp media failure not recorded: {error}");
        }
    }
}

async fn record_final(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    media: &WhatsappMedia,
    kind: &str,
    error: &str,
) {
    let community = tenant.community();
    tracing::warn!(%community, message = %media.message_id, kind, error, "whatsapp media will not be downloaded");
    if let Err(db_error) = state
        .db
        .whatsapp_media_set_final_failure(community, media.message_id, kind, error)
        .await
    {
        tracing::warn!(%community, message = %media.message_id, "whatsapp media failure not recorded: {db_error}");
    }
}

/// The access token of the connection, opened for one batch of downloads.
fn open_token(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    connection: &WhatsappConnection,
) -> Result<zeroize::Zeroizing<String>, &'static str> {
    let Some(kek) = state.config.accounts.account_kek() else {
        tracing::warn!("whatsapp media could not open the access token: account key unavailable");
        return Err("token_unavailable");
    };
    match open_secrets(kek, *tenant.community().as_uuid(), connection) {
        Ok((token, _)) => Ok(token),
        Err(error) => {
            tracing::warn!("whatsapp media could not open the access token: {error}");
            Err("token_unavailable")
        }
    }
}

/// First download attempt, made while the webhook is being handled so the picture is there
/// when the owner opens the chat. Bounded by [`INLINE_DEADLINE`]; whatever it leaves undone
/// the sender loop finishes.
pub async fn fetch_inline(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    connection: &WhatsappConnection,
    message_id: Uuid,
) {
    let community = tenant.community();
    let media = match state.db.whatsapp_get_media(community, message_id).await {
        Ok(Some(media)) if media.state.as_deref() == Some("pending") => media,
        Ok(_) => return,
        Err(error) => {
            tracing::warn!(%community, message = %message_id, "whatsapp media lookup failed: {error}");
            return;
        }
    };
    let token = open_token(state, tenant, connection);
    let token = token
        .as_ref()
        .map(|token| token.as_str())
        .map_err(|reason| *reason);
    let attempt = process_one(state, tenant, token, &media, Utc::now());
    if tokio::time::timeout(INLINE_DEADLINE, attempt)
        .await
        .is_err()
    {
        tracing::warn!(%community, message = %message_id, "whatsapp media first attempt timed out; the sender loop retries it");
    }
}

/// One pass of the sender loop: download what is due, then add the link to messages that were
/// posted before their download finished.
pub async fn repair(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    connection: &WhatsappConnection,
    channel_id: Option<Uuid>,
    now: DateTime<Utc>,
) {
    let community = tenant.community();
    match state
        .db
        .whatsapp_media_list_due(community, DUE_PER_TICK, now)
        .await
    {
        Ok(due) if !due.is_empty() => {
            let token = open_token(state, tenant, connection);
            let token = token
                .as_ref()
                .map(|token| token.as_str())
                .map_err(|reason| *reason);
            for media in &due {
                process_one(state, tenant, token, media, now).await;
            }
        }
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(%community, "whatsapp media due lookup failed: {error}");
        }
    }
    let Some(channel_id) = channel_id else {
        return;
    };
    let unlinked = match state
        .db
        .whatsapp_media_list_unlinked(community, LINK_PER_TICK, now)
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%community, "whatsapp media link lookup failed: {error}");
            return;
        }
    };
    for media in unlinked {
        if let Err(error) = channel::post_media_followup(state, tenant, channel_id, &media).await {
            tracing::warn!(%community, message = %media.message_id, "whatsapp media link post failed: {error}");
            if let Err(db_error) = state
                .db
                .whatsapp_media_note_link_failure(community, media.message_id, now)
                .await
            {
                tracing::warn!(%community, "whatsapp media link failure not recorded: {db_error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use async_trait::async_trait;

    use super::super::graph::{MediaInfo, PhoneInfo, RemoteTemplate, SendRequest};
    use super::*;

    /// A Graph API that answers the two media calls from a script and counts them.
    struct Stub {
        info: Result<MediaInfo, GraphError>,
        download: Result<Vec<u8>, DownloadError>,
        info_calls: AtomicUsize,
        download_calls: AtomicUsize,
        seen: Mutex<Vec<(String, String)>>,
    }

    impl Stub {
        fn new(
            info: Result<MediaInfo, GraphError>,
            download: Result<Vec<u8>, DownloadError>,
        ) -> Self {
            Self {
                info,
                download,
                info_calls: AtomicUsize::new(0),
                download_calls: AtomicUsize::new(0),
                seen: Mutex::new(Vec::new()),
            }
        }
    }

    fn info(size: Option<u64>) -> MediaInfo {
        MediaInfo {
            url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1".into(),
            mime_type: Some("image/webp".into()),
            sha256: None,
            file_size: size,
        }
    }

    #[async_trait]
    impl GraphApi for Stub {
        async fn get_phone_info(&self, _: &str, _: &str) -> Result<PhoneInfo, GraphError> {
            unimplemented!("not used by media")
        }
        async fn set_webhook_override(
            &self,
            _: &str,
            _: &str,
            _: &str,
            _: &str,
        ) -> Result<(), GraphError> {
            unimplemented!("not used by media")
        }
        async fn clear_webhook_override(&self, _: &str, _: &str) -> Result<(), GraphError> {
            unimplemented!("not used by media")
        }
        async fn subscribe_app(&self, _: &str, _: &str) -> Result<(), GraphError> {
            unimplemented!("not used by media")
        }
        async fn list_templates(
            &self,
            _: &str,
            _: &str,
        ) -> Result<Vec<RemoteTemplate>, GraphError> {
            unimplemented!("not used by media")
        }
        async fn send(&self, _: &str, _: &str, _: &SendRequest) -> Result<String, GraphError> {
            unimplemented!("not used by media")
        }
        async fn media_info(&self, token: &str, media_id: &str) -> Result<MediaInfo, GraphError> {
            self.info_calls.fetch_add(1, Ordering::SeqCst);
            self.seen
                .lock()
                .expect("seen lock")
                .push((token.to_owned(), media_id.to_owned()));
            self.info.clone()
        }
        async fn download_media(
            &self,
            token: &str,
            _url: &str,
            max_bytes: u64,
        ) -> Result<Vec<u8>, DownloadError> {
            self.download_calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(token, "TOKEN");
            assert_eq!(max_bytes, 1000);
            self.download.clone()
        }
    }

    async fn run(stub: &Stub) -> Result<Vec<u8>, Failure> {
        fetch_bytes(stub, "TOKEN", "555", 1000).await
    }

    #[tokio::test]
    async fn a_good_answer_returns_the_bytes_and_uses_the_media_id_and_token() {
        let stub = Stub::new(Ok(info(Some(10))), Ok(vec![1, 2, 3]));
        assert_eq!(run(&stub).await, Ok(vec![1, 2, 3]));
        assert_eq!(
            *stub.seen.lock().expect("seen lock"),
            vec![("TOKEN".to_owned(), "555".to_owned())]
        );
    }

    #[tokio::test]
    async fn a_404_means_meta_no_longer_has_the_file() {
        for rejected in [
            GraphError::Rejected {
                http_status: 404,
                code: None,
                message: String::new(),
            },
            GraphError::Rejected {
                http_status: 400,
                code: Some(100),
                message: "Object with ID does not exist".into(),
            },
        ] {
            let stub = Stub::new(Err(rejected), Ok(vec![]));
            assert_eq!(
                run(&stub).await,
                Err(Failure::Final {
                    state: "gone",
                    error: "not_found"
                })
            );
            assert_eq!(stub.download_calls.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn a_file_over_the_cap_is_refused_before_any_download() {
        let stub = Stub::new(Ok(info(Some(1001))), Ok(vec![0; 5]));
        assert_eq!(
            run(&stub).await,
            Err(Failure::Final {
                state: "failed",
                error: "too_large"
            })
        );
        assert_eq!(stub.download_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_file_that_grows_past_the_cap_while_downloading_is_too_large() {
        // Meta reported no size, or a small one, and the stream went on.
        let stub = Stub::new(Ok(info(None)), Err(DownloadError::TooLarge));
        assert_eq!(
            run(&stub).await,
            Err(Failure::Final {
                state: "failed",
                error: "too_large"
            })
        );
    }

    #[tokio::test]
    async fn a_timeout_or_a_server_error_leaves_a_retry() {
        let stub = Stub::new(
            Ok(info(Some(10))),
            Err(DownloadError::Graph(GraphError::Unavailable(
                "timeout".into(),
            ))),
        );
        assert_eq!(run(&stub).await, Err(Failure::Retry("timeout".into())));
        let stub = Stub::new(Err(GraphError::Unavailable("http 503".into())), Ok(vec![]));
        assert_eq!(run(&stub).await, Err(Failure::Retry("http 503".into())));
        assert_eq!(stub.download_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_rejected_token_is_retried_and_flagged() {
        for rejected in [
            GraphError::Rejected {
                http_status: 401,
                code: Some(190),
                message: "expired".into(),
            },
            GraphError::Rejected {
                http_status: 400,
                code: Some(190),
                message: "expired".into(),
            },
        ] {
            let stub = Stub::new(Err(rejected), Ok(vec![]));
            assert_eq!(run(&stub).await, Err(Failure::Retry("token".into())));
        }
        let other = GraphError::Rejected {
            http_status: 429,
            code: Some(4),
            message: "slow down".into(),
        };
        assert_eq!(
            classify_graph_error(&other),
            Failure::Retry("rejected_429".into())
        );
    }

    #[test]
    fn a_failure_code_never_carries_a_url_or_a_token() {
        let long = GraphError::Unavailable(format!("https://x/{}", "a".repeat(500)));
        match classify_graph_error(&long) {
            Failure::Retry(code) => assert!(code.chars().count() <= 80),
            other => panic!("expected a retry, got {other:?}"),
        }
    }
}
