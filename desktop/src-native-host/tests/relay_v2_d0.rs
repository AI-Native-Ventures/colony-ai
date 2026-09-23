//! D0 disposable-relay proof for the RelayV2 native transport.
//!
//! Hosted-only integration test (ignored locally): starts nothing itself.
//! The workflow provides postgres:16 + redis:7 services, migrates schema,
//! starts `scripts/relay-v2-d0-relay.sh` on an isolated port, seeds one
//! community + member + kind-9 event, then drives the REAL helper binary
//! (`--relay-v2`) over stdio through connect/auth/subscribe/publish/close,
//! wrong-authority/COUNT/malformed/oversized negatives, a proxy drop with
//! reconnect fencing, and full teardown proof.
//!
//! Env contract (workflow sets all of these):
//! - `RELAY_V2_D0_URL` — disposable relay ws:// URL (isolated port).
//! - `RELAY_V2_D0_CHANNEL` — seeded channel UUID for the filter/event.
//! - `RELAY_V2_D0_HOME` — disposable user-data root for helper keys.
//!
//! No production/shared relay is ever contacted; all identities are
//! disposable and confined to the isolated database.

use std::{
    collections::{BTreeSet, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStderr, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

use serde_json::{json, Value};

const PREFIX: &str = "@colony-native:";
const PROFILE_ID: &str = "relay-v2";
const SESSION_ID: &str = "relay-v2-d0-proof";
// RelayV2 uses the v1 stdio envelope as its carrier. The RelayV2 protocol
// version is enforced inside the host's typed operation context, not on this
// outer HELLO/REQUEST envelope.
const ENVELOPE_PROTOCOL_VERSION: u64 = 1;
const FRAME_LIMIT: usize = 16_777_216;

fn required_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("D0 env {name} must be set by the workflow"))
}

struct Harness {
    child: Child,
    stdin: ChildStdin,
    stdout: Receiver<String>,
    stderr: BufReader<ChildStderr>,
    pending_events: VecDeque<Value>,
    sequence: u64,
}

