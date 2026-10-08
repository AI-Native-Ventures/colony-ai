# Work area agent browser: design

Status: approved scoped architecture resumed 7 Oct 2026 on `feat/agent-browser`.
Priority: launch work by owner directive, 7 Oct; reputation is already damaged.
Default OFF behind `COLONY_BROWSER_AGENT` until slices 1 through 3 pass and the owner enables it.
Scope of this document: the backend (tab manager, policy, broker, MCP server,
action log). The dock UI and the safety UI are built by other lanes and talk to
this backend through the host events and IPC listed in section 12.

## 1. Goals and non-goals

Goals

- A real browser tab (Electron `WebContentsView`) that a person drives and an
  agent can drive under a revocable, narrow capability.
- One isolated profile per business (and per client inside a business). The
  person does every login and MFA step in the visible tab. Agents never see
  credentials, cookies or storage.
- Best-practice agent browsing: accessibility tree snapshots with stable element
  references, plus screenshots for vision models, bounded text, and a small set
  of typed actions.
- Safe by construction: capability, not trust. Page content is untrusted data
  and can never grant a permission or change policy.

Non-goals (explicit)

- No raw JavaScript evaluation, no raw CDP, no cookie, storage, or credential
  access for agents. The CDP debugger is attached in the Electron main process
  only and is never reachable from the MCP server or the renderer.
- No screen-level "computer use". It is a later layer on the same grant model.
- No claim that per-site grants confine all agent activity. The general shell
  tool can run other network tools. See section 11, residual risk R1.
- No iframe preview. The only browser surface is a `WebContentsView`.

## 2. Existing pieces we build on

- `desktop/electron/browser-host.mjs`: tab lifecycle (`create`, `attach`,
  `detach`, `navigate`, `back`, `forward`, `reload`, `stop`, `close`),
  `controlOwner` as visible state, popup handling, navigation blocking for
  non-http(s) URLs.
- `desktop/electron/browser-session.mjs`: partition per `(businessId,
  clientId)` hashed to `persist:colony-browser-<hash>`, profile registry,
  permission handlers that deny everything, download limits (4 active, 256 MiB).
- `desktop/electron/browser-host-policy.mjs`: URL and bounds validation.
- `desktop/src/shared/api/browserHost.ts`: renderer typings.
- `crates/buzz-acp` builds the MCP server list for each agent session
  (`build_mcp_servers`). Today it emits one server (`buzz-dev-mcp`).

Today `controlOwner` grants nothing. This work gives it teeth.

## 3. Architecture

```
 Renderer (dock UI, other lane)
   |  ipc colony:browser  (existing)  +  colony:browser-broker (new, UI only)
   v
 Electron main
   +-- BrowserHost (existing): tabs, partitions, downloads
   +-- TabManager additions: agent-owned tabs, history, upload registry
   +-- Broker
   |     +-- CapabilityStore   (pure)  grants, epochs, revocation
   |     +-- UrlPolicy         (pure)  scheme / host / IP classification
   |     +-- ActionClassifier  (pure)  consequential action detection
   |     +-- Redactor          (pure)  credential redaction
   |     +-- SnapshotBuilder   (pure)  AX tree -> bounded text with refs
   |     +-- ActionLog         (pure)  bounded ring, redacted
   |     +-- PageDriver (CDP, main process only) implements the tool actions
   |     +-- EgressProxy (per business session while a grant is active)
   |     +-- BrokerServer: unix socket / named pipe, framed JSON
   ^
   |  local channel (0700 dir, 0600 socket) + broker secret + connection token
   |
 colony-browser-mcp (stdio MCP server, Node, no dependencies)
   ^
   |  stdio JSON-RPC (MCP)
 buzz-acp harness  <-- spawns it as a second MCP server only when env-gated
   ^
 Agent
```

Why the broker runs in Electron main: that is where the `WebContents` objects,
the partitions and the visible control state live. The agent process never gets
a handle to them.

Module layout (all under `desktop/electron/browser-broker/`)

