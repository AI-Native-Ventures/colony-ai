# Part I: Credits live (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-overview.md` first: it holds the contract every part uses.

**Goal:** Make Colony credits ready for a starter team of six employees in production: admission limits that fit six, plain startup errors when the gateway is misconfigured, requests that compact instead of failing when they grow, a clean stop (no chat error) when credits run out or a session ends, a team that pauses for credits and resumes by itself, an owner checklist for production settings, and the phase 1 real-run gate.

**Architecture:** The relay's credits gateway keeps its single-transaction money path; this part only makes its limits configurable (`buzz-db` admission and session counts, read once by the relay) and names configuration errors at startup. The employee's AI runtime (`buzz-agent`) keeps requests under the relay's request limit by compacting history early. The harness (`buzz-acp`) turns the three refusals that the relay gives before admitting a request (402 out of credits, 403 session ended, 429 busy) into a quiet retry or a clean exit with a code the host understands (75 or 77). The host (`desktop/src-tauri`) pauses the company's team on exit 75, records the pause so it survives a restart, polls the owner's balance with a growing wait and resumes the team when the balance covers the next request. Polling was chosen over a relay balance signal because no balance event kind exists, the host already holds the owner's signing key for the balance endpoint, one poll per company costs one cheap authenticated read every two minutes at most, and the app can end the wait at once by calling `team.resume` after a confirmed purchase.

**Tech Stack:** Rust (axum relay, sqlx Postgres, Tauri host crate, tokio), Node test runner and Playwright for the real-run gate.

**Spec:** `docs/superpowers/specs/2026-10-11-colony-os-design.md` and `docs/superpowers/specs/2026-10-11-colony-os-screens/` (engine item E-16 and the X-05 "Credits out" state in `07-system-states.md`; phase gates in `00-overview.md` of this plan set).


> **Integration amendments (read first):** `00-overview.md`, section "Integration decisions", items 1 (pause reason `"credits"`, not `"credits_out"`), 2, 3 (call part C's `WakeLedger::forget_events` method) and 5 (the `close-window` gate row reuses the same window). Where they differ from the tasks below, the amendments win.

## Global Constraints

- Every constraint in `00-overview.md` ("Global constraints") applies to every task here.
- The money path is unchanged: admission, holds, settlement and recovery stay in the existing single-transaction seams of `crates/buzz-db/src/store/credits_gateway.rs`; this part changes limits, not how money moves.
- A credits refusal is processed again only when the relay proves nothing was admitted: 402 (out of credits), 401 or 403 (session ended or revoked), 429 (busy). Every other credits failure keeps today's "never replay" rule.
- Secrets: only setting names appear in code, logs, documents and tests. Values never do.
- Harness exit codes: 75 means credits are out; 77 means the employee needs a fresh credits session. The host treats neither as a crash.
- Resume threshold: 500,000,000 nanoUSD ($0.50). Balance polling waits 30 s, then 60 s, then 120 s for every later poll.
- Request limits: 128 KiB for a managed request (`MAX_BODY`), 132 KiB for the body Colony sends upstream. Every hold stays under $0.40 (400,000,000 nanoUSD).
- Default admission limits: 8 requests waiting at once per payer account, 1 per employee session, 16 active sessions per account.
- New pure relay tests must sit in a module named in the `test-unit` nextest filter in `justfile`, or they run in no CI lane.

## Review Focus

1. **Credits run out in the middle of an employee's turn** (overview review focus 5). Expected: the employee stops cleanly, the whole team shows "paused" for credits, nothing is posted to chat as an error, the refused messages are processed once after credits arrive. Pinned by `out_of_credits_stops_cleanly_and_asks_the_host_to_pause` (task 9.4), `credits_out_pauses_and_a_fresh_session_restarts_at_most_once_per_window` and `polling_backs_off_to_two_minutes_and_resumes_only_with_fifty_cents` (task 9.5), and observed in gate rows `credits-out` and `credits-resume` (task 9.7).
2. **All six employees start working at once after the hire.** Expected: none is refused as busy; a ninth simultaneous request waits quietly and is retried, never shown as an error. Pinned by `six_employees_bill_the_owner_and_the_account_limit_is_configurable` (task 9.1) and `a_busy_gateway_retries_quietly` (task 9.4).
3. **An employee works past its two-hour credits session.** Expected: the employee restarts with a fresh session and answers the same message; a second session expiry within 10 minutes counts as a crash so it cannot loop. Pinned by `an_expired_credits_session_asks_the_host_for_a_fresh_one` (task 9.4) and the `ReauthorizeGuard` assertions in task 9.5.
4. **A long conversation or a large web page makes a request too big.** Expected: the employee compacts its history and continues instead of failing; the largest accepted request still holds less than $0.40. Pinned by `an_oversized_request_asks_for_a_handoff_and_is_never_sent`, `credits_employees_hand_off_long_before_the_request_limit` and `the_largest_accepted_request_holds_less_than_forty_cents` (task 9.3).
5. **The owner sets a wrong model or forgets a secret on Fly.** Expected: the gateway stays off, the relay log names the missing or wrong setting and never its value, and the owner checklist lists every setting the relay reads. Pinned by `each_missing_or_wrong_setting_names_itself` (task 9.2) and `every_gateway_setting_is_in_the_owner_checklist` (task 9.6).

---

### Task 9.1: Admission limits that fit a team of six

**Files:**
- Modify: `crates/buzz-db/src/store/credits_gateway.rs:11-32` (doc of `Admission::Busy`, new `CreditGatewayLimits` after the enum), `:55-93` (`create_credit_ai_session`), `:102-193` (`admit_credit_ai_request`)
- Modify: `crates/buzz-db/src/store/credits_gateway/postgres_tests.rs` (every call site, one new test)
- Create: `crates/buzz-relay/src/api/credits_gateway_limits.rs`
- Modify: `crates/buzz-relay/src/api/mod.rs:7-10` (declare the module)
- Modify: `crates/buzz-relay/src/api/credits_gateway.rs:13` (import), `:28-46` (`Gateway` field and router), `:154-159` (`create_session`), `:215-229` (`inference`)
- Modify: `crates/buzz-relay/src/api/credits_gateway/postgres_tests.rs:133-139`, `:172-186`, `:473-482`
- Modify: `justfile:497-498` (the `cargo nextest run -p buzz-relay --lib` filter in `test-unit`)
- Test: `crates/buzz-db/src/store/credits_gateway/postgres_tests.rs`, `crates/buzz-relay/src/api/credits_gateway_limits.rs` (`tests` module)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `buzz_db::credits_gateway::CreditGatewayLimits { pub max_inflight_per_account: i64, pub max_inflight_per_session: i64, pub max_sessions_per_account: i64 }` with `pub const DEFAULT: Self` = (8, 1, 16) and `impl Default`.
  - `Db::create_credit_ai_session(&self, owner: &str, community: CommunityId, agent: &[u8], limits: &CreditGatewayLimits) -> Result<Uuid>`
  - `Db::admit_credit_ai_request(&self, upstream_id: &str, community: CommunityId, agent: &[u8], session: Uuid, request: Uuid, digest: &str, reserve: i64, limits: &CreditGatewayLimits) -> Result<Admission>`
  - Relay: `credits_gateway_limits::limits_from_lookup(lookup: &dyn Fn(&str) -> Option<String>) -> CreditGatewayLimits`, `limits_from_env() -> CreditGatewayLimits`, and the constants `ENV_MAX_INFLIGHT_PER_ACCOUNT` (`"COLONY_CREDITS_MAX_INFLIGHT_PER_ACCOUNT"`), `ENV_MAX_INFLIGHT_PER_SESSION` (`"COLONY_CREDITS_MAX_INFLIGHT_PER_SESSION"`), `ENV_MAX_SESSIONS_PER_ACCOUNT` (`"COLONY_CREDITS_MAX_SESSIONS_PER_ACCOUNT"`).
  - `Gateway` gains `limits: CreditGatewayLimits`.

- [ ] **Step 1: Write the failing Postgres test**

Append to `crates/buzz-db/src/store/credits_gateway/postgres_tests.rs`, and add these two constants right below the `use` lines at the top of the file:

```rust
const LIMITS: CreditGatewayLimits = CreditGatewayLimits::DEFAULT;
const FOUR_AT_ONCE: CreditGatewayLimits = CreditGatewayLimits {
    max_inflight_per_account: 4,
    ..CreditGatewayLimits::DEFAULT
};
```

```rust
#[tokio::test]
#[ignore = "requires Postgres"]
async fn six_employees_bill_the_owner_and_the_account_limit_is_configurable() {
    let (db, pool, community, _agent, ids) = fixture().await;
    let owner_account = ids[0];
    let owner_hex: String = sqlx::query_scalar("SELECT pubkey FROM accounts WHERE id = $1")
        .bind(owner_account)
        .fetch_one(&pool)
        .await
        .unwrap();
    let digest = "a".repeat(64);
    let mut agents = Vec::new();
    let mut sessions = Vec::new();
    for _ in 0..9 {
        let agent = Keys::generate();
        sqlx::query(
            "INSERT INTO users (community_id,pubkey,agent_owner_pubkey) VALUES ($1,$2,decode($3,'hex'))",
        )
        .bind(community.as_uuid())
        .bind(agent.public_key().to_bytes().to_vec())
        .bind(&owner_hex)
        .execute(&pool)
        .await
        .unwrap();
        sessions.push(
            db.create_credit_ai_session(&owner_hex, community, agent.public_key().as_bytes(), &LIMITS)
                .await
                .unwrap(),
        );
        agents.push(agent);
    }
    // Eight employees may each have a request waiting; every one bills the owner.
    for index in 0..8 {
        assert_eq!(
            db.admit_credit_ai_request(
                "fixture",
                community,
                agents[index].public_key().as_bytes(),
                sessions[index],
                Uuid::new_v4(),
                &digest,
                100_000_000,
                &LIMITS,
            )
            .await
            .unwrap(),
            Admission::New { account_id: owner_account }
        );
    }
    // One employee still waits for its own first request.
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agents[0].public_key().as_bytes(),
            sessions[0],
            Uuid::new_v4(),
            &digest,
            1,
            &LIMITS,
        )
        .await
        .unwrap(),
        Admission::Busy
    );
    // The ninth employee is told to wait, and nothing is held for it.
    let before = db.account_credit_balance(owner_account).await.unwrap();
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agents[8].public_key().as_bytes(),
            sessions[8],
            Uuid::new_v4(),
            &digest,
            1,
            &LIMITS,
        )
        .await
        .unwrap(),
        Admission::Busy
    );
    assert_eq!(db.account_credit_balance(owner_account).await.unwrap(), before);
    // A partner cannot open a credits session for the owner's employee.
    let partner = Keys::generate();
    sqlx::query("INSERT INTO accounts (id,email,pubkey,email_verified_at,wrapped_dek,kek_id,sealed_nsec,nonce) VALUES ($1,$2,$3,now(),$4,'test',$5,$6)")
        .bind(Uuid::new_v4())
        .bind(format!("{}@example.invalid", Uuid::new_v4()))
        .bind(partner.public_key().to_hex())
        .bind(vec![1u8; 28])
        .bind(vec![2u8; 16])
        .bind(vec![3u8; 12])
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        db.create_credit_ai_session(
            &partner.public_key().to_hex(),
            community,
            agents[0].public_key().as_bytes(),
            &LIMITS,
        )
        .await,
        Err(DbError::InvalidData(_))
    ));
}
```

- [ ] **Step 2: Run it to verify it fails**

Run (local Postgres from `docker compose up -d postgres`, see `TESTING.md`): `cargo nextest run -p buzz-db --lib --run-ignored ignored-only -E 'test(/credits_gateway::postgres_tests::/)'`
Expected: compile failure, `error[E0412]: cannot find type CreditGatewayLimits in this scope` and `error[E0061]: this method takes 3 arguments but 4 arguments were supplied`.

- [ ] **Step 3: Implement the limits in `buzz-db`**

In `crates/buzz-db/src/store/credits_gateway.rs`, change the doc of `Admission::Busy` (line 30) to `/// The account or this session already has its configured number of requests waiting.` and add after the `Admission` enum:

```rust
/// Admission bounds for managed inference, set once by the relay from its environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CreditGatewayLimits {
    /// Requests one payer account may have waiting for the AI provider at once.
    pub max_inflight_per_account: i64,
    /// Requests one session (one employee) may have waiting at once.
    pub max_inflight_per_session: i64,
    /// Unexpired, unrevoked sessions one payer account may hold.
    pub max_sessions_per_account: i64,
}

impl CreditGatewayLimits {
    /// Fits a starter team of six employees with room for two more requests.
    pub const DEFAULT: Self = Self {
        max_inflight_per_account: 8,
        max_inflight_per_session: 1,
        max_sessions_per_account: 16,
    };

    fn validate(&self) -> Result<()> {
        if !(1..=32).contains(&self.max_inflight_per_account)
            || !(1..=4).contains(&self.max_inflight_per_session)
            || self.max_inflight_per_session > self.max_inflight_per_account
            || !(1..=64).contains(&self.max_sessions_per_account)
        {
            return Err(DbError::InvalidData("invalid credit gateway limits".into()));
        }
        Ok(())
    }
}

impl Default for CreditGatewayLimits {
    fn default() -> Self {
        Self::DEFAULT
    }
}
```

In `create_credit_ai_session`, add the parameter `limits: &CreditGatewayLimits` after `agent: &[u8]`, call `limits.validate()?;` as the first line of the body, and replace `if active >= 16 {` with `if active >= limits.max_sessions_per_account {`.

In `admit_credit_ai_request`, add the parameter `limits: &CreditGatewayLimits` after `reserve: i64`, call `limits.validate()?;` right after the existing argument check, then replace the expired-hold query and the pending check:

```rust
        // A recovery backlog must never strand a person after the fifteen-minute
        // window. At most the account limit of expired holds exist for this payer.
        let expired: Vec<(Uuid, i64, Option<i64>)> = sqlx::query_as("SELECT id, reserved_nanousd, observed_nanousd FROM account_ai_requests WHERE account_id = $1 AND status = 'pending' AND created_at <= now() - interval '15 minutes' ORDER BY id LIMIT $2 FOR UPDATE")
            .bind(account).bind(limits.max_inflight_per_account).fetch_all(&mut *tx).await?;
```

```rust
        let (pending, same_session): (i64, i64) = sqlx::query_as("SELECT count(*), count(*) FILTER (WHERE session_id = $2) FROM account_ai_requests WHERE account_id = $1 AND status = 'pending'")
            .bind(account).bind(session).fetch_one(&mut *tx).await?;
        if pending >= limits.max_inflight_per_account
            || same_session >= limits.max_inflight_per_session
        {
            tx.commit().await?;
            return Ok(Admission::Busy);
        }
```

- [ ] **Step 4: Update every existing `buzz-db` call site**

The compiler lists each call that lacks the new argument (`error[E0061]`). Add `&LIMITS` as the last argument of every `create_credit_ai_session(` and `admit_credit_ai_request(` call in `postgres_tests.rs`, except inside `aggregate_holds_allow_four_employees_and_block_fifth_and_other_debits`, where every `admit_credit_ai_request(` call takes `&FOUR_AT_ONCE` so that test keeps proving a configured limit of four. For example the first call there becomes:

```rust
    let a = db.admit_credit_ai_request(
        "fixture",
        community,
        agent_pubkey.as_bytes(),
        sessions[0],
        requests[0],
        &digest,
        200_000_000,
        &FOUR_AT_ONCE,
    );
```

- [ ] **Step 5: Run the `buzz-db` tests to verify they pass**

Run: `cargo nextest run -p buzz-db --lib --run-ignored ignored-only -E 'test(/credits_gateway::postgres_tests::/)'`
Expected: PASS, including `six_employees_bill_the_owner_and_the_account_limit_is_configurable` and the unchanged four-at-once test.

- [ ] **Step 6: Write the failing relay limits tests**

Create `crates/buzz-relay/src/api/credits_gateway_limits.rs` containing only:

```rust
//! Admission limits for the credits gateway, read once from the relay environment.

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn unset_limits_fit_a_team_of_six() {
        let limits = limits_from_lookup(&lookup(&[]));
        assert_eq!(limits, CreditGatewayLimits::DEFAULT);
        assert!(limits.max_inflight_per_account >= 6);
    }

    #[test]
    fn valid_values_override_and_invalid_values_keep_defaults() {
        let limits = limits_from_lookup(&lookup(&[
            (ENV_MAX_INFLIGHT_PER_ACCOUNT, "12"),
            (ENV_MAX_INFLIGHT_PER_SESSION, "2"),
            (ENV_MAX_SESSIONS_PER_ACCOUNT, "20"),
        ]));
        assert_eq!(
            (
                limits.max_inflight_per_account,
                limits.max_inflight_per_session,
                limits.max_sessions_per_account
            ),
            (12, 2, 20)
        );
        let limits = limits_from_lookup(&lookup(&[
            (ENV_MAX_INFLIGHT_PER_ACCOUNT, "0"),
            (ENV_MAX_INFLIGHT_PER_SESSION, "lots"),
            (ENV_MAX_SESSIONS_PER_ACCOUNT, "65"),
        ]));
        assert_eq!(limits, CreditGatewayLimits::DEFAULT);
    }

    #[test]
    fn a_session_never_gets_more_than_the_account() {
        let limits = limits_from_lookup(&lookup(&[
            (ENV_MAX_INFLIGHT_PER_ACCOUNT, "2"),
            (ENV_MAX_INFLIGHT_PER_SESSION, "4"),
        ]));
        assert_eq!(limits.max_inflight_per_session, 2);
    }
}
```

In `crates/buzz-relay/src/api/mod.rs`, add `mod credits_gateway_limits;` after line 7 (`pub mod credits_gateway;`).

- [ ] **Step 7: Run it to verify it fails**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/^api::credits_gateway_limits::/)'`
Expected: compile failure, `error[E0425]: cannot find function limits_from_lookup in this scope`.

