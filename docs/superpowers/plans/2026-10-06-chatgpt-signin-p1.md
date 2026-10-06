# ChatGPT plan P1 implementation plan

**Goal:** Implement a clean-room, default-off Electron OAuth client and a local
fake OpenAI server. No UI, agent integration, release promotion, or merge.

**Architecture:** Electron main owns credentials, listeners and renewal. Node
built-ins implement PKCE, RS256 validation and atomic owner-only storage. A
single protected registry snapshot makes account selection, credential rotation
and pending revocation atomic. An exclusive installation lock serializes all
writers across processes. This is stronger serialization than per-account locks.

**Authority:** The owner's 6 October build instruction authorizes P1 despite the
addendum's earlier wait recommendation. Public OpenAI protocol documentation is
the implementation authority. No devkit files, packages or assets may be read.

Acceptance gate: focused Node fault tests pass, touched-file Biome and TypeScript
checks pass, and every P1 PR check is success or skipped. CI proves automated
behavior only. Real consent, eligibility and inference remain owner-only proof.

- [x] Add protocol policy, bounded HTTP, RS256 validation and callback modules.
  Tests exercise production functions against a local RSA/JWKS fake, including
  wrong issuer, audience, signature, nonce, state, callback path and clock skew.
- [x] Add owner-only durable storage and OAuth lifecycle. Use temporary files,
  file sync, rename and directory sync. Journal refresh before the remote call;
  an interrupted rotation becomes durable needs-sign-in on restart. Keep remote
  revoke material in pending records until successful revocation.
- [x] Add single-flight renewal, generation fencing, bounded retries and wake
  scheduling. Tests cover concurrent processes, interrupted rotation, stale
  results, terminal errors, earliest refresh time and exhausted retries.
- [x] Add the dependency-free fake authorize/token/JWKS/models/SSE server. Only
  explicit test builds may use the two loopback origin overrides. Production
  ignores overrides. Fake request records contain no token values or URLs.
- [x] Add main-process IPC dispatch and typed renderer wrapper. Disabled mode
  must neither initialize storage nor open a listener or browser. All results
  are explicit non-secret metadata projections.
- [x] Add CLEAN-ROOM.md, storage trade-off and owner acceptance steps. Commit
  with signoff and the requested co-author trailer, push meaningful checkpoints,
  create one PR to develop, watch CI and correct observed failures.
- [ ] Every check on the P1 PR is success or skipped. No merge by this agent.

Files are split by responsibility under desktop/electron/chatgpt/, with the
service entry at desktop/electron/chatgpt-oauth.mjs. Tests use node --test, real
loopback HTTP and disposable app data. No cargo, full suites or packaged builds
run locally. Each file stays below 1200 lines.

Credentials are installation-scoped, independent of community remounts. No
community singleton is introduced. P3 alone adds controls in the frozen style.