| Module | Kind | Responsibility |
| --- | --- | --- |
| `url-policy.mjs` | pure | classify URL and IP addresses, DNS pin, redirect check |
| `capability.mjs` | pure | grants, token hashing, expiry, per-site approvals, revoke, epoch fence |
| `classifier.mjs` | pure | allow, confirm or deny for each action |
| `redaction.mjs` | pure | strip secrets from text, URLs, log records |
| `snapshot.mjs` | pure | accessibility tree to text with stable refs, bounds |
| `action-log.mjs` | pure | bounded redacted log |
| `tool-definitions.mjs` | pure | the 13 tools, JSON schemas, strict input validation |
| `broker-core.mjs` | pure given a driver | tool dispatch, gating order, fencing, confirmation parking |
| `page-driver.mjs` | Electron | CDP driver, the only module that touches `webContents.debugger` |
| `cdp-functions.mjs` | constants | allowlisted CDP methods and the fixed page functions |
| `driver-errors.mjs` | pure | the only driver error codes that reach an agent |
| `egress-proxy.mjs` | node | connect-time resolve and pin, private range denial |
| `broker-server.mjs`, `broker-client.mjs` | node | local socket, auth, framing, reconnect |
| `mcp-server.mjs` | node | stdio MCP, tool list driven by grant state |
| `browser-agent-host.mjs` | node | composition root and the person facing request API |

## 4. Tabs and sessions

- One `WebContentsView` per tab, sandboxed, context isolated, no node, no
  webview tag (already enforced by `BrowserHost`).
- Session partition per business (and client), unchanged. Agent tabs live in the
  same partition as the human tabs of that business so the person's logins carry
  over. Nothing crosses businesses: a grant names exactly one `businessId`, and
  every tab lookup in the broker is filtered by it.
- A grant binds to one primary tab at issue time. The agent may open up to
  `maxExtraTabs` (default 3) more, each bound to the same grant. The agent only
  ever sees tabs bound to its grant. The person's other tabs are invisible to it.
- Popups opened by an agent-controlled tab become new tabs that are NOT
  agent-accessible until the person approves their origin.
- History: `back`, `forward`, `reload` exposed as navigation actions, subject to
  the same origin check on the target entry.
- Downloads: existing limits stay (4 active, 256 MiB). Agents get metadata only
  (name, size, state), never a path. Moving a file into the workspace is a
  person action.
- Uploads: the agent can never supply a path. The person picks a file through a
  native dialog, the host registers an opaque `uploadId` bound to the grant, and
  the agent attaches that `uploadId` to a file input. One use, expires with the
  grant.
- Control state per tab: `human`, `agent`, `agent-awaiting-confirmation`. This
  extends the existing `controlOwner` and is what the dock UI renders.

## 5. How agents reach the browser

1. Electron main starts the broker server on a Unix domain socket in
   `<userData>/browser-broker/` (directory 0700, socket 0600; a named pipe with
   a per-user ACL on Windows). It generates a per-launch 256 bit broker secret.
2. Electron main passes `COLONY_BROWSER_BROKER_SOCKET`,
   `COLONY_BROWSER_BROKER_SECRET` and `COLONY_BROWSER_MCP_COMMAND` (plus
   `COLONY_BROWSER_MCP_ARGS`) in the environment of the native host. The Rust
   runtime already starts `buzz-acp` with an inherited environment.
3. `buzz-acp` `build_mcp_servers` appends a second server, `colony-browser`,
   only when `COLONY_BROWSER_MCP_COMMAND` is non-empty. It forwards the socket
   path, the secret and the agent's public key (derived from `config.keys`, so
   the nsec is never forwarded). With the env absent the function returns
   exactly what it returns today, so existing agents are unchanged.
4. The MCP server connects, sends `hello {agent, secret}`. The broker answers
   with a connection id and the current grant summary for that agent, or "no
   grant".
5. Tools are absent unless a grant exists. `tools/list` returns an empty list
   without an active grant. The broker pushes grant changes over the socket and
   the MCP server emits `notifications/tools/list_changed`. When a grant is
   revoked or expires the tools vanish again and any call in flight fails with
   `grant_revoked`.
6. Every tool call carries the connection's capability token. The broker checks
   token, grant state, expiry, epoch and tab binding on every call, not once per
   session.