- [ ] **Step 8: Implement the relay limits and pass them through**

Insert above the `tests` module in `credits_gateway_limits.rs`:

```rust
use std::ops::RangeInclusive;

use buzz_db::credits_gateway::CreditGatewayLimits;

/// Requests one payer account may have waiting at once.
pub(super) const ENV_MAX_INFLIGHT_PER_ACCOUNT: &str = "COLONY_CREDITS_MAX_INFLIGHT_PER_ACCOUNT";
/// Requests one employee session may have waiting at once.
pub(super) const ENV_MAX_INFLIGHT_PER_SESSION: &str = "COLONY_CREDITS_MAX_INFLIGHT_PER_SESSION";
/// Active credits sessions one payer account may hold.
pub(super) const ENV_MAX_SESSIONS_PER_ACCOUNT: &str = "COLONY_CREDITS_MAX_SESSIONS_PER_ACCOUNT";

/// Read the limits. A missing value keeps its default; an invalid one keeps its
/// default and is logged by name, never by value.
pub(super) fn limits_from_lookup(lookup: &dyn Fn(&str) -> Option<String>) -> CreditGatewayLimits {
    let defaults = CreditGatewayLimits::DEFAULT;
    let read = |name: &str, default: i64, range: RangeInclusive<i64>| -> i64 {
        match lookup(name) {
            None => default,
            Some(raw) => match raw.trim().parse::<i64>() {
                Ok(value) if range.contains(&value) => value,
                _ => {
                    tracing::error!(
                        "{name} must be a whole number from {} to {}; using {default}",
                        range.start(),
                        range.end()
                    );
                    default
                }
            },
        }
    };
    let mut limits = CreditGatewayLimits {
        max_inflight_per_account: read(
            ENV_MAX_INFLIGHT_PER_ACCOUNT,
            defaults.max_inflight_per_account,
            1..=32,
        ),
        max_inflight_per_session: read(
            ENV_MAX_INFLIGHT_PER_SESSION,
            defaults.max_inflight_per_session,
            1..=4,
        ),
        max_sessions_per_account: read(
            ENV_MAX_SESSIONS_PER_ACCOUNT,
            defaults.max_sessions_per_account,
            1..=64,
        ),
    };
    if limits.max_inflight_per_session > limits.max_inflight_per_account {
        tracing::error!(
            "{ENV_MAX_INFLIGHT_PER_SESSION} cannot exceed {ENV_MAX_INFLIGHT_PER_ACCOUNT}; using {}",
            limits.max_inflight_per_account
        );
        limits.max_inflight_per_session = limits.max_inflight_per_account;
    }
    limits
}

/// Read the limits from the process environment.
pub(super) fn limits_from_env() -> CreditGatewayLimits {
    limits_from_lookup(&|name| std::env::var(name).ok())
}
```

In `crates/buzz-relay/src/api/credits_gateway.rs`:
- line 13 becomes `use buzz_db::credits_gateway::{Admission, CreditGatewayLimits};`
- `struct Gateway` gains the field `limits: CreditGatewayLimits,`
- in `router`, the `Gateway { .. }` literal gains `limits: super::credits_gateway_limits::limits_from_env(),`
- in `create_session`, the call becomes `.create_credit_ai_session(&owner.to_hex(), tenant.community(), agent.as_bytes(), &gateway.limits)`
- in `inference`, the `admit_credit_ai_request(` call gains `&gateway.limits,` after `reserve,`

In `crates/buzz-relay/src/api/credits_gateway/postgres_tests.rs`, the fixture's `create_credit_ai_session(` call (line 133) gains `&CreditGatewayLimits::DEFAULT,` after `agent.public_key().as_bytes(),`; the `Gateway { .. }` literal (line 172) gains `limits: CreditGatewayLimits::DEFAULT,` after `enabled: true,`; the `admit_credit_ai_request(` call (line 473) gains `&CreditGatewayLimits::DEFAULT,` after `reserve,`.

In `justfile`, at the end of the `-E '...'` expression of `cargo nextest run -p buzz-relay --lib` (line 498), replace `+ test(/^config::tests::(stripe_|credit_policy_|payments_config_)/)'` with:

```
+ test(/^config::tests::(stripe_|credit_policy_|payments_config_)/) + test(/^api::credits_gateway_limits::/) + test(/^api::credits_gateway_upstream::/) + test(/^api::credits_gateway_policy::/) + test(/^api::credits_gateway_metering::/)'
```

The last three modules already hold ten infra-free tests that run in no CI lane today.

- [ ] **Step 9: Run the relay tests to verify they pass**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/^api::credits_gateway_(limits|upstream|policy|metering)::/)'`
Expected: PASS for the three new tests and the ten existing gateway tests. If an existing gateway test fails now that it finally runs, stop and report it with its output; do not delete or ignore it.

Run: `cargo nextest run -p buzz-relay --lib --run-ignored ignored-only -E 'test(/credits_gateway::postgres_tests::/)'` (local Postgres)
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add crates/buzz-db/src/store/credits_gateway.rs crates/buzz-db/src/store/credits_gateway/postgres_tests.rs crates/buzz-relay/src/api/credits_gateway_limits.rs crates/buzz-relay/src/api/mod.rs crates/buzz-relay/src/api/credits_gateway.rs crates/buzz-relay/src/api/credits_gateway/postgres_tests.rs justfile
git commit -s -m "feat(credits): admission limits that fit a team of six"
```

---

### Task 9.2: Name the reason when the gateway stays off

**Files:**
- Modify: `crates/buzz-relay/src/api/credits_gateway_upstream.rs:36-92` (`from_env` becomes `from_lookup` plus `from_env`)
- Modify: `crates/buzz-relay/src/api/credits_gateway.rs:38-46` (`router`)
- Test: `crates/buzz-relay/src/api/credits_gateway_upstream.rs` (new `config_tests` module)

**Interfaces:**
- Consumes: `Gateway.limits` and `limits_from_env()` from task 9.1.
- Produces:
  - `pub(super) enum UpstreamConfigError { BaseUrl, MissingKey, Model, PriceTable, AllowedModels, UserHashKey, Client }` with `Display` naming the setting.
  - `Upstream::from_lookup(lookup: &dyn Fn(&str) -> Option<String>) -> Result<Upstream, UpstreamConfigError>`
  - `Upstream::from_env() -> Result<Upstream, UpstreamConfigError>`

- [ ] **Step 1: Write the failing tests**

Append to `crates/buzz-relay/src/api/credits_gateway_upstream.rs`:

```rust
#[cfg(test)]
mod config_tests {
    use super::*;
    use std::collections::HashMap;

    const HASH_KEY: &str = "synthetic-customer-hmac-key-at-least-32-bytes";
    const KEY_VALUE: &str = "synthetic-test-key";

    fn config(pairs: &[(&str, &str)]) -> Result<Upstream, UpstreamConfigError> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect();
        Upstream::from_lookup(&|name| map.get(name).cloned())
    }

    #[test]
    fn openrouter_needs_only_a_key_and_a_tracking_secret() {
        let upstream = config(&[
            ("OPENROUTER_MASTER_KEY", KEY_VALUE),
            ("COLONY_CREDITS_USER_HASH_KEY", HASH_KEY),
        ])
        .unwrap();
        assert_eq!(upstream.model, MODEL);
    }

    #[test]
    fn each_missing_or_wrong_setting_names_itself() {
        let key = ("OPENROUTER_MASTER_KEY", KEY_VALUE);
        let hash = ("COLONY_CREDITS_USER_HASH_KEY", HASH_KEY);
        assert_eq!(config(&[hash]).err(), Some(UpstreamConfigError::MissingKey));
        assert_eq!(config(&[key]).err(), Some(UpstreamConfigError::UserHashKey));
        assert_eq!(
            config(&[key, ("COLONY_CREDITS_USER_HASH_KEY", "short")]).err(),
            Some(UpstreamConfigError::UserHashKey)
        );
        assert_eq!(
            config(&[key, hash, ("COLONY_CREDITS_UPSTREAM_MODEL", "anthropic/claude-sonnet")]).err(),
            Some(UpstreamConfigError::AllowedModels)
        );
        assert_eq!(
            config(&[key, hash, ("COLONY_CREDITS_UPSTREAM_BASE_URL", "http://openrouter.ai/api/v1")]).err(),
            Some(UpstreamConfigError::BaseUrl)
        );
        let direct = ("COLONY_CREDITS_UPSTREAM_BASE_URL", "https://api.example.com/v1");
        let direct_key = ("COLONY_CREDITS_UPSTREAM_KEY", KEY_VALUE);
        assert_eq!(config(&[direct_key, direct]).err(), Some(UpstreamConfigError::Model));
        assert_eq!(
            config(&[direct_key, direct, ("COLONY_CREDITS_UPSTREAM_MODEL", "direct-test-model")]).err(),
            Some(UpstreamConfigError::PriceTable)
        );
    }

    #[test]
    fn error_text_names_settings_and_never_values() {
        for error in [
            UpstreamConfigError::BaseUrl,
            UpstreamConfigError::MissingKey,
            UpstreamConfigError::Model,
            UpstreamConfigError::PriceTable,
            UpstreamConfigError::AllowedModels,
            UpstreamConfigError::UserHashKey,
        ] {
            let text = error.to_string();
            assert!(text.contains("COLONY_CREDITS_"), "{text}");
            assert!(!text.contains(KEY_VALUE) && !text.contains(HASH_KEY), "{text}");
        }
        assert!(UpstreamConfigError::Client.to_string().contains("HTTP client"));
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/^api::credits_gateway_upstream::config_tests::/)'`
Expected: compile failure, `error[E0433]: failed to resolve: use of undeclared type UpstreamConfigError` and `no function or associated item named from_lookup`.

- [ ] **Step 3: Implement `from_lookup` and the named errors**

Add above `impl Upstream` in `credits_gateway_upstream.rs`:

```rust
/// Why the credits upstream is not configured. Names settings, never their values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum UpstreamConfigError {
    BaseUrl,
    MissingKey,
    Model,
    PriceTable,
    AllowedModels,
    UserHashKey,
    Client,
}

impl std::fmt::Display for UpstreamConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::BaseUrl => "COLONY_CREDITS_UPSTREAM_BASE_URL must be an https URL without credentials, query or fragment",
            Self::MissingKey => "COLONY_CREDITS_UPSTREAM_KEY is not set (OpenRouter also accepts OPENROUTER_MASTER_KEY)",
            Self::Model => "COLONY_CREDITS_UPSTREAM_MODEL is missing or longer than 200 characters (it is required for providers other than OpenRouter)",
            Self::PriceTable => "COLONY_CREDITS_MODEL_PRICES is missing, not valid JSON, or has no valid entry for the configured model",
            Self::AllowedModels => "COLONY_CREDITS_ALLOWED_MODELS is not valid or does not include the configured model",
            Self::UserHashKey => "COLONY_CREDITS_USER_HASH_KEY must be set to at least 32 characters for OpenRouter",
            Self::Client => "the upstream HTTP client could not be created",
        })
    }
}
```

Replace the body of `pub(super) fn from_env() -> Option<Self>` (lines 37-92) with these two functions:

```rust
    pub(super) fn from_env() -> Result<Self, UpstreamConfigError> {
        Self::from_lookup(&|name| std::env::var(name).ok())
    }

    pub(super) fn from_lookup(
        lookup: &dyn Fn(&str) -> Option<String>,
    ) -> Result<Self, UpstreamConfigError> {
        let origin = lookup("COLONY_CREDITS_UPSTREAM_BASE_URL")
            .unwrap_or_else(|| "https://openrouter.ai/api/v1".into());
        let url = url::Url::parse(&origin).map_err(|_| UpstreamConfigError::BaseUrl)?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(UpstreamConfigError::BaseUrl);
        }
        let openrouter = url.host_str() == Some("openrouter.ai");
        let key = lookup("COLONY_CREDITS_UPSTREAM_KEY")
            .or_else(|| openrouter.then(|| lookup("OPENROUTER_MASTER_KEY")).flatten())
            .filter(|key| !key.trim().is_empty())
            .ok_or(UpstreamConfigError::MissingKey)?;
        let model = lookup("COLONY_CREDITS_UPSTREAM_MODEL")
            .or_else(|| openrouter.then(|| MODEL.to_owned()))
            .filter(|model| !model.is_empty() && model.len() <= 200)
            .ok_or(UpstreamConfigError::Model)?;
        let prices = match lookup("COLONY_CREDITS_MODEL_PRICES") {
            Some(table) => {
                let table: std::collections::HashMap<String, TokenPrices> =
                    serde_json::from_str(&table).map_err(|_| UpstreamConfigError::PriceTable)?;
                let entry = table.get(&model).cloned().ok_or(UpstreamConfigError::PriceTable)?;
                entry.validate().map_err(|()| UpstreamConfigError::PriceTable)?;
                Some(entry)
            }
            None if openrouter => None,
            None => return Err(UpstreamConfigError::PriceTable),
        };
        let allowed: Vec<String> = match lookup("COLONY_CREDITS_ALLOWED_MODELS") {
            Some(list) => serde_json::from_str(&list).map_err(|_| UpstreamConfigError::AllowedModels)?,
            None => vec![MODEL.into()],
        };
        let tracking = if openrouter {
            let secret = lookup("COLONY_CREDITS_USER_HASH_KEY")
                .filter(|secret| secret.len() >= 32)
                .ok_or(UpstreamConfigError::UserHashKey)?;
            Some(secret)
        } else {
            None
        };
        let policy = Policy::new(&model, allowed, openrouter, tracking)
            .map_err(|()| UpstreamConfigError::AllowedModels)?;
        Self::new(
            key,
            origin.trim_end_matches('/').into(),
            Duration::from_secs(90),
            model,
            openrouter,
            prices,
            policy,
        )
        .map_err(|()| UpstreamConfigError::Client)
    }
```

