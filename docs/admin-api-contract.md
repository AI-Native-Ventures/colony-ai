# Operator admin API contract (AD-DATA to AD-UI)

Status: draft 1, 2 Nov 2026. Owner: AD-DATA. Consumer: AD-UI (`admin-web`).
Design: `docs/superpowers/specs/2026-11-02-operator-admin-design.md` (branch `docs/outreach-lists-admin`). Boards: canvas page "Admin".

This contract is the source of truth for field names. If the UI needs something that is not here, ask AD-DATA to add it; do not read it from another endpoint.

## 1. Rules for every endpoint

- Base: the existing deployment admin API, `/api/admin/v1`, served on the operator-only admin host (same host and same NIP-98 login the Reports and Feedback pages already use). New routes live under `/api/admin/v1/metrics/`.
- Method: `GET` only. No mutations in v1.
- Auth: NIP-98 signed request exactly as the existing routes (`Authorization: Nostr <base64 event>`, bound to the full path and query). The principal must be a **relay operator** (`probe` returns `role: "operator"`).
  - Not signed or bad signature: `401` (existing admin error body).
  - Signed by a moderator, or by a key that is not on the roster: `403`.
  - Admin auth mode `disabled` (local dev): `403` for every metrics route. There is no anonymous read of metrics.
- Audit: every successful read writes one row to `relay_operator_read_audit` (actor key, path, time). No query string values or response data are stored.
- Privacy: counts, ids and timestamps only. No message text, no WhatsApp text, no lead data, no customer names. People appear as shortened keys (`pubkeyShort`, first 8 hex) and a business shows by its name and host (operators already see these). A relay test greps every response for event content.
- Errors: same shape as the existing admin API: `{"error": {"code": "...", "message": "..."}}`.
- Caching: `Cache-Control: no-store` (existing admin middleware). Every number comes from a precomputed table, never from a live scan of `events`.
- Dates: `day` is a UTC date `YYYY-MM-DD`; timestamps are RFC 3339 UTC. The UI formats to SAST. Money is a USD decimal **string** (`"12.340000"`, 6 places) so nothing rounds in transit. Token and request counts are JSON numbers (safe integers).
- Range: `days` query parameter, one of `7`, `30`, `90`; default `30`; anything else is `400 invalid_days`.
- Freshness: every response carries `generatedAt` and `dataThrough`. `dataThrough` is the newest day whose rollup is complete (yesterday UTC once the nightly job has run). Today's numbers are refreshed every 15 minutes and are marked `partial: true` in series rows.
- Nulls: a number the relay does not collect is `null`, never `0`, and is named in the response's `unavailable` array so the UI can show "not collected" instead of a fake zero.

## 2. Endpoints

| Board | Method and path |
|---|---|
| Overview | `GET /api/admin/v1/metrics/overview?days=30` |
| Businesses | `GET /api/admin/v1/metrics/businesses?days=30&q=&sort=active&limit=100&offset=0` |
| Business detail | `GET /api/admin/v1/metrics/businesses/{communityId}?days=30` |
| AI usage | `GET /api/admin/v1/metrics/ai-usage?days=30` |
| Health | `GET /api/admin/v1/metrics/health` |

`probe` (`GET /api/admin/v1/probe`) already tells the UI the role; show the Admin boards only when `role === "operator"`.

### 2.1 Overview

