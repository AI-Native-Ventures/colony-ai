# ChatGPT plan P2 local foundation

P2 starts from green P1 commit 2062ffac3. Its PR is held until the coordinator
merges P1 after cutting release 1.0.5. The detailed decision and source evidence
are in the coordinator's requested lane file, P2-DECISION.md.

Use Codex app-server's HTTP Responses provider through an Electron-owned
loopback relay. A child receives a per-agent local capability, never the real
OAuth bearer. P1 owns token rotation and durable recovery. The relay retries
one HTTP 401 before any stream bytes; it never replays a partial stream.

Startup config lives in a private CODEX_HOME. The same provider is supplied in
CODEX_CONFIG and MODEL_PROVIDER for codex-acp's session configuration. Both
requires_openai_auth and supports_websockets are false. HTTP and stream retries
are zero. Initialization must identify Colony, matching the registration hint.

The preview compatibility header comes from the permitted OpenClaw behavior
reference, not the official protocol contract. It defaults on for this preview
and can be omitted with COLONY_CHATGPT_PREVIEW_HEADER=off. It has one policy
location. Real necessity and relay eligibility still need OpenAI's answer.

The install has two inference slots and bounded body, stream, deadline and
capability resources. Each local capability binds community, agent and account.
Remote agents cannot obtain it. Changing the selected account does not reroute
an existing agent. Private thread homes include all three binding values.

Account circuits and visible models are saved atomically in plan-runtime.json,
without credentials or email. Limits stop other agents before upstream calls,
including limits discovered in response.failed after deltas. Availability
failures use bounded backoff. Manual check reopens the selected circuit without
inventing a weekly reset time. Retired accounts lose derived metadata on read;
the durable credential registry makes interrupted cleanup retryable.

Implemented here: OAuth authorization leases, relay, model discovery, circuit
state, SSE validation and launch preparation. These functions are exercised by
focused Node tests against the P1 fake. The feature stays off by default.

Remaining P2 integration gates: Electron boot wiring, local managed-agent launch
projection and attribution, ACP queue/terminal behavior, bundled adapter/Codex
availability, actual adapter tool and resume proof against the fake. Node wiring
does not prove those paths. Rust compilation belongs to CI after PR permission.
P4's installed packaged fake run and the owner's real sign-in plus tool round
trip remain separate gates. No local cargo or real credential handling is used.

Official sources:

- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
- https://learn.chatgpt.com/docs/config-file/config-reference
