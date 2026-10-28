//! Keeps a slow managed-inference request's connection from going idle.
//!
//! A free model can take a minute or more to answer. Fly's proxy closes a
//! connection that has carried no bytes for 60 seconds, so the managed client
//! saw a dropped connection and reported "Usage is being recovered
//! automatically" (its only word for a transport failure) while the request
//! carried on to settlement unseen. A first hello that took 74 seconds from the
//! business being picked ended exactly that way.
//!
//! The answer is not sent differently when it is quick: a request that finishes
//! within `after` gets its own status and body as before. A request still
//! running at `after` gets `200` and headers at once, then one space every
//! `every`, then its JSON. A space is JSON whitespace, so the shipped client's
//! `serde_json::from_slice` reads the body unchanged; it only ever looks at the
//! body of a `200` for `choices`.
//!
//! The price of committing to `200` is that a failure after that point cannot
//! change the status. Its error JSON is sent as the body, the managed client
//! finds no `choices` and reports its recovering message, and the request's
//! `Colony gateway request finished` line still names the real status.

use std::{convert::Infallible, time::Duration};

use axum::{
    body::{Body, Bytes},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::stream;
use serde_json::Value;
use tokio::task::{JoinError, JoinHandle};

use super::{recovering, ApiResult};

/// When a request that is still running gets its headers, and how often it gets
/// a byte after that. Both are well inside the 60 seconds a proxy may wait.
#[derive(Clone, Copy, Debug)]
pub(super) struct Keepalive {
    pub after: Duration,
    pub every: Duration,
}

impl Keepalive {
    pub(super) const PRODUCTION: Self = Self {
        after: Duration::from_secs(15),
        every: Duration::from_secs(15),
    };
}

/// A request task that ended without answering, for example by panicking, is a
/// request whose outcome is not known, exactly as any other unclear ending.
fn finish(done: Result<ApiResult, JoinError>) -> ApiResult {
    done.unwrap_or_else(|_| {
        tracing::error!("Colony gateway request task ended without an answer");
        Err(recovering())
    })
}

/// The response for a request task that was started and is still running.
pub(super) async fn respond(mut job: JoinHandle<ApiResult>, keepalive: Keepalive) -> Response {
    match tokio::time::timeout(keepalive.after, &mut job).await {
        Ok(done) => finish(done).into_response(),
        Err(_) => streamed(job, keepalive.every),
    }
}

fn streamed(job: JoinHandle<ApiResult>, every: Duration) -> Response {
    // A client that goes away drops this stream, not the task: the provider
    // call and its settlement run on to the end (see `inference`).
    let body = stream::unfold(Some(job), move |state| async move {
        let mut job = state?;
        match tokio::time::timeout(every, &mut job).await {
            Err(_) => Some((Ok::<Bytes, Infallible>(Bytes::from_static(b" ")), Some(job))),
            Ok(done) => {
                let value: Value = match finish(done) {
                    Ok(Json(value)) => value,
                    Err((_, Json(_))) => Value::Null,
                };
                let bytes = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
                Some((Ok(Bytes::from(bytes)), None))
            }
        }
    });
    let mut response = Response::new(Body::from_stream(body));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::time::Instant;

    const FAST: Keepalive = Keepalive {
        after: Duration::from_millis(100),
        every: Duration::from_millis(100),
    };

    fn answer() -> Value {
        json!({"id":"colony-x","choices":[{"index":0,"message":{"role":"assistant","content":"Hi"},"finish_reason":"stop"}],"chargedNanousd":"0"})
    }

    fn after(delay: Duration, result: ApiResult) -> JoinHandle<ApiResult> {
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            result
        })
    }

    async fn collect(response: Response) -> (StatusCode, Vec<u8>) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        (status, bytes.to_vec())
    }

    #[tokio::test]
    async fn a_request_that_finishes_in_time_keeps_its_own_status_and_body() {
        let ok = after(Duration::from_millis(5), Ok(Json(answer())));
        let (status, body) = collect(respond(ok, FAST).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), answer());
        assert_eq!(body.first(), Some(&b'{'), "no padding when it was quick");
        let refused = after(
            Duration::from_millis(5),
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":"unavailable"})),
            )),
        );
        let (status, body) = collect(respond(refused, FAST).await).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.first(), Some(&b'{'));
    }

    #[tokio::test]
    async fn a_slow_request_gets_its_headers_and_spaces_long_before_its_answer() {
        let started = Instant::now();
        let job = after(Duration::from_millis(1200), Ok(Json(answer())));
        let response = respond(job, FAST).await;
        // The headers came back at about `after`, not at the answer.
        assert!(
            started.elapsed() < Duration::from_millis(900),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        let mut frames = response.into_body().into_data_stream();
        let mut arrivals = Vec::new();
        let mut body = Vec::new();
        while let Some(frame) = frames.next().await {
            let frame = frame.unwrap();
            arrivals.push((started.elapsed(), frame.to_vec()));
            body.extend_from_slice(&frame);
        }
        let spaces: Vec<_> = arrivals
            .iter()
            .filter(|(_, frame)| frame.as_slice() == b" ")
            .collect();
        assert!(spaces.len() >= 3, "{arrivals:?}");
        // A space is on the wire well before the answer is.
        assert!(
            spaces[0].0 < Duration::from_millis(400),
            "{:?}",
            spaces[0].0
        );
        assert!(body.starts_with(b" "));
        // The shipped client parses the whole body with `serde_json::from_slice`.
        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), answer());
    }

    #[tokio::test]
    async fn a_failure_after_the_headers_went_out_arrives_as_json_without_choices() {
        let job = after(
            Duration::from_millis(400),
            Err((StatusCode::CONFLICT, Json(json!({"error":"recovering"})))),
        );
        let (status, body) = collect(respond(job, FAST).await).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "the status was committed at `after`"
        );
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["error"], "recovering");
        assert!(value.get("choices").is_none());
    }

    #[tokio::test]
    async fn a_client_that_leaves_mid_stream_does_not_stop_the_request() {
        let finished = Arc::new(AtomicBool::new(false));
        let flag = finished.clone();
        let job = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            flag.store(true, Ordering::SeqCst);
            Ok(Json(answer()))
        });
        let response = respond(job, FAST).await;
        drop(response);
        assert!(!finished.load(Ordering::SeqCst));
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(finished.load(Ordering::SeqCst), "the task ran to its end");
    }

    #[tokio::test]
    async fn a_task_that_panics_ends_the_request_as_recovering_in_both_modes() {
        let quick = tokio::spawn(async { panic!("boom") });
        let (status, _) = collect(respond(quick, FAST).await).await;
        assert_eq!(status, StatusCode::CONFLICT);
        let slow = tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            panic!("boom")
        });
        let (status, body) = collect(respond(slow, FAST).await).await;
        assert_eq!(status, StatusCode::OK);
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert!(value["error"].is_string());
        assert!(value.get("choices").is_none());
    }
}