```jsonc
{
  "generatedAt": "2026-11-02T05:45:11Z",
  "dataThrough": "2026-11-01",
  "range": { "days": 30, "from": "2026-10-04", "to": "2026-11-02" },
  "kpis": {
    // value = now (today, partial). previous = same measure 7 days ago (mau: 30 days ago).
    "people":        { "value": 214, "previous": 176 },
    "dau":           { "value": 71,  "previous": 60 },
    "wau":           { "value": 174, "previous": 155 },
    "mau":           { "value": 203, "previous": 155 },
    "stickinessPct": { "value": 35.0, "previous": 31.0 },      // dau / mau * 100, one decimal
    "newAccounts":   { "value": 38, "previous": 30 }           // created in last 7 days / the 7 days before
  },
  "series": [
    // one row per day in range, oldest first
    { "day": "2026-10-04", "dau": 33, "wau": 88, "mau": 120, "newAccounts": 4, "partial": false }
  ],
  "businesses": { "total": 96, "archived": 2, "activeThisWeek": 61, "createdThisWeek": 22, "cofounderOn": 3 },
  "agents": {
    "total": 118, "scout": 102, "activeThisWeek": 74,
    "answerWithin5MinPct": 88.0,          // mentions to an agent answered in the same channel within 5 min, last 7 days; null when no mentions
    "neverStarted": 11                    // agent rows that never published an event
  },
  "ai": {
    "month": "2026-11",
    "requests": 66100, "inputTokens": 141000000, "outputTokens": 41000000,
    "chargedUsd": "0.000000",
    "byModel": [ { "model": "deepseek-v4", "requests": 41200 } ]   // top 3 by requests, "unknown" when a row has no model
  },
  "discovery": {
    "resultsThisMonth": 3420, "capPerBusiness": 2000,
    "repeatsSkipped": null                // not collected in v1, listed in unavailable
  },
  "whatsapp": { "sentThisMonth": 312, "repliedThisMonth": 41 },
  "needsAttention": [
    {
      "key": "cofounder_wakes_skipped",
      "severity": "red",                  // "red" | "amber"
      "title": "Co-founder wakes",
      "detail": "15 skipped, 3 delivered: no Scout to wake yet",
      "count": 15,
      "link": { "board": "health", "params": {} }     // board: overview|businesses|business|ai-usage|health ; params for business = { "communityId": "..." }
    }
  ],
  "unavailable": ["discovery.repeatsSkipped"]
}
```

`needsAttention` is computed by the relay (rules in section 4) so the UI only renders it. Sorted red first, then by `count` descending. The sidebar Health badge is the number of `red` items with `link.board === "health"`.

### 2.2 Businesses

Query: `q` (case-insensitive substring of business name or host or owner name), `sort` one of `active` (default, most active days first), `people`, `agents`, `ai`, `discovery`, `whatsapp`, `created`, `name`; `limit` 1 to 200 (default 100); `offset`.

```jsonc
{
  "generatedAt": "...", "dataThrough": "2026-11-01",
  "range": { "days": 30, "from": "...", "to": "..." },
  "total": 96, "activeThisWeek": 61,     // total matches `q`; activeThisWeek is across all businesses
  "items": [
    {
      "communityId": "uuid",
      "name": "Horizon Labs",             // business name; falls back to host when unnamed
      "host": "horizonlabs.colony.global",
      "ownerName": "Basheer Phiri",       // owner display name, null when unknown
      "createdAt": "2026-10-03T08:00:00Z",
      "archived": false,
      "people": 4, "agents": 3,
      "activeDaysLast7": 7,
      "aiRequests": 9200,                 // in range
      "aiChargedUsd": "0.000000",
      "discoveryResultsThisMonth": 500, "discoveryCap": 2000,
      "whatsappSentInRange": 312,
      "cofounderOn": true,                // false/true; null when the settings record could not be read
      "health": "ok"                      // "ok" | "warn" | "bad", rules in section 4
    }
  ]
}
```

### 2.3 Business detail

