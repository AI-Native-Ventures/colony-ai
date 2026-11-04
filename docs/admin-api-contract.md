# Operator admin API contract (AD-DATA to AD-UI)

Status: draft 1, 2 Nov 2026. Owner: AD-DATA. Consumer: AD-UI (`admin-web`).
Design: `docs/superpowers/specs/2026-11-02-operator-admin-design.md` (branch `docs/outreach-lists-admin`). Boards: canvas page "Admin".

This contract is the source of truth for field names. If the UI needs something that is not here, ask AD-DATA to add it; do not read it from another endpoint.

## 1. Rules for every endpoint

- Base: the existing deployment admin API, `/api/admin/v1`, served on the operator-only admin host (same host and same NIP-98 login the Reports and Feedback pages already use). New routes live under `/api/admin/v1/metrics/`.
- Method: `GET` only. No mutations in v1.
- Auth: either the Colony sign-in session cookie (section 1a) or a NIP-98 signed request exactly as the existing routes (`Authorization: Nostr <base64 event>`, bound to the full path and query). The principal must be a **relay operator** (`probe` returns `role: "operator"`).
  - Not signed or bad signature: `401` (existing admin error body).
  - Signed by a moderator, or by a key that is not on the roster: `403`.
  - Admin auth mode `disabled` (local dev): `403` for every metrics route. There is no anonymous read of metrics.
- Audit: every successful read writes one row to `relay_operator_read_audit` (actor key, path, time). No query string values or response data are stored.
- Privacy: counts, ids, timestamps and fixed progress enums only. No message text, no WhatsApp text, no lead data, no customer names. People appear as shortened keys (`pubkeyShort`, first 8 hex) and a business shows by its name and host (operators already see these). A relay test greps every response for event content.
- Errors: same shape as the existing admin API: `{"error": {"code": "...", "message": "...", "requestId": "..."}}`. Codes used here: `invalid_days`, `invalid_sort`, `invalid_limit`, `invalid_offset`, `invalid_query`, `not_found`, `forbidden`. An unknown query parameter is `400`.
- Caching: `Cache-Control: no-store` (existing admin middleware). Every number comes from a precomputed table, never from a live scan of `events`.
- Dates: `day` is a UTC date `YYYY-MM-DD`; timestamps are RFC 3339 UTC. The UI formats to SAST. Money is a USD decimal **string** (`"12.340000"`, 6 places) so nothing rounds in transit. Token and request counts are JSON numbers (safe integers).
- Range: `days` query parameter, one of `7`, `30`, `90`; default `30`; anything else is `400 invalid_days`.
- Freshness: every response carries `generatedAt` and `dataThrough`. `dataThrough` is the newest day whose rollup is complete (yesterday UTC once the nightly job has run). Today's numbers are refreshed every 15 minutes and are marked `partial: true` in series rows.
- Nulls: a number the relay does not collect is `null`, never `0`, and is named in the response's `unavailable` array so the UI can show "not collected" instead of a fake zero.

## 1a. Address and sign-in (owner decision, 2 Nov 2026)

**Address:** `https://admin.colony.global`. `deploy/fly/fly.prod.toml` now sets `BUZZ_ADMIN_HOST = "admin.colony.global"` and `RELAY_OPERATOR_API_ORIGIN = "https://admin.colony.global"` (was `admin.colony.ainative.ventures`). The admin bundle (`admin-web`) is already in the production image (`BUZZ_ADMIN_WEB_DIR=/srv/buzz/admin-web`, Dockerfile) and is served by the relay itself on that exact host. Canary keeps `admin-canary.colony.ainative.ventures`.

