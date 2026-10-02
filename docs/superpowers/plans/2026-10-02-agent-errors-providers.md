# Provider failure hotfix implementation plan

Goal: make permanent provider failures immediate and actionable while preserving transient retries and protocol codes.

Architecture: normalize terminal HTTP auth and balance failures at the existing provider transport boundary, attach an allowlisted provider label at the LLM boundary, and classify notices in ACP before requeue. Keep OpenRouter 403 as permission rejection. Extend existing credential/readiness tables and consume the existing native Git prerequisite query in Welcome.

Approved scope: user hotfix outcomes A through F. No default funding decision, release changes, deployment, or merge.

1. Add production ACP notice classification and tests for 401/402/403 versus 429/5xx. Bind immediate delivery tests to handle_prompt_result with a local HTTP fixture.
2. Normalize provider auth/balance failures without provider payloads. Test actual DeepSeek and OpenRouter transports and retain JSON-RPC codes.
3. Correct desktop friendly mapping, DeepSeek credential and explicit-model options, and native readiness fallback to LLM_PROVIDER then deepseek. Test production functions.
4. Pass native Git prerequisite data into the client gate and Welcome, with fail-closed pending/error behavior and an actionable Git download message. Preserve other platforms and CLI paths.
5. Verify setup nudges name provider, model, key and Git. Add link and regressions.
6. Run quick TypeScript, focused node tests, Biome, px-text and Rust formatting only. Commit with DCO and requested co-author trailer, push, open draft PR into develop, then use GitHub CI as Rust/build/package gate. Fix introduced failures and rerun known flakes only after the whole run completes.

Proof boundaries: local formatting is not Rust compilation; Windows build/package checks are not Windows runtime observation; green checks are not merge or deployment.