Secret hygiene. `buzz-acp` strips every `COLONY_BROWSER_*` variable from the
agent process environment (`AGENT_ENV_REMOVALS` in `acp.rs`) so neither the
agent nor its shell tools can read the broker secret or socket path. They reach
only the browser MCP server, through its own explicit MCP environment. The
agent's secret key is never forwarded; the server identifies the agent by public
key.

Identity note. The agent public key is asserted by the runtime that starts the
MCP server, and the broker secret proves "a Colony launched MCP server", not
"this specific agent". Agents run as the same OS user and are not OS isolated
from each other, so a hostile sibling agent that reads another agent's process
environment could impersonate it. This is residual risk R2. The mitigation is
the owner approved restricted browser-only execution mode (section 11).

Launch of the MCP server: `ELECTRON_RUN_AS_NODE=1` with the app's own
executable and `mcp-server.mjs`, so no separate Node install is required and
the server has no npm dependencies. In development it is `node`. UNPROVEN: that
Electron's node mode loads an ES module from inside `app.asar`. If it does not,
the fix is to `asarUnpack` the `browser-broker` directory or ship the server as
one bundled file next to `colony-native-host`. A packaged run must prove this
before the feature is enabled. The feature ships dark: nothing starts unless
`COLONY_BROWSER_AGENT=1` (later a setting), so there is no extra process per
agent session by default.

## 6. Capability model

A grant is created only by the person, through the host UI (never by an agent,
never by page content). Fields:

| Field | Meaning |
| --- | --- |
| `id` | random id |
| `tokenHash` | SHA-256 of the 256 bit capability token; the raw token exists only in memory of the connection that received it |
| `agentId` | agent public key |
| `taskId` | task or conversation thread the grant is for |
| `businessId`, `clientId` | profile scope |
| `tabIds` | primary tab plus extra tabs opened under the grant |
| `allowedOrigins` | exact `scheme://host:port` strings approved by the person |
| `privateExceptions` | explicit `host:port` the person approved despite private range (default empty, UI must warn) |
| `issuedAt`, `expiresAt` | default 15 minutes, hard cap 60 minutes |
| `epoch` | integer, incremented on revoke, take over, expiry and any narrowing (origin or tab removed); widening (approving an origin) does not fence |
| `state` | `active`, `revoked`, `expired`, `taken-over` |

Rules

- Per-site approval: an origin outside `allowedOrigins` is never navigable by the
  agent. The agent can ask through the tool result ("origin approval needed for
  X"), the UI shows a prompt, the person approves, the origin is added.
- A redirect (HTTP or script) that lands on a new origin pauses the navigation:
  it is cancelled in `will-redirect` / `will-frame-navigate`, the tab stays on
  the last approved URL, and the result is `origin_approval_required`.
- Revocation takes effect mid task. Revoke increments `epoch`, sets `state`, and
  broker-core compares the epoch captured at the start of each action to the
  current epoch at every await boundary and again right before dispatching
  input. Pending actions are rejected with `fenced`, in-flight navigations are
  stopped, and the connection receives a list-changed event.
- Take over by the person is a revoke that also sets control owner to `human`.
- Tokens are never logged, never returned by any tool, and compared by hash.

## 7. Network policy

Default deny for agent navigation and for all requests of a business session
while an agent grant is active:

- Schemes: only `http:` and `https:`. Denied: `file:`, `chrome:`, `devtools:`,
  `data:`, `javascript:`, `blob:` (as top level), `about:` other than
  `about:blank`, `view-source:`, `ftp:`, `ws(s):` as navigation, and anything
  unknown.
- Credentials in URLs (`user:pass@`) denied.
- Hosts: `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan`, single
  label hosts, and numeric host forms (decimal, octal, hex, short form) are
  normalized by the WHATWG URL parser and then classified as IP.
- IPv4 ranges denied: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT),
  `127.0.0.0/8`, `169.254.0.0/16` (link-local and cloud metadata),
  `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`,
  `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`,
  `240.0.0.0/4`, broadcast.
