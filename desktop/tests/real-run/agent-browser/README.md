# Prepared packaged agent browser rows

PREPARED ONLY. No packaged app, fixture site, FAKE provider or agent was run.
The coordinator runs the artifact after PR 267 package jobs finish. PR 266 stays
closed until the coordinator releases the hold. No new PR or push for this preparation.

`rows.mjs` defines approve, deny, takeover, Stop, upload and private URL refusal,
with an evidence judge that starts every row NOT OBSERVED and blocks missing
prerequisites. `environment.mjs` prepares a flag-on child environment and FAKE-only
managed-agent configuration. `fake-model.mjs` prepares deterministic OpenAI-compatible
responses for the real agent loop. `fixtures.mjs` prepares bounded site, forbidden
listener and provider servers; only its explicit `start()` method binds them to
127.0.0.1. No listener starts on import or preparation.

## Prerequisites for the coordinator's future run

1. Pin candidate version, app.asar/native host SHA256 and source head. Use the
   actual packaged app and production preload/native host/ACP launch path.
2. Create a fresh 0700 HOME outside the real HOME, with a user-data directory and
   synthetic upload/download files under it. Use the existing `safety.mjs` keychain-deny
   process sandbox, extended with `fresh-home.mjs` real-home deny paths. Do not use
   `freshHomeSandboxPolicy` unchanged: it permits unsandboxed `/usr/bin/security`
   for older Claude proof. FAKE-only runs need no such exception. Stop on a permission dialog.
3. Bind the fixture site, isolated test relay and FAKE model responder only to
   literal `127.0.0.1`, each on an ephemeral port. The test relay must create the
   genuine managed agent/session/task; do not seed renderer state or use a direct
   broker client as a substitute. The provider must accept only bounded planned
   requests for model `colony-browser-fake` and must never forward traffic.
4. Set `COLONY_BROWSER_AGENT=1` only in that app's child environment. Apply the
   prepared `agentEnvironment` to that throwaway managed agent via the genuine
   agent creation/launch path. Keep provider selection explicit so inherited
   Claude, ChatGPT, DeepSeek, OpenRouter or other credentials cannot be used.
5. Resolve the loopback prerequisite explicitly. Production agent grants refuse
   private destinations; `main.mjs` supplies no fixture exceptions. The source
   Electron fixture injects an exact loopback exception, which is absent from the
   package. These prepared rows add no runtime bypass. Until an approved artifact
   fixture-containment mechanism exists, report BLOCKED for loopback approvals.
   Do not mistake the deliberate refusal for a successful approved-flow run.
6. The immutable upload row needs PR 266's bytes in the artifact. PR 267 currently
   includes the runtime and UI, but excludes that closed slice. Record that row
   BLOCKED for slice adoption if running 267 unchanged.

## Collection contract

For each row use a fresh grant and counter baseline. Drive the visible person
controls, including the actual native picker for upload. Let the real FAKE-provider
agent call the narrow production MCP tools with current snapshot refs. Take screenshots
after animations finish. Record artifact provenance, managed session/task match,
scoped MCP launch adoption, controller/grant transitions, redacted action results,
and fixture side-effect counts. Upload records byte digests, never body contents.
Stop/takeover need proof that a stale confirmation and a subsequent agent action
both fail. Private URL refusal needs zero requests at an independently counted
forbidden loopback listener, plus explicit RFC1918 and file URL rejection.

Do not save wire frames, request headers, passwords, cookies, master/derived browser
credentials, raw provider messages, or owner paths. Store reports outside the repo.
A prepared response plan or passing harness unit test is not an observed row.
A managed FAKE-provider run proves protocol and tools, not real model quality.
