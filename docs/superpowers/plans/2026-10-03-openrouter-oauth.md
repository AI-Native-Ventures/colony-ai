# OpenRouter sign-in implementation plan

Goal: implement the owner's approved one-click OpenRouter connection in onboarding and Settings.

Architecture: Electron main owns a short-lived IPv4 loopback listener, random state, S256 PKCE, HTTPS exchange and provider reads. Save through the existing native global agent configuration command, returning only public account/model metadata. A shared panel uses the frozen onboarding classes and invalidates shared defaults after saves.

Acceptance gates:
- Production-bound node tests cover the RFC PKCE vector, state mismatch, duplicate/replayed callbacks, cancellation, expiry, exchange parsing, model selection, and atomic defaults persistence.
- Quick desktop typecheck, touched-file Biome and text-token guard pass. No local Rust compilation or native application launch.
- Mock-bridge Playwright covers unlinked, connected, exhausted and error states in smoke and integration. Capture reference and app at 1728x1117 and 1440x900; inspect and attach with honest verdicts.
- Signed commit, rebase against origin/develop, draft PR, then green GitHub checks. Coordinator owns merge and deployment.

Files: new electron/openrouter-oauth.mjs and tests; minimal app-window dispatch; shared API and shared OpenRouter panel; ConnectSetupStep tab replacement; Settings defaults entry; focused mock-bridge spec and project registration.

Sequence:
- [ ] Read native transport, previous OAuth implementation, provider persistence, frozen references and current provider API documentation.
- [ ] Add failing production-seam tests, implement native flow and exercise faults.
- [ ] Bind shared UI and defaults; add UI tests in the same commit.
- [ ] Run quick checks, rebase, push draft, capture/inspect proof.
- [ ] Resolve caused CI failures and report proof boundaries.

Unknown balances and quotas stay unknown. A metadata/save success does not prove an agent reply. Tauri-shell parity and an actual authenticated OpenRouter browser consent are separate from Electron mock/native-module proof.