- IPv6 denied: `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `2001:db8::/32`,
  and IPv4-mapped or NAT64 forms whose embedded IPv4 is denied.

DNS rebinding. A check-then-connect pair is racy, so we pin:

1. The policy resolves the host (A and AAAA) and denies if ANY answer is in a
   denied range (a mixed answer is how rebinding attacks hide).
2. While a grant is active on a business session, that session is pointed at a
   local egress proxy (`session.setProxy`). The proxy resolves the target
   itself, classifies the addresses, then connects to the pinned IP literal.
   Chromium never resolves for itself, so a second, different DNS answer cannot
   be used. TLS stays end to end through `CONNECT`.
3. Each redirect hop is rechecked (steps 1 and 2 again plus origin approval).
4. When the last grant on a session ends the proxy is detached and
   `session.closeAllConnections()` drops pooled sockets, so human browsing of
   local dev servers is unaffected outside agent control.

Subresources and frames from other origins load normally (sites need CDNs), but
requests to denied ranges are blocked by the proxy. Agent actions never reach
into cross-origin frames: they appear in the snapshot as an
`iframe [origin]` placeholder unless the origin is approved.

## 8. Agent tool surface

Tools exist only while a grant is active. All results are JSON text blocks with
a stable shape. Tool names are prefixed `browser_`.

| Tool | Input | Notes |
| --- | --- | --- |
| `browser_tabs` | none | tabs bound to the grant: id, url, title, loading, control |
| `browser_open` | `url` | new tab under the grant, origin must be approved |
| `browser_close` | `tab` | only tabs opened under the grant, never the primary tab |
| `browser_navigate` | `tab`, `url` or `back`, `forward`, `reload` | URL policy and origin check |
| `browser_snapshot` | `tab`, optional `maxChars` | accessibility tree with refs (section 9) |
| `browser_screenshot` | `tab`, optional `ref`, `fullPage` | PNG, max 1568 px long edge, max 2 MiB; password and card fields blanked |
| `browser_read` | `tab`, optional `ref`, `maxChars` | visible text, bounded (default 8 000, max 20 000) |
| `browser_click` | `tab`, `ref` | real mouse events at element center |
| `browser_type` | `tab`, `ref`, `text`, `submit?` | refuses credential fields |
| `browser_select` | `tab`, `ref`, `values` | `<select>` and listbox |
| `browser_scroll` | `tab`, `ref?`, `direction`, `amount?` | |
| `browser_wait` | `tab`, one of `text`, `textGone`, `ref`, `url`, `idleMs`; `timeoutMs` | bounded (max 30 s) |
| `browser_upload` | `tab`, `ref`, `uploadId` | only person registered uploads |

Not exposed, by design: evaluate, run script, CDP, cookies, storage, headers,
network interception, clipboard, file system paths, extension install.

Every call returns `{ ok: true, ... }` or `{ ok: false, code, message }` where
`code` is one of `no_grant`, `grant_expired`, `grant_revoked`, `fenced`,
`origin_denied`, `origin_approval_required` (with `origin`),
`private_network_denied`, `scheme_denied`, `dns_failed`, `confirmation_required`
(nobody to ask), `confirmation_denied`, `stale_ref`, `not_found`,
`credential_field`, `secret_in_text`, `use_upload_tool`, `timeout`, `tab_limit`,
`too_large`, `busy`, `invalid_input`, `driver_error`, and the driver codes
`click_intercepted`, `element_not_actionable`, `debugger_detached`,
`tab_crashed` and `cdp_timeout`. Driver errors never carry internal messages or
paths.

All text that came from a page is wrapped:

```
<untrusted-page-content origin="https://example.com" tab="t1">
...page derived text, closing tag neutralized...
</untrusted-page-content>
```

The broker never parses page text for instructions. Nothing in the policy path
reads page text. The tool descriptions tell the agent that this block is data.

### Driver safeguards (`page-driver.mjs`)

- Fixed allowlist of CDP methods (`ALLOWED_CDP_METHODS`). Not present: `Network`,
  `Storage`, `Fetch`, `Target`, `Browser`, `Emulation`, `Runtime.evaluate`,
  `Page.navigate`. Navigation goes through the host adapter so the broker's
  synchronous gate and the egress proxy apply.
- Page functions are constants (`cdp-functions.mjs`) and run through
  `Runtime.callFunctionOn` in an isolated world created per document, so a page
  cannot override the built-ins they use. No agent text is ever concatenated into
  one; the driver refuses any declaration not in the table.
- Clicks are real input events at the element centre. After scrolling into view a
  hit test must confirm the element (or a descendant) is what sits at that point,
  otherwise `click_intercepted` and nothing is sent (defeats overlay tricks). The
  broker fence is checked again immediately before the mouse events.
- Screenshots hide credential and card inputs first and always restore them; if
  hiding fails, no screenshot is taken.
- A page can still lie through structure it controls (R4). Isolating the
  functions protects the facts the classifier reads from tampering, not from
  being truthful about a deceptive page.
- Adapter contract the Electron host must provide (added to `browser-host.mjs`
  later): `getTab`, `webContents`, `createTab`, `closeTab`, `loadUrl`, `history`,
  `stop`, `setControlOwner`, `consumeBlocked`, `onDocumentChanged`,
  `onTabClosed`, `setNavigationGate`. The gate is called from `will-frame-navigate`
  and `will-redirect`; a block is cancelled there, recorded, and surfaced to the
  agent as `origin_approval_required`.
- Egress proxy wiring per business session: `session.setProxy` with
  `proxyBypassRules: "<-loopback>"` (Chromium bypasses proxies for loopback by
  default), then `closeAllConnections()`; reversed when the last grant ends.

## 9. Snapshot format

Source: CDP `Accessibility.getFullAXTree` in the main process, converted by
`snapshot.mjs` (pure, tested on recorded node arrays). Output is line oriented
and compact:

```
page url=https://shop.example/cart title="Cart" generation=3
- heading "Your cart" [level=1]
- list
  - listitem
    - link "Blue kettle" [ref=e4] href=https://shop.example/p/kettle
    - spinbutton "Quantity" [ref=e5] value=1
    - button "Remove" [ref=e6]
