//! File-triggered MCP discovery fixture. No wall-clock ordering assumptions.

use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

fn emit(value: Value) {
    let mut out = std::io::stdout().lock();
    writeln!(out, "{value}").expect("fixture stdout");
    out.flush().expect("fixture flush");
}

fn main() {
    let changed = Arc::new(AtomicBool::new(false));
    let trigger = std::env::var("DISCOVERY_TRIGGER").expect("trigger path");
    let signal = changed.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if std::path::Path::new(&trigger).exists() {
                signal.store(true, Ordering::Release);
                emit(json!({"jsonrpc":"2.0", "method":"notifications/tools/list_changed"}));
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    });
    let initial: usize = std::env::var("DISCOVERY_INITIAL").unwrap().parse().unwrap();
    let next: usize = std::env::var("DISCOVERY_NEXT").unwrap().parse().unwrap();
    for line in std::io::stdin().lock().lines() {
        let value: Value = serde_json::from_str(&line.expect("fixture stdin")).unwrap();
        let Some(id) = value.get("id") else { continue };
        let result = match value["method"].as_str().unwrap_or("") {
            "initialize" => json!({
                "protocolVersion":"2025-06-18",
                "capabilities":{"tools":{"listChanged":true}},
                "serverInfo":{"name":"discovery", "version":"1"}
            }),
            "tools/list" => {
                let updated = changed.load(Ordering::Acquire);
                if updated && std::env::var("DISCOVERY_HANG").is_ok() {
                    std::thread::sleep(Duration::from_secs(30));
                }
                let count = if updated { next } else { initial };
                let prefix = if updated { "new" } else { "old" };
                let tools: Vec<Value> = (0..count).map(|i| json!({
                    "name":format!("{prefix}_{i}"),
                    "description":format!("{prefix} description"),
                    "inputSchema":{"type":"object", "properties":{"updated":{"type":"boolean"}}}
                })).collect();
                if updated && std::env::var("DISCOVERY_PAGINATION_LOOP").is_ok() {
                    json!({"tools":tools, "nextCursor":"repeated"})
                } else {
                    json!({"tools":tools})
                }
            }
            "tools/call" => json!({"content":[{"type":"text", "text":"called refreshed tool"}]}),
            "ping" => json!({}),
            _ => panic!("unexpected request {value}"),
        };
        emit(json!({"jsonrpc":"2.0", "id":id, "result":result}));
    }
}