```jsonc
{
  "generatedAt": "...", "dataThrough": "2026-11-01",
  "range": { "days": 30, "from": "...", "to": "..." },
  "business": {
    "communityId": "uuid", "name": "Horizon Labs", "host": "horizonlabs.colony.global",
    "ownerName": "Basheer Phiri", "ownerPubkeyShort": "ab12cd34",
    "createdAt": "...", "archived": false, "health": "ok"
  },
  "kpis": {
    "people": 4, "newPeopleThisWeek": 1,
    "agents": 3, "agentNames": ["Scout", "Aya", "Theo"],
    "activeDaysLast7": 7,
    "discoveryResultsThisMonth": 500, "discoveryCap": 2000,
    "whatsappSentInRange": 312, "whatsappRepliedInRange": 41
  },
  "people": {
    "byRole": [
      { "role": "owner",  "count": 1, "lastActiveAt": "2026-11-02T04:10:00Z" },
      { "role": "admin",  "count": 1, "lastActiveAt": "..." },
      { "role": "member", "count": 2, "lastActiveAt": "..." }
    ],
    "staleMembers": 1                     // members with no activity in the last 7 days
  },
  "agents": [
    {
      "pubkeyShort": "9f3a77c1", "name": "Scout",
      "runtime": "claude_code",           // agent_type as stored, null when unset
      "status": "offline",                // "running" | "idle" | "offline" (running: published in last 15 min, idle: last 7 days, offline: older or never)
      "lastEventAt": "...",               // null when it never published
      "offlineHours": 10,                 // whole hours since lastEventAt, null when never or status != offline
      "answerRatePct": 100.0,             // answered within 5 min, in range; null when no mentions
      "medianAnswerSeconds": 60           // null when not enough pairs
    }
  ],
  "ai": {
    "requests": 9200, "inputTokens": 1, "outputTokens": 1, "chargedUsd": "0.000000",
    "byModel": [ { "model": "deepseek-v4", "requests": 9000, "inputTokens": 1, "outputTokens": 1, "chargedUsd": "0.000000" } ]
  },
  "discovery": { "resultsThisMonth": 500, "cap": 2000, "repeatsSkipped": null },
  "whatsapp": {
    "sent": 312, "delivered": 280, "read": 150, "failed": 2, "newChats": 40, "replied": 41,
    "failedByCode": [ { "code": "131026", "count": 2 } ]    // error_code only, never error text or numbers
  },
  "cofounder": {
    "on": true, "onSince": "2026-11-01T08:05:00Z",   // onSince = first mode_on wake time, null when unknown
    "wakes": { "delivered": 1, "skipped": 2, "pending": 0 },
    "lastWake": { "at": "2026-11-01T23:15:00Z", "status": "delivered", "reason": "daily_start" },   // null when none
    "skippedByOutcome": [ { "outcome": "no Scout found", "count": 2 } ]   // relay-written outcome strings, max 300 chars
  },
  "problems": {
    "gatewayRefusals": 0,                // free AI requests that ended refused or timed out, in range
    "whatsappFailed": 2,
    "skippedWakes": 2
  },
  "series": [ { "day": "...", "activePeople": 3, "agentsActive": 2, "aiRequests": 310, "partial": false } ],
  "unavailable": ["discovery.repeatsSkipped"]
}
```

`404 not_found` when the community id does not exist (an archived or deleted business still returns with `archived: true` while its rollup rows exist).

### 2.4 AI usage

```jsonc
{
  "generatedAt": "...", "dataThrough": "2026-11-01",
  "range": { "days": 30, "from": "...", "to": "..." },
  "kpis": {
    "requests":     { "value": 66100, "previous": 53300 },          // previous = the range of the same length before
    "inputTokens":  { "value": 141000000, "previous": 100000000 },
    "outputTokens": { "value": 41000000,  "previous": 30000000 },
    "chargedUsd":   { "value": "0.000000", "previous": "0.000000" },
    "refusedOrTimedOutPct": { "value": 6.0, "previous": 4.0 },      // of gateway requests, from gatewayOutcomes
    "sessions":     { "value": 1240, "previous": 1000 }             // distinct gateway sessions that sent a request
  },
  "models": ["deepseek-v4", "nemotron-3-ultra", "glm-5"],           // stable order for chart colours: by total requests desc, max 8, rest folded into "other"
  "series": [
    { "day": "2026-10-19", "requests": 2100, "inputTokens": 1, "outputTokens": 1, "chargedUsd": "0.000000", "partial": false,
      "byModel": { "deepseek-v4": 1500, "nemotron-3-ultra": 500, "glm-5": 100 } }   // requests per model
  ],
  "gatewayOutcomes": {
    // counted per finished gateway request (relay counter, hourly)
    "settled": 61900,
    "handedToNextModel": 2800,   // answered after a fallback hop (disjoint from settled, see note)
    "refused": 900,              // every model refused it (upstream_rejected)
    "timedOut": 500,             // transport failure, timeout or 5xx (upstream_unclear)
    "other": 0                   // admission busy, unreadable answer, cost unusable, reply refused, database error
  },
  "topBusinesses": [ { "communityId": "uuid", "name": "Horizon Labs", "requests": 9200, "agentName": "Scout" } ],   // top 10; agentName = agent with most requests, null if unknown
  "notCounted": "Own-AI use (Claude Code, Codex, OpenCode) runs on the person's Mac and never reaches Colony. Only the free AI gateway is counted.",
  "unavailable": []
}
```