- textbox "Promo code" [ref=e7]
- textbox "Password" [ref=e8] value=[redacted] credential
- button "Checkout" [ref=e9] consequential
```

Rules

- Interactive and landmark nodes get refs `e1`, `e2` ... Static text is kept as
  `- text "..."` lines (each capped at 160 chars) except where a named control
  already carries the same text. Bulk reading goes through `browser_read`.
- Stable refs: a ref maps to the CDP `backendDOMNodeId`. The mapping persists
  across snapshots of the same document, so an element keeps its ref when the
  page re-renders around it. A new document (main frame navigation) starts a new
  `generation` and clears the map. Acting on a ref from an older generation or
  for a node that no longer exists returns `stale_ref` with advice to
  re-snapshot. Refs are never reused inside a generation.
- Bounds: depth max 40, max 1 500 nodes, max 30 000 chars, name and value
  truncated to 160 chars each. A truncated snapshot ends with
  `truncated nodes=N omitted=M` so the agent knows to scroll or narrow.
- Values: input values are included only when the DOM attributes prove the field
  is not a credential (`type=password`, autocomplete tokens `cc-*`,
  `one-time-code`, `current-password`, `new-password`, or a credential style
  name). Credential fields and fields whose attributes are unknown print
  `value=[redacted]` (fail closed). Annotations `credential` and `consequential`
  come from the classifier, so the agent knows in advance what will need the
  person.
- Page text is sanitized before it is shown: control, zero width, bidi and Unicode
  tag characters are stripped, whitespace collapsed, quotes escaped, and secret
  shaped strings redacted, so a name cannot break out of its line or smuggle
  hidden instructions.
- Cross-origin frame content is never walked.
- Hidden, `aria-hidden` and `display:none` nodes are skipped.
- Cross-origin frames: one line `iframe origin=https://x.test (not accessible)`.

## 10. Consequential action classifier

Pure function `classifyAction({ action, element, form, page })` returns
`{ decision: "allow" | "confirm" | "deny", reasons: [] }`.