In `crates/buzz-relay/src/api/credits_gateway.rs`, the start of `router` becomes:

```rust
pub fn router(relay: Arc<AppState>) -> Router {
    let flag = std::env::var("COLONY_CREDITS_GATEWAY").ok().as_deref() == Some("1");
    let upstream = match Upstream::from_env() {
        Ok(upstream) => Some(Arc::new(upstream)),
        Err(reason) => {
            if flag {
                tracing::error!("Colony credits gateway is OFF: {reason}");
            }
            None
        }
    };
    let enabled = flag && upstream.is_some();
    if enabled {
        tracing::info!("Colony credits gateway is ON");
    }
    let gateway = Gateway {
        relay,
        upstream,
        enabled,
        limits: super::credits_gateway_limits::limits_from_env(),
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/^api::credits_gateway_/)'`
Expected: PASS (the new `config_tests` and every existing gateway test).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/api/credits_gateway_upstream.rs crates/buzz-relay/src/api/credits_gateway.rs
git commit -s -m "fix(credits): log which setting keeps the gateway off"
```

---

### Task 9.3: Requests that compact instead of failing

**Files:**
- Modify: `crates/buzz-relay/src/api/credits_gateway_upstream.rs:14` (`MAX_BODY`), `:336` (upstream size check)
- Modify: `crates/buzz-agent/src/credits_gateway.rs:120-129` (size check in `complete`)
- Modify: `crates/buzz-agent/src/credits_gateway/tests.rs:126-142` (`images_and_oversized_inputs_fail_before_spend`)
- Modify: `crates/buzz-agent/src/config.rs:379-390` (new constants), `:770-781` (`from_env` ends with `finalize`), `:833` (new `finalize` and `apply_provider_limits`)
- Test: `crates/buzz-relay/src/api/credits_gateway_upstream.rs` (`tests`), `crates/buzz-agent/src/credits_gateway/tests.rs`, `crates/buzz-agent/src/config.rs` (`tests`)

**Interfaces:**
- Consumes: the CI filter from task 9.1 (so the relay test runs).
- Produces:
  - Relay: `pub(super) const MAX_BODY: usize = 128 * 1024;` and `const MAX_UPSTREAM_BODY: usize = 132 * 1024;`
  - `buzz-agent`: `pub(crate) const MAX_REQUEST_BYTES: usize = 128 * 1024;` in `credits_gateway.rs`; an oversized request returns `AgentError::LlmContextExceeded(String)`.
  - `buzz-agent`: `pub const COLONY_CREDITS_MAX_CONTEXT_TOKENS: u64 = 24_000;`, `pub const COLONY_CREDITS_MAX_TOOL_RESULT_TEXT_BYTES: usize = 16 * 1024;`, `Config::finalize(&mut self) -> Result<(), String>`.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` of `crates/buzz-relay/src/api/credits_gateway_upstream.rs`:

```rust
    #[test]
    fn the_largest_accepted_request_holds_less_than_forty_cents() {
        let upstream = Upstream::fake("https://openrouter.ai/api/v1".into(), Duration::from_secs(1));
        let near_limit = ManagedRequest {
            session_id: uuid::Uuid::new_v4(),
            request_id: uuid::Uuid::new_v4(),
            messages: vec![json!({"role":"user","content":"x".repeat(MAX_BODY - 1024)})],
            tools: vec![],
        };
        let (body, reserve) = upstream.request(&near_limit).unwrap();
        assert!(serde_json::to_vec(&body).unwrap().len() > 64 * 1024);
        assert!(reserve <= 400_000_000, "{reserve}");
        let too_big = ManagedRequest {
            messages: vec![json!({"role":"user","content":"x".repeat(MAX_UPSTREAM_BODY)})],
            ..near_limit
        };
        assert!(upstream.request(&too_big).is_err());
    }
```

Append to `crates/buzz-agent/src/credits_gateway/tests.rs`:

```rust
#[tokio::test]
async fn an_oversized_request_asks_for_a_handoff_and_is_never_sent() {
    let (origin, captured, task) = fake(200, json!({"choices":[{"message":{"content":"never"}}]})).await;
    let gateway =
        CreditsGateway::new(&origin, &Uuid::new_v4().to_string(), Keys::generate(), None).unwrap();
    let huge = json!({"messages":[{"role":"user","content":"x".repeat(MAX_REQUEST_BYTES)}],"tools":[]});
    let error = gateway.complete(huge).await.unwrap_err();
    assert!(matches!(error, AgentError::LlmContextExceeded(_)), "{error}");
    assert!(captured.lock().unwrap().is_empty());
    task.abort();
}

#[tokio::test]
async fn a_request_that_fits_is_sent() {
    let (origin, captured, task) = fake(200, json!({"choices":[{"message":{"content":"ok"}}]})).await;
    let gateway =
        CreditsGateway::new(&origin, &Uuid::new_v4().to_string(), Keys::generate(), None).unwrap();
    let large = json!({"messages":[{"role":"user","content":"x".repeat(100 * 1024)}],"tools":[]});
    assert!(gateway.complete(large).await.is_ok());
    assert_eq!(captured.lock().unwrap().len(), 1);
    task.abort();
}
```

In the same file, replace the test `images_and_oversized_inputs_fail_before_spend` (lines 126-142) with:

```rust
#[tokio::test]
async fn images_fail_before_spend() {
    let (origin, captured, task) = fake(200, json!({"choices":[]})).await;
    let gateway =
        CreditsGateway::new(&origin, &Uuid::new_v4().to_string(), Keys::generate(), None).unwrap();
    let image = json!({"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:..."}}]}]});
    assert!(matches!(
        gateway.complete(image).await,
        Err(AgentError::Credits(CreditRefusal::Unsupported))
    ));
    assert!(captured.lock().unwrap().is_empty());
    task.abort();
}
```

Append inside the `tests` module of `crates/buzz-agent/src/config.rs`:

```rust
    #[test]
    fn credits_employees_hand_off_long_before_the_request_limit() {
        let mut cfg = Config::for_discovery(
            Provider::ColonyCredits,
            String::new(),
            "http://127.0.0.1:1".into(),
            None,
        );
        cfg.max_output_tokens = 4096;
        cfg.mcp_max_restart_attempts = 1;
        cfg.mcp_restart_base_ms = 1;
        cfg.mcp_restart_max_ms = 1;
        cfg.max_parallel_tools = 1;
        cfg.finalize().unwrap();
        assert_eq!(cfg.max_context_tokens, COLONY_CREDITS_MAX_CONTEXT_TOKENS);
        assert_eq!(cfg.max_tool_result_text_bytes, COLONY_CREDITS_MAX_TOOL_RESULT_TEXT_BYTES);
        // Even at five bytes a token, the hand-off point sits well under 128 KiB.
        assert!(COLONY_CREDITS_MAX_CONTEXT_TOKENS / 10 * 9 * 5 < 128 * 1024);

        let mut other = Config::for_discovery(
            Provider::OpenRouter,
            "key".into(),
            "https://example.com".into(),
            None,
        );
        other.max_output_tokens = 4096;
        other.mcp_max_restart_attempts = 1;
        other.mcp_restart_base_ms = 1;
        other.mcp_restart_max_ms = 1;
        other.max_parallel_tools = 1;
        other.finalize().unwrap();
        assert_eq!(other.max_context_tokens, 200_001);
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/the_largest_accepted_request_holds_less_than_forty_cents/)'`
Expected: compile failure, `error[E0425]: cannot find value MAX_UPSTREAM_BODY in this scope`.

Run: `cargo nextest run -p buzz-agent --lib -E 'test(/an_oversized_request_asks_for_a_handoff|a_request_that_fits_is_sent|credits_employees_hand_off/)'`
Expected: compile failure, `cannot find value MAX_REQUEST_BYTES`, `no method named finalize`, `cannot find value COLONY_CREDITS_MAX_CONTEXT_TOKENS`.

- [ ] **Step 3: Implement the relay limits**

In `crates/buzz-relay/src/api/credits_gateway_upstream.rs`, replace line 14 with:

```rust
/// Largest managed request body a Colony employee may send (the HTTP limit).
pub(super) const MAX_BODY: usize = 128 * 1024;
/// Largest body sent upstream after Colony adds model and routing fields. At
/// this size the conservative hold is still under 400,000,000 nanoUSD.
const MAX_UPSTREAM_BODY: usize = 132 * 1024;
```

and in `ManagedRequest::upstream_body` replace `if bytes.len() > MAX_BODY {` with `if bytes.len() > MAX_UPSTREAM_BODY {`.

- [ ] **Step 4: Implement the `buzz-agent` request limit and the credits defaults**

In `crates/buzz-agent/src/credits_gateway.rs`, add above `pub(crate) struct CreditsGateway`:

```rust
/// Largest managed request body the relay accepts (relay `MAX_BODY`).
pub(crate) const MAX_REQUEST_BYTES: usize = 128 * 1024;
```

and replace in `complete`:

```rust
        if body.len() > 64 * 1024 {
            return Err(AgentError::Credits(CreditRefusal::Unsupported));
        }
```

with:

```rust
        if body.len() > MAX_REQUEST_BYTES {
            // Never sent, never billed. The agent loop compacts its history and
            // tries again, exactly as for a provider's context-window error.
            return Err(AgentError::LlmContextExceeded(format!(
                "colony credits request is {} bytes; the limit is {MAX_REQUEST_BYTES}",
                body.len()
            )));
        }
```

In `crates/buzz-agent/src/config.rs`, add after `pub const DEFAULT_TOOL_RESULT_TEXT_BYTES` (line 390):

```rust
/// Colony credits requests must fit the relay's 128 KiB managed request limit,
/// so a credits employee hands its history off much earlier than other providers.
pub const COLONY_CREDITS_MAX_CONTEXT_TOKENS: u64 = 24_000;
/// Largest tool result text kept for a Colony credits employee, so one round of
/// tool results cannot push a request past the limit.
pub const COLONY_CREDITS_MAX_TOOL_RESULT_TEXT_BYTES: usize = 16 * 1024;
```

Add to `impl Config`, right above `fn validate(&self)`:

```rust
    /// Apply limits the provider imposes, then validate. Settings may lower a
    /// provider limit, never raise it.
    pub(crate) fn finalize(&mut self) -> Result<(), String> {
        self.apply_provider_limits();
        self.validate()
    }

    fn apply_provider_limits(&mut self) {
        if self.provider == Provider::ColonyCredits {
            self.max_context_tokens = self.max_context_tokens.min(COLONY_CREDITS_MAX_CONTEXT_TOKENS);
            self.max_tool_result_text_bytes = self
                .max_tool_result_text_bytes
                .min(COLONY_CREDITS_MAX_TOOL_RESULT_TEXT_BYTES);
        }
    }
```

At the end of `from_env`, replace `let cfg = Config {` with `let mut cfg = Config {` and replace `cfg.validate()?;` (line 779) with `cfg.finalize()?;`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/^api::credits_gateway_upstream::/)'`
Expected: PASS.

Run: `cargo nextest run -p buzz-agent --lib -E 'test(/credits_gateway::|credits_employees_hand_off/)'`
Expected: PASS, including the replaced `images_fail_before_spend`.

- [ ] **Step 6: Commit**

```bash
git add crates/buzz-relay/src/api/credits_gateway_upstream.rs crates/buzz-agent/src/credits_gateway.rs crates/buzz-agent/src/credits_gateway/tests.rs crates/buzz-agent/src/config.rs
git commit -s -m "fix(credits): compact long conversations instead of refusing them"
```

---

### Task 9.4: The harness stops cleanly on refusals that spent nothing

**Files:**
- Create: `crates/buzz-acp/src/harness_exit.rs`
- Modify: `crates/buzz-acp/src/lib.rs:12` (declare module after `mod filter;`), `:2459-2462` (`run`), `:4716-4728` (credits branch of `handle_prompt_result`), `:5090` (end of `handle_prompt_result`), `:4161-4164` (record the exit code before `tracing::info!("buzz-acp stopped")`)
- Modify: `crates/buzz-acp/src/queue.rs:199-235` (`EventQueue` field), `:241-254` (`new`), new methods in `impl EventQueue`
- Modify: `crates/buzz-acp/src/provider_failure.rs` (classification and two notices)
- Modify: `crates/buzz-agent/src/credits_gateway/tests.rs` (wording drift test)
- Test: `crates/buzz-acp/src/lib.rs` (`error_outcome_emission_tests`), `crates/buzz-acp/src/provider_failure.rs` (`tests`), `crates/buzz-acp/src/harness_exit.rs` (`tests`), `crates/buzz-agent/src/credits_gateway/tests.rs`

**Interfaces:**
- Consumes: Part C's wake ledger function `crate::wake_ledger::forget_events(path: &std::path::Path, events: &[(String, u64)]) -> std::io::Result<()>` (contract change 4 below) and the `COLONY_WAKE_LEDGER` environment variable from the overview.
- Produces:
  - `harness_exit::EXIT_CREDITS_OUT: i32 = 75`, `harness_exit::EXIT_REAUTHORIZE: i32 = 77`
  - `harness_exit::batch_events(batch: &FlushBatch) -> Vec<(String, u64)>`
  - `harness_exit::return_to_ledger(batch: &FlushBatch, ledger: Option<&Path>) -> std::io::Result<()>`
  - `harness_exit::wake_ledger_path() -> Option<PathBuf>`, `record_final(code: Option<i32>)`, `final_code() -> Option<i32>`
  - `EventQueue::request_exit(&mut self, code: i32)`, `EventQueue::exit_requested(&self) -> Option<i32>`
  - `provider_failure::CreditsStop { OutOfCredits, SessionExpired, Busy }`, `provider_failure::credits_stop(error: &AcpError) -> Option<CreditsStop>`, `credits_busy_notice() -> &'static str`, `credits_lost_turn_notice() -> &'static str`

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` of `crates/buzz-acp/src/provider_failure.rs`:

```rust
    #[test]
    fn only_refusals_before_any_spend_are_safe_to_process_again() {
        let stop = |message: &str| {
            credits_stop(&AcpError::AgentError {
                code: -32004,
                message: message.into(),
            })
        };
        assert_eq!(
            stop("Out of credits. Top up to keep your Colony Agent working."),
            Some(CreditsStop::OutOfCredits)
        );
        assert_eq!(
            stop("Managed session expired or unauthorized. Restart your Colony Agent."),
            Some(CreditsStop::SessionExpired)
        );
        assert_eq!(
            stop("Your Colony Agents are busy. Try again shortly."),
            Some(CreditsStop::Busy)
        );
        for maybe_billed in [
            "Usage is being recovered automatically. This turn was stopped; do not resend it automatically.",
            "This request was already charged. Its response could not be recovered. Start a new conversation turn.",
            "Colony credits are unavailable. Try again later.",
        ] {
            assert_eq!(stop(maybe_billed), None, "{maybe_billed}");
        }
        assert_eq!(
            credits_stop(&AcpError::AgentError {
                code: -32000,
                message: "Out of credits. Top up to keep your Colony Agent working.".into(),
            }),
            None
        );
        assert!(!credits_busy_notice().contains('⚠'));
        assert!(!credits_lost_turn_notice().contains('⚠'));
    }
