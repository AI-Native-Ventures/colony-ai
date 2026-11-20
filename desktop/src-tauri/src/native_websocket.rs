use std::{collections::HashMap, sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    plugin::TauriPlugin,
    Manager, Runtime,
};

#[cfg(test)]
use crate::relay_operation_pacer::{
    MAX_RELAY_OPERATIONS_PER_FIVE_SECONDS, RELAY_OPERATION_BURST_CAPACITY, RELAY_OPERATION_INTERVAL,
};
use crate::{
    native_websocket_batch::{is_auth_challenge, FrameBatch, BATCH_MAX_SERIALIZED_BYTES},
    relay_operation_pacer::RelayOperationPacer,
};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::protocol::{frame::coding::CloseCode, CloseFrame, Message},
};
use tokio_util::sync::CancellationToken;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(250);
const SEND_QUEUE_CAPACITY: usize = 64;

pub(crate) fn install_crypto_provider() {
    // Dependencies enable both rustls providers; choose one before TLS setup.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

type Id = u32;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data")]
pub(crate) enum WebSocketMessage {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close(Option<CloseFramePayload>),
}

#[derive(Debug, Deserialize)]
pub(crate) struct CloseFramePayload {
    code: u16,
    reason: String,
}

impl From<WebSocketMessage> for Message {
    fn from(message: WebSocketMessage) -> Self {
        match message {
            WebSocketMessage::Text(value) => Message::Text(value.into()),
            WebSocketMessage::Binary(value) => Message::Binary(value.into()),
            WebSocketMessage::Ping(value) => Message::Ping(value.into()),
            WebSocketMessage::Pong(value) => Message::Pong(value.into()),
            WebSocketMessage::Close(frame) => Message::Close(frame.map(|frame| CloseFrame {
                code: CloseCode::from(frame.code),
                reason: frame.reason.into(),
            })),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", content = "data")]
enum OutboundMessage {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close(Option<CloseFramePayloadOut>),
    Error(String),
}

#[derive(Serialize)]
struct CloseFramePayloadOut {
    code: u16,
    reason: String,
}

struct SendRequest {
    message: Message,
    result: oneshot::Sender<Result<(), String>>,
}

struct ConnectionHandle {
    sender: mpsc::Sender<SendRequest>,
    cancel: CancellationToken,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    operation_scope: String,
}

#[derive(Clone)]
pub(crate) struct WebSocketManager {
    connections: Arc<Mutex<HashMap<Id, Arc<ConnectionHandle>>>>,
    connect_cancel: Arc<Mutex<CancellationToken>>,
    operation_pacer: Arc<RelayOperationPacer>,
}

impl Default for WebSocketManager {
    fn default() -> Self {
        Self::new(Arc::new(RelayOperationPacer::default()))
    }
}

impl WebSocketManager {
    fn new(operation_pacer: Arc<RelayOperationPacer>) -> Self {
        Self {
            connections: Arc::default(),
            connect_cancel: Arc::new(Mutex::new(CancellationToken::new())),
            operation_pacer,
        }
    }
    async fn remove(&self, id: Id) -> Option<Arc<ConnectionHandle>> {
        self.connections.lock().await.remove(&id)
    }

    async fn disconnect_handle(handle: Arc<ConnectionHandle>) {
        handle.cancel.cancel();
        if let Some(mut task) = handle.task.lock().await.take() {
            if tokio::time::timeout(SHUTDOWN_TIMEOUT, &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
    }

    async fn disconnect(&self, id: Id) {
        if let Some(handle) = self.remove(id).await {
            Self::disconnect_handle(handle).await;
        }
    }

    async fn disconnect_all(&self) {
        let mut connect_cancel = self.connect_cancel.lock().await;
        connect_cancel.cancel();
        *connect_cancel = CancellationToken::new();
        let handles = {
            let mut connections = self.connections.lock().await;
            connections
                .drain()
                .map(|(_, handle)| handle)
                .collect::<Vec<_>>()
        };
        futures_util::future::join_all(
            handles.into_iter().map(WebSocketManager::disconnect_handle),
        )
        .await;
        // Keep the admission history across a renderer reload or reconnect. A
        // reset here would mint a fresh burst inside the relay's same fixed
        // window, defeating the cross-window quota that this native boundary
        // exists to protect.
    }
}

async fn open_connection(
    manager: &WebSocketManager,
    url: &str,
    on_message: Channel<InvokeResponseBody>,
) -> Result<Id, String> {
    let connect_cancel = manager.connect_cancel.lock().await.clone();
    let (socket, _) = tokio::select! {
        _ = connect_cancel.cancelled() => return Err("WebSocket connection cancelled".to_string()),
        result = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(url)) => result
            .map_err(|_| "WebSocket connection timed out".to_string())?
            .map_err(|error| error.to_string())?,
    };

    // Serialize registration with disconnect_all so a reload cannot miss a
    // connection that finished its handshake concurrently with teardown.
    let current_connect_cancel = manager.connect_cancel.lock().await;
    if connect_cancel.is_cancelled() {
        return Err("WebSocket connection cancelled".to_string());
    }

    let id = loop {
        let candidate = uuid::Uuid::new_v4().as_u128() as u32;
        if !manager.connections.lock().await.contains_key(&candidate) {
            break candidate;
        }
    };
    let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
    let cancel = CancellationToken::new();
    let handle = Arc::new(ConnectionHandle {
        sender,
        cancel: cancel.clone(),
        task: Mutex::new(None),
        operation_scope: url.to_string(),
    });
    let mut task_slot = handle.task.lock().await;
    manager.connections.lock().await.insert(id, handle.clone());

    let task_manager = manager.clone();
    let task = tauri::async_runtime::spawn(run_connection(
        id,
        socket,
        receiver,
        cancel,
        on_message,
        task_manager,
    ));
    *task_slot = Some(task);
    drop(task_slot);
    drop(current_connect_cancel);
    Ok(id)
}

#[tauri::command]
async fn connect(
    manager: tauri::State<'_, WebSocketManager>,
    url: String,
    on_message: Channel<InvokeResponseBody>,
    _config: Option<serde_json::Value>,
) -> Result<Id, String> {
    open_connection(manager.inner(), &url, on_message).await
}

pub(crate) async fn send_message(
    manager: &WebSocketManager,
    id: Id,
    message: WebSocketMessage,
) -> Result<(), String> {
    // Egress guard: the NIP-49 local key backup must never reach a relay.
    // This is the single choke point for all webview-originated websocket
    // frames (see `crate::egress_guard`).
    match &message {
        WebSocketMessage::Text(text) => {
            crate::egress_guard::assert_no_key_backup(text, "websocket text frame")?
        }
        WebSocketMessage::Binary(bytes) => {
            crate::egress_guard::assert_no_key_backup_bytes(bytes, "websocket binary frame")?
        }
        _ => {}
    }
    let handle = manager
        .connections
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("WebSocket connection {id} not found"))?;
    if is_relay_admission_message(&message) {
        manager
            .operation_pacer
            .acquire(&handle.operation_scope, &handle.cancel)
            .await?;
    }
    let (result_tx, result_rx) = oneshot::channel();
    tokio::time::timeout(
        WRITE_TIMEOUT,
        handle.sender.send(SendRequest {
            message: message.into(),
            result: result_tx,
        }),
    )
    .await
    .map_err(|_| "WebSocket send queue timed out".to_string())?
    .map_err(|_| "WebSocket connection closed".to_string())?;

    tokio::time::timeout(WRITE_TIMEOUT, result_rx)
        .await
        .map_err(|_| "WebSocket send timed out".to_string())?
        .map_err(|_| "WebSocket connection closed".to_string())?
}

#[tauri::command]
async fn send(
    manager: tauri::State<'_, WebSocketManager>,
    id: Id,
    message: WebSocketMessage,
) -> Result<(), String> {
    send_message(manager.inner(), id, message).await
}

#[tauri::command]
async fn disconnect(manager: tauri::State<'_, WebSocketManager>, id: Id) -> Result<(), String> {
    manager.disconnect(id).await;
    Ok(())
}

#[tauri::command]
async fn disconnect_all(manager: tauri::State<'_, WebSocketManager>) -> Result<(), String> {
    manager.disconnect_all().await;
    Ok(())
}

fn is_relay_admission_message(message: &WebSocketMessage) -> bool {
    let WebSocketMessage::Text(text) = message else {
        return false;
    };
    let Ok(frame) = serde_json::from_str::<serde_json::Value>(text) else {
        return false;
    };
    matches!(
        frame
            .as_array()
            .and_then(|items| items.first())
            .and_then(serde_json::Value::as_str),
        Some("REQ" | "COUNT" | "EVENT")
    )
}

async fn run_connection<S>(
    id: Id,
    mut socket: tokio_tungstenite::WebSocketStream<S>,
    mut receiver: mpsc::Receiver<SendRequest>,
    cancel: CancellationToken,
    on_message: Channel<InvokeResponseBody>,
    manager: WebSocketManager,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut batch = FrameBatch::default();
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = tokio::time::timeout(
                    SHUTDOWN_TIMEOUT,
                    socket.send(Message::Close(Some(CloseFrame {
                        code: CloseCode::Normal,
                        reason: "disconnect".into(),
                    }))),
                ).await;
                break;
            }
            _ = batch.due() => batch.flush(&on_message),
            request = receiver.recv() => {
                let Some(request) = request else { break };
                let result = tokio::time::timeout(WRITE_TIMEOUT, socket.send(request.message))
                    .await
                    .map_err(|_| "WebSocket send timed out".to_string())
                    .and_then(|result| result.map_err(|error| error.to_string()));
                let failed = result.is_err();
                let _ = request.result.send(result);
                if failed { break; }
            }
            incoming = socket.next() => {
                let message = match incoming {
                    Some(Ok(message)) => outbound_message(message),
                    Some(Err(error)) => OutboundMessage::Error(error.to_string()),
                    None => OutboundMessage::Close(None),
                };
                let terminal = matches!(message, OutboundMessage::Close(_) | OutboundMessage::Error(_));
                // Classify the relay payload before it is wrapped, while its
                // structure is still readable.
                let urgent = match &message {
                    OutboundMessage::Text(payload) => is_auth_challenge(payload),
                    _ => false,
                };
                let Ok(frame) = serde_json::to_string(&message) else { continue };

                // Flush before appending when the frame would carry the batch
                // over the direct-eval ceiling, so the oversized frame starts a
                // batch of its own rather than pushing its predecessors onto the
                // fetch path. A frame that exceeds the bound alone is delivered
                // alone, exactly as it is today.
                if batch.projected_len(&frame) > BATCH_MAX_SERIALIZED_BYTES {
                    batch.flush(&on_message);
                }
                batch.push(frame);
                // Ordering is FIFO in all cases: buffered frames are flushed
                // together with the frame that forced the flush, never after it.
                if terminal || urgent {
                    batch.flush(&on_message);
                }
                if terminal { break; }
            }
        }
    }
    // A terminal frame already flushed; this covers cancellation and send
    // failure, which must not strand frames the relay already delivered.
    batch.flush(&on_message);
    manager.remove(id).await;
}

fn outbound_message(message: Message) -> OutboundMessage {
    match message {
        Message::Text(value) => OutboundMessage::Text(value.to_string()),
        Message::Binary(value) => OutboundMessage::Binary(value.to_vec()),
        Message::Ping(value) => OutboundMessage::Ping(value.to_vec()),
        Message::Pong(value) => OutboundMessage::Pong(value.to_vec()),
        Message::Close(frame) => OutboundMessage::Close(frame.map(|frame| CloseFramePayloadOut {
            code: frame.code.into(),
            reason: frame.reason.to_string(),
        })),
        Message::Frame(_) => OutboundMessage::Error("unexpected raw WebSocket frame".to_string()),
    }
}

/// Installs the webview WebSocket bridge with the app-wide operation pacer.
pub(crate) fn init<R: Runtime>(operation_pacer: Arc<RelayOperationPacer>) -> TauriPlugin<R> {
    install_crypto_provider();
    tauri::plugin::Builder::new("websocket")
        .invoke_handler(tauri::generate_handler![
            connect,
            send,
            disconnect,
            disconnect_all
        ])
        .setup(move |app, _api| {
            app.manage(WebSocketManager::new(operation_pacer));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_websocket_batch::BATCH_WINDOW;
    use futures_util::FutureExt;
    use std::sync::atomic::{AtomicBool, Ordering};

    use tokio::io::duplex;
    use tokio::time::Instant;
    use tokio_tungstenite::{tungstenite::protocol::Role, WebSocketStream};

    fn silent_channel() -> Channel<InvokeResponseBody> {
        Channel::new(|_: InvokeResponseBody| Ok(()))
    }

    /// Records each delivery as its raw JSON payload, so tests assert on what
    /// the renderer actually receives rather than on internal batch state.
    fn recording_channel() -> (
        Channel<InvokeResponseBody>,
        Arc<std::sync::Mutex<Vec<String>>>,
    ) {
        // A std mutex: `Channel::send` is synchronous and runs on whatever
        // thread flushed, including inside the async runtime.
        let deliveries = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = deliveries.clone();
        let channel = Channel::new(move |body: InvokeResponseBody| {
            let payload = match body {
                InvokeResponseBody::Json(json) => json,
                InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            };
            sink.lock().unwrap().push(payload);
            Ok(())
        });
        (channel, deliveries)
    }

    /// Drives the real `run_connection` loop over a live in-memory socket, so
    /// flush policy is exercised as the loop applies it. Asserting against
    /// `FrameBatch` alone cannot see the loop's decisions and lets a broken
    /// policy pass.
    struct LoopHarness {
        server: WebSocketStream<tokio::io::DuplexStream>,
        deliveries: Arc<std::sync::Mutex<Vec<String>>>,
        cancel: CancellationToken,
        _sender: mpsc::Sender<SendRequest>,
    }

    impl LoopHarness {
        async fn start() -> Self {
            let manager = WebSocketManager::default();
            let (client_io, server_io) = duplex(256 * 1024);
            let (client, server) = tokio::join!(
                WebSocketStream::from_raw_socket(client_io, Role::Client, None),
                WebSocketStream::from_raw_socket(server_io, Role::Server, None),
            );
            let (channel, deliveries) = recording_channel();
            // The sender is held by the harness: dropping it would end the
            // loop before the test could drive it.
            let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
            let cancel = CancellationToken::new();
            // `tokio::spawn`, not `tauri::async_runtime::spawn`: the latter
            // runs the task on Tauri's own runtime, where this test's paused
            // clock does not apply and `advance` would silently do nothing.
            tokio::spawn(run_connection(
                1,
                client,
                receiver,
                cancel.clone(),
                channel,
                manager,
            ));
            Self {
                server,
                deliveries,
                cancel,
                _sender: sender,
            }
        }

        async fn relay_says(&mut self, payload: &str) {
            self.server
                .send(Message::Text(payload.into()))
                .await
                .unwrap();
        }

        /// Lets the connection task run without letting the batch timer
        /// elapse, so what arrives here arrived because policy forced it out.
        async fn settle(&self) {
            for _ in 0..64 {
                tokio::task::yield_now().await;
            }
        }

        fn deliveries(&self) -> Vec<String> {
            self.deliveries.lock().unwrap().clone()
        }
    }

    #[tokio::test(start_paused = true)]
    async fn auth_challenge_does_not_wait_for_the_batch_timer() {
        let mut harness = LoopHarness::start().await;

        // Control: an ordinary frame stays buffered, proving the window is
        // genuinely holding frames back rather than the clock running out.
        harness.relay_says(r#"["EOSE","sub"]"#).await;
        harness.settle().await;
        assert!(
            harness.deliveries().is_empty(),
            "EOSE must ride the batch window"
        );

        harness.relay_says(r#"["AUTH","challenge"]"#).await;
        harness.settle().await;

        let deliveries = harness.deliveries();
        assert_eq!(deliveries.len(), 1, "AUTH must not wait for the timer");
        let frames: Vec<serde_json::Value> = serde_json::from_str(&deliveries[0]).unwrap();
        assert_eq!(frames.len(), 2, "the buffered EOSE rides out with AUTH");
        assert_eq!(frames[0]["data"], r#"["EOSE","sub"]"#, "FIFO preserved");
    }

    #[tokio::test(start_paused = true)]
    async fn batch_window_eventually_delivers_unforced_frames() {
        let mut harness = LoopHarness::start().await;
        harness.relay_says(r#"["EOSE","sub"]"#).await;
        harness.settle().await;
        assert!(harness.deliveries().is_empty());

        // Same frame, once the window elapses: the control above is waiting on
        // the timer, not stuck.
        tokio::time::advance(BATCH_WINDOW * 2).await;
        harness.settle().await;
        assert_eq!(harness.deliveries().len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn cancellation_delivers_frames_the_relay_already_sent() {
        let mut harness = LoopHarness::start().await;
        harness.relay_says(r#"["EVENT","sub",{}]"#).await;
        harness.settle().await;
        assert!(harness.deliveries().is_empty(), "frame is buffered");

        // Teardown must not strand a frame that never reached the renderer.
        harness.cancel.cancel();
        harness.settle().await;

        let seen = harness.deliveries().join("");
        assert!(
            seen.contains("EVENT"),
            "buffered frame lost on cancel: {seen}"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn oversize_frame_does_not_drag_buffered_frames_over_the_threshold() {
        let mut harness = LoopHarness::start().await;
        harness.relay_says(r#"["EOSE","sub"]"#).await;
        harness.settle().await;

        let big = format!(
            r#"["EVENT","sub","{}"]"#,
            "x".repeat(BATCH_MAX_SERIALIZED_BYTES)
        );
        harness.relay_says(&big).await;
        harness.settle().await;
        // The small frame is forced out by the straddle; the oversize frame
        // itself still rides the window.
        assert_eq!(
            harness.deliveries().len(),
            1,
            "straddle flushes immediately"
        );
        tokio::time::advance(BATCH_WINDOW * 2).await;
        harness.settle().await;

        // The small frame must ship on its own rather than riding a delivery
        // that crosses tauri's direct-eval threshold.
        let deliveries = harness.deliveries();
        assert_eq!(
            deliveries.len(),
            2,
            "straddling frames must not share a batch"
        );
        assert!(
            deliveries[0].len() < 8192,
            "first delivery {} crossed the direct-eval threshold",
            deliveries[0].len()
        );
        let first: Vec<serde_json::Value> = serde_json::from_str(&deliveries[0]).unwrap();
        assert_eq!(first[0]["data"], r#"["EOSE","sub"]"#);
    }

    #[tokio::test]
    async fn eof_delivers_buffered_frames_before_the_close() {
        let manager = WebSocketManager::default();
        let (client_io, server_io) = duplex(4096);
        let (client, mut server) = tokio::join!(
            WebSocketStream::from_raw_socket(client_io, Role::Client, None),
            WebSocketStream::from_raw_socket(server_io, Role::Server, None),
        );
        let (channel, deliveries) = recording_channel();
        let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
        let handle = Arc::new(ConnectionHandle {
            sender,
            cancel: CancellationToken::new(),
            task: Mutex::new(None),
            operation_scope: "test".to_string(),
        });
        manager.connections.lock().await.insert(1, handle.clone());
        let task = tauri::async_runtime::spawn(run_connection(
            1,
            client,
            receiver,
            handle.cancel.clone(),
            channel,
            manager.clone(),
        ));
        *handle.task.lock().await = Some(task);

        server.send(Message::Text("buffered".into())).await.unwrap();
        drop(server);

        tokio::time::timeout(Duration::from_secs(2), async {
            while manager.connections.lock().await.contains_key(&1) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("EOF should clean up its native connection ID");

        // A frame the relay already delivered must reach the renderer even
        // though the socket closed inside the batch window.
        let seen = deliveries.lock().unwrap().join("");
        assert!(
            seen.contains("buffered"),
            "buffered frame was dropped: {seen}"
        );
    }

    #[tokio::test]
    async fn secure_websocket_reaches_tls_without_panicking() {
        install_crypto_provider();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
        });
        let result = std::panic::AssertUnwindSafe(tokio_tungstenite::connect_async(format!(
            "wss://{address}"
        )))
        .catch_unwind()
        .await;

        assert!(result.is_ok(), "TLS setup must not panic");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn live_tcp_server_connect_send_and_disconnect() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (received_tx, received_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let message = socket.next().await.unwrap().unwrap();
            received_tx.send(message).unwrap();
            while let Some(message) = socket.next().await {
                if matches!(message, Ok(Message::Close(_))) {
                    break;
                }
            }
        });

        let manager = WebSocketManager::default();
        let id = open_connection(&manager, &format!("ws://{address}"), silent_channel())
            .await
            .unwrap();
        send_message(&manager, id, WebSocketMessage::Text("live-probe".into()))
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), received_rx)
                .await
                .unwrap()
                .unwrap(),
            Message::Text("live-probe".into())
        );

        manager.disconnect(id).await;
        assert!(!manager.connections.lock().await.contains_key(&id));
        tokio::time::timeout(Duration::from_secs(1), server)
            .await
            .expect("live server should observe native socket shutdown")
            .unwrap();
    }

    #[tokio::test]
    async fn eof_removes_connection() {
        let manager = WebSocketManager::default();
        let (client_io, server_io) = duplex(1024);
        let (client, server) = tokio::join!(
            WebSocketStream::from_raw_socket(client_io, Role::Client, None),
            WebSocketStream::from_raw_socket(server_io, Role::Server, None),
        );
        let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
        let handle = Arc::new(ConnectionHandle {
            sender,
            cancel: CancellationToken::new(),
            task: Mutex::new(None),
            operation_scope: "test".to_string(),
        });
        manager.connections.lock().await.insert(1, handle.clone());
        let task = tauri::async_runtime::spawn(run_connection(
            1,
            client,
            receiver,
            handle.cancel.clone(),
            silent_channel(),
            manager.clone(),
        ));
        *handle.task.lock().await = Some(task);

        drop(server);
        tokio::time::timeout(Duration::from_secs(1), async {
            while manager.connections.lock().await.contains_key(&1) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("EOF should clean up its native connection ID");
    }

    #[tokio::test]
    async fn disconnect_removes_and_drops_task_before_returning() {
        struct DropGuard(Arc<AtomicBool>);
        impl Drop for DropGuard {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        let manager = WebSocketManager::default();
        let dropped = Arc::new(AtomicBool::new(false));
        let task_dropped = dropped.clone();
        let (ready_tx, ready_rx) = oneshot::channel();
        let (sender, _receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
        let handle = Arc::new(ConnectionHandle {
            sender,
            cancel: CancellationToken::new(),
            task: Mutex::new(Some(tauri::async_runtime::spawn(async move {
                let _guard = DropGuard(task_dropped);
                ready_tx.send(()).unwrap();
                std::future::pending::<()>().await;
            }))),
            operation_scope: "test".to_string(),
        });
        manager.connections.lock().await.insert(7, handle);
        ready_rx.await.unwrap();

        tokio::time::timeout(Duration::from_secs(1), manager.disconnect(7))
            .await
            .expect("disconnect should abort an unresponsive task");
        assert!(!manager.connections.lock().await.contains_key(&7));
        assert!(dropped.load(Ordering::SeqCst));

        // Repeated teardown is intentionally a no-op.
        manager.disconnect(7).await;
    }

    #[tokio::test]
    async fn teardown_gate_stays_closed_until_tasks_stop() {
        let manager = WebSocketManager::default();
        let gate = manager.connect_cancel.lock().await;
        let (sender, _receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
        let handle = Arc::new(ConnectionHandle {
            sender,
            cancel: CancellationToken::new(),
            task: Mutex::new(Some(tauri::async_runtime::spawn(async {
                std::future::pending::<()>().await;
            }))),
            operation_scope: "test".to_string(),
        });
        manager.connections.lock().await.insert(1, handle);
        gate.cancel();
        let handles = {
            let mut connections = manager.connections.lock().await;
            connections
                .drain()
                .map(|(_, handle)| handle)
                .collect::<Vec<_>>()
        };

        let shutdown = futures_util::future::join_all(
            handles.into_iter().map(WebSocketManager::disconnect_handle),
        );
        assert!(manager.connect_cancel.try_lock().is_err());
        shutdown.await;
        drop(gate);
        assert!(manager.connect_cancel.try_lock().is_ok());
    }

    #[tokio::test]
    async fn one_connection_does_not_block_another_send_queue() {
        let manager = WebSocketManager::default();
        let (blocked_sender, blocked_receiver) = mpsc::channel(1);
        blocked_sender
            .send(SendRequest {
                message: Message::Text("blocked".into()),
                result: oneshot::channel().0,
            })
            .await
            .unwrap();
        let blocked = Arc::new(ConnectionHandle {
            sender: blocked_sender,
            cancel: CancellationToken::new(),
            task: Mutex::new(None),
            operation_scope: "test".to_string(),
        });
        manager.connections.lock().await.insert(1, blocked);

        let (healthy_sender, mut healthy_receiver) = mpsc::channel(1);
        let healthy = Arc::new(ConnectionHandle {
            sender: healthy_sender.clone(),
            cancel: CancellationToken::new(),
            task: Mutex::new(None),
            operation_scope: "test".to_string(),
        });
        manager.connections.lock().await.insert(2, healthy);

        let (result, _) = oneshot::channel();
        tokio::time::timeout(
            Duration::from_millis(50),
            healthy_sender.send(SendRequest {
                message: Message::Text("healthy".into()),
                result,
            }),
        )
        .await
        .expect("a full queue on one connection must not block another")
        .unwrap();
        assert!(healthy_receiver.recv().await.is_some());
        drop(blocked_receiver);
    }

    #[tokio::test(start_paused = true)]
    async fn admission_budget_is_shared_across_five_native_connections() {
        let manager = WebSocketManager::default();
        let sent_at = Arc::new(std::sync::Mutex::new(Vec::new()));

        for id in 1..=5 {
            let (sender, mut receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
            let handle = Arc::new(ConnectionHandle {
                sender,
                cancel: CancellationToken::new(),
                task: Mutex::new(None),
                operation_scope: "wss://relay.example.test".to_string(),
            });
            manager.connections.lock().await.insert(id, handle);
            let sent_at = Arc::clone(&sent_at);
            tokio::spawn(async move {
                while let Some(request) = receiver.recv().await {
                    sent_at.lock().unwrap().push(Instant::now());
                    let _ = request.result.send(Ok(()));
                }
            });
        }

        let start = Instant::now();
        let sends = (0..96)
            .map(|index| {
                let manager = manager.clone();
                tokio::spawn(async move {
                    let connection_id = ((index % 5) + 1) as Id;
                    send_message(
                        &manager,
                        connection_id,
                        WebSocketMessage::Text(format!(
                            r#"["REQ","owner-shaped-{index}",{{"kinds":[1],"limit":1}}]"#
                        )),
                    )
                    .await
                })
            })
            .collect::<Vec<_>>();

        // Advance in operation-sized increments so every queued sender gets a
        // chance to observe a newly minted shared token.
        for _ in 0..100 {
            tokio::task::yield_now().await;
            tokio::time::advance(RELAY_OPERATION_INTERVAL).await;
        }

        for send in sends {
            send.await.unwrap().unwrap();
        }
        let within_first_window = sent_at
            .lock()
            .unwrap()
            .iter()
            .filter(|sent| sent.duration_since(start) < Duration::from_secs(5))
            .count();
        assert!(
            within_first_window <= MAX_RELAY_OPERATIONS_PER_FIVE_SECONDS,
            "five windows sent {within_first_window} REQ frames in one five-second relay window"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn disconnect_all_does_not_refill_the_shared_admission_bucket() {
        let manager = WebSocketManager::default();
        let scope = "wss://relay.example.test".to_string();
        let (first_sender, mut first_receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
        let first = Arc::new(ConnectionHandle {
            sender: first_sender,
            cancel: CancellationToken::new(),
            task: Mutex::new(None),
            operation_scope: scope.clone(),
        });
        manager.connections.lock().await.insert(1, first);
        tokio::spawn(async move {
            while let Some(request) = first_receiver.recv().await {
                let _ = request.result.send(Ok(()));
            }
        });

        for index in 0..RELAY_OPERATION_BURST_CAPACITY {
            send_message(
                &manager,
                1,
                WebSocketMessage::Text(format!(
                    r#"["REQ","before-reconnect-{index}",{{"kinds":[1],"limit":1}}]"#
                )),
            )
            .await
            .unwrap();
        }

        manager.disconnect_all().await;

        let (second_sender, mut second_receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
        let second = Arc::new(ConnectionHandle {
            sender: second_sender,
            cancel: CancellationToken::new(),
            task: Mutex::new(None),
            operation_scope: scope,
        });
        manager.connections.lock().await.insert(2, second);
        tokio::spawn(async move {
            while let Some(request) = second_receiver.recv().await {
                let _ = request.result.send(Ok(()));
            }
        });

        let after_reconnect = tokio::spawn({
            let manager = manager.clone();
            async move {
                send_message(
                    &manager,
                    2,
                    WebSocketMessage::Text(
                        r#"["REQ","after-reconnect",{"kinds":[1],"limit":1}]"#.into(),
                    ),
                )
                .await
            }
        });
        tokio::task::yield_now().await;
        assert!(
            !after_reconnect.is_finished(),
            "a reconnect must not manufacture a fresh burst token"
        );

        tokio::time::advance(RELAY_OPERATION_INTERVAL).await;
        assert!(after_reconnect.await.unwrap().is_ok());
    }
}