Deny (no confirmation can unlock it)

- typing into a credential field (password, card number, CVC, expiry, OTP,
  `current-password`, `new-password`). The person types those.
- navigation to a denied URL (handled by `url-policy`, same decision shape).

Confirm (explicit person approval for this exact action, once)

- submit or Enter in a form that contains a credential or payment field
- click or submit on elements whose accessible name matches buy, pay, purchase,
  order, checkout, subscribe, donate, confirm payment, transfer, withdraw,
  delete, remove account, close account, cancel subscription, send, post, publish,
  tweet, reply, share, invite, submit application, sign, authorize, grant access,
  allow, connect, install, with a small multilingual list
- form whose action posts to a different origin than the page
- `file` input interactions and any in-page permission or consent dialog
  ("allow notifications", "share your location", OAuth consent)
- `browser_type` with `submit: true` on a form that is otherwise confirm class

Confirmation protocol: broker-core parks the action, sets control state to
`agent-awaiting-confirmation`, emits `confirmation-requested` with a redacted
description (action, element name, origin, a screenshot id). The action only runs
when the host UI calls `confirm(actionId)`; a take over, revoke, expiry, or a
page navigation while parked cancels it. Confirmation is bound to the element
ref, tab, generation and epoch, so a swapped page cannot reuse it.

Browser level permission prompts (camera, geolocation, notifications) stay
denied by the session handlers that already exist. Agents cannot approve them.

## 11. Threat model

| ID | Threat | Control | Test |
| --- | --- | --- | --- |
| T1 | Prompt injection in page text tries to widen policy | policy never reads page text; page text wrapped as untrusted; grants only created by host UI | classifier and policy suites, injection fixtures |
| T2 | Redirect or link to another origin | per hop origin check, cancel in `will-redirect` | redirect fixture |
| T3 | SSRF to localhost, LAN, metadata IP | URL policy, DNS answer check, egress proxy pin | url-policy tests, fixture |
| T4 | DNS rebinding | resolve and pin in proxy, any bad answer denies | pin tests with fake resolver |
| T5 | Credential theft through typing or reading | credential fields denied for type, redacted in snapshot, screenshot, log | redaction and classifier tests |
| T6 | Stale approval reuse | grant bound to agent, task, business, tab, expiry; epoch fence | capability tests |
| T7 | Race between revoke and action | epoch checked at every await and before input | broker-core race tests |
| T8 | Agent reads other business data | every lookup filtered by `businessId`; partition per business | cross business tests |
| T9 | Raw CDP or JS reaches agent | not in the tool list; driver is main process only | tool list snapshot test |
| T10 | Log leaks secrets | redactor on every record, bounded ring | redaction tests |
| T11 | Resource exhaustion | caps on tabs, snapshot size, screenshot size, wait time, log size, queue depth | bounds tests |
| T12 | Local process abuses the socket | 0700 dir, 0600 socket, broker secret, grant needed for any action | server auth tests |

Residual risks (stated, not hidden)

- R1: the general shell tool can run any network tool. Per-site grants protect
  this broker, not all agent activity. A browser-only task needs a restricted
  shell and network environment. This is the owner decision in the audit and is
  not implemented here.
- R2: same user agents are not OS isolated from each other (section 5).
- R3: the person can approve a harmful origin or action. We make approvals
  specific and visible; we do not second guess them.
- R4: a hostile page can lie inside what it renders (fake "Pay" label). The
  classifier works on accessible names and form structure, so a mislabeled
  button can slip through. Confirmation text shows the origin and the
  structure-derived reasons, not only the label.

## 12. Host events and IPC for the UI lanes

Added to `colony:browser-event`: `agent-control` (owner and grant summary),
`confirmation-requested`, `confirmation-resolved`, `origin-approval-requested`,
`grant-changed`, `agent-action` (redacted log line).

New IPC under `colony:browser-broker`, UI windows only (same trusted caller check
as `colony:browser`): `grant-create`, `grant-revoke`, `take-over`, `confirm`,
`deny`, `approve-origin`, `register-upload`, `get-log`.

## 13. Failure modes