```

Create `crates/buzz-acp/src/harness_exit.rs` containing only the tests:

```rust
//! Exit codes for clean credits stops, which the host tells apart from crashes.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queue::{BatchEvent, FlushBatch};
    use crate::scope::SessionScope;
    use nostr::{EventBuilder, Keys, Kind};

    fn batch_with(events: usize, cancelled: usize) -> FlushBatch {
        let item = |text: &str| BatchEvent {
            event: EventBuilder::new(Kind::Custom(9), text)
                .sign_with_keys(&Keys::generate())
                .unwrap(),
            prompt_tag: "test".into(),
            received_at: std::time::Instant::now(),
        };
        let channel_id = uuid::Uuid::new_v4();
        FlushBatch {
            channel_id,
            scope: SessionScope::Conversation { channel_id },
            events: (0..events).map(|i| item(&format!("message {i}"))).collect(),
            cancelled_events: (0..cancelled).map(|i| item(&format!("earlier {i}"))).collect(),
            cancel_reason: None,
        }
    }

    #[test]
    fn a_refused_batch_lists_every_message_it_carried() {
        let listed = batch_events(&batch_with(2, 1));
        assert_eq!(listed.len(), 3);
        assert!(listed.iter().all(|(id, at)| id.len() == 64 && *at > 0));
    }

    #[test]
    fn without_a_wake_ledger_there_is_nothing_to_hand_back() {
        assert!(return_to_ledger(&batch_with(1, 0), None).is_ok());
    }

    #[test]
    fn an_unusable_wake_ledger_is_reported() {
        let dir = std::env::temp_dir().join(format!("colony-ledger-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let result = return_to_ledger(&batch_with(1, 0), Some(&dir));
        std::fs::remove_dir(&dir).unwrap();
        assert!(result.is_err());
    }

    #[test]
    fn the_final_code_is_set_once_by_the_main_loop() {
        record_final(None);
        assert_eq!(final_code(), None);
        record_final(Some(EXIT_CREDITS_OUT));
        assert_eq!(final_code(), Some(75));
        record_final(None);
    }
}
```

In `crates/buzz-acp/src/lib.rs`, add `mod harness_exit;` after `mod filter;` (line 12), then append inside `mod error_outcome_emission_tests`:

```rust
    /// A credits refusal the relay gave before admitting the request, run through
    /// the production result handler with a managed credits session.
    async fn handle_credits_refusal(
        message: &str,
    ) -> (LoopAction, EventQueue, Uuid, tokio::net::TcpListener) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let rest = relay::RestClient {
            http: reqwest::Client::new(),
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            keys: Keys::generate(),
            auth_tag_json: None,
        };
        let channel_id = Uuid::new_v4();
        let scope = scope::SessionScope::Conversation { channel_id };
        let event = EventBuilder::new(Kind::Custom(9), "draft next week's posts")
            .sign_with_keys(&Keys::generate())
            .unwrap();
        let batch = FlushBatch {
            channel_id,
            scope: scope.clone(),
            events: vec![BatchEvent {
                event,
                prompt_tag: "test".into(),
                received_at: std::time::Instant::now(),
            }],
            cancelled_events: vec![],
            cancel_reason: None,
        };
        let agent = dummy_agent(0).await;
        let mut pool = AgentPool::from_slots(vec![None]);
        let task = pool.join_set.spawn(async {}).id();
        pool.task_map_mut().insert(
            task,
            crate::pool::TaskMeta {
                agent_index: 0,
                channel_id: Some(channel_id),
                scope: Some(scope.clone()),
                turn_id: "credits-refusal".into(),
                recoverable_batch: None,
                control_tx: None,
                steer_tx: None,
                successful_steer_deliveries: HashSet::new(),
            },
        );
        let mut queue = EventQueue::new(config::DedupMode::Queue);
        let mut config = test_config();
        config.managed_credits_session = Some(Uuid::new_v4());
        let mut heartbeat = false;
        let removed = HashSet::new();
        let mut history = vec![SlotCircuit {
            crash_times: vec![],
            open_until: None,
            respawn_in_flight: false,
        }];
        let (sender, _receiver) = mpsc::channel(8);
        let mut respawns = tokio::task::JoinSet::new();
        let result = PromptResult {
            agent,
            source: PromptSource::Channel(scope),
            turn_id: "credits-refusal".into(),
            outcome: PromptOutcome::Error(AcpError::AgentError {
                code: -32004,
                message: message.into(),
            }),
            batch: Some(batch),
        };
        let action = handle_prompt_result(
            &mut pool,
            &mut queue,
            &config,
            result,
            &mut heartbeat,
            &removed,
            &mut history,
            &sender,
            &mut respawns,
            None,
            Some(&rest),
        );
        (action, queue, channel_id, listener)
    }

    async fn assert_no_chat_message(listener: &tokio::net::TcpListener) {
        assert!(
            tokio::time::timeout(Duration::from_secs(1), listener.accept())
                .await
                .is_err(),
            "a refusal before any spend must not post a chat message"
        );
    }

    #[tokio::test]
    async fn out_of_credits_stops_cleanly_and_asks_the_host_to_pause() {
        let (action, queue, channel_id, listener) =
            handle_credits_refusal("Out of credits. Top up to keep your Colony Agent working.").await;
        assert!(action == LoopAction::Exit);
        assert_eq!(queue.exit_requested(), Some(harness_exit::EXIT_CREDITS_OUT));
        assert_eq!(queue.queued_event_count(channel_id), 0);
        assert_no_chat_message(&listener).await;
    }

    #[tokio::test]
    async fn an_expired_credits_session_asks_the_host_for_a_fresh_one() {
        let (action, queue, _channel_id, listener) = handle_credits_refusal(
            "Managed session expired or unauthorized. Restart your Colony Agent.",
        )
        .await;
        assert!(action == LoopAction::Exit);
        assert_eq!(queue.exit_requested(), Some(harness_exit::EXIT_REAUTHORIZE));
        assert_no_chat_message(&listener).await;
    }

    #[tokio::test]
    async fn a_busy_gateway_retries_quietly() {
        let (action, queue, channel_id, listener) =
            handle_credits_refusal("Your Colony Agents are busy. Try again shortly.").await;
        assert!(action == LoopAction::Continue);
        assert_eq!(queue.exit_requested(), None);
        assert_eq!(queue.queued_event_count(channel_id), 1);
        assert_no_chat_message(&listener).await;
    }
```

Append to `crates/buzz-agent/src/credits_gateway/tests.rs`:

```rust
#[test]
fn refusal_texts_match_what_the_harness_classifies() {
    // buzz-acp provider_failure::credits_stop matches these exact strings.
    assert_eq!(
        CreditRefusal::OutOfCredits.to_string(),
        "Out of credits. Top up to keep your Colony Agent working."
    );
    assert_eq!(
        CreditRefusal::Unauthorized.to_string(),
        "Managed session expired or unauthorized. Restart your Colony Agent."
    );
    assert_eq!(
        CreditRefusal::Busy.to_string(),
        "Your Colony Agents are busy. Try again shortly."
    );
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo nextest run -p buzz-acp --lib -E 'test(/credits_stop|only_refusals_before_any_spend|harness_exit::|out_of_credits_stops_cleanly|an_expired_credits_session|a_busy_gateway_retries/)'`
Expected: compile failure, `cannot find function credits_stop`, `cannot find function batch_events`, `no method named exit_requested found for struct EventQueue`.

Run: `cargo nextest run -p buzz-agent --lib -E 'test(/refusal_texts_match/)'`
Expected: PASS already (it pins today's wording; it fails later only if someone changes a refusal text).

- [ ] **Step 3: Implement the classification and the notices**

Add to `crates/buzz-acp/src/provider_failure.rs`, after `credits_interrupted_notice`:

```rust
/// A Colony credits refusal the relay gave before admitting the request, so
/// nothing was spent and the same messages are safe to process again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CreditsStop {
    /// 402: the owner's balance cannot fund the request.
    OutOfCredits,
    /// 401 or 403: the two-hour session ended or was revoked.
    SessionExpired,
    /// 429: the account or session already has its limit of requests waiting.
    Busy,
}

/// Classify a credits failure. Every other credits failure may have been billed
/// and keeps the "never replay" rule.
pub(crate) fn credits_stop(error: &AcpError) -> Option<CreditsStop> {
    let AcpError::AgentError { code, message } = error else {
        return None;
    };
    if *code != -32004 {
        return None;
    }
    match message.as_str() {
        "Out of credits. Top up to keep your Colony Agent working." => {
            Some(CreditsStop::OutOfCredits)
        }
        "Managed session expired or unauthorized. Restart your Colony Agent." => {
            Some(CreditsStop::SessionExpired)
        }
        "Your Colony Agents are busy. Try again shortly." => Some(CreditsStop::Busy),
        _ => None,
    }
}

/// Posted only when a busy gateway refused the same messages until the retry budget ran out.
pub(crate) fn credits_busy_notice() -> &'static str {
    "I couldn't get to this because the team was busy for too long. Please send it again."
}

/// Posted only when refused messages could not be handed back for a later retry.
pub(crate) fn credits_lost_turn_notice() -> &'static str {
    "I couldn't get to this. Please send it again in a few minutes."
}
```

- [ ] **Step 4: Implement `harness_exit` and the queue's exit request**

Insert above the `tests` module in `crates/buzz-acp/src/harness_exit.rs`:

```rust
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, Ordering};

use crate::queue::FlushBatch;

/// The owner's credits cannot fund the next request. The host pauses the team.
pub const EXIT_CREDITS_OUT: i32 = 75;
/// The two-hour credits session ended. The host restarts this employee with a fresh session.
pub const EXIT_REAUTHORIZE: i32 = 77;

static FINAL: AtomicI32 = AtomicI32::new(0);

/// Remember the exit code the main loop ended with. Called once, after shutdown.
pub(crate) fn record_final(code: Option<i32>) {
    FINAL.store(code.unwrap_or(0), Ordering::SeqCst);
}

/// The exit code to use when the process ends, if a clean credits stop asked for one.
pub(crate) fn final_code() -> Option<i32> {
    match FINAL.load(Ordering::SeqCst) {
        0 => None,
        code => Some(code),
    }
}

/// The wake ledger the host gave this employee, if any.
pub(crate) fn wake_ledger_path() -> Option<PathBuf> {
    std::env::var_os("COLONY_WAKE_LEDGER").map(PathBuf::from)
}

/// Every message a batch carried, as (event id hex, created_at seconds).
pub(crate) fn batch_events(batch: &FlushBatch) -> Vec<(String, u64)> {
    batch
        .events
        .iter()
        .chain(batch.cancelled_events.iter())
        .map(|item| (item.event.id.to_hex(), item.event.created_at.as_secs()))
        .collect()
}

/// Hand a batch the relay refused before any spend back to the wake ledger, so
/// the next start processes it once more.
pub(crate) fn return_to_ledger(batch: &FlushBatch, ledger: Option<&Path>) -> std::io::Result<()> {
    match ledger {
        Some(path) => crate::wake_ledger::forget_events(path, &batch_events(batch)),
        None => Ok(()),
    }
}
```

In `crates/buzz-acp/src/queue.rs`, add the field at the end of `struct EventQueue` (after `in_flight_deadline: Duration,`):

```rust
    /// Exit code a clean credits stop asked for; the main loop exits after this turn.
    exit_code: Option<i32>,
```

initialize it in `EventQueue::new` with `exit_code: None,`, and add to `impl EventQueue`:

```rust
    /// Ask the main loop to stop after this turn and exit with `code`. The first request wins.
    pub fn request_exit(&mut self, code: i32) {
        if self.exit_code.is_none() {
            self.exit_code = Some(code);
        }
    }

    /// The exit code a clean credits stop asked for, if any.
    pub fn exit_requested(&self) -> Option<i32> {
        self.exit_code
    }
