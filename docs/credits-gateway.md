# Colony credits gateway

Owner decisions: 9 October 2026. Target: Colony 1.0.7. Checkout is outside this work.

## Contract and request path

A person selects **Colony credits** for the bundled Colony Agent. The native launcher obtains an owner-signed, expiring managed-session authorization from the relay, bound to the existing agent ownership record and host-derived community. The agent signs each inference request with its relay identity (NIP-98, including the body hash) and supplies that session id. The relay checks identity, ownership, expiry, replay, rate limits and available credits before contacting OpenRouter. No anonymous calls, customer OpenRouter keys, arbitrary upstream URLs, model marketplace, or public OpenAI-compatible endpoint are exposed. This is a private Colony managed-session operation. Other runtimes and customer-supplied connections retain their existing behavior.

## Keys and upstream

Use one server-only `OPENROUTER_MASTER_KEY`, loaded from the environment, and a fixed HTTPS OpenRouter origin. A master-key proxy keeps the existing ledger authoritative, avoids a second balance replicated into per-customer key limits, and avoids storing derived provider secrets. Management API keys are an alternative when independently managed customer limits become necessary; they cannot themselves perform inference. Never forward incoming credentials or upstream error bodies, log secrets, or return provider credentials. The owner funds OpenRouter and configures Fly secrets. The flag and presence of a key are checked independently.

## Metering and durable recovery

Before sending, atomically reserve a conservative maximum charge under the account row lock and create a durable request journal keyed by account plus caller request UUID. The reservation is a negative ledger adjustment, so existing debit paths cannot spend held funds. Only one unresolved request per account is admitted across processes, sessions and communities. Restrict the server-selected text/tool model, input bytes, output tokens and upstream price ceilings; reject unsupported request options. First release uses buffered responses with a finite deadline and response-size limit. This permits settlement before the agent receives success.

Charge `ceil(OpenRouter usage.cost USD * 1,000,000,000 * 1.20)` using decimal arithmetic, never token-price estimates or binary floating-point money. In one transaction release the hold, insert the actual usage debit and mark the journal settled. Zero-cost usage releases the hold without a zero ledger entry. Stable journal-derived ledger sources prevent double debit after a lost commit acknowledgement. Reused UUIDs with different bodies fail. Retries of settled calls return a receipt without repeating inference; the agent must not repeat a tool turn whose response was lost.

Timeouts, disconnects, missing/invalid usage and crashes leave the hold and journal unresolved, blocking new spend. Never automatically resend an ambiguous upstream request or expire its hold. Persist generation ids when available. An authenticated operator reconciliation operation retrieves actual cost by generation id and settles the original journal; if attribution is unavailable, retain the record for operator investigation. A response above its authorized ceiling is quarantined, never reported as successful or silently discounted. Recovery records contain identifiers and usage, not prompts, completions or secrets.

## Refusals, limits and product wiring

Insufficient available credits returns HTTP 402 with **Out of credits. Top up to keep your Colony Agent working.** Busy or unresolved spending has a distinct retry/recovery message. Disabled or unconfigured service reports unavailable and never falls back to another paid connection. Cap request bytes, tools, messages, output tokens, response bytes, session lifetime, sessions per account and request frequency. Session authorization is revocable and cannot change its payer or agent. The private request schema accepts only the Colony Agent's supported text/tool workflow.

The launcher passes only the session id, relay URL and existing agent relay credentials to the bundled agent. Selecting credits stores a connection choice, not a provider key. Onboarding and settings use existing visual components and the existing balance/top-up surfaces. `COLONY_CREDITS_GATEWAY` defaults OFF on relay and native client; capability discovery must confirm the relay is configured before offering the working option. A zero balance retains the top-up recovery affordance.

## Delivery and proof gates

1. Commit this note and record progress. 2. Relay PR to `develop`: migration and desired schema, reservation/journal/settlement, authenticated session and request routes, operator recovery, fake upstream tests covering actual cost, concurrent admission, retries, lost acknowledgements, missing usage, timeout, auth and disabled state. 3. Agent wiring PR: production transport and launch tests, typed credit refusals, no key handoff. 4. UI PR: flag/capability-gated onboarding and settings, with mock-bridge specs registered in both smoke and integration projects. GitHub CI is the gate; no local cargo or full suites. Focused heavy work is serialized through `heavy.sh`, with a ten-minute limit. The coordinator merges strict green PRs. Flag activation, deployed runtime adoption and a real funded first reply remain separate owner/live gates.

References checked 9 October: [OpenRouter terms, sections 5 and 7](https://openrouter.ai/terms), [usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [Management API keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys). These engineering restrictions implement the owner's product-integration decision; they do not grant customers API access.
