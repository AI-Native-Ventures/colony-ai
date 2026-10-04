Colony 1.0.4b lane 2, 4 October 2026

Implemented: readiness waits for the saved native configuration and runtime catalog instead of evaluating placeholder defaults. Completed real connection turns produce short-lived runtime readiness evidence independent of discovery cache refresh, bound to the tested configuration and transport credentials. Failed config/catalog/receipt reads retain an explicit Retry path rather than posting the connect notice. Native CLI auth probes now have a 10 second bound.

Implemented: the test prompt includes the entered business profile and asks Scout for its first introduction. Its actual reply is stored for that business and configuration, then posted once in private Welcome before awaiting managed startup. Failed startup can retry without duplicating the intro. Scout receives all three business facts as standing harness context, including on reconciliation of an existing starter. The managed starter uses one worker instead of ten. Legacy built-in persona display metadata becomes Scout while custom names stay intact. Exported onboardingConnectionTest types remain compatible; timing fields and the business-aware wrapper are additive.

Observed owner runtime evidence, read-only existing records and timestamp metadata:
- Connection test user turn: 06:42:02.421 UTC. First assistant event: 06:42:05.393 UTC. Difference: 2.972 seconds.
- Scout created: 06:42:37.339544 UTC. Managed start timestamp: 06:44:43.325758 UTC. Difference: 125.986 seconds.
- Harness start: 06:44:43.347056 UTC. All ten workers initialized by 06:44:45.554289 UTC, 2.207 seconds. Relay connected at 06:44:46.548539 UTC, 3.201 seconds after harness start.
- Later managed conversation user event: 06:48:41.572 UTC. First assistant event: 06:48:45.737 UTC. Difference: 4.165 seconds. This is a later conversation, not proof of the intro's first-token time.

These measurements do not establish that personal plugins, MCP servers or hooks caused the delay. No lean mode, isolation, sign-in change or Claude configuration directory change was added. Owner's normal Claude setup remains in use.

The exact allocation of the 126 second pre-start interval is NOT proven. Native summary readiness previously reran an unbounded CLI login command, including after process startup; this is a plausible contributor, not a measured attribution. New numeric timings cover record resolution, mesh preflight, launch configuration, launch setup, harness spawn, ACP initialize, session creation and first assistant token. No prompt, credentials or business content is added to timing logs.

Important limitation: task (b) is PARTIAL. The actual intro reply is reused, removing a second generated intro turn and making delivery independent of managed startup. The probe still shuts down its ACP client; the live process/session is NOT handed off. Managed operation still starts another process. Do not call this warm-session reuse or claim the second cold start is removed. Completing a live native ACP session handoff remains required work.

Closest local runtime evidence: real Electron main/preload/renderer with a throwaway user-data directory, a non-native stdio fixture, and the mock IPC bridge. It made no native keychain access. Open to intro measured 614 ms initially and 755 ms on the later capture, while managed startup was delayed 15 seconds. A temporary uncommitted updater import shim was necessary because the development shell's named electron-updater import fails under Electron 44. The packaged shell uses a different updater module. This is renderer evidence, NOT a real Claude test of the changed Rust implementation.

Screens inspected: Testing and Connected references served locally, and Electron Testing, Connected and private Welcome at 1728x1117 and 1440x900. Artifacts: /tmp/colony-104b-runtime-proof/. PNG SHA-256 values are distinct. Testing: CLOSE, reference marks connection saved before the real proof while production correctly leaves save pending; reference review chrome changes available geometry. Connected: CLOSE, real reply and negotiated raw model identifier differ from the reference's fixture text/model name; geometry excludes reference chrome. Welcome: functional screen inspected, design parity NOT CHECKED against an equivalent frozen empty Welcome state. Existing mock channels include legacy fixture names. The Scout persona badge itself no longer displays the legacy name.

Local checks: 102 focused node tests passed, including the production React Query hook; TypeScript and E2E build passed; Biome and px-text passed; Rust formatting passed. The broad two-project run had 267 passes, four pre-existing skips and one Agent Defaults save-retry failure. That failure passed when rerun in both projects. A subsequent full first-reply-runtime run had 48 passes and four pre-existing skips. The final delayed-config/catalog, stale-auth and startup-retry gates passed all six cases across smoke and integration. The later Electron repeat passed its Welcome assertions with 3697 ms Open-to-intro, then timed out during the subsequent capture/reference work and teardown under contention; the earlier complete Electron run passed. Do not report the entire later repeat as green. A repeat broad run was stopped because local resource contention made it exceed the remaining time box. Rust was formatted only and must be compiled/tested by integration CI. No packaged app or changed real-provider run is claimed. No production data was modified. No PR, merge or deployment is authorized for this lane.

Changed files:
- crates/buzz-acp/src/acp.rs
- crates/buzz-acp/src/acp/connection_reply_tests.rs
- crates/buzz-acp/src/business_context.rs
- crates/buzz-acp/src/config.rs
- crates/buzz-acp/src/connection_test.rs
- crates/buzz-acp/src/lib.rs
- desktop/src-tauri/src/commands/agents.rs
- desktop/src-tauri/src/commands/global_agent_config.rs
- desktop/src-tauri/src/commands/test_onboarding_connection.rs
- desktop/src-tauri/src/managed_agents/discovery.rs
- desktop/src-tauri/src/managed_agents/discovery/auth_status_cache.rs
- desktop/src-tauri/src/managed_agents/mod.rs
- desktop/src-tauri/src/managed_agents/readiness.rs
- desktop/src-tauri/src/managed_agents/readiness/cli_probe.rs
- desktop/src-tauri/src/managed_agents/runtime.rs
- desktop/src-tauri/src/managed_agents/verified_connection.rs
- desktop/src/features/agents/useGlobalAgentConfig.test.mjs
- desktop/src/features/agents/useGlobalAgentConfig.ts
- desktop/src/features/onboarding/ui/ConnectSetupStep.tsx
- desktop/src/features/onboarding/ui/agentReadiness.test.mjs
- desktop/src/features/onboarding/ui/agentReadiness.ts
- desktop/src/features/onboarding/ui/onboardingConnectionTest.ts
- desktop/src/features/onboarding/welcomeConnection.test.mjs
- desktop/src/features/onboarding/welcomeConnection.ts
- desktop/src/features/onboarding/welcomeGuide.test.mjs
- desktop/src/features/onboarding/welcomeGuide.ts
- desktop/src/features/onboarding/welcomeKickoff.ts
- desktop/src/shared/api/tauriPersonas.test.mjs
- desktop/src/shared/api/tauriPersonas.ts
- desktop/tests/e2e/first-reply-runtime.spec.ts
- docs/first-run-runtime-104b.md