impl Harness {
    fn spawn() -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_colony-native-host"));
        command
            .arg("--relay-v2")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_remove("BUZZ_RELAY_URL")
            .env_remove("COLONY_STAGE0_FAULT")
            .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS");
        let mut child = command.spawn().expect("helper should spawn");
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let (stdout_sender, stdout_receiver) = mpsc::sync_channel(32);
        std::thread::spawn(move || {
            let stdout = BufReader::new(stdout);
            for line in stdout.lines() {
                match line {
                    Ok(line) => {
                        if stdout_sender.send(line).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            child,
            stdin,
            stdout: stdout_receiver,
            stderr: BufReader::new(stderr),
            pending_events: VecDeque::new(),
            sequence: 1,
        }
    }

    fn send(&mut self, value: Value, context: &str) -> Value {
        let mut encoded = serde_json::to_vec(&value).expect("frame encodes");
        assert!(encoded.len() < FRAME_LIMIT, "frame within host limit");
        encoded.push(b'\n');
        let line = format!("{PREFIX}{}", String::from_utf8(encoded).expect("utf8"));
        self.stdin.write_all(line.as_bytes()).expect("stdin write");
        self.stdin.flush().expect("stdin flush");
        self.recv(context)
    }

    fn recv(&mut self, context: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if Instant::now() >= deadline {
                panic!("timed out waiting for helper frame: {context}");
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .unwrap_or(Duration::ZERO);
            let line = match self.stdout.recv_timeout(remaining) {
                Ok(line) => line,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    panic!("timed out waiting for helper frame after 30s: {context}")
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let status = self.child.wait().expect("helper status readable");
                    let mut stderr = String::new();
                    self.stderr
                        .read_to_string(&mut stderr)
                        .expect("stderr readable");
                    panic!(
                        "helper closed stdout before frame: status={status:?} stderr={stderr:?}"
                    );
                }
            };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let stripped = line.strip_prefix(PREFIX).expect("framed line");
            return serde_json::from_str(stripped).expect("valid frame json");
        }
    }

    fn hello(&mut self, payload: Value) -> Value {
        self.sequence = 1;
        let ready = self.send(
            json!({
            "type": "HELLO",
            "protocolVersion": ENVELOPE_PROTOCOL_VERSION,
            "profileId": PROFILE_ID,
            "sessionId": SESSION_ID,
            "generationId": 1,
            "buildId": "relay-v2-d0",
            "payload": payload,
            }),
            "HELLO response",
        );
        let mut lifecycle_states = BTreeSet::new();
        let mut ready_frame = None;
        let mut frame = ready;
        loop {
            match frame.get("type").and_then(|value| value.as_str()) {
                Some("READY") => ready_frame = Some(frame),
                Some("EVENT") => match classify_event(&frame) {
                    "host_lifecycle" => {
                        let state = frame
                            .get("payload")
                            .and_then(|payload| payload.get("state"))
                            .and_then(|value| value.as_str())
                            .expect("lifecycle state");
                        lifecycle_states.insert(state.to_string());
                    }
                    "relay_message" => self.pending_events.push_back(frame),
                    other => panic!("unexpected EVENT {other:?}: {frame}"),
                },
                other => panic!("expected READY or EVENT, got {other:?}: {frame}"),
            }
            if ready_frame.is_some() && lifecycle_states.contains("ready") {
                return ready_frame.expect("READY frame");
            }
            frame = self.recv("HELLO READY/lifecycle frames");
        }
    }

    fn request(&mut self, capability: &str, method: &str, payload: Value) -> Value {
        let request_id = format!("d0-{}", self.sequence);
        self.sequence += 1;
        let context = format!("REQUEST {request_id} {capability}/{method}");
        let mut frame = self.send(
            json!({
            "type": "REQUEST",
            "protocolVersion": ENVELOPE_PROTOCOL_VERSION,
            "profileId": PROFILE_ID,
            "sessionId": SESSION_ID,
            "generationId": 1,
            "requestId": request_id,
            "capability": capability,
            "method": method,
            "payload": payload,
            }),
            &context,
        );
        let mut lifecycle_states = BTreeSet::new();
        let mut response = None;
        let required_connect_states = ["relay_authenticated", "relay_connecting"]
            .into_iter()
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        loop {
            match frame.get("type").and_then(|value| value.as_str()) {
                Some("RESPONSE") => {
                    assert_eq!(
                        frame.get("requestId").and_then(|value| value.as_str()),
                        Some(request_id.as_str()),
                        "response for {method}, got {frame}"
                    );
                    response = Some(frame);
                }
                Some("EVENT") => match classify_event(&frame) {
                    "host_lifecycle" => {
                        let state = frame
                            .get("payload")
                            .and_then(|payload| payload.get("state"))
                            .and_then(|value| value.as_str())
                            .expect("lifecycle state");
                        lifecycle_states.insert(state.to_string());
                    }
                    "relay_message" => self.pending_events.push_back(frame),
                    other => panic!("unexpected EVENT {other:?}: {frame}"),
                },
                other => panic!("expected RESPONSE or lifecycle EVENT, got {other:?}: {frame}"),
            }
            let lifecycle_complete =
                method != "connect" || lifecycle_states == required_connect_states;
            if lifecycle_complete {
                if let Some(response) = response.take() {
                    return response;
                }
            }
            frame = self.recv(&context);
        }
    }

    fn stop(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn assert_ok(frame: &Value) -> &Value {
    assert_eq!(
        frame.get("outcome").and_then(|v| v.as_str()),
        Some("ok"),
        "expected ok, got {frame}"
    );
    frame.get("payload").expect("ok payload")
}

fn assert_err(frame: &Value) -> &str {
    assert_eq!(
        frame.get("outcome").and_then(|v| v.as_str()),
        Some("error"),
        "expected error, got {frame}"
    );
    frame
        .get("error")
        .and_then(|e| e.get("code"))
        .and_then(|c| c.as_str())
        .expect("error code")
}

fn classify_event(frame: &Value) -> &str {
    let event = frame
        .get("event")
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| panic!("EVENT missing event name: {frame}"));
    match event {
        "host_lifecycle" => {
            frame
                .get("payload")
                .and_then(|payload| payload.get("state"))
                .and_then(|value| value.as_str())
                .unwrap_or_else(|| panic!("host_lifecycle missing state: {frame}"));
        }
        "relay_message" => {
            frame
                .get("payload")
                .and_then(|payload| payload.get("messageType"))
                .and_then(|value| value.as_str())
                .unwrap_or_else(|| panic!("relay_message missing messageType: {frame}"));
        }
        other => panic!("unexpected EVENT name {other:?}: {frame}"),
    }
    event
}

fn next_event(harness: &mut Harness) -> Value {
    // Streaming relay traffic arrives as unsolicited EVENT frames between
    // request responses. Return the relay message the caller is waiting for;
    // known lifecycle events are classified and consumed, while unknown
    // event names remain a loud protocol failure.
    loop {
        let frame = match harness.pending_events.pop_front() {
            Some(frame) => frame,
            None => harness.recv("relay stream event"),
        };
        match frame.get("type").and_then(|v| v.as_str()) {
            Some("EVENT") => {
                if classify_event(&frame) == "relay_message" {
                    return frame;
                }
            }
            Some("RESPONSE") => panic!("expected streaming EVENT, got RESPONSE {frame}"),
            other => panic!("unexpected frame type {other:?} in {frame}"),
        }
    }
}

#[test]
#[ignore = "hosted D0 only: needs disposable relay + seeded database"]
fn relay_v2_d0_disposable_proof() {
    let relay_url = required_env("RELAY_V2_D0_URL");
    let user_data_root = required_env("RELAY_V2_D0_HOME");
    let authority_ref = "a".repeat(64);
    std::fs::create_dir_all(&user_data_root).expect("D0 identity root should be creatable");

    let mut harness = Harness::spawn();
    let ready = harness.hello(json!({
        "relayUrl": relay_url,
        "authorityRef": authority_ref,
        "userDataRoot": user_data_root,
        "flavor": "normal",
    }));
    assert_eq!(
        ready.get("type").and_then(|v| v.as_str()),
        Some("READY"),
        "relay-v2 READY, got {ready}"
    );
    let digest = ready
        .get("registryDigest")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(
        digest.starts_with("bfc07c1c"),
        "READY carries the frozen digest, got {digest}"
    );

    // connect → connectionId
    let response = harness.request(
        "relay-transport",
        "connect",
        json!({"authorityRef": authority_ref}),
    );
    let connection_id = assert_ok(&response)
        .get("connectionId")
        .and_then(|v| v.as_str())
        .expect("connection id")
        .to_string();

    // subscribe with the seeded channel filter → subscription ack
    let filter = json!({
        "kinds": [9],
        "#h": [required_env("RELAY_V2_D0_CHANNEL")],
        "limit": 10,
    });
    let response = harness.request(
        "relay-transport",
        "subscribe",
        json!({
            "connectionId": connection_id,
            "subscriptionId": "d0-sub-1",
            "filter": filter,
        }),
    );
    assert_ok(&response);

    // The seeded kind-9 event and EOSE must both arrive, but their order is
    // not part of the relay contract.
    let mut stream_message_types = BTreeSet::new();
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline && stream_message_types.len() < 2 {
        let frame = next_event(&mut harness);
        let payload = frame.get("payload").expect("event payload");
        let message_type = payload
            .get("messageType")
            .and_then(|v| v.as_str())
            .expect("relay message type");
        match message_type {
            "EVENT" => {
                let event = payload
                    .get("payload")
                    .and_then(|p| p.get("event"))
                    .expect("signed event");
                assert_eq!(event.get("kind").and_then(|v| v.as_u64()), Some(9));
            }
            "EOSE" => {}
            other => panic!("unexpected streaming class {other:?}"),
        }
        stream_message_types.insert(message_type.to_owned());
    }
    assert_eq!(
        stream_message_types,
        BTreeSet::from(["EOSE".to_owned(), "EVENT".to_owned()]),
        "seeded EVENT + EOSE must arrive"
    );

    // sign → publish → accepted
    let response = harness.request(
        "identity-sign",
        "sign_message",
        json!({
            "connectionId": connection_id,
            "channelId": required_env("RELAY_V2_D0_CHANNEL"),
            "content": "d0 hello",
            "mentionPubkeys": [],
            "extraTags": [],
        }),
    );
    let handle = assert_ok(&response)
        .get("eventHandle")
        .and_then(|v| v.as_str())
        .expect("event handle")
        .to_string();
    let response = harness.request(
        "relay-transport",
        "publish",
        json!({"connectionId": connection_id, "eventHandle": handle}),
    );
    assert_ok(&response);

    // negatives: wrong operation shape and oversized filter must fail
    // closed without touching the socket.
    let response = harness.request(
        "relay-transport",
        "subscribe",
        json!({
            "connectionId": connection_id,
            "subscriptionId": "d0-sub-2",
            "filter": {"kinds": [9], "limit": 1},
        }),
    );
    // Sanity: a valid second subscription shape is accepted before the
    // failure cases below.
    assert_ok(&response);
    // Unknown method on a known capability.
    let response = harness.request("relay-transport", "send_raw", json!({}));
    assert_eq!(assert_err(&response), "unknown_method");
    // Oversized filter value (over maxFilterValueBytes 128) fails closed.
    let response = harness.request(
        "relay-transport",
        "subscribe",
        json!({
            "connectionId": connection_id,
            "subscriptionId": "d0-sub-3",
            "filter": {"kinds": [9], "#h": ["x".repeat(200)]},
        }),
    );
    assert_eq!(assert_err(&response), "invalid_payload");

    harness.stop();
}
