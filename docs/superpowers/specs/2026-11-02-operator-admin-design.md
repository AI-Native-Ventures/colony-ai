# Operator admin: knowing what happens after launch (design)

Date: 2 Nov 2026. Status: design for owner review. Mockups: Colony 3.0 canvas https://claude.ai/artifact/RnYdZoidiBCf13htG27KE8, page "Admin" (local PNGs: /Users/mac/worktrees/.lanes/phase2/real-run-20261004/admin-design/shots/).

## 1. Intent

Owner, 2 Nov 2026: "I also need a mock of the admin side that we need to build that gives me visibility because when I launch I will have no idea about users, DAU, MAU, WAU, communities, agents, sessions, tokens consumed etc."

One place, for the operator only, that answers every morning: how many people use Colony, are they coming back, which businesses are active, are agents working, what AI and Discovery cost us, and is anything broken. Counts and health only, never anyone's messages.

## 2. Goals, non-goals, anti-goals

Goals
- Overview with the numbers that matter at launch and their trend.
- Drill into a business (community) and see its people, agents, AI use, Discovery use, WhatsApp sends and errors.
- Health: the silent failures that hurt us before (co-founder wakes never delivered, agents not answering, gateway refusals) shown as red numbers the day they start.

Non-goals
- Product analytics on what people click inside the app (later, opt in).
- Billing management (Stripe, credits top-ups) beyond showing spend.
- Moderation (reports and feedback already exist in admin-web and stay).

Anti-goals
- Reading or showing message content, names of a business's customers, or WhatsApp text.
- A slow page: every number comes from a precomputed daily table, not a live scan of the events table.

## 3. What exists today (main, 2 Nov)

- `admin-web/` (React, Vite) with Reports and Feedback pages, calling the relay's deployment admin API under `/api/admin/v1` (NIP-98 signed requests, principal resolved from `relay_operators`, see `crates/buzz-relay/src/api/admin/auth.rs`).
- `buzz-admin` CLI: members, keys, migrations, storage snapshot, product feedback, community deletions.
- Relay tables with usable signal: `accounts` (created_at, last_signin_at), `users` (per community: pubkey, agent_type, agent_owner_pubkey, created_at, deactivated_at), `communities` (created_at, archived_at), `events` (community_id, pubkey, kind, created_at; partitioned), `account_ai_sessions` and `account_ai_requests` (free AI gateway: charged_nanousd, usage JSON, status, created_at), `account_credit_ledger`, `discovery_usage` (results per company per month), `whatsapp_messages` (state, sent_at, error_code, new_chat), `cofounder_wakes` (status, outcome, attempts), `delivery_log`, `rate_limit_violations`, `storage_accounting_snapshots`, `product_feedback`, `moderation_reports`.

## 4. Metric definitions

