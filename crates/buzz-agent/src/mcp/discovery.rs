//! Notification-driven discovery, published atomically before model requests.

use std::sync::atomic::{AtomicU64, Ordering};

use rmcp::service::{MaybeSendFuture, NotificationContext};
use rmcp::ClientHandler;

use super::*;

#[derive(Default)]
pub(super) struct DiscoveryHandler {
    revision: AtomicU64,
    listed: AtomicU64,
}

impl DiscoveryHandler {
    pub(super) fn changed(&self) {
        self.revision.fetch_add(1, Ordering::Release);
    }

    pub(super) fn revision(&self) -> u64 {
        self.revision.load(Ordering::Acquire)
    }

    pub(super) fn listed(&self, revision: u64) {
        self.listed.store(revision, Ordering::Release);
    }

    fn dirty(&self) -> bool {
        self.revision() != self.listed.load(Ordering::Acquire)
    }
}

impl ClientHandler for DiscoveryHandler {
    fn on_tool_list_changed(
        &self,
        _context: NotificationContext<RoleClient>,
    ) -> impl std::future::Future<Output = ()> + MaybeSendFuture + '_ {
        // No transport work in the handler: coalesce bursts into one revision.
        self.changed();
        tracing::info!("MCP tool list changed");
        std::future::ready(())
    }
}

#[derive(Clone, Default)]
pub(super) struct ToolCatalog {
    pub(super) by_qname: HashMap<String, Entry>,
    pub(super) defs: Vec<ToolDef>,
}

impl ToolCatalog {
    pub(super) fn replace(
        &mut self,
        server_idx: usize,
        server_name: &str,
        tools: Vec<rmcp::model::Tool>,
    ) -> Result<(), AgentError> {
        let mut next = self.clone();
        next.defs.retain(|d| {
            self.by_qname
                .get(&d.name)
                .is_some_and(|e| e.server_idx != server_idx)
        });
        next.by_qname.retain(|_, e| e.server_idx != server_idx);
        for t in tools {
            if next.defs.len() >= MAX_TOOLS_PER_SESSION {
                return Err(AgentError::Mcp(format!(
                    "too many tools (>{MAX_TOOLS_PER_SESSION})"
                )));
            }
            let bare = t.name.to_string();
            if !valid_name(&bare) || bare.contains("__") {
                return Err(AgentError::Mcp(format!("invalid tool name: {bare}")));
            }
            let qname = format!("{server_name}{SEP}{bare}");
            if qname.len() > MAX_QNAME_LEN {
                return Err(AgentError::Mcp(format!(
                    "qualified tool name too long: {} ({} > {MAX_QNAME_LEN})",
                    qname,
                    qname.len()
                )));
            }
            if next.by_qname.contains_key(&qname) {
                return Err(AgentError::Mcp(format!("duplicate tool: {qname}")));
            }
            next.defs.push(ToolDef {
                name: qname.clone(),
                description: clamp(
                    t.description.as_deref().unwrap_or("").to_owned(),
                    MAX_DESCRIPTION_BYTES,
                ),
                input_schema: cap_schema(&qname, Value::Object((*t.input_schema).clone())),
            });
            next.by_qname.insert(qname, Entry { server_idx, bare });
        }
        next.defs.sort_by_key(|d| next.by_qname[&d.name].server_idx);
        *self = next;
        Ok(())
    }
}

impl McpRegistry {
    /// Reconcile changed MCP tool lists before constructing a model request.
    /// The entire refresh, including lock waits and pagination, is bounded.
    /// Errors propagate with the revision still dirty, allowing a later retry.
    pub async fn refresh_tools(&self) -> Result<(), AgentError> {
        let timeout = self.init_timeout.min(Duration::from_secs(5));
        tokio::time::timeout(timeout, self.refresh_changed_tools())
            .await
            .map_err(|_| AgentError::Mcp(timeout_msg("refresh_tools", "session", timeout)))?
    }

    async fn refresh_changed_tools(&self) -> Result<(), AgentError> {
        let _refresh = self.refresh_lock.lock().await;
        for (idx, server) in self.servers.iter().enumerate() {
            let _restart = server.restart_lock.lock().await;
            loop {
                let current = server.client.load_full();
                let (client, pgid) = match &*current {
                    ClientState::Healthy { client, pgid, .. } if client.service().dirty() => {
                        (client.clone(), *pgid)
                    }
                    _ => break,
                };
                let revision = client.service().revision();
                let tools = list_tools_bounded(&client).await?;
                {
                    // Validate the complete replacement before publishing either names or metadata.
                    let mut catalog = self.catalog.lock().unwrap_or_else(|e| e.into_inner());
                    let mut next = catalog.clone();
                    let names = tools.iter().map(|t| t.name.to_string()).collect();
                    next.replace(idx, &server.name, tools)?;
                    let updated = Arc::new(ClientState::Healthy {
                        client: client.clone(),
                        pgid,
                        tools: Arc::new(names),
                    });
                    let previous = server.client.compare_and_swap(&current, updated);
                    if !Arc::ptr_eq(&previous, &current) {
                        // A retired connection cannot publish into a newer generation.
                        break;
                    }
                    *catalog = next;
                    client.service().listed(revision);
                }
                // A notification during discovery remains dirty and is reconciled
                // within the same bounded refresh before the model sees a snapshot.
            }
        }
        Ok(())
    }
}

/// Bound tool accumulation and pagination as well as the caller's wall time.
pub(super) async fn list_tools_bounded(
    client: &Client,
) -> Result<Vec<rmcp::model::Tool>, AgentError> {
    let mut tools = Vec::new();
    let mut cursor = None;
    let mut seen = HashSet::new();
    for _ in 0..MAX_TOOLS_PER_SESSION {
        let page = client
            .peer()
            .list_tools(Some(
                rmcp::model::PaginatedRequestParams::default().with_cursor(cursor),
            ))
            .await
            .map_err(|e| AgentError::Mcp(format!("list_tools: {e}")))?;
        if tools.len() + page.tools.len() > MAX_TOOLS_PER_SESSION {
            return Err(AgentError::Mcp(format!(
                "too many tools (>{MAX_TOOLS_PER_SESSION})"
            )));
        }
        tools.extend(page.tools);
        cursor = page.next_cursor;
        match &cursor {
            None => return Ok(tools),
            Some(value) if !seen.insert(value.clone()) => {
                return Err(AgentError::Mcp(
                    "tool pagination repeated a cursor".to_owned(),
                ));
            }
            _ => {}
        }
    }
    Err(AgentError::Mcp(
        "tool pagination exceeded page limit".to_owned(),
    ))
}
