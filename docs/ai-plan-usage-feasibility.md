# AI plan usage feasibility

Date: 7 November 2026

This is a static feasibility review. It did not run a native app, invoke a
provider, access an owner profile, read a credential, or contact production.

| Provider | Documented read surface | Reportable fields | Credential and policy boundary | Decision |
| --- | --- | --- | --- | --- |
| ChatGPT plan through Codex | Codex app-server has `account/rateLimits/read`, but the documented application OAuth handoff only configures `ACCESS_TOKEN` for Responses inference. | The protocol can represent `usedPercent`, `windowDurationMins`, `resetsAt`, `planType`, and optional buckets keyed by limit id. No documented, supported handoff makes those fields available from Colony's OAuth credential. | The app-server `chatgptAuthTokens` login route is explicitly marked internal-only. Using Codex's file credential store would require reading or reconstructing a Codex auth profile, which this feature must not do. Electron main, the renderer, and relay must never expose a token. | Unsupported. Return `usage not available for your AI`; do not apply the reserve rule and do not invent a percentage or reset. |
| Claude Code plan | No documented non-consuming programmatic quota read was found. Claude Code documents `/status` for account and connection state, not a structured allowance value. Its documented print JSON executes a prompt and would consume usage. | None | The current private `api/oauth/usage` path is not a public documented contract and needs an OAuth credential, potentially through Keychain. It cannot be used by this feature. | Unsupported. Return `usage not available for your AI`; do not apply the reserve rule and do not invent a percentage. |

## Implementation boundary

The relay receives an outreach batch or draft only after Scout has already
invoked the model. It cannot protect the owner's plan at that point. If a
future supported snapshot makes the reserve active, its gate belongs in the
desktop-local ACP prompt admission path before an outreach drafting prompt
starts. This needs no relay schema, endpoint, deploy, or compatibility change.

The normalized desktop-only snapshot must contain provider, availability,
used percent for its selected current window when reported or estimated, reset
time, source, observation time, freshness, and confidence. The present Codex
and Claude readers return unavailable snapshots. Any future Colony token-count
calculation must be explicitly labelled `estimated` and must not replace an
unavailable provider value.

## Evidence consulted

- OpenAI Codex app-server protocol source lists `account/rateLimits/read` and
  its rate-limit response has percentage, duration, reset, and per-limit-id
  fields. The same source marks the external-token account login route as
  internal-only.
- OpenAI's Codex app-server documentation permits an application to pass its
  own ChatGPT-plan OAuth access token to the app-server child for Responses
  inference. It does not document a quota-read handoff for that token.
- Anthropic's Claude Code documentation describes `/status` as account and
  connection information and documents JSON output for prompt execution, not
  as a quota API.
- `desktop/electron/chatgpt/README.md` keeps ChatGPT tokens in Electron main
  and excludes them from renderer IPC.
- `desktop/electron/ai-subscriptions.mjs` contains older direct Codex-file and
  Claude protected-read logic. This feature must not reuse its owner-profile or
  Keychain route.
- `crates/buzz-relay/src/whatsapp/mod.rs` and the WhatsApp command handler
  show that the relay receives a prepared batch or draft after agent work.

## Not verified

- A live ChatGPT quota read against a real account.
- Any provider-specific window selection beyond recorded protocol fixtures.
- Packaged Electron and native ACP integration.
- Claude live usage, because the documented safe reader does not exist.
