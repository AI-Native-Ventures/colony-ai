# Honest AI onboarding implementation plan

Goal: a new user can configure and test their own provider, or deliberately enter Colony knowing AI employees cannot reply yet.

Architecture: keep the four existing tabs. Reuse AgentConfigFields and the atomic global defaults save. Readiness uses resolveAgentReadiness for the bundled agent. Add a bounded native connection probe with safe result codes. Credits are coming soon. Installed CLI actions retain their current behavior.

- Wire provider forms and honest readiness into ConnectSetupStep.
- Add a minimal provider request command without logging credentials or returning raw provider errors.
- Add explicit skip copy and a Settings > Agents > Defaults destination.
- Update Fizz guidance, mounted regressions, and affected smoke expectations.
- Run quick TypeScript, Biome, text-token, focused Node, and Rust formatting checks.
- Open a draft PR into develop as soon as the slice compiles. Use GitHub CI as the build and test gate. No local Rust builds or tests, no merge or deploy.

Acceptance: configuration saves only after a successful connection test, stale test results cannot authorize an edited draft, errors distinguish authentication, balance, network, and unknown model failures, and credits show no balances or retry loop.

Not verified here: Windows runtime behavior, real customer keys, production deployment. Default funding policy remains NEEDS_OWNER.