| Failure | Behavior |
| --- | --- |
| Renderer crash or hang | tool returns `timeout` or `tab_crashed`; grant stays, person sees error state |
| Tab closed by person | pending actions fenced, tool results `not_found`, grant keeps other tabs |
| Broker socket lost | MCP server drops tools (empty list) and retries with backoff; never retries a mutating action |
| Host restart | all grants are memory only and die with the process; agents see no grant |
| Debugger detach (DevTools opened) | driver marks tab `unavailable`, actions fail closed |
| Proxy crash | session proxy removed and sockets closed; agent actions fail closed with `network_unavailable` |
| Snapshot too large | truncated with explicit marker |
| Clock skew or sleep | expiry uses a monotonic clock plus wall clock check, whichever is earlier |
| Log overflow | oldest records dropped, count of dropped records kept |

## 14. Test and proof plan

Pure unit tests (node `--test`, run in CI and locally on touched files only):
url-policy, capability, classifier, redaction, snapshot, action-log, broker-core
with a fake driver (revoke mid task, confirm gate, fencing), egress proxy with a
fake resolver and in memory sockets, MCP server framing and tool-list gating.

Fixture site suite (real HTTP fixture server, real Electron `WebContentsView`,
real CDP driver): allowed actions pass; cross origin denied; private network
denied; redirect needs approval; revoke mid task; confirmation gate on submit;
untrusted page text cannot change policy; credential fields refused. This needs
Electron and is NOT run locally while the machine rules and the launch hold
apply. It runs in GitHub CI (`electron-e2e` job family) or later through
`heavy.sh` when the coordinator lifts the hold.

What stays unproven until then:

- real Chromium behavior of `page-driver.mjs` and `cdp-functions.mjs` (written to
  the CDP specs, tested only against a fake debugger and by compiling the page
  functions)
- the egress proxy against real TLS sites and Chromium's proxy handling
- `browser-host.mjs` adapter additions and the navigation gate in
  `will-frame-navigate` and `will-redirect` (not written yet)
- MCP interop with each ACP runtime's handling of `tools/list_changed`
- packaged `ELECTRON_RUN_AS_NODE` launch of `mcp-server.mjs` from `app.asar`
- the Rust change in `buzz-acp` (`build_mcp_servers` and `AGENT_ENV_REMOVALS`):
  rustfmt clean, never compiled locally; a pull request or manual CI dispatch is
  needed because plain branch pushes do not run CI

## 15. Slices

1. DONE. This document.
2. DONE. Pure modules with node tests: `url-policy`, `redaction`, `capability`,
   `classifier`, `snapshot`, `action-log`.
3. DONE. `tool-definitions` and `broker-core` against an in-memory fake driver
   (revoke mid task, confirm gate, fencing, untrusted text).
4. DONE. `broker-server`, `broker-client`, `mcp-server`, `browser-agent-host`
   with real socket and real child process protocol tests.
5. DONE, CI UNPROVEN. `buzz-acp` env gated second MCP server and agent env
   stripping (Rust).
6. DONE for node. `egress-proxy` (fake resolver, injected connect) and
   `page-driver` (fake debugger).
7. HELD until the launch gates pass: `browser-host.mjs` adapter and gate,
   `main.mjs` and preload wiring behind `COLONY_BROWSER_AGENT=1`, the
   TypeScript API types for the UI lanes, the Electron fixture site suite
   (allowed actions, cross origin, private network, redirect approval, revoke
   mid task, confirmation gate, injection text, credential fields), the packaged
   MCP launch proof.
8. Owner review of the threat model and a run on one approved public site before
   the feature is enabled for real sites.

## 16. Decisions needing the owner

- D1: tools are absent without a grant (as briefed). Some ACP runtimes ignore
  `tools/list_changed`; there the agent may need a session restart after the
  person grants access. Alternative: one always visible `browser_request_access`
  tool. Recommendation: keep absent, add the request tool only if real runtimes
  need it.
- D2: loopback and private hosts for a person's own dev servers need an explicit
  `privateExceptions` entry with a warning. Recommendation: allow, default off.
- D3: restricted browser-only execution mode (R1) is a separate lane.
