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
picker. Source and Node checks do not establish packaged runtime, managed
session or real-provider proof.
Never retain raw provider messages, credentials, cookie values or owner data.

For 1.0.7, preparation leaves COLONY_BROWSER_AGENT absent even if the parent
shell set it. The driver derives defaultFlagUnset from that launch environment;
observe flagOn in the actual candidate. Explicit 1 does not prove the default.
COLONY_BROWSER_AGENT=0 is still the release kill switch. Both gate-only opt-ins
remain required. Use a candidate containing PR 280, PR 282 and the final default
change, and record its exact artifact digest and source head.

Upload and download now run through drivePackagedRow as well. Set
immutableUploadSliceInArtifact or confirmedDownloadSliceInArtifact only after
checking candidate provenance. Upload additionally takes nativePicker with
selectFile({path, timeoutMs}), which must wait for and operate the real OS file
picker and return {selected: true}. Do not stub the dialog, seed upload state,
attach a path through CDP or invoke the broker directly. The driver creates
only a synthetic file under run.home and clicks Choose a file for this task.

The managed adapter's observe({row, phase, timeoutMs}) contract for transfers:

| Row | Phase | Actual observations required |
| --- | --- | --- |
| upload | chosen | uploadId from the successful UI-initiated agent-choose-upload IPC reply |
| upload | rejected | toolRefused and uploadRejectedWithoutEffect, including an empty native fixture file input |
| upload | attached | toolSucceeded for the fresh browser_upload call |
| upload | submitted | toolSucceeded and fixture completion after the separately confirmed Send file click |
| download | rejected | toolRefused for browser_download |
| download | saved-1, saved-2 | toolSucceeded for each fresh confirmed browser_download |
| download | redirect-refused | toolRefused and redirectRefused for the confirmed private redirect link |
| both | stopped | grantTerminated after visible Stop and settled cleanup |

Observe records are measurements from the running managed session. Missing
observations must time out or return false, never manufacture success. Every
phase must also report unexpectedExternalRequests or credentialExposure if
observed; a later clean phase cannot erase a previous failure. Keep only
redacted evidence. The FAKE plan uses advertised tools and fresh tab/ref values
from actual prior tool messages. For upload the opaque uploadId may be selected
from the chosen observation, which the driver includes in the real person
message. No local filesystem path goes into the agent prompt. Each rejection
ends that managed turn; the next real message starts the fresh attempt.

The download fixture requires its HttpOnly cookie, set when the person opens
the fixture page. It supplies Download report and Download private redirect
links. The driver seeds a collision in the throwaway Downloads, rejects once,
confirms twice, compares both saved digests, confirms the private redirect
refusal, then checks collision preservation and saved-file survival after Stop.
Upload replaces its original after attachment and compares the server's digest
against the bytes approved before picking. Both rows inspect only the returned
HOME/profile and demand empty browser-agent-uploads/payloads and records. Do
not point the app's Downloads path outside the throwaway HOME. Failure to find
these actual directories is a failed observation, not an empty cleanup result.

Focused Node harness tests exercise orchestration using doubles and synthetic
files. They do not establish packaged, native picker or managed-runtime proof.
The coordinator must run all seven rows on the real candidate before merging
the final default-on PR. Transfer cancellation while in flight remains separate
runtime evidence from the completed-transfer Stop cleanup collected here.