| Metric | Definition | Source today | Needs new collection |
|---|---|---|---|
| Accounts | Rows in `accounts`; new = created that UTC day | accounts | no |
| People | Distinct human pubkeys (`users.agent_type IS NULL`) across communities | users | no |
| DAU / WAU / MAU | Distinct human pubkeys that published a human event (kinds 9, 7, 5 by a non-agent, plus company record actions) in the UTC day / last 7 days / last 30 days. Stickiness = DAU / MAU | events + users | daily rollup table `metrics_daily_active` (computed nightly, 13 months kept) |
| App opens (sessions) | Distinct authenticated WebSocket connections per pubkey per day, grouped into sessions with a 30 minute gap | not stored (connections only logged) | relay counter `connection_sessions_daily` (pubkey hash, day, sessions, minutes); no content |
| Businesses | Communities not archived or deleted; active = at least one human event in the last 7 days | communities + events | rollup |
| Agents | `users` rows with agent_type set; active = published an event in the last 7 days; answering rate = mentions to an agent answered within 5 minutes | users + events | rollup, plus mention-to-answer pairs (from `event_mentions` and the agent's reply in the same thread) |
| Agent sessions | Free AI gateway sessions per day | account_ai_sessions | none for free AI; own-AI sessions (Claude Code, Codex, OpenCode on the person's Mac) never reach the server: opt-in anonymous counts from the desktop (see question 4) |
| AI tokens and cost | Sum of input and output tokens and charged USD per day, per model, per business, from the gateway | account_ai_requests (charged_nanousd; tokens inside usage JSON) | add `model`, `input_tokens`, `output_tokens` columns at settle time so it is queryable; model fallback chain counts |
| Discovery | Results served per business this month against its cap; repeat results skipped | discovery_usage | skipped repeats count (from the paging fix) |
| WhatsApp | Sends, delivered, read, failed, new chats per day per business; quality rating | whatsapp_messages, whatsapp_connections | none |
| Co-founder | Businesses with co-founder on, onboarding finished, wakes delivered vs skipped (with outcome) | cofounder_wakes, company heads | none |
| Errors | Gateway refusals and timeouts, rate-limit hits, wakes skipped, WhatsApp send failures, relay 5xx | account_ai_requests, rate_limit_violations, cofounder_wakes, whatsapp_messages | relay 5xx counter per route per hour |
| Desktop versions | People per app version (for "who still runs 3.0.20") | not stored | the desktop already sends its version in the client hello; store per pubkey per day |

Privacy: every table above holds counts, ids and timestamps only. Pubkeys are shown shortened; a business shows by its name (operators already see community names). No message text, no WhatsApp text, no lead data.

## 5. Screens (boards on the canvas, 1440, light and dark)

1. **Overview**: KPI row (people, DAU, WAU, MAU, stickiness, new accounts this week), active people chart (30 days, DAU line with WAU band), businesses and agents tiles, AI spend this month with top models, Discovery used, WhatsApp sent, and a "Needs attention" list (red numbers with one link each).
2. **Businesses**: table of communities: name, created, people, agents, active days in last 7, AI spend this month, Discovery used / cap, WhatsApp sends, co-founder on, health dot. Search and sort.
3. **Business detail**: header with key numbers, people (count by role, last active), agents (status, answering rate), AI usage by model, Discovery and WhatsApp usage, co-founder state (onboarding step, last wake outcome), recent errors. Actions limited to safe ones already in buzz-admin (none new in v1).
4. **AI usage**: spend and tokens per day, per model (including free fallback chain), per business top 10, gateway outcomes (settled, refused, timed out).
5. **Health**: relay up and version, WebSocket connections now, queue depths, co-founder wakes (delivered, skipped by reason, the 15 never-delivered example), agent answering rate, WhatsApp failures, Discovery provider errors, last deploys.

Mobile: not designed; the admin is a desktop tool.

## 6. Where it lives and access

Proposed: extend `admin-web` (it already has the NIP-98 operator login and the relay admin API) with these pages, served at an operator-only host. New read-only endpoints under `/api/admin/v1/metrics/*`, each backed by a rollup table refreshed by a nightly job plus a 15 minute "today" refresh. Access: `relay_operators` only (the owner's key), every read audited in `relay_operator_audit`.

## 7. Acceptance

- Each metric matches a hand-run SQL check on a staging copy within 1 percent.
- Pages load under 1 second with a year of data.
- No endpoint returns message content (test that greps responses for event content).
- The co-founder wake example (15 skipped, "no Scout to wake yet") shows on Health as it did in production on 1 Nov.

## 8. Questions only the owner can answer

1. Where should the admin live: the existing admin web app on its own operator address (recommended), or an owner-only section inside the Colony app?
2. People who bring their own AI (Claude Code, Codex, OpenCode) run it on their Mac, so the server never sees those tokens or sessions. Should the desktop send anonymous daily counts (sessions, tokens, model; never content), or do we measure only the free AI gateway?
3. Should anyone besides you get admin access at launch?