Note: `settled` counts answered requests with no fallback hop; `handedToNextModel` counts answered requests that needed a hop. They are disjoint; `settled + handedToNextModel` is every answered request. `gatewayOutcomes` only has data from the day the relay counter shipped (it cannot be backfilled): earlier days report the request, token and cost series from the ledger but contribute `null` to `gatewayOutcomes` (the response then sets `gatewayOutcomes: null` and adds `"gatewayOutcomes"` to `unavailable` when the whole range has no counter rows).

### 2.5 Health

No `days` parameter: every figure is "now", "today" or "last 24 hours" as labelled.

```jsonc
{
  "generatedAt": "...", "dataThrough": "2026-11-01",
  "relay": { "status": "up", "version": "f3841bd3", "startedAt": "...", "uptimePct7d": null },   // uptimePct7d not collected, null
  "connections": { "now": 143 },
  "cofounderWakes": {
    "last24h": { "delivered": 3, "skipped": 14, "pending": 0 },
    "allTime": { "delivered": 3, "skipped": 15, "pending": 0 },
    "byOutcome": [
      { "status": "skipped",   "outcome": "no Scout to wake yet", "count": 14, "lastAt": "..." },
      { "status": "skipped",   "outcome": "co-founder mode is off", "count": 1, "lastAt": "..." },
      { "status": "delivered", "outcome": "", "count": 3, "lastAt": "..." }
    ]
  },
  "agents": { "answerWithin5MinPct": 88.0, "previousPct": 94.0, "businessesNotAnswering": 4 },
  "whatsapp": { "failedToday": 2, "failedLast7d": 9, "failedByCode": [ { "code": "131026", "count": 2 } ] },
  "relayErrors": {
    "last24h": 12,                       // HTTP 5xx responses
    "byRoute": [ { "route": "/api/credits/v1/chat/completions", "errors5xx": 9, "requests": 5400 } ]   // top 10 routes by errors
  },
  "queues": { "cofounderWakesPending": 0, "aiRequestsPending": 1, "aiRequestsStuck": 0, "whatsappQueued": 4 },
  "checks": [
    // one row per line of the Checks card; status "ok" | "warn" | "bad" | "unknown"
    { "key": "database",  "label": "Database",  "status": "ok",      "value": "p95 query 14 ms" },
    { "key": "redis",     "label": "Redis fan-out", "status": "unknown", "value": "not collected" },
    { "key": "whatsapp",  "label": "WhatsApp sends", "status": "warn", "value": "2 failed today" },
    { "key": "discovery", "label": "Discovery provider", "status": "unknown", "value": "not collected" },
    { "key": "agents",    "label": "Agents not answering", "status": "bad", "value": "4 businesses" },
    { "key": "deploy",    "label": "Last deploy", "status": "ok", "value": "relay 1 Nov 23:14" }
  ],
  "desktopVersions": [ { "version": "3.0.31", "people": 120 }, { "version": "3.0.20", "people": 9 } ],   // distinct people on each version in the last 7 days; people with no version are not listed
  "needsAttention": [ /* same items as Overview */ ],
  "unavailable": ["relay.uptimePct7d", "checks.redis", "checks.discovery"]
}
```

Not collected in v1 and therefore `null` or `"unknown"`, not faked: relay uptime percentage, Redis lag, database p95, Discovery provider errors, deploy history beyond the running relay's own start time and version. The UI must show "not collected" for these.

## 3. Collected data (what the numbers come from)