**Why the old host "returns 404":** it is by design for non-browser requests. The relay answers the admin host with the web page only when the request says `Accept: text/html`; anything else (curl's default `Accept: */*`, API probes without a signature) gets 404 so the relay protocol is not exposed there. Checked 2 Nov: `curl -H 'Accept: text/html' https://admin.colony.ainative.ventures/` returns 200, plain `curl` returns 404. So the old host was reachable; it was just unused. The new host `admin.colony.global` has **no DNS record yet**, so it cannot work until the coordinator steps below are done.

**Client routes the relay serves on the admin host** (index page, client-side routing): `/`, `/overview`, `/businesses`, `/businesses/{id}`, `/ai-usage`, `/system` (Health), `/sign-in`, `/reports`, `/feedback`. (`/health` is taken by the relay's own health route, so the Health board lives at `/system`.) Everything else on that host is 404.

**Sign in with your Colony account** (the same Google sign-in Colony accounts use, server custody; no shared passwords or tokens):

1. The page sends the browser to Google's OpenID Connect endpoint: `https://accounts.google.com/o/oauth2/v2/auth?client_id=<admin web client id>&redirect_uri=https://admin.colony.global/sign-in&response_type=id_token&scope=openid%20email&nonce=<random 32+ chars>&prompt=select_account`. The nonce is generated in the browser and kept in `sessionStorage`. (The page's content security policy is `script-src 'self'`, so no Google script is loaded; this is a plain redirect.)
2. Google returns to `/sign-in#id_token=...`. The page reads the fragment, removes it from the address bar, and posts it.
3. `POST /api/admin/v1/session/google` with `Content-Type: application/json`, body `{"idToken": "...", "nonce": "..."}`, sent from the admin page (the request must carry `Origin: https://admin.colony.global`).
   - The relay verifies the token exactly as account sign-in does (signature, issuer, expiry, `email_verified`, audience in `COLONY_GOOGLE_CLIENT_IDS`), and that the token's `nonce` equals the posted one.
   - It looks up the existing Colony account for the verified email (it never creates or links an account) and checks that the **account's public key is listed in `RELAY_OPERATOR_PUBKEYS`**.
   - `200 {"status":"ok","pubkeyShort":"ab12cd34","expiresInSeconds":28800}` plus `Set-Cookie: __Host-colony_admin=...; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`. The cookie is a signed token (HMAC keyed from the deployment account key); removing the key from `RELAY_OPERATOR_PUBKEYS` ends its sessions at once.
   - `401 unauthorized` for a bad token or nonce; `403 forbidden` for "no such account" and "not an operator" alike (one answer, so the page cannot be used to learn who has an account); `403` also when Colony sign-in is not configured.
4. Every later admin request is authenticated by the cookie, no `Authorization` header. The existing `GET /api/admin/v1/probe` returns `role: "operator"`, `source: "config"`; the UI uses it to decide between "signed in" and "show sign-in".
5. Writes (report and feedback actions) with the cookie must also send the header `X-Colony-Admin: 1`; without it they are `403`. Reads (GET) do not need it.
6. `POST /api/admin/v1/session/logout` (with `X-Colony-Admin: 1`) clears the cookie.

**NIP-98 stays** as the operator fallback (a request with an `Authorization: Nostr ...` header ignores the cookie). The metrics boards accept either. Moderators (DB roster) keep NIP-98 only; the cookie sign-in is for keys in `RELAY_OPERATOR_PUBKEYS`.

**Coordinator steps (not done by AD-DATA, nothing was run against Fly or DNS):**

1. DNS, Cloudflare zone `colony.global`: add `CNAME admin -> colony-relay.fly.dev`, DNS only (grey cloud), the same shape as `admin.colony.ainative.ventures` today.
2. Fly certificate: `fly certs add admin.colony.global -a colony-relay`, then `fly certs show admin.colony.global -a colony-relay` until it says issued. (If Fly asks for the `_acme-challenge` CNAME, add what it prints.)
3. Google Cloud console (project that owns the existing Colony Google client ids): create an OAuth client of type **Web application**, authorized redirect URI `https://admin.colony.global/sign-in`, authorized JavaScript origin `https://admin.colony.global`. Append its client id to the Fly secret `COLONY_GOOGLE_CLIENT_IDS` (comma-separated, keep the existing ids). It is an identifier, not a credential; no client secret is used.
4. Confirm Fly secrets on `colony-relay`: `RELAY_OPERATOR_PUBKEYS` contains the owner's **Colony account public key** (the `accounts.pubkey` for the owner's Google email, hex), and `COLONY_ACCOUNT_KEK` is set (it is, accounts work today).
5. Deploy the relay (this PR's code, the `fly.prod.toml` change and migration 0062 go out together). After that `admin.colony.ainative.ventures` stops being the admin host.
6. Tell AD-UI the Google web client id so the page can build the redirect URL (it is public; v1 puts it in the admin bundle as a build-time constant).

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
      "name": "Horizon Labs",             // name of the business channel; falls back to host when there is none
      "host": "horizonlabs.colony.global",
      "ownerName": "Basheer Phiri",       // owner display name, null when unknown
      "createdAt": "2026-10-03T08:00:00Z",
      "archived": false,
      "people": 4, "agents": 3,
      "activeDaysLast7": 7,
      "aiRequests": 9200,                 // in range
      "aiChargedUsd": "0.000000",
      "discoveryResultsThisMonth": 500, "discoveryCap": 2000,   // cap from relay config (default 2000 per business per month)
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
      "status": "offline",                // "running" | "idle" | "offline" (running: published in the last 30 min, idle: in the last 7 days, offline: older or never; resolution is the 15 minute refresh)
      "lastEventAt": "...",               // null when it never published
      "offlineHours": 10,                 // whole hours since lastEventAt, null when never or status != offline
      "answerRatePct": 100.0,             // answered within 5 min, in range; null when no mentions
      "avgAnswerSeconds": 60              // mean seconds to answer, over answers inside 5 minutes; null when none. (Mean, not median: daily rollups cannot be merged into a median.)
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
    "onboarding": {                                   // null when onboarding has not started
      "status": "in_progress", "currentStep": "money", "currentStepState": "asked",
      "steps": [
        { "step": "brief", "state": "done" }, { "step": "money", "state": "asked" },
        { "step": "approvals", "state": "todo" }, { "step": "accounts", "state": "todo" },
        { "step": "map", "state": "todo" }
      ]
    },                                                 // progress enums only; no question, account, map or pubkey data
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
  "topBusinesses": [ { "communityId": "uuid", "name": "Horizon Labs", "requests": 9200 } ],   // top 10 by requests
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
  "connections": { "now": 143, "scope": "this_relay_instance" },   // WebSocket connections on the relay instance that answered; with several instances it is that one's count
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

All new tables are deployment-global (not per community), hold counts and ids only, and are created by migration `0062_admin_metrics.sql` (also in `schema/schema.sql`). Production runs it through the normal relay deploy. **A relay deploy is needed** for any of these endpoints and counters to work.

| Table | Grain | Written by |
|---|---|---|
| `metrics_daily_active` | one row per UTC day (DAU, WAU, MAU, people, businesses, agents; `is_final`) | rollup job |
| `metrics_person_daily` | per human per business per day (count of events, last event time) | rollup job |
| `metrics_agent_daily` | per agent per day (events, mentions, answered within 5 min, answer seconds) | rollup job |
| `metrics_ai_daily` | per day per business per model (requests, outcomes, tokens, charge) | rollup job, from `account_ai_requests` |
| `metrics_app_sessions_daily` | per person per business per day (sessions, connections, app version) | relay, on every authenticated WebSocket connection |
| `metrics_http_hourly` | per hour per route template (requests, 4xx, 5xx) | relay middleware, flushed every minute |
| `metrics_gateway_outcomes_hourly` | per hour per outcome per fallback flag | relay, when a gateway request finishes |
| `relay_operator_read_audit` | one row per metrics read (actor, route, time) | admin API |
| `account_ai_requests.model / input_tokens / output_tokens` | generated columns from the stored `usage` JSON, so old rows are backfilled by the migration itself | database |

Rollup job: runs inside the relay (one pod at a time, Postgres advisory lock). On start it fills any missing days of the last 120 days, giving the earliest point in the 90-day admin range its full 30-day MAU context. Every 15 minutes it recomputes today (partial). Once a day, after 00:10 UTC, it finalises yesterday. All recomputations are idempotent (same input, same rows).

Definitions used by the rollup:

- **Human**: a `users` row with no `agent_type` and no `agent_owner_pubkey`. **Agent**: a `users` row with either set, except `agent_type = 'worker'` (hidden workers are not counted).
- **Human activity**: an undeleted event authored by a human, of any kind except ephemeral kinds (20000 to 29999, which covers AUTH and presence) and except kind 0.
- **DAU / WAU / MAU**: distinct such pubkeys across all communities in the UTC day / the 7 days ending that day / the 30 days ending that day. Stickiness = DAU / MAU.
- **People**: distinct human pubkeys with a non-deactivated `users` row, created on or before that day.
- **Active business (week)**: at least one human event in the 7 days ending that day.
- **Agent active** = published an event in the window. **Never started** = no event in the retained rollup history.
- **Answered within 5 minutes**: an `event_mentions` row naming an agent, for an event by someone else, with a reply by that agent in the same channel at most 5 minutes later. (Same channel, not same thread, in v1.) A mention only counts once it has had its 5 minutes, so a partial day never shows a mention as unanswered that simply has not had time.
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
| `gateway_refusals` | amber | refused or timed out share of today's gateway requests is 5 percent or more, with at least 20 requests today |
| `relay_5xx` | amber | at least 1 server error in the last 24 h (red at 50 or more) |
| `whatsapp_failed` | amber | at least 1 failed WhatsApp send today |
| `old_app_versions` | amber | people (last 7 days) on a version older than the newest version seen by at least 2 people |

Business `health`: `bad` when the business has skipped or stuck co-founder wakes in the last 24 h or an agent with an unanswered mention; `warn` when it has a failed WhatsApp send or gateway refusal in the last 24 h or no human activity in 7 days; otherwise `ok`.

## 5. Not collected in v1 (the UI must say so, not show zero)

- Own-AI usage (Claude Code, Codex, OpenCode): never reaches the server, owner decision 2 Nov.
- Discovery repeats skipped, Discovery provider errors, Redis lag, database p95, uptime percentage, deploy history.
- Gateway outcome history before the counter shipped.
- Desktop version for people on an app older than this change.
