# Colony Agent credits wiring implementation plan

**Goal:** Run the bundled Colony Agent against the private credits gateway using the saved `colony-credits` provider choice and managed relay identities, without a provider key.

**Architecture:** The native shared launch boundary discovers capability and obtains an owner-signed, two-hour session before spawning. The bundled agent signs bounded text/function requests with its existing relay identity. Credits refusals terminate the turn; ambiguous sends are never replayed automatically. The relay chooses the model and settles usage before returning output.

**Tech stack:** Rust, reqwest, Nostr NIP-98, existing ACP transport and native provider persistence.

The owner approved this design in `docs/credits-gateway.md` and requested this implementation on 10 October. Execute inline. CI is the gate; no local cargo or full suites. UI activation belongs to the following PR after this one merges.

- [x] Add `crates/buzz-agent/src/credits_gateway.rs`: validate relay origin, load ephemeral authorization, sign body-bound requests, cap request/response size and deadline, disable redirects and retries, classify safe credit refusals. Fake HTTP tests verify signatures, bodies, no bearer, one send on failure and no redirect leaks.
- [x] Extend `config.rs`, `llm.rs`, `types.rs` and `lib.rs`: explicit keyless provider, completion and summarization dispatch through the production gateway transport, typed terminal refusals, text/function serialization only. Existing providers retain their transport.
- [x] Add `desktop/src-tauri/src/managed_agents/credits_gateway.rs`: default-off flag, bundled/local runtime checks, configured capability, owner-signed session creation, bounded authorization response, authoritative post-merge child environment. Production environment tests prove stale authorization and unrelated provider keys cannot win.
- [x] Wire `runtime.rs`, `readiness.rs`, `reserved_env_keys.rs`: all shared launch paths use the authorization seam; credits needs no customer model/key; ephemeral authority cannot be saved or overridden. Existing provider fields already persist the choice through definitions/global configuration and restarts.
- [x] Run only serialized focused formatting/static checks through `heavy.sh`, bounded to ten minutes. Review all exhaustive provider matches, lockfile parity, no added em dashes or secrets, and refusal behavior through the ACP boundary.
- [ ] Commit with DCO and final coauthor trailer, inspect trailers before pushing with `--no-verify`. Open one REST PR to develop, await every latest check and whole workflows, inspect real failures and fix within this PR. Never merge. Record progress and distinguish CI proof from deployed/funded runtime proof.