All new tables are deployment-global (not per community), hold counts and ids only, and are created by migration `0061_admin_metrics.sql` (also in `schema/schema.sql`). Production runs it through the normal relay deploy. **A relay deploy is needed** for any of these endpoints and counters to work.

| Table | Grain | Written by |
|---|---|---|
| `metrics_daily_active` | one row per UTC day | rollup job |
| `metrics_community_daily` | per business per day | rollup job |
| `metrics_ai_daily` | per day per business per model | rollup job (from `account_ai_requests`) |
| `metrics_app_sessions_daily` | per person per business per day (sessions, connections, app version) | relay, on every authenticated WebSocket connection |
| `metrics_http_hourly` | per hour per route (requests, 4xx, 5xx) | relay middleware, flushed every minute |
| `metrics_gateway_outcomes_hourly` | per hour per outcome per fallback flag | relay, when a gateway request finishes |
| `relay_operator_read_audit` | one row per metrics read | admin API |
| `account_ai_requests.model / input_tokens / output_tokens` | generated columns from the stored `usage` JSON (so old rows are backfilled by the migration) | database |

Rollup job: runs inside the relay (one pod at a time, Postgres advisory lock). On start it fills any missing days of the last 90 days. Every 15 minutes it recomputes today (partial). Once a day, after 00:10 UTC, it finalises yesterday. All recomputations are idempotent (same input, same rows).

Definitions used by the rollup:

- **Human activity**: an event authored by a pubkey that has a `users` row with `agent_type IS NULL` in that community, of any kind except ephemeral kinds (20000 to 29999, which covers AUTH and presence) and except kind 0.
- **DAU / WAU / MAU**: distinct such pubkeys across all communities in the UTC day / the 7 days ending that day / the 30 days ending that day. Stickiness = DAU / MAU.
- **People**: distinct human pubkeys with a non-deactivated `users` row, created on or before that day.
- **Active business (week)**: at least one human event in the 7 days ending that day.
- **Agent**: `users` row with `agent_type IS NOT NULL`. Active = published an event in the window. Never started = no event ever.
- **Answered within 5 minutes**: an `event_mentions` row naming an agent, for an event by someone else, with a reply by that agent in the same channel at most 5 minutes later. (Same channel, not same thread, in v1.)
- **App session**: authenticated WebSocket connections by one pubkey in one business, where a new session starts when the previous connection was more than 30 minutes earlier.
- **App version**: sent by the desktop in the AUTH event as a tag `["client", "colony-desktop", "<version>"]`. Only versions that include this change report; older apps show no version.

## 4. Rules the relay applies (so the UI does not)

Needs attention items (`key`, severity, rule):

| key | severity | rule |
|---|---|---|
| `cofounder_wakes_skipped` | red | skipped wakes in the last 24 h at least 1, or any skipped wake ever while none delivered |
| `cofounder_wakes_stuck` | red | a pending wake older than 1 hour |
| `agents_not_answering` | red | at least 1 business with a mention that had no agent reply within 5 minutes in the last 24 h |
| `ai_requests_stuck` | red | an AI request pending more than 15 minutes |
| `gateway_refusals` | amber | refused or timed out share of today's gateway requests is 5 percent or more |
| `relay_5xx` | amber | at least 1 server error in the last 24 h (red at 50 or more) |
| `whatsapp_failed` | amber | at least 1 failed WhatsApp send today |
| `old_app_versions` | amber | people (last 7 days) on a version older than the newest version seen by at least 2 people |

Business `health`: `bad` when the business has skipped or stuck co-founder wakes in the last 24 h or an agent with an unanswered mention; `warn` when it has a failed WhatsApp send or gateway refusal in the last 24 h or no human activity in 7 days; otherwise `ok`.

## 5. Not collected in v1 (the UI must say so, not show zero)

- Own-AI usage (Claude Code, Codex, OpenCode): never reaches the server, owner decision 2 Nov.
- Discovery repeats skipped, Discovery provider errors, Redis lag, database p95, uptime percentage, deploy history.
- Gateway outcome history before the counter shipped.
- Desktop version for people on an app older than this change.
