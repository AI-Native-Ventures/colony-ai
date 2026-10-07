//! Native-only requests to Electron main. Never route replies through Tauri events.
use super::wire;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tokio::sync::oneshot;

const MAX_PENDING: usize = 16;
const MAX_BYTES: usize = 64 * 1024;
const MAX_ID: u64 = (1 << 53) - 1;
// The parent has a 60-second deadline and retains hung handler slots.
const DEADLINE: Duration = Duration::from_secs(65);
type Reply = Result<Value, &'static str>;
type Sender = Arc<dyn Fn(&Value) -> Result<(), &'static str> + Send + Sync>;

struct State {
    sequence: u64,
    closed: bool,
    pending: HashMap<u64, oneshot::Sender<Reply>>,
}

/// Process-scoped private channel; the transport owns its lifetime.
pub(super) struct Broker {
    state: Mutex<State>,
    send: Sender,
    queue: Option<mpsc::SyncSender<Option<Value>>>,
}

impl Broker {
    pub(super) fn new() -> Result<Arc<Self>, std::io::Error> {
        let (queue, input) = mpsc::sync_channel::<Option<Value>>(MAX_PENDING);
        let output = queue.clone();
        let broker = Self::with_queue(
            Arc::new(move |frame| {
                output
                    .try_send(Some(frame.clone()))
                    .map_err(|_| "private_request_unavailable")
            }),
            Some(queue),
        );
        let weak = Arc::downgrade(&broker);
        std::thread::Builder::new()
            .name("electron-private-output".into())
            .spawn(move || {
                while let Ok(Some(frame)) = input.recv() {
                    let Some(broker) = weak.upgrade() else {
                        break;
                    };
                    let id = frame["id"].as_u64();
                    let active = broker.state.lock().map(|state| {
                        (
                            !state.closed,
                            id.is_some_and(|id| state.pending.contains_key(&id)),
                        )
                    });
                    match active {
                        Ok((true, true)) => {}
                        Ok((true, false)) => continue,
                        _ => break,
                    }
                    if wire::send(&frame).is_err() {
                        broker.close();
                        break;
                    }
                }
            })?;
        Ok(broker)
    }

    #[cfg(test)]
    fn with_sender(send: Sender) -> Arc<Self> {
        Self::with_queue(send, None)
    }

    fn with_queue(send: Sender, queue: Option<mpsc::SyncSender<Option<Value>>>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                sequence: 0,
                closed: false,
                pending: HashMap::new(),
            }),
            send,
            queue,
        })
    }

    async fn call(self: &Arc<Self>, name: &str, payload: Value, deadline: Duration) -> Reply {
        if name.is_empty()
            || name.len() > 64
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
            || !payload.is_object()
            || deadline.is_zero()
            || deadline > DEADLINE
        {
            return Err("private_request_invalid");
        }
        let (id, response) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "private_request_unavailable")?;
            if state.closed || state.sequence == MAX_ID {
                return Err("private_request_unavailable");
            }
            if state.pending.len() >= MAX_PENDING {
                return Err("private_request_busy");
            }
            let id = state.sequence + 1;
            let frame = json!({"type":"private_request", "id":id, "name":name, "payload":payload});
            if !bounded(&frame) {
                return Err("private_request_invalid");
            }
            let (sender, response) = oneshot::channel();
            state.sequence = id;
            state.pending.insert(id, sender);
            // Allocation and bounded enqueue are atomic, so concurrent callers
            // cannot send IDs out of order. The sole writer may block on stdout,
            // but this caller and all admission/timeout paths remain bounded.
            if (self.send)(&frame).is_err() {
                state.pending.remove(&id);
                return Err("private_request_unavailable");
            }
            (id, response)
        };
        let _registration = Registration {
            broker: self.clone(),
            id,
        };
        match tokio::time::timeout(deadline, response).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err("private_request_unavailable"),
            Err(_) => Err("private_request_timeout"),
        }
    }

    pub(super) fn reply(&self, id: u64, result: Option<Value>, error: Option<String>) {
        let value = match (result, error) {
            (Some(value), None) => {
                if bounded(&json!({"type":"private_response", "id":id, "result":&value})) {
                    Ok(value)
                } else {
                    Err("private_result_invalid")
                }
            }
            (None, Some(code)) => Err(match code.as_str() {
                "private_request_timeout" => "private_request_timeout",
                "private_request_unavailable" => "private_request_unavailable",
                "private_result_invalid" => "private_result_invalid",
                _ => "private_request_failed",
            }),
            _ => Err("private_result_invalid"),
        };
        if let Ok(mut state) = self.state.lock() {
            if let Some(sender) = state.pending.remove(&id) {
                let _ = sender.send(value);
            }
        }
    }

    pub(super) fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
            for sender in state.pending.drain().map(|(_, sender)| sender) {
                let _ = sender.send(Err("private_request_unavailable"));
            }
        }
        if let Some(queue) = &self.queue {
            // If full, the writer sees closed before writing its next frame.
            let _ = queue.try_send(None);
        }
    }
}