```

- [ ] **Step 5: Wire the stop into `handle_prompt_result`, the shutdown and `run`**

In `crates/buzz-acp/src/lib.rs`, replace the credits branch body of `handle_prompt_result` (lines 4716-4728, from `if config.managed_credits_session.is_some()` to the line that sets `hard_timeout_fate_suffix = Some(" (automatic replay stopped for Colony credits)");` and its closing brace) with:

```rust
            if config.managed_credits_session.is_some()
                && !matches!(result.outcome, PromptOutcome::Ok(_))
            {
                let stop = match &result.outcome {
                    PromptOutcome::Error(error) => provider_failure::credits_stop(error),
                    _ => None,
                };
                match stop {
                    Some(provider_failure::CreditsStop::Busy) => {
                        // Refused before admission, so nothing was billed: retry
                        // with the queue's backoff and stay quiet.
                        if let Some(dead) = queue.requeue(batch) {
                            spawn_failure_notice(
                                rest_client,
                                &dead,
                                provider_failure::credits_busy_notice().to_owned(),
                            );
                        }
                        hard_timeout_fate_suffix = Some(" (credits busy, retried quietly)");
                    }
                    Some(stop) => {
                        // Refused before admission, so nothing was billed. Hand the
                        // messages back to the wake ledger and stop this employee so
                        // the host can pause the team or start a fresh session.
                        let ledger = harness_exit::wake_ledger_path();
                        if let Err(error) = harness_exit::return_to_ledger(&batch, ledger.as_deref()) {
                            tracing::error!(
                                "could not hand refused messages back to the wake ledger: {error}"
                            );
                            spawn_failure_notice(
                                rest_client,
                                &batch,
                                provider_failure::credits_lost_turn_notice().to_owned(),
                            );
                        }
                        queue.request_exit(match stop {
                            provider_failure::CreditsStop::OutOfCredits => {
                                harness_exit::EXIT_CREDITS_OUT
                            }
                            _ => harness_exit::EXIT_REAUTHORIZE,
                        });
                        hard_timeout_fate_suffix = Some(" (credits stop, exiting for the host)");
                    }
                    None => {
                        // A lost ACP response, process exit, timeout or cancellation may
                        // follow billed inference. Never create a fresh paid request by
                        // replaying this batch, including annotated cancelled prompts.
                        let notice = match &result.outcome {
                            PromptOutcome::Error(error) => provider_failure::notice(error),
                            _ => None,
                        }
                        .unwrap_or_else(|| provider_failure::credits_interrupted_notice().to_owned());
                        spawn_failure_notice(rest_client, &batch, notice);
                        hard_timeout_fate_suffix =
                            Some(" (automatic replay stopped for Colony credits)");
                    }
                }
            } else if matches!(
```

(The `} else if matches!(` line continues the existing `PromptOutcome::Cancelled` branch unchanged.)

At the end of `handle_prompt_result` (line 5090), replace the final `LoopAction::Continue` that follows the `pool.return_agent(result.agent);` block with:

```rust
    if queue.exit_requested().is_some() {
        return LoopAction::Exit;
    }
    LoopAction::Continue
```

At the end of `tokio_main` (line 4163), replace:

```rust
    tracing::info!("buzz-acp stopped");
    Ok(())
```

with:

```rust
    harness_exit::record_final(queue.exit_requested());
    tracing::info!("buzz-acp stopped");
    Ok(())
```

and replace `run` (lines 2459-2462) with:

```rust
pub fn run() -> Result<()> {
    config::propagate_legacy_env_vars();
    tokio_main()?;
    if let Some(code) = harness_exit::final_code() {
        // A clean credits stop: the host pauses the team (75) or starts a fresh
        // session (77). Neither is a crash.
        std::process::exit(code);
    }
    Ok(())
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo nextest run -p buzz-acp --lib`
Expected: PASS, including the five new tests and the unchanged `credits_refusals_post_one_safe_threaded_notice_without_requeueing` and `credits_interruptions_never_requeue_an_ambiguous_paid_batch`.

Run: `cargo nextest run -p buzz-agent --lib -E 'test(/credits_gateway::/)'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/buzz-acp/src/harness_exit.rs crates/buzz-acp/src/lib.rs crates/buzz-acp/src/queue.rs crates/buzz-acp/src/provider_failure.rs crates/buzz-agent/src/credits_gateway/tests.rs
git commit -s -m "feat(harness): stop cleanly when credits run out or a session ends"
```

---

### Task 9.5: The host pauses the team for credits and resumes it

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/credits_pause.rs` (replace the stub Part D creates, contract change 3; create the file if it does not exist)
- Create: `desktop/src-tauri/src/managed_agents/credits_pause/tests.rs`
- Modify: `desktop/src-tauri/src/managed_agents/mod.rs:19` (only if the module is not declared yet: add `pub(crate) mod credits_pause;` after `pub(crate) mod credits_gateway;`)
- Test: `desktop/src-tauri/src/managed_agents/credits_pause/tests.rs`

**Interfaces:**
- Consumes:
  - Part D (contract change 2): `crate::managed_agents::team_runner::{PauseReason, pause_company, resume_company}` with `pub(crate) async fn pause_company(app: &AppHandle, relay_url: &str, reason: PauseReason) -> Result<(), String>` and the same signature for `resume_company`.
  - Part D (contract change 3): the calls from the team runner into `on_harness_exit`, `is_paused_for_credits`, `ensure_watcher` and `resume_if_funded`.
  - Existing: `crate::app_state::AppState::signing_keys(&self) -> Result<nostr::Keys, String>` (`desktop/src-tauri/src/app_state_accessors.rs:52`), `crate::relay::build_nip98_auth_header_for_keys(keys, method, url, body) -> Result<String, String>` (`desktop/src-tauri/src/relay.rs:130`), `buzz_agent_pkg::credits_gateway::gateway_origin(relay) -> Result<String, CreditRefusal>`, `super::managed_agents_base_dir(app) -> Result<PathBuf, String>` (`desktop/src-tauri/src/managed_agents/storage.rs:35`).
  - Task 9.4: harness exit codes 75 and 77.
- Produces (signatures Part D's stub already has):
  - `pub(crate) enum ExitHandling { PausedForCredits, RestartNow, Crash }`
  - `pub(crate) async fn on_harness_exit(app: &AppHandle, relay_url: &str, agent_pubkey: &str, code: Option<i32>) -> ExitHandling`
  - `pub(crate) fn is_paused_for_credits(app: &AppHandle, relay_url: &str) -> bool`
  - `pub(crate) fn ensure_watcher(app: &AppHandle, relay_url: &str)`
  - `pub(crate) async fn resume_if_funded(app: &AppHandle, relay_url: &str) -> Result<bool, String>`
  - Also: `HARNESS_EXIT_CREDITS_OUT`, `HARNESS_EXIT_REAUTHORIZE`, `RESUME_THRESHOLD_NANOUSD`, `REAUTHORIZE_WINDOW`, `HarnessExit`, `WatchStep`, `classify_exit`, `decide`, `poll_delay`, `watch_step`, `ReauthorizeGuard`, `CreditsPauseStore`, `fetch_balance_nanousd`.

- [ ] **Step 1: Write the failing tests**

Create `desktop/src-tauri/src/managed_agents/credits_pause/tests.rs`:

```rust
use super::*;

#[test]
fn only_the_two_credits_exit_codes_are_not_crashes() {
    assert_eq!(classify_exit(Some(HARNESS_EXIT_CREDITS_OUT)), HarnessExit::CreditsOut);
    assert_eq!(classify_exit(Some(HARNESS_EXIT_REAUTHORIZE)), HarnessExit::Reauthorize);
    for code in [None, Some(0), Some(1), Some(101), Some(-1)] {
        assert_eq!(classify_exit(code), HarnessExit::Other, "{code:?}");
    }
}

#[test]
fn credits_out_pauses_and_a_fresh_session_restarts_at_most_once_per_window() {
    assert_eq!(decide(HarnessExit::CreditsOut, false), ExitHandling::PausedForCredits);
    assert_eq!(decide(HarnessExit::Reauthorize, true), ExitHandling::RestartNow);
    assert_eq!(decide(HarnessExit::Reauthorize, false), ExitHandling::Crash);
    assert_eq!(decide(HarnessExit::Other, true), ExitHandling::Crash);

    let mut guard = ReauthorizeGuard::new();
    let start = Instant::now();
    assert!(guard.allow("naledi", start));
    assert!(!guard.allow("naledi", start + Duration::from_secs(9 * 60)));
    assert!(guard.allow("sipho", start + Duration::from_secs(60)));
    assert!(guard.allow("naledi", start + REAUTHORIZE_WINDOW + Duration::from_secs(1)));
}

#[test]
fn polling_backs_off_to_two_minutes_and_resumes_only_with_fifty_cents() {
    assert_eq!(poll_delay(0), Duration::from_secs(30));
    assert_eq!(poll_delay(1), Duration::from_secs(60));
    assert_eq!(poll_delay(2), Duration::from_secs(120));
    assert_eq!(poll_delay(u32::MAX), Duration::from_secs(120));
    assert_eq!(watch_step(&Ok(RESUME_THRESHOLD_NANOUSD - 1)), WatchStep::Wait);
    assert_eq!(watch_step(&Ok(RESUME_THRESHOLD_NANOUSD)), WatchStep::Resume);
    assert_eq!(watch_step(&Err("offline".into())), WatchStep::Wait);
}

#[test]
fn the_pause_survives_a_restart_and_clears_once() {
    let dir = tempfile::tempdir().unwrap();
    let store = CreditsPauseStore::in_dir(dir.path());
    let relay = "wss://lerato-designs.colony.global";
    assert!(!store.is_paused(relay).unwrap());
    store.set_paused(relay, 1_760_180_000).unwrap();
    store.set_paused(relay, 1_760_190_000).unwrap();
    let reopened = CreditsPauseStore::in_dir(dir.path());
    assert!(reopened.is_paused(relay).unwrap());
    assert_eq!(reopened.paused_since(relay).unwrap(), Some(1_760_180_000));
    assert_eq!(reopened.paused_relays().unwrap(), vec![relay.to_string()]);
    reopened.clear(relay).unwrap();
    assert!(!store.is_paused(relay).unwrap());
    reopened.clear(relay).unwrap();
}

#[test]
fn a_damaged_pause_file_is_reported_not_guessed() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("credits-pause.json"), b"{not json").unwrap();
    assert!(CreditsPauseStore::in_dir(dir.path()).is_paused("wss://x").is_err());
}

async fn serve_once(
    status: &'static str,
    body: &'static str,
) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let relay = format!("ws://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut reader = BufReader::new(socket);
        let mut head = Vec::new();
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).await.unwrap() == 0 || line == "\r\n" {
                break;
            }
            head.push(line);
        }
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        reader.get_mut().write_all(response.as_bytes()).await.unwrap();
        head
    });
    (relay, task)
}

#[tokio::test]
async fn the_balance_is_read_with_the_owners_signature() {
    let (relay, server) = serve_once(
        "200 OK",
        r#"{"balanceNanousd":"750000000","balanceUsdCents":75,"currency":"USD","source":"account_credit_ledger"}"#,
    )
    .await;
    let owner = nostr::Keys::generate();
    assert_eq!(fetch_balance_nanousd(&relay, &owner).await.unwrap(), 750_000_000);
    let head = server.await.unwrap();
    assert_eq!(head[0], "GET /api/payments/balance HTTP/1.1\r\n");
    assert!(head
        .iter()
        .any(|line| line.to_ascii_lowercase().starts_with("authorization: nostr ")));
}

#[tokio::test]
async fn a_refused_balance_read_is_an_error() {
    let (relay, server) = serve_once("401 Unauthorized", r#"{"error":"account_not_found"}"#).await;
    assert!(fetch_balance_nanousd(&relay, &nostr::Keys::generate()).await.is_err());
    server.await.unwrap();
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib credits_pause`
Expected: compile failure, `cannot find function classify_exit in this scope`, `cannot find type CreditsPauseStore`, `cannot find function fetch_balance_nanousd` (the stub has none of them).

- [ ] **Step 3: Replace the stub with the implementation**

Write `desktop/src-tauri/src/managed_agents/credits_pause.rs`:

```rust
//! Pause the team when the owner's credits run out, and resume it when they are back.
//!
//! The harness exits with [`HARNESS_EXIT_CREDITS_OUT`] after a request was refused
//! for lack of credits: nothing was spent and its messages went back to the wake
//! ledger. The host then pauses every employee of that company, records the pause
//! so it survives a restart, and polls the owner's balance with a growing wait
//! until it covers the next request. The app ends the wait at once by calling
//! `team_resume` after a confirmed purchase.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::team_runner::{pause_company, resume_company, PauseReason};

/// Harness exit code: credits cannot fund the next request (buzz-acp `EXIT_CREDITS_OUT`).
pub(crate) const HARNESS_EXIT_CREDITS_OUT: i32 = 75;
/// Harness exit code: the credits session ended (buzz-acp `EXIT_REAUTHORIZE`).
pub(crate) const HARNESS_EXIT_REAUTHORIZE: i32 = 77;
/// Resume when the balance covers the largest single hold with room to spare ($0.50).
pub(crate) const RESUME_THRESHOLD_NANOUSD: i64 = 500_000_000;
/// A second fresh-session restart inside this window counts as a crash.
pub(crate) const REAUTHORIZE_WINDOW: Duration = Duration::from_secs(10 * 60);

const PROBLEM_EVENT: &str = "team://problem";
const CREDITS_OUT_DETAIL: &str = "Credits ran out. Your team is paused until credits are added.";
const STILL_TOO_LOW: &str = "Credits are still too low to restart your team.";
const UNREADABLE: &str = "Could not check credits.";

static WATCHING: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
static REAUTHORIZE: Mutex<ReauthorizeGuard> = Mutex::new(ReauthorizeGuard::new());

/// What a harness exit code means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HarnessExit {
    CreditsOut,
    Reauthorize,
    Other,
}

/// What the team runner should do after an employee's harness exits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitHandling {
    /// The team was paused for credits; do not restart this employee now.
    PausedForCredits,
    /// Restart this employee now with a fresh credits session; not a crash.
    RestartNow,
    /// Apply the normal crash policy.
    Crash,
}

/// One balance poll's outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WatchStep {
    Resume,
    Wait,
}

pub(crate) fn classify_exit(code: Option<i32>) -> HarnessExit {
    match code {
        Some(HARNESS_EXIT_CREDITS_OUT) => HarnessExit::CreditsOut,
        Some(HARNESS_EXIT_REAUTHORIZE) => HarnessExit::Reauthorize,
        _ => HarnessExit::Other,
    }
}

pub(crate) fn decide(exit: HarnessExit, reauthorize_allowed: bool) -> ExitHandling {
    match exit {
        HarnessExit::CreditsOut => ExitHandling::PausedForCredits,
        HarnessExit::Reauthorize if reauthorize_allowed => ExitHandling::RestartNow,
        HarnessExit::Reauthorize | HarnessExit::Other => ExitHandling::Crash,
    }
}

/// Waits between balance polls: 30 s, 60 s, then 120 s.
pub(crate) fn poll_delay(attempt: u32) -> Duration {
    match attempt {
        0 => Duration::from_secs(30),
        1 => Duration::from_secs(60),
        _ => Duration::from_secs(120),
    }
}

pub(crate) fn watch_step(balance: &Result<i64, String>) -> WatchStep {
    match balance {
        Ok(nanousd) if *nanousd >= RESUME_THRESHOLD_NANOUSD => WatchStep::Resume,
        _ => WatchStep::Wait,
    }
}

/// Remembers when each employee last restarted for a fresh credits session.
pub(crate) struct ReauthorizeGuard {
    last: BTreeMap<String, Instant>,
}

impl ReauthorizeGuard {
    pub(crate) const fn new() -> Self {
        Self { last: BTreeMap::new() }
    }

    /// True when this employee may restart for a fresh session now.
    pub(crate) fn allow(&mut self, agent_pubkey: &str, now: Instant) -> bool {
        let allowed = self
            .last
            .get(agent_pubkey)
            .is_none_or(|last| now.duration_since(*last) >= REAUTHORIZE_WINDOW);
        if allowed {
            self.last.insert(agent_pubkey.to_owned(), now);
        }
        allowed
    }
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PauseFile {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    paused_since: BTreeMap<String, i64>,
}

/// Companies paused because credits ran out, kept in the host's app data.
pub(crate) struct CreditsPauseStore {
    path: PathBuf,
}

impl CreditsPauseStore {
    pub(crate) fn in_dir(dir: &Path) -> Self {
        Self { path: dir.join("credits-pause.json") }
    }

    pub(crate) fn for_app(app: &AppHandle) -> Result<Self, String> {
        Ok(Self::in_dir(&super::managed_agents_base_dir(app)?))
    }

    fn read(&self) -> Result<PauseFile, String> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| "The saved credits pause could not be read.".to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(PauseFile {
                schema_version: 1,
                paused_since: BTreeMap::new(),
            }),
            Err(_) => Err("The saved credits pause could not be read.".to_string()),
        }
    }

    fn write(&self, file: &PauseFile) -> Result<(), String> {
        let failed = || "Could not save the credits pause.".to_string();
        let bytes = serde_json::to_vec_pretty(file).map_err(|_| failed())?;
        let temp = self.path.with_extension("json.tmp");
        std::fs::write(&temp, bytes).map_err(|_| failed())?;
        std::fs::rename(&temp, &self.path).map_err(|_| failed())
    }

    pub(crate) fn is_paused(&self, relay_url: &str) -> Result<bool, String> {
        Ok(self.read()?.paused_since.contains_key(relay_url))
    }

    pub(crate) fn paused_since(&self, relay_url: &str) -> Result<Option<i64>, String> {
        Ok(self.read()?.paused_since.get(relay_url).copied())
    }

    /// Record the pause. A repeated call keeps the first time.
    pub(crate) fn set_paused(&self, relay_url: &str, since_unix: i64) -> Result<(), String> {
        let mut file = self.read()?;
        file.schema_version = 1;
        file.paused_since.entry(relay_url.to_owned()).or_insert(since_unix);
        self.write(&file)
    }

    pub(crate) fn clear(&self, relay_url: &str) -> Result<(), String> {
        let mut file = self.read()?;
        if file.paused_since.remove(relay_url).is_some() {
            self.write(&file)?;
        }
        Ok(())
    }

    pub(crate) fn paused_relays(&self) -> Result<Vec<String>, String> {
        Ok(self.read()?.paused_since.into_keys().collect())
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Decide how to treat an employee's harness exit, and start the credits pause when needed.
pub(crate) async fn on_harness_exit(
    app: &AppHandle,
    relay_url: &str,
    agent_pubkey: &str,
    code: Option<i32>,
) -> ExitHandling {
    let exit = classify_exit(code);
    let allowed = exit == HarnessExit::Reauthorize
        && REAUTHORIZE
            .lock()
            .map(|mut guard| guard.allow(agent_pubkey, Instant::now()))
            .unwrap_or(false);
    let handling = decide(exit, allowed);
    if handling == ExitHandling::PausedForCredits {
        enter_credits_pause(app, relay_url, agent_pubkey).await;
    }
    handling
}

async fn enter_credits_pause(app: &AppHandle, relay_url: &str, agent_pubkey: &str) {
    let newly_paused = match CreditsPauseStore::for_app(app) {
        Ok(store) => {
            let already = store.is_paused(relay_url).unwrap_or(false);
            if let Err(error) = store.set_paused(relay_url, now_unix()) {
                tracing::error!("credits pause not saved; it lasts until Colony quits: {error}");
            }
            !already
        }
        Err(error) => {
            tracing::error!("credits pause not saved; it lasts until Colony quits: {error}");
            true
        }
    };
    if let Err(error) = pause_company(app, relay_url, PauseReason::CreditsOut).await {
        tracing::error!("could not pause the team for credits: {error}");
    }
    if newly_paused {
        let _ = app.emit(
            PROBLEM_EVENT,
            serde_json::json!({
                "agentPubkey": agent_pubkey,
                "kind": "credits_out",
                "detail": CREDITS_OUT_DETAIL,
            }),
        );
    }
    ensure_watcher(app, relay_url);
}

/// True when this company is paused for credits. An unreadable record counts as
/// not paused: the gateway refuses spending anyway and the pause comes back.
pub(crate) fn is_paused_for_credits(app: &AppHandle, relay_url: &str) -> bool {
    CreditsPauseStore::for_app(app)
        .and_then(|store| store.is_paused(relay_url))
        .unwrap_or(false)
}

/// Poll the owner's balance for this company until it can fund work again.
/// At most one watcher runs per company.
pub(crate) fn ensure_watcher(app: &AppHandle, relay_url: &str) {
    let inserted = WATCHING
        .lock()
        .map(|mut watching| watching.insert(relay_url.to_owned()))
        .unwrap_or(false);
    if !inserted {
        return;
    }
    let app = app.clone();
    let relay_url = relay_url.to_owned();
    tauri::async_runtime::spawn(async move {
        watch_until_funded(&app, &relay_url).await;
        if let Ok(mut watching) = WATCHING.lock() {
            watching.remove(&relay_url);
        }
    });
}

async fn watch_until_funded(app: &AppHandle, relay_url: &str) {
    let mut attempt = 0u32;
    loop {
        tokio::time::sleep(poll_delay(attempt)).await;
        let Ok(store) = CreditsPauseStore::for_app(app) else {
            return;
        };
        if !store.is_paused(relay_url).unwrap_or(true) {
            // Cleared elsewhere, for example by `resume_if_funded`.
            return;
        }
        if watch_step(&owner_balance(app, relay_url).await) == WatchStep::Resume
            && resume_company(app, relay_url, PauseReason::CreditsOut).await.is_ok()
        {
            if let Err(error) = store.clear(relay_url) {
                tracing::error!("team resumed but the credits pause was not cleared: {error}");
            }
            return;
        }
        attempt = attempt.saturating_add(1);
    }
}

/// For `team_resume`: when the company is paused for credits, resume only if the
/// balance now covers work. Ok(false) means the company was not paused for credits.
pub(crate) async fn resume_if_funded(app: &AppHandle, relay_url: &str) -> Result<bool, String> {
    let store = CreditsPauseStore::for_app(app)?;
    if !store.is_paused(relay_url).unwrap_or(false) {
        return Ok(false);
    }
    match watch_step(&owner_balance(app, relay_url).await) {
        WatchStep::Resume => {
            resume_company(app, relay_url, PauseReason::CreditsOut).await?;
            store.clear(relay_url)?;
            Ok(true)
        }
        WatchStep::Wait => Err(STILL_TOO_LOW.to_string()),
    }
}

async fn owner_balance(app: &AppHandle, relay_url: &str) -> Result<i64, String> {
    let owner = app.state::<crate::app_state::AppState>().signing_keys()?;
    fetch_balance_nanousd(relay_url, &owner).await
}

/// Read the signed-in owner's credit balance from the relay, in nanoUSD.
pub(crate) async fn fetch_balance_nanousd(
    relay_url: &str,
    owner: &nostr::Keys,
) -> Result<i64, String> {
    let origin = buzz_agent_pkg::credits_gateway::gateway_origin(relay_url)
        .map_err(|_| UNREADABLE.to_string())?;
    let url = format!("{origin}/api/payments/balance");
    let auth = crate::relay::build_nip98_auth_header_for_keys(owner, &reqwest::Method::GET, &url, &[])?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| UNREADABLE.to_string())?;
    let mut response = client
        .get(&url)
        .header("authorization", auth)
        .send()
        .await
        .map_err(|_| UNREADABLE.to_string())?;
    if !response.status().is_success() {
        return Err(UNREADABLE.to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| UNREADABLE.to_string())? {
        if bytes.len() + chunk.len() > 16 * 1024 {
            return Err(UNREADABLE.to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| UNREADABLE.to_string())?;
    value["balanceNanousd"]
        .as_str()
        .and_then(|raw| raw.parse::<i64>().ok())
        .ok_or_else(|| UNREADABLE.to_string())
}

#[cfg(test)]
mod tests;
```

If Part D did not create the stub and its three call sites, also make these edits in Part D's team runner: where it handles a harness exit, call `on_harness_exit(&app, &relay_url, &agent_pubkey, exit_code).await` before its crash policy and return on `PausedForCredits`, restart without counting on `RestartNow`, fall through on `Crash`; in its start-on-launch loop, skip a company for which `is_paused_for_credits(&app, &relay_url)` is true and call `ensure_watcher(&app, &relay_url)` for it; at the top of `team_resume`, add:

```rust
    match crate::managed_agents::credits_pause::resume_if_funded(&app, &relay_url).await {
        Ok(true) => return Ok(()),
        Ok(false) => {}
        Err(reason) => return Err(reason),
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib credits_pause`
Expected: PASS (seven tests).

Run: `cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings in `credits_pause.rs`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/credits_pause.rs desktop/src-tauri/src/managed_agents/credits_pause/tests.rs desktop/src-tauri/src/managed_agents/mod.rs
git commit -s -m "feat(host): pause the team when credits run out and resume it"
```

---

### Task 9.6: The owner's production checklist

**Files:**
- Modify: `docs/credits-gateway-operations.md` (three sentences, one new section)
- Modify: `crates/buzz-relay/src/api/credits_gateway_limits.rs` (one test in `tests`)
- Test: `crates/buzz-relay/src/api/credits_gateway_limits.rs`

**Interfaces:**
- Consumes: the setting names from tasks 9.1 and 9.2.
- Produces: the "Production checklist for the owner" section that the test reads.

- [ ] **Step 1: Write the failing test**

Append inside `mod tests` of `crates/buzz-relay/src/api/credits_gateway_limits.rs`:

```rust
    #[test]
    fn every_gateway_setting_is_in_the_owner_checklist() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let doc = std::fs::read_to_string(root.join("docs/credits-gateway-operations.md")).unwrap();
        let checklist = doc
            .split("## Production checklist for the owner")
            .nth(1)
            .expect("the owner checklist section exists");
        // Built at run time so this test's own source never matches the scan.
        let needle = concat!('"', "COLONY", "_CREDITS_");
        let mut names = std::collections::BTreeSet::new();
        for file in [
            "credits_gateway.rs",
            "credits_gateway_limits.rs",
            "credits_gateway_upstream.rs",
        ] {
            let source =
                std::fs::read_to_string(root.join("crates/buzz-relay/src/api").join(file)).unwrap();
            for (index, _) in source.match_indices(needle) {
                let rest = &source[index + 1..];
                let name = &rest[..rest.find('"').unwrap_or(0)];
                if name.len() > "COLONY_CREDITS_".len()
                    && name.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
                {
                    names.insert(name.to_owned());
                }
            }
        }
        for extra in [
            "OPENROUTER_MASTER_KEY",
            "STRIPE_SECRET_KEY",
            "STRIPE_WEBHOOK_SECRET",
            "COLONY_CREDITS_TERMS_URL",
            "COLONY_CREDITS_ACCEPTABLE_USE_URL",
        ] {
            names.insert(extra.to_owned());
        }
        assert!(names.len() >= 14, "{names:?}");
        for name in names {
            assert!(
                checklist.contains(&format!("`{name}`")),
                "{name} is read by the relay but missing from the owner checklist"
            );
        }
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/every_gateway_setting_is_in_the_owner_checklist/)'`
Expected: FAIL with `the owner checklist section exists`.

- [ ] **Step 3: Update the operations document**

In `docs/credits-gateway-operations.md`:
- Replace `The launch integration must replace its authorization before expiry.` with `When a session ends, the employee's next request is refused before any spend; its harness exits with code 77 and the host restarts that employee with a fresh session.`
- Replace `Admission also settles at most four expired holds for its payer, so a worker backlog cannot strand a returning person.` with `Admission also settles up to the account's in-flight limit of expired holds for its payer, so a worker backlog cannot strand a returning person.`
- Replace `The maximum hold is under $0.40 per request, at most four unresolved requests per payer, and one per session.` with `Requests are limited to 128 KiB, and the maximum hold is under $0.40 per request. By default at most eight requests per payer and one per session wait at once.`

Append at the end of the document:

```markdown
## Production checklist for the owner

Set every value as a Fly secret on the relay app. Never paste a value into chat, a ticket, a commit, or a logged command line.

1. Payments: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. In Stripe, send `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired` to `https://<relay address>/api/payments/webhook/stripe`.
2. Customer terms: `COLONY_CREDITS_TERMS_URL` and `COLONY_CREDITS_ACCEPTABLE_USE_URL` point at the published Colony terms and acceptable use pages. The terms pass the AI provider's rules down to customers, and they are live before anyone is charged.
3. AI provider: `OPENROUTER_MASTER_KEY` (or `COLONY_CREDITS_UPSTREAM_KEY`) is an inference key, not a management-only key. `COLONY_CREDITS_USER_HASH_KEY` is at least 32 random characters and never changes.
4. Model, optional: leave `COLONY_CREDITS_UPSTREAM_MODEL` unset to use `openai/gpt-4.1-mini`. To change the model, set `COLONY_CREDITS_UPSTREAM_MODEL` and `COLONY_CREDITS_ALLOWED_MODELS` together; the allowed list must contain the model. `COLONY_CREDITS_UPSTREAM_BASE_URL` and `COLONY_CREDITS_MODEL_PRICES` are only for a provider other than OpenRouter.
5. Team limits, optional: `COLONY_CREDITS_MAX_INFLIGHT_PER_ACCOUNT` (default 8), `COLONY_CREDITS_MAX_INFLIGHT_PER_SESSION` (default 1), `COLONY_CREDITS_MAX_SESSIONS_PER_ACCOUNT` (default 16).
6. Turn it on last: set `COLONY_CREDITS_GATEWAY` to `1` and restart the relay. The relay log must not contain "Colony credits gateway is OFF"; if it does, that line names the setting to fix. `GET /api/credits-gateway/capabilities` must answer `"enabled": true`.
7. App builds: release builds of the app are made with `COLONY_CREDITS_GATEWAY` set to `1`, so the app offers credits.
8. First real check: on production, buy the $5 pack with a real card, send Scout one message, and confirm the balance went down by a few cents.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cargo nextest run -p buzz-relay --lib -E 'test(/^api::credits_gateway_limits::/)'`
Expected: PASS (four tests).

- [ ] **Step 5: Commit**

```bash
git add docs/credits-gateway-operations.md crates/buzz-relay/src/api/credits_gateway_limits.rs
git commit -s -m "docs(credits): owner production checklist, checked against the code"
```

---

### Task 9.7: The phase 1 real-run gate

**Files:**
- Create: `app/tests/real-run/first-run/rows.mjs`
- Create: `app/tests/real-run/first-run/evidence.mjs`
- Create: `app/tests/real-run/first-run/checks.mjs`
- Create: `app/tests/real-run/first-run/launch.mjs`
- Create: `app/tests/real-run/first-run/run.mjs`
- Create: `app/tests/real-run/first-run/verdict.mjs`
- Create: `app/tests/real-run/first-run/README.md`
- Create: `app/tests/real-run/first-run/rows.test.mjs`, `evidence.test.mjs`, `checks.test.mjs`, `launch.test.mjs`
- Modify: `app/package.json` (created by part E): add the scripts below and make the `test` script include `tests/real-run/first-run/*.test.mjs`
- Test: the four `*.test.mjs` files

**Interfaces:**
- Consumes:
  - Bridge contract from `00-overview.md`: `window.colony.auth.startEmailCode`, `auth.verifyEmailCode`, `team.status`, `team.onProblem`, `system.onNavigate`; `EmployeeRuntimeStatus.pauseReason` (contract change 1).
  - Existing real-run helpers: `createSmokeInbox()` from `desktop/tests/real-run/mailbox.mjs` and `assertSafeDiagnostics`, `outsideRepo` from `desktop/tests/real-run/safety.mjs`.
  - Part E (contract change 6): the app reads `COLONY_RELAY_URL`; closing the window keeps the team running; reopening from the menu bar or tray opens a new window.
- Produces: `GATE_ROWS`, `rowsFor(platform)`, `gateVerdict(reports)`; `GateEvidence`; `waitFor`, `allPausedForCredits`, `forbiddenTextFindings`, `navigatedToDecision`; `gateEnvironment`, `refuseUnsafe`, `freshProfileVerdict`, `parseArgs`.

- [ ] **Step 1: Write the failing tests**

Create `app/tests/real-run/first-run/rows.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { GATE_ROWS, gateVerdict, rowsFor } from "./rows.mjs";

test("every phase 1 gate item in the overview has a row", () => {
  const ids = new Set(GATE_ROWS.map((row) => row.id));
  for (const id of [
    "sign-in",
    "company",
    "credits-out",
    "credits-resume",
    "scout-first-turn",
    "hire-team",
    "close-window",
    "notification",
    "morning-brief",
  ]) {
    assert.ok(ids.has(id), id);
  }
});

test("Windows repeats the background and credits rows", () => {
  const windows = new Set(rowsFor("windows").map((row) => row.id));
  for (const id of ["launch", "sign-in", "credits-out", "credits-resume", "hire-team", "close-window"]) {
    assert.ok(windows.has(id), id);
  }
  assert.throws(() => rowsFor("linux"), /Unknown platform/u);
});

test("the gate needs passing reports from both computers on fresh accounts", () => {
  const passing = (platform) => ({
    platform,
    freshProfile: true,
    rows: rowsFor(platform).map((row) => ({ id: row.id, status: "PASS" })),
  });
  assert.equal(gateVerdict([passing("mac"), passing("windows")]).pass, true);
  assert.equal(gateVerdict([passing("mac")]).pass, false);
  assert.equal(gateVerdict([passing("mac"), { ...passing("windows"), freshProfile: false }]).pass, false);
  const notObserved = passing("mac");
  notObserved.rows[3].status = "NOT OBSERVED";
  assert.equal(gateVerdict([notObserved, passing("windows")]).pass, false);
});
```

Create `app/tests/real-run/first-run/evidence.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GateEvidence } from "./evidence.mjs";

test("rows start not observed and codes never reach the report", async () => {
  const evidence = new GateEvidence({
    platform: "mac",
    artifact: { file: "Colony.dmg", sha256: "0".repeat(64) },
    freshProfile: true,
  });
  assert.ok(evidence.rows.every((row) => row.status === "NOT OBSERVED"));
  evidence.record("sign-in", "PASS", "code 482913 accepted", 1200);
  assert.equal(evidence.rows.find((row) => row.id === "sign-in").detail, "code [redacted] accepted");
  assert.throws(() => evidence.record("sign-in", "MAYBE", ""), /Unknown status/u);
  assert.throws(() => evidence.record("nope", "PASS", ""), /Unknown row/u);
  const directory = await mkdtemp(path.join(os.tmpdir(), "colony-gate-"));
  await evidence.write(directory);
  const report = JSON.parse(await readFile(path.join(directory, "report.json"), "utf8"));
  assert.equal(report.platform, "mac");
  assert.equal(report.rows.find((row) => row.id === "sign-in").elapsedMs, 1200);
  assert.match(await readFile(path.join(directory, "report.md"), "utf8"), /NOT OBSERVED/u);
});
```

Create `app/tests/real-run/first-run/checks.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  allPausedForCredits,
  forbiddenTextFindings,
  navigatedToDecision,
  waitFor,
} from "./checks.mjs";

test("paused for credits means every employee, with the credits reason", () => {
  const paused = { state: "paused", pauseReason: "credits_out" };
  assert.equal(allPausedForCredits([paused, paused]), true);
  assert.equal(allPausedForCredits([paused, { state: "paused", pauseReason: "person" }]), false);
  assert.equal(allPausedForCredits([paused, { state: "running" }]), false);
  assert.equal(allPausedForCredits([]), false);
});

test("error text in the conversation is caught", () => {
  assert.deepEqual(forbiddenTextFindings("Scout: All set for Friday."), []);
  assert.equal(forbiddenTextFindings("⚠️ Out of credits. Top up to keep your Colony Agent working.").length, 2);
});

test("a decision screen is Needs you or a card viewer", () => {
  assert.equal(navigatedToDecision([{ screen: "T-05" }]), true);
  assert.equal(navigatedToDecision([{ screen: "C-04", id: "abc" }]), true);
  assert.equal(navigatedToDecision([{ screen: "T-01" }]), false);
});

test("waitFor stops at its deadline and reports success with timing", async () => {
  let clock = 0;
  const options = { timeoutMs: 10, intervalMs: 5, now: () => clock, sleep: async (ms) => { clock += ms; } };
  assert.deepEqual(await waitFor(async () => false, options), { ok: false, elapsedMs: 10 });
  clock = 0;
  let calls = 0;
  const result = await waitFor(async () => (calls += 1) === 2, options);
  assert.equal(result.ok, true);
  assert.equal(result.elapsedMs, 5);
});
```

Create `app/tests/real-run/first-run/launch.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { freshProfileVerdict, gateEnvironment, parseArgs, refuseUnsafe } from "./launch.mjs";

test("the launch environment keeps what the computer needs and drops secrets", () => {
  const env = gateEnvironment(
    { PATH: "/bin", APPDATA: "C:\\Users\\colonygate\\AppData", OPENROUTER_API_KEY: "x", STRIPE_SECRET_KEY: "y" },
    "wss://canary.example",
  );
  assert.equal(env.PATH, "/bin");
  assert.equal(env.APPDATA, "C:\\Users\\colonygate\\AppData");
  assert.equal(env.COLONY_RELAY_URL, "wss://canary.example");
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
});

test("the gate refuses CI and needs the opt-in", () => {
  assert.throws(() => refuseUnsafe({ CI: "1", COLONY_REAL_RUN: "1" }), /never runs in CI/u);
  assert.throws(() => refuseUnsafe({}), /COLONY_REAL_RUN=1/u);
  assert.doesNotThrow(() => refuseUnsafe({ COLONY_REAL_RUN: "1" }));
});

test("only a colonygate computer account is a fresh profile", () => {
  assert.equal(freshProfileVerdict("colonygate1", false), true);
  assert.throws(() => freshProfileVerdict("lerato", false), /colonygate/u);
  assert.equal(freshProfileVerdict("lerato", true), false);
});

test("arguments are complete and the relay is a wss address", () => {
  const options = parseArgs([
    "--app", "/Applications/Colony.app/Contents/MacOS/Colony",
    "--artifact", "/tmp/Colony.dmg",
    "--relay", "wss://canary.example",
    "--output", "/tmp/gate",
    "--platform", "mac",
  ]);
  assert.equal(options.platform, "mac");
  assert.equal(options.allowExistingProfile, false);
  assert.throws(() => parseArgs(["--app", "x"]), /Missing --artifact/u);
  assert.throws(
    () => parseArgs(["--app", "a", "--artifact", "b", "--relay", "http://x", "--output", "o", "--platform", "mac"]),
    /wss:/u,
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && node --test tests/real-run/first-run/*.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./rows.mjs`, `./evidence.mjs`, `./checks.mjs` and `./launch.mjs`.

- [ ] **Step 3: Implement the rows, evidence, checks and launch helpers**

Create `app/tests/real-run/first-run/rows.mjs`:

```js
// The phase 1 real-run gate: what must be observed, and on which computers.
// Every row starts NOT OBSERVED; only an observation on a packaged app passes it.

export const PLATFORMS = ["mac", "windows"];

export const GATE_ROWS = [
  { id: "launch", title: "The packaged app opens on a fresh computer account", platforms: ["mac", "windows"], mode: "auto", pass: "The window shows within 60 seconds and the installer's SHA-256 is recorded." },
  { id: "sign-in", title: "Sign in with an email code creates a new account", platforms: ["mac", "windows"], mode: "auto", pass: "auth.verifyEmailCode returns a session for a fresh disposable inbox." },
  { id: "company", title: "The company and its business profile are created", platforms: ["mac", "windows"], mode: "manual", pass: "The operator saw the company name and profile saved and pasted the company address." },
  { id: "credits-out", title: "With no credits, Scout's first turn pauses the team cleanly", platforms: ["mac", "windows"], mode: "auto", pass: "A credits_out problem arrives within 5 minutes, every employee is paused for credits, and no error text appears in the console." },
  { id: "credits-resume", title: "Buying the $5 pack resumes the team by itself", platforms: ["mac", "windows"], mode: "mixed", pass: "Within 180 seconds of payment no employee is paused, without anyone pressing resume." },
  { id: "scout-first-turn", title: "Scout's first real turn completes after the resume", platforms: ["mac"], mode: "manual", pass: "Scout's profile proposal appears; the time since the resume is recorded." },
  { id: "hire-team", title: "One approval hires the team and each employee says hello", platforms: ["mac", "windows"], mode: "mixed", pass: "At least six employees run within 5 minutes of the approval and each posted a hello." },
  { id: "close-window", title: "Closing the window keeps the team working", platforms: ["mac", "windows"], mode: "mixed", pass: "After 2 minutes with no window and a reopen from the menu bar or tray, every employee still runs with no restart since the close." },
  { id: "notification", title: "A decision raises a notification that opens the right screen", platforms: ["mac"], mode: "mixed", pass: "Clicking the notification opens T-05 or a card viewer (C-xx)." },
  { id: "morning-brief", title: "The morning brief appears at 08:30 company time", platforms: ["mac"], mode: "manual", pass: "With the company time zone set so that 08:30 is minutes away, the brief appears within 10 minutes of 08:30." },
];

export function rowsFor(platform) {
  if (!PLATFORMS.includes(platform)) throw new Error(`Unknown platform ${platform}`);
  return GATE_ROWS.filter((row) => row.platforms.includes(platform));
}

// The gate passes only when both computers passed every row they require on fresh accounts.
export function gateVerdict(reports) {
  for (const platform of PLATFORMS) {
    const report = reports.find((item) => item.platform === platform);
    if (!report) return { pass: false, reason: `No ${platform} report.` };
    if (!report.freshProfile) return { pass: false, reason: `${platform}: not run on a fresh computer account.` };
    for (const row of rowsFor(platform)) {
      const observed = report.rows.find((item) => item.id === row.id);
      if (observed?.status !== "PASS") {
        return { pass: false, reason: `${platform}: ${row.id} is ${observed?.status ?? "NOT OBSERVED"}.` };
      }
    }
  }
  return { pass: true, reason: "Every required row passed on Mac and Windows." };
}
```

Create `app/tests/real-run/first-run/evidence.mjs`:

```js
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { rowsFor } from "./rows.mjs";

const STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT OBSERVED"]);
// Six-digit sign-in codes, private keys and Stripe secrets never reach a report.
const SECRET = /\b\d{6}\b|nsec1[0-9a-z]+|sk_(?:live|test)_[0-9A-Za-z]+/gu;

export function redact(text) {
  return String(text ?? "").replace(SECRET, "[redacted]");
}

export class GateEvidence {
  constructor({ platform, artifact, freshProfile }) {
    this.platform = platform;
    this.artifact = artifact;
    this.freshProfile = freshProfile;
    this.rows = rowsFor(platform).map((row) => ({
      id: row.id,
      title: row.title,
      pass: row.pass,
      status: "NOT OBSERVED",
      detail: "",
      elapsedMs: null,
    }));
    this.smokeAccounts = [];
    this.notes = [];
  }

  record(id, status, detail, elapsedMs = null) {
    if (!STATUSES.has(status)) throw new Error(`Unknown status ${status}`);
    const row = this.rows.find((item) => item.id === id);
    if (!row) throw new Error(`Unknown row ${id}`);
    Object.assign(row, { status, detail: redact(detail), elapsedMs });
  }

  note(text) {
    this.notes.push(redact(text));
  }

  report() {
    return {
      platform: this.platform,
      artifact: this.artifact,
      freshProfile: this.freshProfile,
      rows: this.rows,
      smokeAccounts: this.smokeAccounts,
      notes: this.notes,
      writtenAt: new Date().toISOString(),
    };
  }

  async write(directory) {
    await mkdir(directory, { recursive: true });
    const report = this.report();
    await writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    const lines = [
      `# Phase 1 gate: ${report.platform}`,
      "",
      `Installer: ${report.artifact.file} (SHA-256 ${report.artifact.sha256})`,
      `Fresh computer account: ${report.freshProfile ? "yes" : "no (this run cannot pass the gate)"}`,
      "",
      "| Row | Status | Seconds | Detail |",
      "|-|-|-|-|",
      ...report.rows.map((row) => `| ${row.title} | ${row.status} | ${row.elapsedMs === null ? "" : Math.round(row.elapsedMs / 1000)} | ${row.detail} |`),
      "",
      `Smoke accounts to remove: ${report.smokeAccounts.join(", ") || "none"}`,
      ...report.notes.map((text) => `Note: ${text}`),
      "",
    ];
    await writeFile(path.join(directory, "report.md"), lines.join("\n"));
  }
}
```

Create `app/tests/real-run/first-run/checks.mjs`:

```js
// Observations made through the production bridge. No product code is imported.

export const FORBIDDEN_CHAT_TEXT = [
  "⚠️",
  "Top up to keep your Colony Agent working",
  "Restart your Colony Agent",
  "Managed session expired",
];

export function allPausedForCredits(statuses) {
  return statuses.length > 0 && statuses.every((item) => item.state === "paused" && item.pauseReason === "credits_out");
}

export function forbiddenTextFindings(text) {
  return FORBIDDEN_CHAT_TEXT.filter((needle) => text.includes(needle));
}

export function navigatedToDecision(targets) {
  return targets.some((target) => target.screen === "T-05" || /^C-\d{2}$/u.test(target.screen));
}

export async function waitFor(
  check,
  { timeoutMs, intervalMs = 2000, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
) {
  const start = now();
  for (;;) {
    if (await check()) return { ok: true, elapsedMs: now() - start };
    if (now() - start >= timeoutMs) return { ok: false, elapsedMs: now() - start };
    await sleep(intervalMs);
  }
}

export async function teamStatus(page, relayUrl) {
  return page.evaluate((relay) => window.colony.team.status(relay), relayUrl);
}

export async function captureProblems(page) {
  await page.evaluate(() => {
    window.__gateProblems = [];
    window.colony.team.onProblem((problem) => window.__gateProblems.push(problem));
  });
}

export async function problems(page) {
  return page.evaluate(() => window.__gateProblems ?? []);
}

export async function captureNavigation(page) {
  await page.evaluate(() => {
    window.__gateNavigation = [];
    window.colony.system.onNavigate((target) => window.__gateNavigation.push(target));
  });
}

export async function navigation(page) {
  return page.evaluate(() => window.__gateNavigation ?? []);
}
```

Create `app/tests/real-run/first-run/launch.mjs`:

```js
// Pure helpers for the phase 1 gate launcher.

const KEEP = [
  "PATH", "Path", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL",
  "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "USERPROFILE", "APPDATA",
  "LOCALAPPDATA", "TEMP", "TMP", "HOMEDRIVE", "HOMEPATH", "COMPUTERNAME", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)",
];

// Only what the computer needs, plus the test relay. Inherited secrets are dropped.
export function gateEnvironment(source, relayUrl) {
  const env = {};
  for (const key of KEEP) if (source[key]) env[key] = source[key];
  return { ...env, COLONY_RELAY_URL: relayUrl };
}

export function refuseUnsafe(environment) {
  if (environment.CI) throw new Error("The real-run gate never runs in CI.");
  if (environment.COLONY_REAL_RUN !== "1") throw new Error("Set COLONY_REAL_RUN=1 to run the real-run gate.");
}

// A new computer account is the only clean profile: it has no keychain entries,
// no app data and no running Colony.
export function freshProfileVerdict(username, allowExisting) {
  const fresh = /^colonygate/iu.test(username);
  if (!fresh && !allowExisting) {
    throw new Error("Run the gate in a new computer account whose name starts with colonygate, or pass --allow-existing-profile (the run then cannot pass the gate).");
  }
  return fresh;
}

export function parseArgs(argv) {
  const options = { allowExistingProfile: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--allow-existing-profile") {
      options.allowExistingProfile = true;
      continue;
    }
    const value = argv[index + 1];
    if (!flag.startsWith("--") || value === undefined) throw new Error(`Unexpected argument ${flag}`);
    options[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  for (const required of ["app", "artifact", "relay", "output", "platform"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }
  if (!["mac", "windows"].includes(options.platform)) throw new Error("--platform must be mac or windows");
  if (!/^wss:\/\//u.test(options.relay)) throw new Error("--relay must be a wss: test relay address");
  return options;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && node --test tests/real-run/first-run/*.test.mjs`
Expected: PASS (fourteen tests).

- [ ] **Step 5: Write the runner, the verdict tool and the README**

Create `app/tests/real-run/first-run/run.mjs`:

```js
import { _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createSmokeInbox } from "../../../../desktop/tests/real-run/mailbox.mjs";
import { assertSafeDiagnostics, outsideRepo } from "../../../../desktop/tests/real-run/safety.mjs";
import {
  allPausedForCredits,
  captureNavigation,
  captureProblems,
  forbiddenTextFindings,
  navigatedToDecision,
  navigation,
  problems,
  teamStatus,
  waitFor,
} from "./checks.mjs";
import { GateEvidence } from "./evidence.mjs";
import { freshProfileVerdict, gateEnvironment, parseArgs, refuseUnsafe } from "./launch.mjs";

const TERMS_VERSION = "2026-10-11";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
refuseUnsafe(process.env);
assertSafeDiagnostics(process.env);
const options = parseArgs(process.argv.slice(2));
await mkdir(options.output, { recursive: true });
const output = outsideRepo(options.output, repo);
const freshProfile = freshProfileVerdict(os.userInfo().username, options.allowExistingProfile);
const artifact = {
  file: path.basename(options.artifact),
  sha256: createHash("sha256").update(await readFile(options.artifact)).digest("hex"),
};
const evidence = new GateEvidence({ platform: options.platform, artifact, freshProfile });
const required = new Set(evidence.rows.map((row) => row.id));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function operator(question) {
  return (await rl.question(`\n${question}\n> `)).trim();
}

async function verdict(question) {
  const words = (await operator(`${question} Type pass, fail or blocked, then a short note.`)).split(/\s+/u);
  const first = (words.shift() ?? "").toLowerCase();
  const status = first === "pass" ? "PASS" : first === "blocked" ? "BLOCKED" : "FAIL";
  return { status, note: words.join(" ") };
}

async function screenshot(page, id) {
  await page.screenshot({ path: path.join(output, `${options.platform}-${id}.png`) }).catch(() => {});
}

let app;
let page;
let relayUrl = "";
try {
  const started = Date.now();
  app = await electron.launch({
    executablePath: options.app,
    env: gateEnvironment(process.env, options.relay),
    timeout: 60_000,
  });
  page = await app.firstWindow({ timeout: 60_000 });
  evidence.record("launch", "PASS", `Window shown for ${artifact.file}.`, Date.now() - started);
  await screenshot(page, "launch");

  {
    const start = Date.now();
    const inbox = await createSmokeInbox();
    evidence.smokeAccounts.push(inbox.email);
    await page.evaluate((email) => window.colony.auth.startEmailCode(email), inbox.email);
    const code = await inbox.verificationCode(120_000);
    const session = await page.evaluate(
      (input) => window.colony.auth.verifyEmailCode(input),
      { email: inbox.email, code, termsVersion: TERMS_VERSION, displayName: "Gate owner" },
    );
    evidence.record("sign-in", session ? "PASS" : "FAIL", session ? "Session returned for a new disposable inbox." : "No session returned.", Date.now() - start);
  }

  {
    relayUrl = await operator("In the engine console, create the company and finish the business chat. Paste the company address the console shows (wss://...):");
    const { status, note } = await verdict("Did the company name and business profile save?");
    evidence.record("company", /^wss:\/\//u.test(relayUrl) ? status : "FAIL", note || "Company address recorded.");
    await screenshot(page, "company");
  }

  {
    await captureProblems(page);
    await operator("Choose Colony credits and do not buy a pack. Send Scout any message. Press Enter.");
    const result = await waitFor(async () => {
      const seen = (await problems(page)).some((item) => item.kind === "credits_out");
      return seen && allPausedForCredits(await teamStatus(page, relayUrl));
    }, { timeoutMs: 5 * 60_000 });
    const findings = forbiddenTextFindings(await page.locator("body").innerText());
    const pass = result.ok && findings.length === 0;
    evidence.record("credits-out", pass ? "PASS" : "FAIL", pass ? "Team paused for credits; no error text in the console." : `paused for credits: ${result.ok}; error text: ${findings.join(", ") || "none"}`, result.elapsedMs);
    await screenshot(page, "credits-out");
  }

  let resumedAt = Date.now();
  {
    await operator("Buy the $5 pack in the browser with the Stripe test card. Press Enter the moment the payment page says it is paid.");
    const result = await waitFor(async () => {
      const statuses = await teamStatus(page, relayUrl);
      return statuses.length > 0 && statuses.every((item) => item.state !== "paused");
    }, { timeoutMs: 180_000 });
    resumedAt = Date.now();
    evidence.record("credits-resume", result.ok ? "PASS" : "FAIL", result.ok ? "No employee paused after the payment." : "Still paused after 180 seconds.", result.elapsedMs);
  }

  if (required.has("scout-first-turn")) {
    const { status, note } = await verdict("Did Scout's profile proposal appear in the console?");
    evidence.record("scout-first-turn", status, note, Date.now() - resumedAt);
    await screenshot(page, "scout-first-turn");
  }

  {
    await operator("Approve the profile and the proposed team in one approval. Press Enter right after approving.");
    const result = await waitFor(
      async () => (await teamStatus(page, relayUrl)).filter((item) => item.state === "running").length >= 6,
      { timeoutMs: 5 * 60_000 },
    );
    const { status, note } = await verdict("Did every new employee post a hello?");
    evidence.record("hire-team", result.ok && status === "PASS" ? "PASS" : "FAIL", note || (result.ok ? "Six or more employees running." : "Fewer than six running after 5 minutes."), result.elapsedMs);
    await screenshot(page, "hire-team");
  }

  {
    const before = await teamStatus(page, relayUrl);
    const closedAt = Math.floor(Date.now() / 1000);
    const reopened = app.waitForEvent("window", { timeout: 15 * 60_000 });
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    });
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    const alive = app.process().exitCode === null;
    await operator("Open Colony from the menu bar (Mac) or the tray (Windows). Press Enter when the window shows.");
    page = await reopened;
    const after = await teamStatus(page, relayUrl);
    const steady =
      after.length === before.length &&
      after.every((item) => {
        const earlier = before.find((entry) => entry.agentPubkey === item.agentPubkey);
        return item.state === "running" && item.since <= closedAt && earlier?.restartsInWindow === item.restartsInWindow;
      });
    evidence.record("close-window", alive && steady ? "PASS" : "FAIL", `App running with no window: ${alive}. Team unchanged: ${steady}.`);
  }

  if (required.has("notification")) {
    await captureNavigation(page);
    await operator("Ask Scout for something that needs your approval, for example: draft a post for Friday. When the notification appears, click it. Press Enter.");
    const result = await waitFor(async () => navigatedToDecision(await navigation(page)), { timeoutMs: 10 * 60_000 });
    evidence.record("notification", result.ok ? "PASS" : "FAIL", result.ok ? "The notification opened a decision." : "No decision screen was opened.", result.elapsedMs);
    await screenshot(page, "notification");
  }

  if (required.has("morning-brief")) {
    await operator("Set the company time zone so that 08:30 is a few minutes away. Press Enter when saved.");
    const { status, note } = await verdict("Did the morning brief appear within 10 minutes of 08:30 company time?");
    evidence.record("morning-brief", status, note);
    await screenshot(page, "morning-brief");
  }
} catch (error) {
  evidence.note(`Stopped early: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  rl.close();
  await app?.close().catch(() => {});
  await evidence.write(output);
}

const notPassed = evidence.rows.filter((row) => row.status !== "PASS");
console.log(
  notPassed.length === 0
    ? "Every row passed on this computer."
    : `Not passed: ${notPassed.map((row) => `${row.id} (${row.status})`).join(", ")}`,
);
process.exitCode = notPassed.length === 0 && freshProfile ? 0 : 1;
```

Create `app/tests/real-run/first-run/verdict.mjs`:

```js
import { readFile } from "node:fs/promises";
import { gateVerdict } from "./rows.mjs";

const reports = await Promise.all(
  process.argv.slice(2).map(async (file) => JSON.parse(await readFile(file, "utf8"))),
);
const result = gateVerdict(reports);
console.log(result.reason);
process.exitCode = result.pass ? 0 : 1;
```

Create `app/tests/real-run/first-run/README.md`:

````markdown
# Phase 1 real-run gate

This gate runs the packaged app on a real computer with real AI, a real test relay and real Stripe test payments. It never runs in CI, never imports product code, and never records codes, keys or card details. Every row starts NOT OBSERVED; the gate passes only when a Mac report and a Windows report both pass every row they require (`verdict.mjs`).

## Before you start

1. A test relay (canary) with Stripe test keys, the credits gateway on (`COLONY_CREDITS_GATEWAY=1`) and an OpenRouter inference key, set as Fly secrets by the owner.
2. On each computer, a new computer account whose name starts with `colonygate`. This is the clean profile: no keychain entries, no app data, no Colony running.
3. The installer for the candidate build, downloaded into that account, and the app installed from it.
4. Node and the app's dev dependencies installed (`pnpm install` in `app/`).

## Run on a Mac

```sh
cd app
COLONY_REAL_RUN=1 node tests/real-run/first-run/run.mjs \
  --app '/Applications/Colony.app/Contents/MacOS/Colony' \
  --artifact "$HOME/Downloads/Colony-<version>.dmg" \
  --relay 'wss://<company host on the test relay>' \
  --output "$HOME/colony-gate-mac" \
  --platform mac
```

## Run on Windows

```powershell
cd app
$env:COLONY_REAL_RUN = "1"
node tests/real-run/first-run/run.mjs `
  --app "$env:LOCALAPPDATA\Programs\Colony\Colony.exe" `
  --artifact "$env:USERPROFILE\Downloads\Colony-Setup-<version>.exe" `
  --relay "wss://<company host on the test relay>" `
  --output "$env:USERPROFILE\colony-gate-windows" `
  --platform windows
```

The runner asks you to act in the engine console at each manual step and waits for you. It saves `report.json`, `report.md` and one screenshot per row in the output folder, which must be outside the repository.

## Proof checklist

| Row | Mac | Windows | Passes when |
|-|-|-|-|
| launch | yes | yes | The window shows within 60 seconds; the installer's SHA-256 is recorded |
| sign-in | yes | yes | An email code from a fresh disposable inbox signs in |
| company | yes | yes | The company and business profile save |
| credits-out | yes | yes | With no credits, Scout's first turn pauses every employee for credits within 5 minutes, and no error text shows |
| credits-resume | yes | yes | Within 180 seconds of paying for the $5 pack, no employee is paused, without anyone pressing resume |
| scout-first-turn | yes | no | Scout's profile proposal appears after the resume |
| hire-team | yes | yes | One approval; six or more employees run within 5 minutes and each posts a hello |
| close-window | yes | yes | Two minutes with no window, then a reopen from the menu bar or tray: every employee still runs, none restarted |
| notification | yes | no | Clicking a decision notification opens Needs you or a card |
| morning-brief | yes | no | The morning brief appears within 10 minutes of 08:30 company time |

## Verdict

```sh
node tests/real-run/first-run/verdict.mjs ~/colony-gate-mac/report.json ~/colony-gate-windows/report.json
```

Remove the smoke accounts each report lists after the run.
````

In `app/package.json`, add to `"scripts"`:

```json
"real-run:first-run": "node tests/real-run/first-run/run.mjs",
"real-run:verdict": "node tests/real-run/first-run/verdict.mjs"
```

and make sure the `test` script's file list includes `tests/real-run/first-run/*.test.mjs`. If `@playwright/test` is not in `devDependencies`, add `"@playwright/test": "^1.58.2"` (the version the desktop app uses).

- [ ] **Step 6: Run the tests again and check the runner loads**

Run: `cd app && node --test tests/real-run/first-run/*.test.mjs`
Expected: PASS.

Run: `cd app && node tests/real-run/first-run/run.mjs`
Expected: exits with `Error: Set COLONY_REAL_RUN=1 to run the real-run gate.` (the guard runs before anything else).

- [ ] **Step 7: Commit**

```bash
git add app/tests/real-run/first-run app/package.json
git commit -s -m "test(app): phase 1 real-run gate with credits pause and resume"
```

---

## Contract changes

These change or extend `00-overview.md`. Each one is needed by a task above.

1. **`EmployeeRuntimeStatus` gains `pause_reason: Option<String>`** (`"person"` or `"credits_out"`; bridge field `pauseReason`). Part D sets it whenever `state` is `"paused"`; part H shows it; the gate (task 9.7) reads it.
2. **Part D exposes pause reasons** in `desktop/src-tauri/src/managed_agents/team_runner.rs`: `pub(crate) enum PauseReason { Person, CreditsOut }`, `pub(crate) async fn pause_company(app: &tauri::AppHandle, relay_url: &str, reason: PauseReason) -> Result<(), String>` and `pub(crate) async fn resume_company(app: &tauri::AppHandle, relay_url: &str, reason: PauseReason) -> Result<(), String>`. A company's team runs only when no pause reason remains. The `team_pause` and `team_resume` commands use `PauseReason::Person`.
3. **Part D creates the `credits_pause` seam as a stub** in `desktop/src-tauri/src/managed_agents/credits_pause.rs` with exactly these signatures, and calls them: `pub(crate) enum ExitHandling { PausedForCredits, RestartNow, Crash }`; `pub(crate) async fn on_harness_exit(app: &tauri::AppHandle, relay_url: &str, agent_pubkey: &str, code: Option<i32>) -> ExitHandling` (stub returns `Crash`), called on every harness exit before the crash policy (`PausedForCredits`: do not restart; `RestartNow`: restart now without counting a crash; `Crash`: normal policy); `pub(crate) fn is_paused_for_credits(app: &tauri::AppHandle, relay_url: &str) -> bool` (stub `false`) and `pub(crate) fn ensure_watcher(app: &tauri::AppHandle, relay_url: &str)` (stub no-op), used by start-on-launch to skip a paused company and watch it; `pub(crate) async fn resume_if_funded(app: &tauri::AppHandle, relay_url: &str) -> Result<bool, String>` (stub `Ok(false)`), called first by `team_resume` (`Ok(true)`: done; `Err`: return it; `Ok(false)`: resume as a person). Task 9.5 replaces the stub's bodies.
4. **Part C's wake ledger forgets events**: `pub(crate) fn forget_events(path: &std::path::Path, events: &[(String, u64)]) -> std::io::Result<()>` in `crates/buzz-acp/src/wake_ledger.rs`, given (event id hex, created_at seconds). It removes the ids from the processed set and moves the replay floor back to no later than the oldest given `created_at`, so the next start processes them once more. It writes atomically, returns `Ok(())` when the ledger file does not exist yet, and returns an error when the ledger exists but cannot be read or written.
5. **Harness exit codes**: buzz-acp exits with 75 when credits cannot fund the next request and with 77 when the credits session ended, after a normal graceful shutdown. Neither is a crash for the host.
6. **Part E**: the new app reads `COLONY_RELAY_URL` when set (the gate points it at a test relay); after a confirmed credits purchase it calls `team.resume(relayUrl)` so a credits pause ends at once instead of at the next balance poll; closing the window keeps the team running and reopening from the menu bar or tray opens a new window; the `app/package.json` `test` script runs `node --test` over test files and CI runs it.
7. The gate rows `scout-first-turn`, `hire-team`, `notification` and `morning-brief` exercise parts F, G and H through the engine console; those parts must offer the console actions the README names (create the company, choose credits, approve the profile and team in one approval, set the company time zone).

## Self-review

- **Spec coverage.** Admission limits for six employees: task 9.1. Model configurable by environment: already true (`COLONY_CREDITS_UPSTREAM_MODEL`, `COLONY_CREDITS_ALLOWED_MODELS`); task 9.2 makes a wrong value visible instead of silently disabling the gateway, and task 9.6 documents it. Out of credits as a clean stop with no chat message: task 9.4. Host "paused" status plus a `credits_out` problem event: task 9.5 and contract changes 1 to 3. Automatic resume when the balance is back: task 9.5 (polling, justified in the Architecture line) and contract change 6 (immediate resume after purchase). Who pays: the gateway bills the account whose key matches the employee's `agent_owner_pubkey` (`crates/buzz-db/src/store/credits_gateway.rs:68-80` and `:128-139`), and the host opens every session with the signed-in owner's key (`desktop/src-tauri/src/managed_agents/runtime.rs:516-531`); task 9.1 pins it with six employees billing the owner and a partner refused. Owner checklist: task 9.6. Phase 1 gate: task 9.7. Two findings outside the stated scope were needed for "ready for six employees": the 64 KiB request cap with a 200,000-token history (task 9.3) and the two-hour session with no renewal (`docs/credits-gateway-operations.md` already said "The launch integration must replace its authorization before expiry"; tasks 9.4 and 9.5).
- **Placeholder scan.** No step says "TBD", "handle errors" or "similar to". The one conditional (task 9.5, "if Part D did not create the stub") gives the exact edits.
- **Type consistency.** `CreditGatewayLimits` (9.1) is used by 9.6; `MAX_BODY` and `MAX_UPSTREAM_BODY` (9.3) match the 128 KiB and 132 KiB constraints; `MAX_REQUEST_BYTES` matches `MAX_BODY`; exit codes 75 and 77 are `EXIT_CREDITS_OUT`, `EXIT_REAUTHORIZE` (9.4) and `HARNESS_EXIT_CREDITS_OUT`, `HARNESS_EXIT_REAUTHORIZE` (9.5); `pauseReason` and `restartsInWindow` in 9.7 match contract change 1 and the overview's `EmployeeRuntimeStatus`.
- **Review focus.** Each of the five lines names the test that pins it; items 1 to 3 are also observed in the gate.
- **Not verified here.** No code was compiled or run while writing this plan. The ten existing gateway unit tests that task 9.1 adds to CI have never run in CI; they may expose an old failure.
