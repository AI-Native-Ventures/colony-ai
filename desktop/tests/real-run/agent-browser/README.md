# Packaged agent browser gate

The driver and fixtures are preparation, not packaged observations. Each row
needs a new app process and a fresh grant. All rows start NOT OBSERVED.

`prepareGateRun` creates a 0700 temporary HOME, bounded literal-loopback fixture
and FAKE provider, a 0600 marker, and a nonce matched by
COLONY_BROWSER_PACKAGED_GATE. The production Electron host reads both opt-ins
before accepting one exact managed agent/task/community/business/client and
fixture origin. The marker expires within ten minutes. Other origins, private
ports, renderer-supplied exceptions and subsequent grants remain refused. The
seam never approves a task or supplies a browser credential. Origin widening is
refused while the gate is active, including a different scheme at the same port.

The coordinator must create the managed agent/task in an isolated test relay,
then pass its trusted identity in `task` (agentId, taskId, communityOrigin,
businessId, clientId). Use the returned agentEnvironment for that agent through
the genuine creation/launch path. Only model colony-browser-fake at the returned
local provider is allowed. The source environment is scrubbed of credentials.
The FAKE plan must select current tab/ref values from actual tool messages.

Launch the candidate using the returned environment, a sandbox that denies the
owner HOME and all keychains, and the profile under the returned HOME. Use the
existing real-run safety guards, never freshHomeSandboxPolicy's historical
unsandboxed security exception. Pin artifact SHA256 and source head. Do not run
without successful isolation probes. No app is launched by prepareGateRun.

Navigate the actual packaged UI to the matching thread and fixture browser tab.
Call `drivePackagedRow` with its Playwright page, `run`, verified `provenance`,
and a relay-backed `managed` adapter. `sendTask` posts a real person message;
`observe` waits at most timeoutMs for actual scoped MCP results, redacted log,
and control/grant transitions. The driver clicks normal visible approval,
confirmation, rejection, takeover and Stop controls and independently counts
fixture side effects. Refusal includes a distinct forbidden port and redirect.
The adapter must observe stale confirmation refusal as well as a subsequent
managed browser attempt after Stop/takeover. For that negative phase, a FAKE
plan step may set allowStaleTool: true for a previously advertised browser
connect/snapshot tool. This only asks the real agent to attempt the stale call;
the real runtime or broker must refuse it. Arbitrary or never-advertised tools
remain refused by the FAKE responder. Missing prerequisites return BLOCKED.
Always call run.close() after terminating the app and its process tree.

Upload requires the immutable upload slice in the candidate and the real native
picker. Its manual collection contract remains in rows.mjs. Source and Node
checks do not establish packaged runtime, managed session or real-provider proof.
Never retain raw provider messages, credentials, cookie values or owner data.