fn bounded(frame: &Value) -> bool {
    // Include the newline written by the transport.
    serde_json::to_vec(frame).is_ok_and(|bytes| bytes.len() < MAX_BYTES)
}

struct Registration {
    broker: Arc<Broker>,
    id: u64,
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut state) = self.broker.state.lock() {
            state.pending.remove(&self.id);
        }
    }
}

/// Native internal seam. Not a Tauri command and not available to the renderer.
pub(crate) async fn request(app: &tauri::AppHandle, name: &str, payload: Value) -> Reply {
    if !super::enabled() {
        return Err("private_request_unavailable");
    }
    let broker = app
        .try_state::<Arc<Broker>>()
        .ok_or("private_request_unavailable")?
        .inner()
        .clone();
    broker.call(name, payload, DEADLINE).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Arc<Broker>, Arc<Mutex<Vec<Value>>>) {
        let frames = Arc::new(Mutex::new(Vec::new()));
        let output = frames.clone();
        let broker = Broker::with_sender(Arc::new(move |frame| {
            output.lock().expect("test output lock").push(frame.clone());
            Ok(())
        }));
        (broker, frames)
    }

    async fn start(broker: &Arc<Broker>) -> tokio::task::JoinHandle<Reply> {
        let broker = broker.clone();
        let task =
            tokio::spawn(async move { broker.call("plan_prepare", json!({}), DEADLINE).await });
        tokio::task::yield_now().await;
        task
    }

    #[tokio::test]
    async fn replies_correlate_without_exposing_parent_errors() {
        let (broker, frames) = fixture();
        let first = start(&broker).await;
        let second = start(&broker).await;
        assert_eq!(frames.lock().expect("test frames")[1]["id"], 2);
        broker.reply(2, Some(Value::Null), None);
        broker.reply(1, None, Some("secret-parent-error".into()));
        assert_eq!(second.await.expect("second task"), Ok(Value::Null));
        assert_eq!(
            first.await.expect("first task"),
            Err("private_request_failed")
        );
        assert!(broker.state.lock().expect("test state").pending.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn timeout_and_cancellation_remove_registrations_and_ignore_late_replies() {
        let (broker, _) = fixture();
        let first = start(&broker).await;
        tokio::time::advance(DEADLINE).await;
        assert_eq!(
            first.await.expect("timed task"),
            Err("private_request_timeout")
        );
        broker.reply(1, Some(json!({"late":"secret"})), None);
        let second = start(&broker).await;
        broker.reply(1, Some(json!({"duplicate":"secret"})), None);
        tokio::task::yield_now().await;
        assert!(!second.is_finished());
        second.abort();
        assert!(second.await.expect_err("cancelled task").is_cancelled());
        assert!(broker.state.lock().expect("test state").pending.is_empty());
    }

    #[tokio::test]
    async fn capacity_shutdown_and_id_exhaustion_are_terminal_and_bounded() {
        let (broker, frames) = fixture();
        let mut tasks = Vec::new();
        for _ in 0..MAX_PENDING {
            tasks.push(start(&broker).await);
        }
        assert_eq!(
            broker.call("plan_prepare", json!({}), DEADLINE).await,
            Err("private_request_busy")
        );
        assert_eq!(frames.lock().expect("test frames").len(), MAX_PENDING);
        broker.close();
        for task in tasks {
            assert_eq!(
                task.await.expect("closed task"),
                Err("private_request_unavailable")
            );
        }
        assert_eq!(
            broker.call("plan_prepare", json!({}), DEADLINE).await,
            Err("private_request_unavailable")
        );
        let (exhausted, _) = fixture();
        exhausted.state.lock().expect("test state").sequence = MAX_ID;
        assert_eq!(
            exhausted.call("plan_prepare", json!({}), DEADLINE).await,
            Err("private_request_unavailable")
        );
    }

    #[tokio::test]
    async fn invalid_requests_and_responses_do_not_escape_the_boundary() {
        let (broker, frames) = fixture();
        for (name, payload) in [
            ("secret name", json!({})),
            ("plan_prepare", Value::Null),
            ("plan_prepare", json!({"large":"x".repeat(MAX_BYTES)})),
        ] {
            assert_eq!(
                broker.call(name, payload, DEADLINE).await,
                Err("private_request_invalid")
            );
        }
        assert!(frames.lock().expect("test frames").is_empty());
        let task = start(&broker).await;
        broker.reply(1, Some(json!({})), Some("secret".into()));
        assert_eq!(
            task.await.expect("invalid task"),
            Err("private_result_invalid")
        );
        let task = start(&broker).await;
        broker.reply(2, Some(json!({"large":"x".repeat(MAX_BYTES)})), None);
        assert_eq!(
            task.await.expect("oversized task"),
            Err("private_result_invalid")
        );
    }

    #[tokio::test]
    async fn failed_enqueue_removes_pending_registration() {
        let broker = Broker::with_sender(Arc::new(|_| Err("secret-pipe-error")));
        assert_eq!(
            broker.call("plan_prepare", json!({}), DEADLINE).await,
            Err("private_request_unavailable")
        );
        assert!(broker.state.lock().expect("test state").pending.is_empty());
    }
}
