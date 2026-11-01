//! Domain-owned persistence implementations.

/// Deployment-global email and Google account persistence.
pub mod accounts;
/// Explicit deployment-global admin report reads.
pub mod admin_moderation;
/// Community-scoped authentication allowlist persistence.
pub mod allowlist;
/// API token storage and lookup.
pub mod api_token;
/// Relay-scoped archived identity persistence (NIP-IA).
pub mod archived_identities;
/// Client-scoped business-record conversion claims.
pub mod business_records;
/// Channel lifecycle and metadata persistence.
pub mod channel;
/// Channel membership and roster persistence.
pub mod channel_members;
/// Community lifecycle and host-map persistence.
/// Durable queue of wakes for Scout in co-founder mode.
pub mod cofounder_wakes;
pub mod community;
/// Durable company work watchdog schedule and delivery journal.
pub mod company_work_watchdog;
/// Private Colony managed-session credit reservations and settlement.
pub mod credits_gateway;
/// Durable whole-community deletion lifecycle and PostgreSQL adapter.
pub mod deletion;
/// Per-company monthly Discovery result counter.
pub mod discovery_usage;
/// Direct message channel persistence.
pub mod dm;
/// Event storage and retrieval.
pub mod event;
/// Home feed queries.
pub mod feed;
/// Git repository name registry (NIP-34 kind:30617).
pub mod git_repo;
/// Community moderation: reports, bans/timeouts, audit actions.
pub mod moderation;
/// Money rails: provider connections, recipients, jobs and payment notices.
pub mod money_rails;
/// Monthly table partition management.
pub mod partition;
/// Deployment-global payment intents, credit ledger, and subscriptions.
pub mod payments;
/// Buzz product-feedback sidecar persistence.
pub mod product_feedback;
/// Community-scoped push lease and durable wake-outbox persistence.
pub mod push;
/// Reaction persistence.
pub mod reaction;
/// HTTP report-resolution enforcement state machine persistence.
pub mod relay_admin_actions;
/// Use-limited relay invite persistence (v2 opaque tokens).
pub mod relay_invite;
/// Relay-level membership persistence (NIP-43).
pub mod relay_members;
/// Deployment-global relay operator/moderator roster persistence.
pub mod relay_operators;
/// Event-reminder delivery query, claim, and release persistence.
pub mod reminder;
/// Replaceable-event persistence and coordinate locking.
pub mod replaceable;
/// Durable completed snapshots from the isolated media-storage worker.
pub mod storage_accounting;
/// Thread metadata persistence.
pub mod thread;
/// Per-community usage rollup queries for Prometheus gauges.
pub mod usage;
/// User profile persistence.
pub mod user;
/// Per-company WhatsApp outreach connection, contacts, messages and batches.
pub mod whatsapp;
/// Workflow, run, and approval persistence.
pub mod workflow;
