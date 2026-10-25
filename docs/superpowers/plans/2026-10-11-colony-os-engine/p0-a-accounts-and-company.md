# Phase 0, part A: accounts and company Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the new Colony app passwordless email sign-in with a recorded terms version, let a brand-new verified account create its company, store the company's business profile on the relay, record which single computer runs the company's team, and let employees read the profile with `colony profile show`.

**Architecture:** Everything here is engine work on the existing relay. (1) Account codes gain a `sign_in` purpose: `POST /api/accounts/code/start` issues a code (creating a passwordless, unverified account for a new email) and `POST /api/accounts/code/verify` consumes it, records the terms version and returns the existing session payload plus `created`. Google sign-in records the terms version too, and both paths drop a password that was set before anyone proved the email. (2) Self-serve company creation gains an operator-enabled account mode that admits signers holding a verified account. (3) Two company-wide singleton records, the business profile (47046 to head 30657) and the team computer (47047 to head 30658), are brokered like member positions: an owner or admin action becomes a relay-signed head written with a create-only or exact-revision precondition, so concurrent writers cannot both win. (4) `colony profile show` reads and verifies the profile head.

**Tech Stack:** Rust 1.95 (axum, sqlx Postgres, deadpool-redis, nostr, chrono, chrono-tz, uuid), crates buzz-core, buzz-db, buzz-relay, buzz-sdk, buzz-cli, buzz-test-client; SQL migrations plus `schema/schema.sql`.

**Spec:** `docs/superpowers/plans/2026-10-11-colony-os-engine/00-overview.md` (the contract; it wins over everything else), `docs/superpowers/specs/2026-10-11-colony-os-design.md`, `docs/superpowers/specs/2026-10-11-colony-os-screens/10-data-and-engine.md` (engine items E-02, E-03, E-04 and the relay side of E-12), screens O-01, O-02, O-03, N-01, N-02 and S-01 in the same screen pack.


> **Integration amendments (read first):** `00-overview.md`, section "Integration decisions", items 10 (BusinessProfile gains optional `bestSellers` and `priceRange` in task 1.6), 11 and 14. Where they differ from the tasks below, the amendments win.

## Global Constraints

- The overview's Global Constraints apply to every task in this part.
- Kind numbers are exactly 30657 (`KIND_BUSINESS_PROFILE_HEAD`), 47046 (`KIND_BUSINESS_PROFILE_ACTION`), 30658 (`KIND_TEAM_COMPUTER_HEAD`) and 47047 (`KIND_TEAM_COMPUTER_ACTION`).
- Account codes keep the existing rules: 6 digits, 15-minute life (`ACCOUNT_CODE_TTL`), 5 attempts (`ACCOUNT_CODE_MAX_ATTEMPTS`), 30-second resend (`ACCOUNT_CODE_RESEND_COOLDOWN_SECS`), 10 calls per email per minute and 60 per address per minute per route.
- A terms version is 1 to 64 characters with no control characters.
- The business profile follows the overview schema exactly: `name` 1 to 120 characters and required, every other text at most 500 characters, lists at most 10 items, `timeZone` an IANA name, unknown keys rejected, at most 16 KB, `expectedRevision` must equal the head's `revision` tag.
- The team computer follows the overview rules plus the additions listed under "Contract changes" at the end of this part.
- The new migration is `migrations/0056_account_sign_in_codes.sql`. If another part merged a 0056 first, use the next free number and update the migrator count test in Task 1.1 to match.
- `schema/schema.sql` (applied by pgschema in CI) and the migrations (applied at relay start) must describe the same end state.
- Postgres-backed tests are `#[ignore]`d and run in CI's PostgreSQL lane; e2e tests run in CI's Relay E2E lane. Locally they need `docker compose up -d postgres redis` and `cargo run -p buzz-admin -- migrate` first.
- Production (`deploy/fly/fly.prod.toml`) currently runs public self-serve mode; switching it to account mode is a release decision, not part of this plan.

## Review Focus

1. **A second computer tries to take a team that another computer holds** (overview review focus 2). Expected: refused unless it is a forced move by an owner or admin, and two computers claiming a free team at the same moment never both win. Pinned in Task 1.7 (`a_second_computer_cannot_take_a_held_team_without_force`) and Task 1.9 (`team_computer_has_one_holder_heartbeats_releases_and_moves_by_force`, including a concurrent claim race).
2. **Someone guesses email codes** (overview review focus 3). Expected: five wrong tries burn the code, the right code no longer works afterwards, a locked email gets no new code until the burned one expires, a known email and an unknown email get the same answer, and the per-email limit holds. Pinned in Task 1.1 (`five_wrong_codes_burn_the_code_and_lock_new_starts_until_it_expires`) and Task 1.2 (`email_code_sign_in_does_not_reveal_accounts_and_burns_a_guessed_code`, `email_code_routes_reject_bad_input_and_respect_the_email_limit`).
3. **Someone registers another person's email with a password before that person ever signs in.** Expected: the real owner's first proof of the email (a sign-in code or Google) drops that password, so the squatter cannot sign in with it. Pinned in Task 1.1 (`first_proof_of_the_email_drops_a_password_nobody_proved`) and Task 1.3 (`google_sign_in_records_terms_and_drops_a_password_nobody_proved`).
4. **Two people save the business profile at the same time.** Expected: the second save is refused with the current revision instead of silently overwriting the first. Pinned in Task 1.6 (`revisions_start_at_one_and_must_match_the_current_head`) and Task 1.8 (`business_profile_is_written_by_owners_and_admins_and_read_by_members_and_employees`).
5. **A brand-new person tries to create companies without a verified account, or many times from one network.** Expected: refused without a verified account, rate limited per network, while existing members are not caught by the new-account limit. Pinned in Task 1.4.

---

### Task 1.1: Sign-in codes and terms acceptance in the database

**Files:**
- Create: `migrations/0056_account_sign_in_codes.sql`
- Modify: `schema/schema.sql:2051-2066` (accounts table), `schema/schema.sql:2080`, `:2096`, `:2117` (three purpose checks)
- Modify: `crates/buzz-db/src/store/accounts.rs:119-135` (purpose enum), after `:193` (new outcome enums), `:359-486` (`consume_account_code`), after `:334` (new `start_sign_in_code`), after `:486` (new `consume_sign_in_code`), after `:996` (shared helpers)
- Modify: `crates/buzz-db/src/runtime/migration.rs:718-724` (migrator count assertions)
- Test: `crates/buzz-db/src/store/accounts.rs` (new `#[cfg(test)] mod sign_in_code_tests` at the end of the file)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (all in `buzz_db::accounts`):

```rust
pub enum AccountCodePurpose { VerifyEmail, ResetPassword, SignIn }

pub enum StartSignInCodeOutcome {
    Issued,
    Locked { retry_after_secs: i64 },
}

pub enum ConsumeSignInCodeOutcome {
    Accepted { account: Box<AccountRecord>, created: bool },
    Invalid { attempts_left: i32 },
    Expired,
    AttemptsExceeded { retry_after_secs: i64 },
}

impl Db {
    pub async fn start_sign_in_code(
        &self,
        candidate: &NewAccount,
        code: &NewAccountCode,
    ) -> Result<StartSignInCodeOutcome>;

    pub async fn consume_sign_in_code(
        &self,
        email: &str,
        provided_hash: &[u8; 32],
        terms_version: &str,
        profile: Option<(&nostr::Event, CommunityId)>,
    ) -> Result<ConsumeSignInCodeOutcome>;
}

// Private to accounts.rs, reused by Task 1.3:
const VERIFY_EMAIL_DROPPING_UNPROVEN_PASSWORD: &str;
async fn record_terms_acceptance(
    tx: &mut Transaction<'_, Postgres>,
    account_id: Uuid,
    terms_version: Option<&str>,
) -> Result<()>;
```

`created` is true when the account had never verified its email before this code.

- [ ] **Step 1: Write the failing tests**

Append to the end of `crates/buzz-db/src/store/accounts.rs`:

```rust
#[cfg(test)]
mod sign_in_code_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    async fn setup_db() -> (Db, PgPool) {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&crate::test_support::database_url())
            .await
            .expect("connect to the account test database");
        (Db::from_pool(pool.clone()), pool)
    }

    fn candidate(email: &str) -> NewAccount {
        let id = Uuid::new_v4();
        NewAccount {
            email: email.to_owned(),
            pubkey: format!("{:064x}", id.as_u128()),
            password_hash: None,
            wrapped_dek: vec![1_u8; 28],
            kek_id: "test-kek".to_owned(),
            sealed_nsec: vec![2_u8; 16],
            nonce: vec![3_u8; 12],
            email_verified: false,
        }
    }

    fn sign_in_code(hash_byte: u8) -> NewAccountCode {
        NewAccountCode {
            code_id: Uuid::new_v4(),
            outbox_id: Uuid::new_v4(),
            code_hash: [hash_byte; 32],
            code_ciphertext: vec![4_u8; 16],
            nonce: vec![5_u8; 12],
            purpose: AccountCodePurpose::SignIn,
        }
    }

    fn unique_email(prefix: &str) -> String {
        format!("{prefix}-{}@example.invalid", Uuid::new_v4().simple())
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn start_creates_one_passwordless_account_and_reuses_it() {
        let (db, pool) = setup_db().await;
        let email = unique_email("start");
        assert!(matches!(
            db.start_sign_in_code(&candidate(&email), &sign_in_code(1))
                .await
                .expect("first start"),
            StartSignInCodeOutcome::Issued
        ));
        assert!(matches!(
            db.start_sign_in_code(&candidate(&email), &sign_in_code(2))
                .await
                .expect("second start"),
            StartSignInCodeOutcome::Issued
        ));

        let account = db
            .account_by_email(&email)
            .await
            .expect("load account")
            .expect("start created the account");
        assert!(account.email_verified_at.is_none());
        assert!(account.password_hash().is_none());
        let accounts: i64 = sqlx::query_scalar("SELECT count(*) FROM accounts WHERE email = $1")
            .bind(&email)
            .fetch_one(&pool)
            .await
            .expect("count accounts");
        assert_eq!(accounts, 1, "a second start reuses the pending account");
        let active: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM account_codes \
             WHERE account_id = $1 AND purpose = 'sign_in' AND consumed_at IS NULL",
        )
        .bind(account.id)
        .fetch_one(&pool)
        .await
        .expect("count active codes");
        assert_eq!(active, 1, "only the newest sign-in code stays active");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn first_verified_sign_in_is_created_and_records_terms() {
        let (db, pool) = setup_db().await;
        let email = unique_email("consume");
        db.start_sign_in_code(&candidate(&email), &sign_in_code(7))
            .await
            .expect("start");

        match db
            .consume_sign_in_code(&email, &[8_u8; 32], "2026-10-11", None)
            .await
            .expect("wrong code")
        {
            ConsumeSignInCodeOutcome::Invalid { attempts_left } => assert_eq!(attempts_left, 4),
            _ => panic!("a wrong code must count one attempt"),
        }
        let first = match db
            .consume_sign_in_code(&email, &[7_u8; 32], "2026-10-11", None)
            .await
            .expect("right code")
        {
            ConsumeSignInCodeOutcome::Accepted { account, created } => {
                assert!(created, "the first verified sign-in creates the account");
                account
            }
            _ => panic!("the right code must sign in"),
        };
        assert!(first.email_verified_at.is_some());
        let terms: (Option<String>, bool) = sqlx::query_as(
            "SELECT terms_version, terms_accepted_at IS NOT NULL FROM accounts WHERE id = $1",
        )
        .bind(first.id)
        .fetch_one(&pool)
        .await
        .expect("read terms");
        assert_eq!(terms, (Some("2026-10-11".to_owned()), true));

        db.start_sign_in_code(&candidate(&email), &sign_in_code(9))
            .await
            .expect("second start");
        match db
            .consume_sign_in_code(&email, &[9_u8; 32], "2026-11-01", None)
            .await
            .expect("second sign-in")
        {
            ConsumeSignInCodeOutcome::Accepted { account, created } => {
                assert!(!created, "a verified account signs in; it is not created again");
                assert_eq!(account.id, first.id);
            }
            _ => panic!("the second code must sign in"),
        }
        let terms_version: Option<String> =
            sqlx::query_scalar("SELECT terms_version FROM accounts WHERE id = $1")
                .bind(first.id)
                .fetch_one(&pool)
                .await
                .expect("read updated terms");
        assert_eq!(terms_version.as_deref(), Some("2026-11-01"));
        assert!(
            matches!(
                db.consume_sign_in_code(&email, &[9_u8; 32], "2026-11-01", None)
                    .await
                    .expect("reused code"),
                ConsumeSignInCodeOutcome::Expired
            ),
            "a used code never works twice"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn five_wrong_codes_burn_the_code_and_lock_new_starts_until_it_expires() {
        let (db, _pool) = setup_db().await;
        let email = unique_email("burn");
        db.start_sign_in_code(&candidate(&email), &sign_in_code(11))
            .await
            .expect("start");
        for expected_left in [4, 3, 2, 1] {
            match db
                .consume_sign_in_code(&email, &[12_u8; 32], "2026-10-11", None)
                .await
                .expect("wrong code")
            {
                ConsumeSignInCodeOutcome::Invalid { attempts_left } => {
                    assert_eq!(attempts_left, expected_left)
                }
                _ => panic!("wrong codes count down"),
            }
        }
        assert!(matches!(
            db.consume_sign_in_code(&email, &[12_u8; 32], "2026-10-11", None)
                .await
                .expect("fifth wrong code"),
            ConsumeSignInCodeOutcome::AttemptsExceeded { .. }
        ));
        assert!(
            matches!(
                db.consume_sign_in_code(&email, &[11_u8; 32], "2026-10-11", None)
                    .await
                    .expect("right code after the burn"),
                ConsumeSignInCodeOutcome::AttemptsExceeded { .. }
            ),
            "a burned code never signs in, even when it is right"
        );
        match db
            .start_sign_in_code(&candidate(&email), &sign_in_code(13))
            .await
            .expect("start during the lock")
        {
            StartSignInCodeOutcome::Locked { retry_after_secs } => assert!(retry_after_secs > 0),
            StartSignInCodeOutcome::Issued => panic!("no new code until the burned one expires"),
        }
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn first_proof_of_the_email_drops_a_password_nobody_proved() {
        let (db, _pool) = setup_db().await;
        let squatted = unique_email("squatted");
        let mut squatter = candidate(&squatted);
        squatter.password_hash =
            Some("$argon2id$v=19$m=19456,t=2,p=1$c3F1YXR0ZXI$c3F1YXR0ZXI".to_owned());
        assert!(matches!(
            db.create_account(&squatter, None)
                .await
                .expect("squatter signup"),
            CreateAccountOutcome::Created(_)
        ));
        db.start_sign_in_code(&candidate(&squatted), &sign_in_code(21))
            .await
            .expect("owner start");
        match db
            .consume_sign_in_code(&squatted, &[21_u8; 32], "2026-10-11", None)
            .await
            .expect("owner proves the email")
        {
            ConsumeSignInCodeOutcome::Accepted { account, created } => {
                assert!(created);
                assert!(
                    account.password_hash().is_none(),
                    "the squatter's password must not survive"
                );
            }
            _ => panic!("the owner's code must sign in"),
        }

        let owned = unique_email("owned");
        let mut verified = candidate(&owned);
        verified.email_verified = true;
        verified.password_hash = Some("$argon2id$v=19$m=19456,t=2,p=1$b3duZXI$b3duZXI".to_owned());
        db.create_account(&verified, None)
            .await
            .expect("verified password account");
        db.start_sign_in_code(&candidate(&owned), &sign_in_code(22))
            .await
            .expect("start");
        match db
            .consume_sign_in_code(&owned, &[22_u8; 32], "2026-10-11", None)
            .await
            .expect("sign in")
        {
            ConsumeSignInCodeOutcome::Accepted { account, created } => {
                assert!(!created);
                assert!(account.password_hash().is_some(), "a proven password stays");
            }
            _ => panic!("the code must sign in"),
        }
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn consume_account_code_refuses_sign_in_codes() {
        let (db, _pool) = setup_db().await;
        let email = unique_email("refuse");
        db.start_sign_in_code(&candidate(&email), &sign_in_code(31))
            .await
            .expect("start");
        assert!(db
            .consume_account_code(&email, AccountCodePurpose::SignIn, &[31_u8; 32], None)
            .await
            .is_err());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-db --lib sign_in_code_tests`
Expected: FAIL to compile with `no variant or associated item named SignIn found for enum AccountCodePurpose` and `no method named start_sign_in_code found for struct Db`.

- [ ] **Step 3: Add the migration and the schema change**

Create `migrations/0056_account_sign_in_codes.sql`:

```sql
-- Passwordless sign-in codes and terms acceptance for the Colony app.
ALTER TABLE accounts
    ADD COLUMN terms_version TEXT
        CHECK (terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 64),
    ADD COLUMN terms_accepted_at TIMESTAMPTZ;

ALTER TABLE account_codes
    DROP CONSTRAINT account_codes_purpose_check,
    ADD CONSTRAINT account_codes_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'sign_in'));

ALTER TABLE account_mail_outbox
    DROP CONSTRAINT account_mail_outbox_purpose_check,
    ADD CONSTRAINT account_mail_outbox_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'sign_in'));

ALTER TABLE account_test_mail
    DROP CONSTRAINT account_test_mail_purpose_check,
    ADD CONSTRAINT account_test_mail_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'sign_in'));
```

In `schema/schema.sql`, in `CREATE TABLE accounts` (lines 2051-2066), replace:

```sql
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ
);
CREATE UNIQUE INDEX accounts_email_lower_key ON accounts (lower(email));
```

with:

```sql
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ,
    terms_version TEXT CHECK (terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 64),
    terms_accepted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX accounts_email_lower_key ON accounts (lower(email));
```

Then replace each of the three occurrences in the accounts section (lines 2080, 2096 and 2117) of:

```sql
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
```

with:

```sql
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'sign_in')),
```

In `crates/buzz-db/src/runtime/migration.rs`, replace (lines 718-724):

```rust
        assert_eq!(migrations.len(), 55);
        assert_eq!(migrations[53].version, 54);
        assert_eq!(migrations[54].version, 55);
        assert!(migrations[54]
            .sql
            .as_str()
            .contains("CREATE TABLE account_ai_sessions"));
```

with:

```rust
        assert_eq!(migrations.len(), 56);
        assert_eq!(migrations[53].version, 54);
        assert_eq!(migrations[54].version, 55);
        assert!(migrations[54]
            .sql
            .as_str()
            .contains("CREATE TABLE account_ai_sessions"));
        assert_eq!(migrations[55].version, 56);
        assert!(migrations[55].sql.as_str().contains("'sign_in'"));
```

- [ ] **Step 4: Add the purpose and the outcome types**

In `crates/buzz-db/src/store/accounts.rs`, replace the purpose enum and its `impl` (lines 119-135) with:

```rust
/// Purpose of a one-time account code.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AccountCodePurpose {
    /// Verify the account email address.
    VerifyEmail,
    /// Replace or create the account password.
    ResetPassword,
    /// Sign in without a password; the first use also verifies the email.
    SignIn,
}

impl AccountCodePurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::VerifyEmail => "verify_email",
            Self::ResetPassword => "reset_password",
            Self::SignIn => "sign_in",
        }
    }
}
```

After `IssueAccountCodeOutcome` (it ends at line 193), add:

```rust
/// Result of starting a passwordless sign-in.
pub enum StartSignInCodeOutcome {
    /// A fresh sign-in code and its encrypted mail row were committed.
    Issued,
    /// The newest sign-in code used up its attempts and has not expired yet.
    Locked {
        /// Seconds until the locked code expires and a new one can be sent.
        retry_after_secs: i64,
    },
}

/// Result of consuming a passwordless sign-in code.
pub enum ConsumeSignInCodeOutcome {
    /// Code accepted; the account is verified and the terms are recorded.
    Accepted {
        /// The signed-in account.
        account: Box<AccountRecord>,
        /// True when the account had never verified its email before this code.
        created: bool,
    },
    /// The supplied code does not match the active code.
    Invalid {
        /// Failed submissions remaining before this code is burned.
        attempts_left: i32,
    },
    /// No active code exists, it expired, or it was already used.
    Expired,
    /// The active code used up its attempts.
    AttemptsExceeded {
        /// Seconds until the burned code expires.
        retry_after_secs: i64,
    },
}
```

- [ ] **Step 5: Share the code check between both consumers**

After `delete_code_outbox` (it ends at line 996), add:

```rust
/// Result of locking and comparing the newest code for one email and purpose.
enum LockedCode {
    /// The code matched and is now marked used inside the caller's transaction.
    Matched {
        /// The matched code row.
        code_id: Uuid,
        /// The account the code belongs to.
        account_id: Uuid,
    },
    /// The code cannot be used. Any bookkeeping writes are already in the
    /// transaction; `commit` says whether they must be kept.
    Rejected {
        /// Why the code was refused.
        reason: CodeRejection,
        /// Commit the transaction when true, roll it back when false.
        commit: bool,
    },
}

/// Why a submitted code was refused.
enum CodeRejection {
    Invalid { attempts_left: i32 },
    Expired,
    AttemptsExceeded { retry_after_secs: i64 },
}

impl CodeRejection {
    fn into_consume_outcome(self) -> ConsumeAccountCodeOutcome {
        match self {
            Self::Invalid { attempts_left } => ConsumeAccountCodeOutcome::Invalid { attempts_left },
            Self::Expired => ConsumeAccountCodeOutcome::Expired,
            Self::AttemptsExceeded { retry_after_secs } => {
                ConsumeAccountCodeOutcome::AttemptsExceeded { retry_after_secs }
            }
        }
    }

    fn into_sign_in_outcome(self) -> ConsumeSignInCodeOutcome {
        match self {
            Self::Invalid { attempts_left } => ConsumeSignInCodeOutcome::Invalid { attempts_left },
            Self::Expired => ConsumeSignInCodeOutcome::Expired,
            Self::AttemptsExceeded { retry_after_secs } => {
                ConsumeSignInCodeOutcome::AttemptsExceeded { retry_after_secs }
            }
        }
    }
}

/// Lock the newest code for `email` and `purpose`, count a wrong submission,
/// burn the code at the attempt limit, and mark a matching code used.
async fn lock_and_check_code(
    tx: &mut Transaction<'_, Postgres>,
    email: &str,
    purpose: AccountCodePurpose,
    provided_hash: &[u8; 32],
) -> Result<LockedCode> {
    let row = sqlx::query(
        "SELECT c.id, c.account_id, c.code_hash, c.expires_at, c.attempts, c.consumed_at \
         FROM account_codes c JOIN accounts a ON a.id = c.account_id \
         WHERE lower(a.email) = lower($1) AND c.purpose = $2 \
         ORDER BY c.created_at DESC, c.id DESC LIMIT 1 FOR UPDATE OF c",
    )
    .bind(email)
    .bind(purpose.as_str())
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(LockedCode::Rejected {
            reason: CodeRejection::Expired,
            commit: false,
        });
    };

    let code_id: Uuid = row.try_get("id")?;
    let account_id: Uuid = row.try_get("account_id")?;
    let stored_hash: Vec<u8> = row.try_get("code_hash")?;
    let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
    let attempts: i32 = row.try_get("attempts")?;
    let consumed_at: Option<DateTime<Utc>> = row.try_get("consumed_at")?;
    if expires_at <= Utc::now() {
        sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
            .bind(code_id)
            .execute(&mut **tx)
            .await?;
        delete_code_outbox(tx, code_id).await?;
        return Ok(LockedCode::Rejected {
            reason: CodeRejection::Expired,
            commit: true,
        });
    }
    if attempts >= ACCOUNT_CODE_MAX_ATTEMPTS {
        if consumed_at.is_none() {
            sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
                .bind(code_id)
                .execute(&mut **tx)
                .await?;
            delete_code_outbox(tx, code_id).await?;
        }
        return Ok(LockedCode::Rejected {
            reason: CodeRejection::AttemptsExceeded {
                retry_after_secs: retry_after_until(expires_at),
            },
            commit: true,
        });
    }
    if consumed_at.is_some() {
        return Ok(LockedCode::Rejected {
            reason: CodeRejection::Expired,
            commit: false,
        });
    }

    let matches = bool::from(stored_hash.as_slice().ct_eq(provided_hash.as_slice()));
    if !matches {
        let next_attempts = attempts.saturating_add(1);
        sqlx::query(
            "UPDATE account_codes SET attempts = $2, \
             consumed_at = CASE WHEN $2 >= $3 THEN now() ELSE consumed_at END \
             WHERE id = $1",
        )
        .bind(code_id)
        .bind(next_attempts)
        .bind(ACCOUNT_CODE_MAX_ATTEMPTS)
        .execute(&mut **tx)
        .await?;
        if next_attempts >= ACCOUNT_CODE_MAX_ATTEMPTS {
            delete_code_outbox(tx, code_id).await?;
            return Ok(LockedCode::Rejected {
                reason: CodeRejection::AttemptsExceeded {
                    retry_after_secs: retry_after_until(expires_at),
                },
                commit: true,
            });
        }
        return Ok(LockedCode::Rejected {
            reason: CodeRejection::Invalid {
                attempts_left: ACCOUNT_CODE_MAX_ATTEMPTS.saturating_sub(next_attempts),
            },
            commit: true,
        });
    }

    sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
        .bind(code_id)
        .execute(&mut **tx)
        .await?;
    Ok(LockedCode::Matched {
        code_id,
        account_id,
    })
}

/// Commit or roll back a transaction that ended in a refused code.
async fn finish_rejected_code(tx: Transaction<'_, Postgres>, commit: bool) -> Result<()> {
    if commit {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }
    Ok(())
}

/// Verify an account's email. A password set while the email was unproven is
/// dropped, because whoever set it never proved they own the address.
const VERIFY_EMAIL_DROPPING_UNPROVEN_PASSWORD: &str = "UPDATE accounts SET \
     password_hash = CASE WHEN email_verified_at IS NULL THEN NULL ELSE password_hash END, \
     failed_attempts = CASE WHEN email_verified_at IS NULL THEN 0 ELSE failed_attempts END, \
     locked_until = CASE WHEN email_verified_at IS NULL THEN NULL ELSE locked_until END, \
     email_verified_at = COALESCE(email_verified_at, now()), \
     last_signin_at = now(), updated_at = now() WHERE id = $1";

/// Record which terms version the person accepted, and when.
async fn record_terms_acceptance(
    tx: &mut Transaction<'_, Postgres>,
    account_id: Uuid,
    terms_version: Option<&str>,
) -> Result<()> {
    if let Some(terms_version) = terms_version {
        sqlx::query(
            "UPDATE accounts SET terms_version = $2, terms_accepted_at = now() WHERE id = $1",
        )
        .bind(account_id)
        .bind(terms_version)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
```

Postgres evaluates every `SET` expression against the old row, so the `CASE WHEN email_verified_at IS NULL` tests in `VERIFY_EMAIL_DROPPING_UNPROVEN_PASSWORD` see the value from before this statement.

Replace `consume_account_code` (lines 359-486, from its doc comment through its closing brace) with:

```rust
    /// Atomically compare, count, and consume a code while updating its account.
    ///
    /// Sign-in codes are consumed by [`Db::consume_sign_in_code`] instead.
    #[datastore_span(name = "account_consume_code", system = "postgresql")]
    pub async fn consume_account_code(
        &self,
        email: &str,
        purpose: AccountCodePurpose,
        provided_hash: &[u8; 32],
        new_password_hash: Option<&str>,
    ) -> Result<ConsumeAccountCodeOutcome> {
        if purpose == AccountCodePurpose::SignIn {
            return Err(DbError::InvalidData(
                "sign-in codes are consumed by consume_sign_in_code".to_owned(),
            ));
        }
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let (code_id, account_id) =
            match lock_and_check_code(&mut tx, email, purpose, provided_hash).await? {
                LockedCode::Matched {
                    code_id,
                    account_id,
                } => (code_id, account_id),
                LockedCode::Rejected { reason, commit } => {
                    finish_rejected_code(tx, commit).await?;
                    return Ok(reason.into_consume_outcome());
                }
            };
        match purpose {
            AccountCodePurpose::VerifyEmail => {
                sqlx::query(
                    "UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, now()), \
                     updated_at = now() WHERE id = $1",
                )
                .bind(account_id)
                .execute(&mut *tx)
                .await?;
            }
            AccountCodePurpose::ResetPassword => {
                let password_hash = new_password_hash.ok_or_else(|| {
                    DbError::InvalidData("reset code requires a new password hash".to_owned())
                })?;
                sqlx::query(
                    "UPDATE accounts SET password_hash = $2, updated_at = now(), \
                     failed_attempts = 0, locked_until = NULL WHERE id = $1",
                )
                .bind(account_id)
                .bind(password_hash)
                .execute(&mut *tx)
                .await?;
            }
            AccountCodePurpose::SignIn => {
                return Err(DbError::InvalidData(
                    "sign-in codes are consumed by consume_sign_in_code".to_owned(),
                ));
            }
        }
        delete_code_outbox(&mut tx, code_id).await?;
        let row = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{ACCOUNT_SELECT} WHERE a.id = $1"
        )))
        .bind(account_id)
        .fetch_one(&mut *tx)
        .await?;
        let account = account_from_row(row)?;
        tx.commit().await?;
        Ok(ConsumeAccountCodeOutcome::Accepted(Box::new(account)))
    }

    /// Consume a passwordless sign-in code: verify the email (dropping a
    /// password nobody proved), record the terms version, and, on the first
    /// verified sign-in, store the person's profile event in the same commit.
    #[datastore_span(name = "account_consume_sign_in_code", system = "postgresql")]
    pub async fn consume_sign_in_code(
        &self,
        email: &str,
        provided_hash: &[u8; 32],
        terms_version: &str,
        profile: Option<(&nostr::Event, CommunityId)>,
    ) -> Result<ConsumeSignInCodeOutcome> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let (code_id, account_id) = match lock_and_check_code(
            &mut tx,
            email,
            AccountCodePurpose::SignIn,
            provided_hash,
        )
        .await?
        {
            LockedCode::Matched {
                code_id,
                account_id,
            } => (code_id, account_id),
            LockedCode::Rejected { reason, commit } => {
                finish_rejected_code(tx, commit).await?;
                return Ok(reason.into_sign_in_outcome());
            }
        };
        let previously_verified: bool = sqlx::query_scalar(
            "SELECT email_verified_at IS NOT NULL FROM accounts WHERE id = $1 FOR UPDATE",
        )
        .bind(account_id)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(VERIFY_EMAIL_DROPPING_UNPROVEN_PASSWORD)
            .bind(account_id)
            .execute(&mut *tx)
            .await?;
        record_terms_acceptance(&mut tx, account_id, Some(terms_version)).await?;
        let created = !previously_verified;
        if created {
            if let Some((event, community_id)) = profile {
                crate::store::event::insert_event_in_transaction(&mut tx, community_id, event, None)
                    .await?;
            }
        }
        delete_code_outbox(&mut tx, code_id).await?;
        let row = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{ACCOUNT_SELECT} WHERE a.id = $1"
        )))
        .bind(account_id)
        .fetch_one(&mut *tx)
        .await?;
        let account = account_from_row(row)?;
        tx.commit().await?;
        Ok(ConsumeSignInCodeOutcome::Accepted {
            account: Box::new(account),
            created,
        })
    }
```

- [ ] **Step 6: Add `start_sign_in_code`**

After `issue_account_code` (it ends at line 334), add:

```rust
    /// Issue a sign-in code for an email. When no account owns the email, a
    /// passwordless, unverified account is created in the same commit, so the
    /// answer never depends on whether the email was known.
    #[datastore_span(name = "account_start_sign_in_code", system = "postgresql")]
    pub async fn start_sign_in_code(
        &self,
        candidate: &NewAccount,
        code: &NewAccountCode,
    ) -> Result<StartSignInCodeOutcome> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("account-email:{}", candidate.email))
            .execute(&mut *tx)
            .await?;
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM accounts WHERE lower(email) = lower($1) FOR UPDATE",
        )
        .bind(&candidate.email)
        .fetch_optional(&mut *tx)
        .await?;
        let account_id = match existing {
            Some(account_id) => account_id,
            None => match insert_account(&mut tx, candidate).await? {
                Some(account_id) => account_id,
                None => {
                    sqlx::query_scalar(
                        "SELECT id FROM accounts WHERE lower(email) = lower($1) FOR UPDATE",
                    )
                    .bind(&candidate.email)
                    .fetch_one(&mut *tx)
                    .await?
                }
            },
        };
        let active = sqlx::query(
            "SELECT attempts, expires_at FROM account_codes \
             WHERE account_id = $1 AND purpose = $2 \
             ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE",
        )
        .bind(account_id)
        .bind(code.purpose.as_str())
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(active) = active {
            let attempts: i32 = active.try_get("attempts")?;
            let expires_at: DateTime<Utc> = active.try_get("expires_at")?;
            if attempts >= ACCOUNT_CODE_MAX_ATTEMPTS && expires_at > Utc::now() {
                let retry_after_secs = retry_after_until(expires_at);
                tx.rollback().await?;
                return Ok(StartSignInCodeOutcome::Locked { retry_after_secs });
            }
        }
        replace_active_code(&mut tx, account_id, code.purpose).await?;
        insert_account_code(&mut tx, account_id, &candidate.email, code).await?;
        prune_old_account_mail(&mut tx).await?;
        tx.commit().await?;
        Ok(StartSignInCodeOutcome::Issued)
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test -p buzz-db --lib embedded_migrator_contains_consolidated_initial_schema`
Expected: PASS (no services needed).

Run (with local Postgres migrated): `cargo run -p buzz-admin -- migrate && BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz cargo test -p buzz-db --lib sign_in_code_tests -- --ignored`
Expected: PASS, 5 tests.

Run: `cargo test -p buzz-relay --lib api::accounts -- --ignored` with `BUZZ_TEST_DATABASE_URL` and `REDIS_URL=redis://127.0.0.1:6379` set
Expected: PASS for the existing account route tests (proves the shared code check kept verify, reset and lockout behaviour).

- [ ] **Step 8: Commit**

```bash
git add migrations/0056_account_sign_in_codes.sql schema/schema.sql \
  crates/buzz-db/src/store/accounts.rs crates/buzz-db/src/runtime/migration.rs
git commit -s -m "feat(db): sign-in codes and terms acceptance for accounts"
```

---

### Task 1.2: Email code sign-in routes and the sign-in email

**Files:**
- Modify: `crates/buzz-relay/src/api/accounts.rs:27-30` (imports), `:78-99` (router), after `:187` (request and response types), after `:300` (helpers), after `:591` (new handlers), `:629-632` (resend match), `:1100-1105` (cooldown key)
- Modify: `crates/buzz-relay/src/api/accounts/mail.rs:20-54`
- Modify: `docs/auth-accounts.md:72-83` (endpoint table)
- Test: `crates/buzz-relay/src/api/accounts/postgres_tests.rs` (helpers and three tests at the end), `crates/buzz-relay/src/api/accounts/mail.rs` (unit tests)

**Interfaces:**
- Consumes: `Db::start_sign_in_code`, `Db::consume_sign_in_code`, `StartSignInCodeOutcome`, `ConsumeSignInCodeOutcome`, `AccountCodePurpose::SignIn` (Task 1.1).
- Produces:
  - `POST /api/accounts/code/start` with `{ "email": string }`: `200 {"sent": true, "resendAfterSeconds": n}` for every well-formed email; `400 {"error":"invalid_request"}` for a malformed email; `429 {"error":"rate_limited", ...}` past the per-email or per-address limit.
  - `POST /api/accounts/code/verify` with `{ "email", "code", "termsVersion", "displayName" }`: `200 {"account": {...}, "nsec": "nsec1...", "created": bool}`; `400 {"error":"invalid_code", "attempts_left": n}` for a wrong code; `400 {"error":"invalid_code"}` for a malformed code; `400 {"error":"invalid_request"}` for a missing or bad terms version; `410 {"error":"code_expired"}`; `429 {"error":"too_many_attempts", "retry_after_secs": n}`.
  - `fn normalize_terms_version(raw: &str) -> Result<String, (StatusCode, Json<Value>)>` (private, used by Task 1.3).

- [ ] **Step 1: Write the failing tests**

At the end of `crates/buzz-relay/src/api/accounts/mail.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::message_for;

    #[test]
    fn sign_in_mail_names_colony_and_carries_the_code() {
        let (subject, body) = message_for("sign_in", "482913");
        assert_eq!(subject.as_str(), "Your Colony code: 482913");
        assert!(body.contains("sign in to Colony: 482913"));
        assert!(body.contains("15 minutes"));
    }

    #[test]
    fn verification_and_reset_mail_keep_their_wording() {
        let (subject, body) = message_for("reset_password", "123456");
        assert_eq!(subject.as_str(), "Your password reset code");
        assert!(body.contains("123456"));
        let (subject, body) = message_for("verify_email", "654321");
        assert_eq!(subject.as_str(), "Your verification code");
        assert!(body.contains("654321"));
    }
}
```

At the end of `crates/buzz-relay/src/api/accounts/postgres_tests.rs`, add:

```rust
async fn clear_sign_in_cooldown(state: &Arc<AppState>, email: &str) {
    let digest = hex::encode(Sha256::digest(email.as_bytes()));
    let key = format!("colony:account-code-cooldown:sign_in:{digest}");
    let mut connection = state
        .redis_pool
        .get()
        .await
        .expect("account test Redis connection");
    let _: i64 = redis::cmd("DEL")
        .arg(key)
        .query_async(&mut *connection)
        .await
        .expect("clear the sign-in cooldown");
}

async fn test_mail_count(pool: &PgPool, email: &str, purpose: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM account_test_mail WHERE recipient = $1 AND purpose = $2",
    )
    .bind(email)
    .bind(purpose)
    .fetch_one(pool)
    .await
    .expect("count test-only mail")
}

async fn code_start(state: &Arc<AppState>, host: &str, ip: Ipv4Addr, email: &str) -> (StatusCode, Value) {
    json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/code/start",
            host,
            ip,
            json!({ "email": email }),
            None,
        )
        .await,
    )
    .await
}

async fn code_verify(state: &Arc<AppState>, host: &str, ip: Ipv4Addr, body: Value) -> (StatusCode, Value) {
    json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/code/verify",
            host,
            ip,
            body,
            None,
        )
        .await,
    )
    .await
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn email_code_sign_in_creates_a_passwordless_account_then_signs_it_in_again() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("code-{}@example.test", Uuid::new_v4().simple());

    let (start_status, start_body) = code_start(&state, &host, ip, &email).await;
    assert_eq!(start_status, StatusCode::OK);
    assert_eq!(
        start_body,
        json!({ "sent": true, "resendAfterSeconds": ACCOUNT_CODE_RESEND_COOLDOWN_SECS })
    );
    let (again_status, again_body) = code_start(&state, &host, ip, &email).await;
    assert_eq!(again_status, StatusCode::OK);
    assert_eq!(again_body["sent"], true);
    let wait = again_body["resendAfterSeconds"]
        .as_i64()
        .expect("resend wait in seconds");
    assert!((1..=ACCOUNT_CODE_RESEND_COOLDOWN_SECS).contains(&wait));

    deliver_pending_mail(&state).await;
    assert_eq!(
        test_mail_count(&pool, &email, "sign_in").await,
        1,
        "a resend inside the cooldown sends no second code"
    );
    let code = test_mail_code(&pool, &email, "sign_in").await;
    let (verify_status, verify_body) = code_verify(
        &state,
        &host,
        ip,
        json!({
            "email": email,
            "code": code,
            "termsVersion": "2026-10-11",
            "displayName": "Lerato Mokoena",
        }),
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    assert_eq!(verify_body["created"], true);
    assert_eq!(verify_body["account"]["has_password"], false);
    assert!(verify_body["nsec"]
        .as_str()
        .is_some_and(|nsec| nsec.starts_with("nsec1")));
    let pubkey = verify_body["account"]["pubkey"]
        .as_str()
        .expect("session public key")
        .to_owned();

    let terms: (Option<String>, bool) = sqlx::query_as(
        "SELECT terms_version, terms_accepted_at IS NOT NULL FROM accounts WHERE email = $1",
    )
    .bind(&email)
    .fetch_one(&pool)
    .await
    .expect("read recorded terms");
    assert_eq!(terms, (Some("2026-10-11".to_owned()), true));

    let community_id: Uuid = sqlx::query_scalar("SELECT id FROM communities WHERE host = $1")
        .bind(&host)
        .fetch_one(&pool)
        .await
        .expect("code sign-in community id");
    let content: String = sqlx::query_scalar(
        "SELECT content FROM events WHERE community_id = $1 AND pubkey = $2 AND kind = 0 \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(community_id)
    .bind(hex::decode(&pubkey).expect("decode profile pubkey"))
    .fetch_one(&pool)
    .await
    .expect("display name profile event");
    assert_eq!(
        serde_json::from_str::<Value>(&content).expect("profile content"),
        json!({ "display_name": "Lerato Mokoena" })
    );

    clear_sign_in_cooldown(&state, &email).await;
    let (_, second_start) = code_start(&state, &host, ip, &email).await;
    assert_eq!(second_start["sent"], true);
    deliver_pending_mail(&state).await;
    let second_code = test_mail_code(&pool, &email, "sign_in").await;
    let (second_status, second_body) = code_verify(
        &state,
        &host,
        ip,
        json!({ "email": email, "code": second_code, "termsVersion": "2026-11-01" }),
    )
    .await;
    assert_eq!(second_status, StatusCode::OK);
    assert_eq!(second_body["created"], false);
    assert_eq!(second_body["account"]["pubkey"].as_str(), Some(pubkey.as_str()));
    let terms_version: Option<String> =
        sqlx::query_scalar("SELECT terms_version FROM accounts WHERE email = $1")
            .bind(&email)
            .fetch_one(&pool)
            .await
            .expect("read updated terms");
    assert_eq!(terms_version.as_deref(), Some("2026-11-01"));
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn email_code_sign_in_does_not_reveal_accounts_and_burns_a_guessed_code() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let known = format!("known-{}@example.test", Uuid::new_v4().simple());
    let unknown = format!("unknown-{}@example.test", Uuid::new_v4().simple());

    let _ = code_start(&state, &host, ip, &known).await;
    deliver_pending_mail(&state).await;
    let known_code = test_mail_code(&pool, &known, "sign_in").await;
    let (made_status, _) = code_verify(
        &state,
        &host,
        ip,
        json!({ "email": known, "code": known_code, "termsVersion": "2026-10-11" }),
    )
    .await;
    assert_eq!(made_status, StatusCode::OK);
    clear_sign_in_cooldown(&state, &known).await;

    let known_answer = code_start(&state, &host, ip, &known).await;
    let unknown_answer = code_start(&state, &host, ip, &unknown).await;
    assert_eq!(
        known_answer, unknown_answer,
        "a known email and an unknown email get the same answer"
    );
    assert_eq!(
        unknown_answer.1,
        json!({ "sent": true, "resendAfterSeconds": ACCOUNT_CODE_RESEND_COOLDOWN_SECS })
    );

    deliver_pending_mail(&state).await;
    let code = test_mail_code(&pool, &unknown, "sign_in").await;
    let wrong = wrong_test_code(&code);
    for attempts_left in [4, 3, 2, 1] {
        let (status, body) = code_verify(
            &state,
            &host,
            ip,
            json!({ "email": unknown, "code": wrong, "termsVersion": "2026-10-11" }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "invalid_code", "attempts_left": attempts_left }));
    }
    let (fifth_status, fifth_body) = code_verify(
        &state,
        &host,
        ip,
        json!({ "email": unknown, "code": wrong, "termsVersion": "2026-10-11" }),
    )
    .await;
    assert_eq!(fifth_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(fifth_body["error"], "too_many_attempts");
    let (burned_status, burned_body) = code_verify(
        &state,
        &host,
        ip,
        json!({ "email": unknown, "code": code, "termsVersion": "2026-10-11" }),
    )
    .await;
    assert_eq!(
        burned_status,
        StatusCode::TOO_MANY_REQUESTS,
        "a burned code never works, even when it is right"
    );
    assert_eq!(burned_body["error"], "too_many_attempts");

    clear_sign_in_cooldown(&state, &unknown).await;
    let (locked_status, locked_body) = code_start(&state, &host, ip, &unknown).await;
    assert_eq!(locked_status, StatusCode::OK);
    assert_eq!(locked_body["sent"], true);
    assert!(
        locked_body["resendAfterSeconds"].as_i64().unwrap_or_default()
            > ACCOUNT_CODE_RESEND_COOLDOWN_SECS,
        "no new code until the burned one expires"
    );
    deliver_pending_mail(&state).await;
    assert_eq!(
        test_mail_count(&pool, &unknown, "sign_in").await,
        1,
        "a locked email gets no new code"
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn email_code_routes_reject_bad_input_and_respect_the_email_limit() {
    let (state, _pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("limits-{}@example.test", Uuid::new_v4().simple());

    let (bad_email_status, bad_email_body) = code_start(&state, &host, ip, "not-an-email").await;
    assert_eq!(bad_email_status, StatusCode::BAD_REQUEST);
    assert_eq!(bad_email_body, json!({ "error": "invalid_request" }));

    let (no_code_status, no_code_body) = code_verify(
        &state,
        &host,
        ip,
        json!({ "email": email, "code": "123456", "termsVersion": "2026-10-11" }),
    )
    .await;
    assert_eq!(no_code_status, StatusCode::GONE);
    assert_eq!(no_code_body, json!({ "error": "code_expired" }));

    let (malformed_status, malformed_body) = code_verify(
        &state,
        &host,
        ip,
        json!({ "email": email, "code": "12ab", "termsVersion": "2026-10-11" }),
    )
    .await;
    assert_eq!(malformed_status, StatusCode::BAD_REQUEST);
    assert_eq!(malformed_body, json!({ "error": "invalid_code" }));

    let (missing_terms_status, missing_terms_body) =
        code_verify(&state, &host, ip, json!({ "email": email, "code": "123456" })).await;
    assert_eq!(missing_terms_status, StatusCode::BAD_REQUEST);
    assert_eq!(missing_terms_body, json!({ "error": "invalid_request" }));

    let (long_terms_status, _) = code_verify(
        &state,
        &host,
        ip,
        json!({ "email": email, "code": "123456", "termsVersion": "x".repeat(65) }),
    )
    .await;
    assert_eq!(long_terms_status, StatusCode::BAD_REQUEST);

    for _ in 0..10 {
        let (status, _) = code_start(&state, &host, ip, &email).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (limited_status, limited_body) = code_start(&state, &host, ip, &email).await;
    assert_eq!(limited_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited_body["error"], "rate_limited");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-relay --lib api::accounts::mail::tests`
Expected: FAIL to compile with `cannot find function message_for in this scope`.

- [ ] **Step 3: Write the sign-in email**

In `crates/buzz-relay/src/api/accounts/mail.rs`, replace the `ResendEmail` struct and the body of `send_resend` from `let subject = match purpose {` through the `let body = ResendEmail { ... };` block (lines 20-54) so the file reads:

```rust
#[derive(Serialize)]
struct ResendEmail<'a> {
    from: &'a str,
    to: [&'a str; 1],
    subject: &'a str,
    text: &'a str,
}

/// Subject and body for one code email. A sign-in subject carries the code so
/// it can be read from a phone notification without opening the email.
fn message_for(purpose: &str, code: &str) -> (Zeroizing<String>, Zeroizing<String>) {
    match purpose {
        "sign_in" => (
            Zeroizing::new(format!("Your Colony code: {code}")),
            Zeroizing::new(format!(
                "Here's your code to sign in to Colony: {code}. It works for 15 minutes. \
                 If you didn't ask for it, you can ignore this email."
            )),
        ),
        "reset_password" => (
            Zeroizing::new("Your password reset code".to_owned()),
            Zeroizing::new(format!(
                "Your verification code is {code}. It expires in 15 minutes. \
                 If you did not request this code, you can ignore this email."
            )),
        ),
        _ => (
            Zeroizing::new("Your verification code".to_owned()),
            Zeroizing::new(format!(
                "Your verification code is {code}. It expires in 15 minutes. \
                 If you did not request this code, you can ignore this email."
            )),
        ),
    }
}

/// Send one code through Resend without logging its API token or payload.
pub async fn send_resend(
    client: &reqwest::Client,
    config: &crate::config::AccountConfig,
    recipient: &str,
    purpose: &str,
    code: &Zeroizing<String>,
) -> Result<(), MailDeliveryError> {
    let api_key = config
        .resend_api_key()
        .ok_or(MailDeliveryError::Unconfigured)?;
    let from = config.mail_from().ok_or(MailDeliveryError::Unconfigured)?;
    let (subject, text) = message_for(purpose, code.as_str());
    let body = ResendEmail {
        from,
        to: [recipient],
        subject: subject.as_str(),
        text: text.as_str(),
    };
```

Keep the rest of `send_resend` (the request, status check and `Ok(())`) unchanged.

- [ ] **Step 4: Add the routes, types and handlers**

In `crates/buzz-relay/src/api/accounts.rs`, replace the `buzz_db::accounts` import (lines 27-30) with:

```rust
use buzz_db::accounts::{
    AccountCodePurpose, AccountRecord, CheckAccountCodeOutcome, ConsumeAccountCodeOutcome,
    ConsumeSignInCodeOutcome, CreateAccountOutcome, IssueAccountCodeOutcome, NewAccount,
    NewAccountCode, StartSignInCodeOutcome,
};
```

In `router` (lines 78-99), after `.route("/verify", post(verify_email))`, add:

```rust
        .route("/code/start", post(code_start))
        .route("/code/verify", post(code_verify))
```

After `PasswordRequest` (it ends at line 187), add:

```rust
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CodeStartRequest {
    email: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CodeVerifyRequest {
    email: String,
    code: SecretString,
    terms_version: String,
    #[serde(default)]
    display_name: Option<String>,
}

const TERMS_VERSION_MAX_CHARS: usize = 64;
```

After `SessionResponse` (it ends at line 226), add:

```rust
#[derive(Serialize)]
struct CodeSessionResponse {
    account: PublicAccount,
    nsec: SecretString,
    created: bool,
}
```

After `normalize_display_name` (it ends at line 300), add:

```rust
fn normalize_terms_version(raw: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let value = raw.trim();
    if value.is_empty()
        || value.chars().count() > TERMS_VERSION_MAX_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(invalid_request());
    }
    Ok(value.to_owned())
}

fn code_sent(resend_after_secs: i64) -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "sent": true,
            "resendAfterSeconds": resend_after_secs.max(1),
        })),
    )
}

fn invalid_code(attempts_left: Option<i32>) -> (StatusCode, Json<Value>) {
    let body = match attempts_left {
        Some(attempts_left) => serde_json::json!({
            "error": "invalid_code",
            "attempts_left": attempts_left,
        }),
        None => serde_json::json!({ "error": "invalid_code" }),
    };
    (StatusCode::BAD_REQUEST, Json(body))
}

/// Sign the person's first profile (display name) with their own key.
fn display_name_event(
    config: &Config,
    account: &AccountRecord,
    display_name: &str,
) -> Result<nostr::Event, (StatusCode, Json<Value>)> {
    let nsec = crypto::open_nsec(
        account_kek(config)?,
        &account.pubkey,
        account.kek_id(),
        account.wrapped_dek(),
        account.sealed_nsec(),
        account.nonce(),
    )
    .map_err(|_| account_unavailable())?;
    let keys = nostr::Keys::parse(nsec.as_str()).map_err(|_| account_unavailable())?;
    nostr::EventBuilder::new(
        nostr::Kind::Metadata,
        serde_json::json!({ "display_name": display_name }).to_string(),
    )
    .sign_with_keys(&keys)
    .map_err(|_| account_unavailable())
}
```

After `verify_email` (it ends at line 591), add:

```rust
/// `POST /api/accounts/code/start` sends a sign-in code. A new email gets a
/// passwordless account in the same commit, so every well-formed email gets
/// the same answer and nobody can learn which emails have accounts.
async fn code_start(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let request: CodeStartRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/code/start", &email).await?;
    ensure_mail_enabled(&state)?;
    let purpose = AccountCodePurpose::SignIn;
    let cooldown = match reserve_code_cooldown(&state, &email, purpose).await? {
        CodeCooldownReservation::Acquired(lease) => lease,
        CodeCooldownReservation::Active { retry_after_secs } => {
            return Ok(code_sent(retry_after_secs));
        }
    };
    let (identity_pubkey, nsec) =
        crypto::generate_nostr_identity().map_err(|_| account_unavailable())?;
    let candidate = new_account(&state.config, email.clone(), None, &nsec, false)?;
    if candidate.pubkey != identity_pubkey {
        release_code_cooldown(&state, &cooldown).await?;
        return Err(account_unavailable());
    }
    let (clear_code, code) = new_code(account_kek(&state.config)?, purpose)?;
    let outcome = match state.db.start_sign_in_code(&candidate, &code).await {
        Ok(outcome) => outcome,
        Err(error) => {
            release_code_cooldown(&state, &cooldown).await?;
            return Err(map_db_error("code_start", error));
        }
    };
    drop(clear_code);
    Ok(match outcome {
        StartSignInCodeOutcome::Issued => code_sent(ACCOUNT_CODE_RESEND_COOLDOWN_SECS),
        StartSignInCodeOutcome::Locked { retry_after_secs } => code_sent(retry_after_secs),
    })
}

/// `POST /api/accounts/code/verify` signs in with an email code, records the
/// accepted terms version, and reports whether this created the account.
async fn code_verify(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<CodeSessionResponse>, (StatusCode, Json<Value>)> {
    let request: CodeVerifyRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/code/verify", &email).await?;
    let terms_version = normalize_terms_version(&request.terms_version)?;
    let display_name = normalize_display_name(request.display_name)?;
    let code = request.code.into_inner();
    if !valid_code(&code) {
        return Err(invalid_code(None));
    }
    let code_hash =
        crypto::hash_code(account_kek(&state.config)?, &code).map_err(|_| account_unavailable())?;
    let tenant = tenant_from_headers(&state, &headers).await?;
    let profile_event = match display_name {
        Some(display_name) => {
            let Some(account) = state
                .db
                .account_by_email(&email)
                .await
                .map_err(|error| map_db_error("code_verify", error))?
            else {
                return Err(code_expired());
            };
            Some(display_name_event(&state.config, &account, &display_name)?)
        }
        None => None,
    };
    let outcome = state
        .db
        .consume_sign_in_code(
            &email,
            &code_hash,
            &terms_version,
            profile_event
                .as_ref()
                .map(|event| (event, tenant.community())),
        )
        .await
        .map_err(|error| map_db_error("code_verify", error))?;
    match outcome {
        ConsumeSignInCodeOutcome::Accepted { account, created } => {
            if created {
                if let Some(event) = profile_event.as_ref() {
                    if let Err(error) = state
                        .pubsub
                        .publish_event(&tenant, EventTopic::Global, event)
                        .await
                    {
                        tracing::warn!(
                            event_id = %event.id,
                            error = %error,
                            "account profile is stored and will be available to event queries"
                        );
                    }
                }
            }
            let Json(SessionResponse { account, nsec }) = session(&state.config, &account)?;
            Ok(Json(CodeSessionResponse {
                account,
                nsec,
                created,
            }))
        }
        ConsumeSignInCodeOutcome::Invalid { attempts_left } => {
            Err(invalid_code(Some(attempts_left)))
        }
        ConsumeSignInCodeOutcome::Expired => Err(code_expired()),
        ConsumeSignInCodeOutcome::AttemptsExceeded { retry_after_secs } => {
            Err(too_many_attempts(retry_after_secs))
        }
    }
}
```

In `resend_code`, replace (lines 629-632):

```rust
        let eligible = match purpose {
            AccountCodePurpose::VerifyEmail => account.email_verified_at.is_none(),
            AccountCodePurpose::ResetPassword => true,
        };
```

with:

```rust
        let eligible = match purpose {
            AccountCodePurpose::VerifyEmail => account.email_verified_at.is_none(),
            AccountCodePurpose::ResetPassword => true,
            AccountCodePurpose::SignIn => false,
        };
```

In `code_purpose_key`, replace (lines 1100-1105):

```rust
fn code_purpose_key(purpose: AccountCodePurpose) -> &'static str {
    match purpose {
        AccountCodePurpose::VerifyEmail => "verify",
        AccountCodePurpose::ResetPassword => "reset",
    }
}
```

with:

```rust
fn code_purpose_key(purpose: AccountCodePurpose) -> &'static str {
    match purpose {
        AccountCodePurpose::VerifyEmail => "verify",
        AccountCodePurpose::ResetPassword => "reset",
        AccountCodePurpose::SignIn => "sign_in",
    }
}
```

In `docs/auth-accounts.md`, after the `POST /api/accounts/verify` row of the endpoint table (line 73), add:

```markdown
| `POST /api/accounts/code/start` | `{email}` | `200 {sent:true, resendAfterSeconds}` for every well-formed email; a new email gets a passwordless, unverified account; no new code while the 30-second cooldown or a burned code is active (the wait is in `resendAfterSeconds`) |
| `POST /api/accounts/code/verify` | `{email, code, termsVersion, displayName?}` | `200` session payload plus `created` (true on the first verified sign-in); records `termsVersion` and its time; drops a password set before the email was proven; `400 invalid_code` (with `attempts_left` for a wrong code), `410 code_expired`, `429 too_many_attempts` once five wrong codes burn it |
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p buzz-relay --lib api::accounts::mail::tests`
Expected: PASS, 2 tests.

Run (Postgres and Redis running, schema migrated): `BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz REDIS_URL=redis://127.0.0.1:6379 cargo test -p buzz-relay --lib email_code -- --ignored`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/buzz-relay/src/api/accounts.rs crates/buzz-relay/src/api/accounts/mail.rs \
  crates/buzz-relay/src/api/accounts/postgres_tests.rs docs/auth-accounts.md
git commit -s -m "feat(relay): passwordless email code sign-in with terms acceptance"
```

---

### Task 1.3: Google sign-in records terms and drops an unproven password

**Files:**
- Modify: `crates/buzz-db/src/store/accounts.rs:631-735` (`account_google_signin`)
- Modify: `crates/buzz-relay/src/api/accounts.rs:148-152` (`GoogleRequest`), `:729-762` (`google_signin`)
- Modify: `docs/auth-accounts.md:76` (Google row)
- Test: `crates/buzz-relay/src/api/accounts/postgres_tests.rs` (one test at the end)

**Interfaces:**
- Consumes: `VERIFY_EMAIL_DROPPING_UNPROVEN_PASSWORD`, `record_terms_acceptance` (Task 1.1); `normalize_terms_version` (Task 1.2).
- Produces: `Db::account_google_signin(&self, sub: &str, verified_email: &str, new_account: &NewAccount, terms_version: Option<&str>) -> Result<AccountRecord>`; `POST /api/accounts/google` accepts an optional `termsVersion`.

- [ ] **Step 1: Write the failing test**

At the end of `crates/buzz-relay/src/api/accounts/postgres_tests.rs`, add:

```rust
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn google_sign_in_records_terms_and_drops_a_password_nobody_proved() {
    let (jwks_url, server) = fake_google_jwks().await;
    let (state, pool, host) =
        test_state(vec![TEST_GOOGLE_AUDIENCE.to_owned()], Some(jwks_url)).await;
    let ip = unique_test_ip();

    let squatted = format!("prehijack-{}@example.test", Uuid::new_v4().simple());
    let squatter_password = "squatter-passphrase";
    let (signup_status, _) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/signup",
            &host,
            ip,
            json!({ "email": squatted, "password": squatter_password }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(signup_status, StatusCode::ACCEPTED);
    let (google_status, google_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/google",
            &host,
            ip,
            json!({
                "id_token": google_token(&squatted, &format!("sub-{}", Uuid::new_v4().simple())),
                "termsVersion": "2026-10-11",
            }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(google_status, StatusCode::OK);
    assert_eq!(google_body["account"]["has_password"], false);
    let (squatter_status, _) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/signin",
            &host,
            ip,
            json!({ "email": squatted, "password": squatter_password }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(
        squatter_status,
        StatusCode::UNAUTHORIZED,
        "the squatter's password must not sign in after the owner proved the email"
    );
    let terms_version: Option<String> =
        sqlx::query_scalar("SELECT terms_version FROM accounts WHERE email = $1")
            .bind(&squatted)
            .fetch_one(&pool)
            .await
            .expect("read Google terms");
    assert_eq!(terms_version.as_deref(), Some("2026-10-11"));

    let owned = format!("linked-{}@example.test", Uuid::new_v4().simple());
    let (owner_signup, _) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/signup",
            &host,
            ip,
            json!({ "email": owned, "password": "owner-passphrase" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(owner_signup, StatusCode::ACCEPTED);
    deliver_pending_mail(&state).await;
    let verification_code = test_mail_code(&pool, &owned, "verify_email").await;
    let (verify_status, _) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": owned, "code": verification_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    let (linked_status, linked_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/google",
            &host,
            ip,
            json!({ "id_token": google_token(&owned, &format!("sub-{}", Uuid::new_v4().simple())) }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(linked_status, StatusCode::OK);
    assert_eq!(
        linked_body["account"]["has_password"], true,
        "a password proven by its own email verification stays"
    );
    let owner_terms: Option<String> =
        sqlx::query_scalar("SELECT terms_version FROM accounts WHERE email = $1")
            .bind(&owned)
            .fetch_one(&pool)
            .await
            .expect("read owner terms");
    assert_eq!(owner_terms, None, "no terms version is recorded when none was sent");
    server.abort();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz REDIS_URL=redis://127.0.0.1:6379 cargo test -p buzz-relay --lib google_sign_in_records_terms -- --ignored`
Expected: FAIL: the Google request with `termsVersion` returns `400` because `GoogleRequest` denies unknown fields.

- [ ] **Step 3: Write the implementation**

In `crates/buzz-db/src/store/accounts.rs`, replace `account_google_signin` (lines 631-735, from its doc comment through its closing brace) with:

```rust
    /// Sign in through a verified Google subject, creating or linking atomically.
    ///
    /// Linking proves the person controls the email, so a password set on a
    /// never-verified account is dropped: whoever set it never proved the
    /// address. A terms version, when given, is recorded with its time.
    #[datastore_span(name = "account_google_signin", system = "postgresql")]
    pub async fn account_google_signin(
        &self,
        sub: &str,
        verified_email: &str,
        new_account: &NewAccount,
        terms_version: Option<&str>,
    ) -> Result<AccountRecord> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("account-google-sub:{sub}"))
            .execute(&mut *tx)
            .await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("account-google-email:{verified_email}"))
            .execute(&mut *tx)
            .await?;

        let linked = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{ACCOUNT_SELECT} JOIN account_google_identities gi ON gi.account_id = a.id \
             WHERE gi.sub = $1 FOR UPDATE OF a"
        )))
        .bind(sub)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(row) = linked {
            let account_id: Uuid = row.try_get("id")?;
            sqlx::query("UPDATE account_google_identities SET email = $2 WHERE sub = $1")
                .bind(sub)
                .bind(verified_email)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "UPDATE accounts SET last_signin_at = now(), updated_at = now() WHERE id = $1",
            )
            .bind(account_id)
            .execute(&mut *tx)
            .await?;
            record_terms_acceptance(&mut tx, account_id, terms_version).await?;
            let account = load_account_by_id_tx(&mut tx, account_id).await?;
            tx.commit().await?;
            return Ok(account);
        }

        let existing = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{ACCOUNT_SELECT} WHERE lower(a.email) = lower($1) FOR UPDATE OF a"
        )))
        .bind(verified_email)
        .fetch_optional(&mut *tx)
        .await?;
        let account_id = if let Some(row) = existing {
            let account_id: Uuid = row.try_get("id")?;
            sqlx::query(VERIFY_EMAIL_DROPPING_UNPROVEN_PASSWORD)
                .bind(account_id)
                .execute(&mut *tx)
                .await?;
            account_id
        } else if let Some(account_id) = insert_account(&mut tx, new_account).await? {
            sqlx::query("UPDATE accounts SET last_signin_at = now() WHERE id = $1")
                .bind(account_id)
                .execute(&mut *tx)
                .await?;
            account_id
        } else {
            let row = sqlx::query(sqlx::AssertSqlSafe(format!(
                "{ACCOUNT_SELECT} WHERE lower(a.email) = lower($1) FOR UPDATE OF a"
            )))
            .bind(verified_email)
            .fetch_one(&mut *tx)
            .await?;
            let account_id: Uuid = row.try_get("id")?;
            sqlx::query(VERIFY_EMAIL_DROPPING_UNPROVEN_PASSWORD)
                .bind(account_id)
                .execute(&mut *tx)
                .await?;
            account_id
        };
        sqlx::query(
            "INSERT INTO account_google_identities (sub, account_id, email) VALUES ($1, $2, $3) \
             ON CONFLICT (sub) DO NOTHING",
        )
        .bind(sub)
        .bind(account_id)
        .bind(verified_email)
        .execute(&mut *tx)
        .await?;
        let linked_id: Uuid =
            sqlx::query_scalar("SELECT account_id FROM account_google_identities WHERE sub = $1")
                .bind(sub)
                .fetch_one(&mut *tx)
                .await?;
        record_terms_acceptance(&mut tx, linked_id, terms_version).await?;
        let account = load_account_by_id_tx(&mut tx, linked_id).await?;
        tx.commit().await?;
        Ok(account)
    }
```

In `crates/buzz-relay/src/api/accounts.rs`, replace `GoogleRequest` (lines 148-152) with:

```rust
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GoogleRequest {
    id_token: SecretString,
    #[serde(default, rename = "termsVersion")]
    terms_version: Option<String>,
}
```

In `google_signin`, replace (lines 734-735 and 756-760):

```rust
    let request: GoogleRequest = decode_body(&body)?;
```

with:

```rust
    let request: GoogleRequest = decode_body(&body)?;
    let terms_version = request
        .terms_version
        .as_deref()
        .map(normalize_terms_version)
        .transpose()?;
```

and replace:

```rust
        .account_google_signin(&identity.sub, &identity.email, &account)
```

with:

```rust
        .account_google_signin(
            &identity.sub,
            &identity.email,
            &account,
            terms_version.as_deref(),
        )
```

In `docs/auth-accounts.md`, replace the Google row (line 76) with:

```markdown
| `POST /api/accounts/google` | `{id_token, termsVersion?}` | `200` session payload; creates the account on first use (email taken from the verified Google token, marked verified); links to an existing account with the same verified email, dropping a password that was set before that email was ever verified; records `termsVersion` and its time when sent |
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz REDIS_URL=redis://127.0.0.1:6379 cargo test -p buzz-relay --lib api::accounts -- --ignored`
Expected: PASS, including `google_sign_in_records_terms_and_drops_a_password_nobody_proved` and the existing `google_test_jwks_creates_accounts_and_links_verified_email`.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-db/src/store/accounts.rs crates/buzz-relay/src/api/accounts.rs \
  crates/buzz-relay/src/api/accounts/postgres_tests.rs docs/auth-accounts.md
git commit -s -m "fix(accounts): Google sign-in records terms and drops unproven passwords"
```

---

### Task 1.4: Company creation for verified accounts

**Files:**
- Modify: `crates/buzz-relay/src/config.rs:780-791` (fields), `:899-914` (new helper after `parse_positive_u32`), `:1307-1319` (parsing), `:1867-1870` (construction), tests module near `:1925`
- Modify: `crates/buzz-relay/src/api/self_provisioning.rs:251-356` (membership helpers and limiter), `:369-386` (config body), `:444-457` (create gate), unit tests `:651-678`
- Modify: `.env.example:119-126`
- Test: `crates/buzz-relay/src/api/self_provisioning/postgres_tests.rs` (helpers and three tests at the end)

**Interfaces:**
- Consumes: nothing from earlier tasks (reads `accounts.email_verified_at` through the existing `Db::account_by_pubkey`).
- Produces: `Config::{self_provision_accounts: bool, self_provision_account_ip_limit: u32, self_provision_account_global_limit: u32}` from `BUZZ_SELF_PROVISION_ACCOUNTS`, `BUZZ_SELF_PROVISION_ACCOUNT_IP_LIMIT` (default 10 per hour) and `BUZZ_SELF_PROVISION_ACCOUNT_GLOBAL_LIMIT` (default 500 per hour); `GET /api/communities/config` gains `"accounts": bool`. In account mode, `POST /api/communities` admits a non-member signer whose account email is verified, under the account-mode limits; members are admitted as before.

- [ ] **Step 1: Write the failing tests**

At the end of `crates/buzz-relay/src/api/self_provisioning/postgres_tests.rs`, add:

```rust
fn with_account_mode(state: Arc<AppState>, ip_limit: u32, global_limit: u32) -> Arc<AppState> {
    let mut config = (*state.config).clone();
    config.self_provision_public = false;
    config.self_provision_accounts = true;
    config.self_provision_account_ip_limit = ip_limit;
    config.self_provision_account_global_limit = global_limit;
    let mut next = (*state).clone();
    next.config = Arc::new(config);
    Arc::new(next)
}

async fn insert_test_account(pool: &PgPool, keys: &Keys, verified: bool) {
    sqlx::query(
        "INSERT INTO accounts (email, email_verified_at, pubkey, wrapped_dek, kek_id, \
         sealed_nsec, nonce) VALUES ($1, CASE WHEN $2 THEN now() ELSE NULL END, $3, $4, \
         'test-kek', $5, $6)",
    )
    .bind(format!("company-{}@example.test", Uuid::new_v4().simple()))
    .bind(verified)
    .bind(keys.public_key().to_hex())
    .bind(vec![1_u8; 28])
    .bind(vec![2_u8; 16])
    .bind(vec![3_u8; 12])
    .execute(pool)
    .await
    .expect("insert self-serve test account");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn account_mode_lets_a_verified_account_create_its_first_company() {
    let (state, pool, ingress_host, domain) = test_state(false, 3, 50).await;
    let state = with_account_mode(state, 10, 500);
    let newcomer = Keys::generate();
    insert_test_account(&pool, &newcomer, true).await;
    let slug = format!("first-{}", Uuid::new_v4().simple());

    let response =
        create_request(state.clone(), &newcomer, &ingress_host, &slug, Some("198.51.100.30")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let host = format!("{slug}.{domain}");
    assert_eq!(body["community"]["normalized_host"], host);
    let record = state
        .db
        .lookup_community_by_host(&host)
        .await
        .expect("lookup created company")
        .expect("created company exists");
    let membership = state
        .db
        .get_relay_member(record.id, &newcomer.public_key().to_hex())
        .await
        .expect("lookup owner membership")
        .expect("owner membership exists");
    assert_eq!(membership.role, "owner");

    let config = response_json(
        build_router(state)
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/communities/config")
                    .header(header::HOST, &ingress_host)
                    .body(Body::empty())
                    .expect("config request"),
            )
            .await
            .expect("config response"),
    )
    .await;
    assert_eq!(config["accounts"], true);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn account_mode_refuses_unknown_and_unverified_signers() {
    let (state, pool, ingress_host, _domain) = test_state(false, 3, 50).await;
    let state = with_account_mode(state, 10, 500);
    let stranger = Keys::generate();
    let unverified = Keys::generate();
    insert_test_account(&pool, &unverified, false).await;

    for keys in [&stranger, &unverified] {
        let response = create_request(
            state.clone(),
            keys,
            &ingress_host,
            &format!("refused-{}", Uuid::new_v4().simple()),
            Some("198.51.100.31"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response_json(response).await["error"]
            .as_str()
            .is_some_and(|error| error.contains("verified Colony account")));
    }
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn account_mode_limits_new_accounts_per_network_but_not_existing_members() {
    let (state, pool, ingress_host, _domain) = test_state(false, 3, 50).await;
    let state = with_account_mode(state, 1, 500);
    let first = Keys::generate();
    let second = Keys::generate();
    let member = Keys::generate();
    insert_test_account(&pool, &first, true).await;
    insert_test_account(&pool, &second, true).await;
    add_member(&state, &ingress_host, &member).await;
    let network = "198.51.100.32";

    let allowed = create_request(
        state.clone(),
        &first,
        &ingress_host,
        &format!("net-{}", Uuid::new_v4().simple()),
        Some(network),
    )
    .await;
    assert_eq!(allowed.status(), StatusCode::OK);
    let limited = create_request(
        state.clone(),
        &second,
        &ingress_host,
        &format!("net-{}", Uuid::new_v4().simple()),
        Some(network),
    )
    .await;
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    let member_create = create_request(
        state,
        &member,
        &ingress_host,
        &format!("net-{}", Uuid::new_v4().simple()),
        Some(network),
    )
    .await;
    assert_eq!(
        member_create.status(),
        StatusCode::OK,
        "existing members are not limited by the new-account network limit"
    );
}
```

In `crates/buzz-relay/src/api/self_provisioning.rs`, in the unit `tests` module, add:

```rust
    #[test]
    fn config_reports_account_mode() {
        let body = provisioning_config_body(Some("example.test"), false, true, 5);
        assert_eq!(body["accounts"], serde_json::json!(true));
        assert_eq!(body["public"], serde_json::json!(false));
    }
```

In `crates/buzz-relay/src/config.rs`, in the existing `#[cfg(test)] mod tests`, next to `self_provision_domain_normalizes_and_rejects_non_domain_values`, add:

```rust
    #[test]
    fn self_provision_modes_require_a_domain() {
        assert_eq!(
            self_provision_mode_error(false, true, false),
            Some("BUZZ_SELF_PROVISION_PUBLIC requires BUZZ_SELF_PROVISION_DOMAIN")
        );
        assert_eq!(
            self_provision_mode_error(false, false, true),
            Some("BUZZ_SELF_PROVISION_ACCOUNTS requires BUZZ_SELF_PROVISION_DOMAIN")
        );
        assert_eq!(self_provision_mode_error(true, true, true), None);
        assert_eq!(self_provision_mode_error(false, false, false), None);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-relay --lib self_provision`
Expected: FAIL to compile with `cannot find function self_provision_mode_error`, `this function takes 3 arguments but 4 arguments were supplied` for `provisioning_config_body`, and `no field self_provision_accounts on type Config`.

- [ ] **Step 3: Write the configuration**

In `crates/buzz-relay/src/config.rs`, after `pub self_provision_public_global_limit: u32,` (line 791), add:

```rust

    /// Allow signers holding a verified Colony account to create their first
    /// community without an existing membership. Requires
    /// `self_provision_domain`; the account-mode limits below apply to them.
    pub self_provision_accounts: bool,

    /// Account-mode community creation attempts allowed per source IP per hour.
    pub self_provision_account_ip_limit: u32,

    /// Account-mode community creation attempts allowed across the relay deployment per hour.
    pub self_provision_account_global_limit: u32,
```

After `parse_positive_u32` (it ends at line 912), add:

```rust
/// Explain why a self-serve provisioning mode combination is invalid.
fn self_provision_mode_error(
    domain_configured: bool,
    public: bool,
    accounts: bool,
) -> Option<&'static str> {
    if public && !domain_configured {
        Some("BUZZ_SELF_PROVISION_PUBLIC requires BUZZ_SELF_PROVISION_DOMAIN")
    } else if accounts && !domain_configured {
        Some("BUZZ_SELF_PROVISION_ACCOUNTS requires BUZZ_SELF_PROVISION_DOMAIN")
    } else {
        None
    }
}
```

Replace the parsing block (lines 1307-1319):

```rust
        let self_provision_public = std::env::var("BUZZ_SELF_PROVISION_PUBLIC")
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false);
        if self_provision_public && self_provision_domain.is_none() {
            return Err(ConfigError::InvalidValue(
                "BUZZ_SELF_PROVISION_PUBLIC requires BUZZ_SELF_PROVISION_DOMAIN".to_string(),
            ));
        }
        let self_provision_public_ip_limit =
            parse_positive_u32("BUZZ_SELF_PROVISION_PUBLIC_IP_LIMIT", 3)?;
        let self_provision_public_global_limit =
            parse_positive_u32("BUZZ_SELF_PROVISION_PUBLIC_GLOBAL_LIMIT", 50)?;
```

with:

```rust
        let self_provision_public = std::env::var("BUZZ_SELF_PROVISION_PUBLIC")
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false);
        let self_provision_accounts = std::env::var("BUZZ_SELF_PROVISION_ACCOUNTS")
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false);
        if let Some(message) = self_provision_mode_error(
            self_provision_domain.is_some(),
            self_provision_public,
            self_provision_accounts,
        ) {
            return Err(ConfigError::InvalidValue(message.to_string()));
        }
        let self_provision_public_ip_limit =
            parse_positive_u32("BUZZ_SELF_PROVISION_PUBLIC_IP_LIMIT", 3)?;
        let self_provision_public_global_limit =
            parse_positive_u32("BUZZ_SELF_PROVISION_PUBLIC_GLOBAL_LIMIT", 50)?;
        let self_provision_account_ip_limit =
            parse_positive_u32("BUZZ_SELF_PROVISION_ACCOUNT_IP_LIMIT", 10)?;
        let self_provision_account_global_limit =
            parse_positive_u32("BUZZ_SELF_PROVISION_ACCOUNT_GLOBAL_LIMIT", 500)?;
```

In the `Config` construction (after `self_provision_public_global_limit,` at line 1870), add:

```rust
            self_provision_accounts,
            self_provision_account_ip_limit,
            self_provision_account_global_limit,
```

In `.env.example`, replace lines 119-126 (from `# Member self-serve community creation is disabled` through `# BUZZ_MAX_COMMUNITIES_PER_OWNER=3`) with:

```bash
# Member self-serve community creation is disabled until a domain is configured.
# Public mode lets a new account create its first community without existing
# relay membership. Its source-IP and shared deployment limits apply per hour.
# Account mode admits a non-member only when its Colony account email is
# verified, with its own hourly source-IP and deployment limits.
# BUZZ_SELF_PROVISION_DOMAIN=communities.example.com
# BUZZ_SELF_PROVISION_PUBLIC=false
# BUZZ_SELF_PROVISION_PUBLIC_IP_LIMIT=3
# BUZZ_SELF_PROVISION_PUBLIC_GLOBAL_LIMIT=50
# BUZZ_SELF_PROVISION_ACCOUNTS=false
# BUZZ_SELF_PROVISION_ACCOUNT_IP_LIMIT=10
# BUZZ_SELF_PROVISION_ACCOUNT_GLOBAL_LIMIT=500
# BUZZ_MAX_COMMUNITIES_PER_OWNER=3
```

- [ ] **Step 4: Write the account-mode gate**

In `crates/buzz-relay/src/api/self_provisioning.rs`, replace `require_tenant_membership` (lines 251-274) with:

```rust
/// Whether the signer holds a relay membership in the tenant community the
/// request arrived on.
async fn is_tenant_member(
    state: &AppState,
    tenant: &buzz_core::TenantContext,
    pubkey_hex: &str,
) -> Result<bool, (StatusCode, Json<Value>)> {
    state
        .db
        .get_relay_member(tenant.community(), pubkey_hex)
        .await
        .map(|member| member.is_some())
        .map_err(|e| internal_error(&format!("self-provision membership lookup: {e}")))
}

/// The requester must already be a relay member of the tenant community the
/// request arrived on. Any role qualifies: membership is the customer gate,
/// ownership of the new community is what the request grants.
///
/// Skipped entirely in public mode, where the IP and deployment-wide rate
/// limits are the abuse controls instead.
async fn require_tenant_membership(
    state: &AppState,
    tenant: &buzz_core::TenantContext,
    pubkey_hex: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    if !is_tenant_member(state, tenant, pubkey_hex).await? {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "only members of this community can create new communities",
        ));
    }
    Ok(())
}

/// Account mode admits a non-member only when the signer's Colony account has
/// a verified email, which is scarcer than a freshly generated key.
async fn require_verified_account(
    state: &AppState,
    pubkey_hex: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let account = state
        .db
        .account_by_pubkey(pubkey_hex)
        .await
        .map_err(|e| internal_error(&format!("self-provision account lookup: {e}")))?;
    if account.is_some_and(|account| account.email_verified_at.is_some()) {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "sign in with a verified Colony account to create a company",
        ))
    }
}
```

Replace `public_create_rate_limited` (lines 321-356, from its doc comment through its closing brace) with:

```rust
/// Hourly creation limits for one self-serve mode.
struct CreateLimits {
    /// Redis key namespace; distinct per mode and provisioning domain.
    namespace: String,
    /// Attempts allowed per source address per hour.
    ip_limit: u32,
    /// Attempts allowed across the deployment per hour.
    global_limit: u32,
}

fn public_create_limits(state: &AppState, domain: &str) -> CreateLimits {
    CreateLimits {
        namespace: format!("colony:self-provision:{domain}"),
        ip_limit: state.config.self_provision_public_ip_limit,
        global_limit: state.config.self_provision_public_global_limit,
    }
}

fn account_create_limits(state: &AppState, domain: &str) -> CreateLimits {
    CreateLimits {
        namespace: format!("colony:self-provision-accounts:{domain}"),
        ip_limit: state.config.self_provision_account_ip_limit,
        global_limit: state.config.self_provision_account_global_limit,
    }
}

/// Shared abuse controls. The deployment counter advances on every attempt.
/// Once it is exhausted, requests do not create new per-IP keys, so
/// source-address sprays cannot grow Redis state without bound. Redis makes
/// the limits apply across relay processes; failure to reach Redis fails
/// closed.
async fn create_rate_limited(
    state: &AppState,
    limits: &CreateLimits,
    client_ip: Option<IpAddr>,
) -> Result<Option<&'static str>, ()> {
    use sha2::{Digest as _, Sha256};

    let global_count =
        increment_public_create_counter(state, &format!("{}:global", limits.namespace)).await?;
    if global_count > u64::from(limits.global_limit) {
        return Ok(Some(
            "this relay has reached its hourly limit for new communities; try again later",
        ));
    }

    // Unknown source addresses share one bucket rather than bypassing the
    // per-IP limit. Hash the value to avoid storing raw client addresses in
    // Redis keys.
    let ip = client_ip.unwrap_or(IpAddr::from([0, 0, 0, 0]));
    let ip_digest = hex::encode(Sha256::digest(ip.to_string().as_bytes()));
    let ip_count =
        increment_public_create_counter(state, &format!("{}:ip:{ip_digest}", limits.namespace))
            .await?;
    if ip_count > u64::from(limits.ip_limit) {
        return Ok(Some(
            "too many communities created from this network; try again later",
        ));
    }
    Ok(None)
}

/// Apply one mode's limits, mapping the outcome to the HTTP error.
async fn enforce_create_limits(
    state: &AppState,
    limits: &CreateLimits,
    client_ip: Option<IpAddr>,
) -> Result<(), (StatusCode, Json<Value>)> {
    match create_rate_limited(state, limits, client_ip).await {
        Ok(Some(message)) => Err(api_error(StatusCode::TOO_MANY_REQUESTS, message)),
        Ok(None) => Ok(()),
        Err(()) => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "community creation is temporarily unavailable",
        )),
    }
}
```

Replace `provisioning_config` and `provisioning_config_body` (lines 369-386) with:

```rust
pub async fn provisioning_config(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(provisioning_config_body(
        state.config.self_provision_domain.as_deref(),
        state.config.self_provision_public,
        state.config.self_provision_accounts,
        buzz_db::relay_members::max_communities_per_owner(),
    ))
}

/// Body of [`provisioning_config`], split out so the shape is unit-testable
/// without standing up an [`AppState`].
fn provisioning_config_body(
    domain: Option<&str>,
    public: bool,
    accounts: bool,
    max_per_owner: i64,
) -> Value {
    serde_json::json!({
        "self_serve": domain.is_some(),
        "domain": domain,
        "public": public,
        "accounts": accounts,
        "max_per_owner": max_per_owner,
    })
}
```

Keep the existing doc comment above `provisioning_config` (lines 358-368). In the create handler, replace the gate (lines 444-457):

```rust
    if state.config.self_provision_public {
        match public_create_rate_limited(&state, &domain, client_ip(&headers, &extensions)).await {
            Ok(Some(message)) => return Err(api_error(StatusCode::TOO_MANY_REQUESTS, message)),
            Ok(None) => {}
            Err(()) => {
                return Err(api_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "community creation is temporarily unavailable",
                ));
            }
        }
    } else {
        require_tenant_membership(&state, &tenant, &pubkey_hex).await?;
    }
```

with:

```rust
    let client_ip = client_ip(&headers, &extensions);
    if state.config.self_provision_public {
        enforce_create_limits(&state, &public_create_limits(&state, &domain), client_ip).await?;
    } else if state.config.self_provision_accounts {
        if !is_tenant_member(&state, &tenant, &pubkey_hex).await? {
            require_verified_account(&state, &pubkey_hex).await?;
            enforce_create_limits(&state, &account_create_limits(&state, &domain), client_ip)
                .await?;
        }
    } else {
        require_tenant_membership(&state, &tenant, &pubkey_hex).await?;
    }
```

Update the three existing unit-test calls (lines 653, 668 and 675) to pass `false` as the new third argument:

```rust
        let body = provisioning_config_body(Some("colony.ainative.ventures"), false, false, 3);
```

```rust
        let body = provisioning_config_body(None, false, false, 3);
```

```rust
        let body = provisioning_config_body(Some("example.test"), true, false, 25);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p buzz-relay --lib self_provision`
Expected: PASS for the unit tests, including `config_reports_account_mode` and `self_provision_modes_require_a_domain`.

Run: `BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz REDIS_URL=redis://127.0.0.1:6379 cargo test -p buzz-relay --lib self_provisioning::postgres_tests -- --ignored`
Expected: PASS, including the three `account_mode_` tests and the existing public-mode tests.

- [ ] **Step 6: Commit**

```bash
git add crates/buzz-relay/src/config.rs crates/buzz-relay/src/api/self_provisioning.rs \
  crates/buzz-relay/src/api/self_provisioning/postgres_tests.rs .env.example
git commit -s -m "feat(relay): self-serve company creation for verified accounts"
```

---

### Task 1.5: Register the business profile and team computer kinds

**Files:**
- Modify: `crates/buzz-core/src/kind.rs:796` (constants), `:799-825` (`COMPANY_RECORD_KINDS`), `:828-845` (`is_company_command_kind`), `:848-874` (`is_company_global_kind`), `:1160-1183` (`ALL_KINDS`), `:1232-1271` (`is_command_kind`), `:1275-1312` (`is_relay_only_kind`), tests near `:1435`
- Modify: `crates/buzz-relay/src/handlers/ingest.rs:632-700` (`is_global_only_kind`), tests near `:3895`
- Modify: `docs/company-records.md:33-63` (kind registry table)

**Interfaces:**
- Consumes: nothing.
- Produces: `buzz_core::kind::{KIND_BUSINESS_PROFILE_HEAD = 30657, KIND_BUSINESS_PROFILE_ACTION = 47046, KIND_TEAM_COMPUTER_HEAD = 30658, KIND_TEAM_COMPUTER_ACTION = 47047}`. Heads are relay-only and company-wide; actions are company command kinds, company-wide and transactional. Until Task 1.8 and Task 1.9 route them, actions are rejected by the generic company broker.

- [ ] **Step 1: Write the failing tests**

In `crates/buzz-core/src/kind.rs`, in the tests module next to `duty_and_lesson_kinds_have_expected_write_authority`, add:

```rust
    #[test]
    fn business_profile_and_team_computer_kinds_have_expected_write_authority() {
        for (head, action) in [
            (KIND_BUSINESS_PROFILE_HEAD, KIND_BUSINESS_PROFILE_ACTION),
            (KIND_TEAM_COMPUTER_HEAD, KIND_TEAM_COMPUTER_ACTION),
        ] {
            assert!(ALL_KINDS.contains(&head));
            assert!(ALL_KINDS.contains(&action));
            assert!(COMPANY_RECORD_KINDS.contains(&head));
            assert!(COMPANY_RECORD_KINDS.contains(&action));
            assert!(is_company_global_kind(head));
            assert!(is_company_global_kind(action));
            assert!(is_parameterized_replaceable(head));
            assert!(is_relay_only_kind(head));
            assert!(is_company_command_kind(action));
            assert!(is_command_kind(action));
            assert!(!is_relay_only_kind(action));
        }
        assert_eq!(
            (KIND_BUSINESS_PROFILE_HEAD, KIND_BUSINESS_PROFILE_ACTION),
            (30657, 47046)
        );
        assert_eq!((KIND_TEAM_COMPUTER_HEAD, KIND_TEAM_COMPUTER_ACTION), (30658, 47047));
    }
```

In `crates/buzz-relay/src/handlers/ingest.rs`, in the tests module next to `duty_and_lesson_record_kinds_are_global_only_message_writes`, add:

```rust
    #[test]
    fn business_profile_and_team_computer_kinds_are_global_only_message_writes() {
        let event = make_dummy_event();
        for kind in [
            buzz_core::kind::KIND_BUSINESS_PROFILE_HEAD,
            buzz_core::kind::KIND_BUSINESS_PROFILE_ACTION,
            buzz_core::kind::KIND_TEAM_COMPUTER_HEAD,
            buzz_core::kind::KIND_TEAM_COMPUTER_ACTION,
        ] {
            assert_eq!(
                required_scope_for_kind(kind, &event),
                Ok(Scope::MessagesWrite),
                "kind {kind} should require MessagesWrite scope"
            );
            assert!(is_global_only_kind(kind), "kind {kind} must be global-only");
            assert!(
                !requires_h_channel_scope(kind),
                "kind {kind} must not require an h tag"
            );
        }
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-core --lib business_profile_and_team_computer_kinds`
Expected: FAIL to compile with `cannot find value KIND_BUSINESS_PROFILE_HEAD in this scope`.

- [ ] **Step 3: Write the implementation**

In `crates/buzz-core/src/kind.rs`, after `pub const KIND_LESSON_ACTION: u32 = 47045;` (line 796), add:

```rust
/// Relay-authored canonical business profile head (community-wide, `d` = `business-profile`).
pub const KIND_BUSINESS_PROFILE_HEAD: u32 = 30657;
/// Relay-authored canonical team computer head (community-wide, `d` = `team-computer`).
pub const KIND_TEAM_COMPUTER_HEAD: u32 = 30658;
/// Owner or admin business profile replacement, brokered and community-wide.
pub const KIND_BUSINESS_PROFILE_ACTION: u32 = 47046;
/// Owner or admin team computer claim, heartbeat or release, brokered and community-wide.
pub const KIND_TEAM_COMPUTER_ACTION: u32 = 47047;
```

At the end of `COMPANY_RECORD_KINDS` (after `KIND_AI_SPEND_RECORD_ACTION,` at line 824), add:

```rust
    KIND_BUSINESS_PROFILE_HEAD,
    KIND_BUSINESS_PROFILE_ACTION,
    KIND_TEAM_COMPUTER_HEAD,
    KIND_TEAM_COMPUTER_ACTION,
```

In `is_company_command_kind`, after `| KIND_AI_SPEND_RECORD_ACTION` (line 843), add:

```rust
            | KIND_BUSINESS_PROFILE_ACTION
            | KIND_TEAM_COMPUTER_ACTION
```

In `is_company_global_kind`, after `| KIND_AI_SPEND_RECORD_ACTION` (line 872), add:

```rust
            | KIND_BUSINESS_PROFILE_HEAD
            | KIND_BUSINESS_PROFILE_ACTION
            | KIND_TEAM_COMPUTER_HEAD
            | KIND_TEAM_COMPUTER_ACTION
```

At the end of `ALL_KINDS` (after `KIND_LESSON_ACTION,` at line 1182), add:

```rust
    KIND_BUSINESS_PROFILE_HEAD,
    KIND_BUSINESS_PROFILE_ACTION,
    KIND_TEAM_COMPUTER_HEAD,
    KIND_TEAM_COMPUTER_ACTION,
```

In `is_command_kind`, after `| KIND_AI_SPEND_RECORD_ACTION` (line 1270), add:

```rust
            | KIND_BUSINESS_PROFILE_ACTION
            | KIND_TEAM_COMPUTER_ACTION
```

In `is_relay_only_kind`, after `| KIND_AI_SPEND_RECORD_HEAD` (line 1311), add:

```rust
            | KIND_BUSINESS_PROFILE_HEAD
            | KIND_TEAM_COMPUTER_HEAD
```

In `crates/buzz-relay/src/handlers/ingest.rs`, in `is_global_only_kind`, after `| KIND_LESSON_ACTION` (in the "Duties and lessons" group), add:

```rust
            // The business profile and team computer are company-wide singletons.
            | buzz_core::kind::KIND_BUSINESS_PROFILE_HEAD
            | buzz_core::kind::KIND_BUSINESS_PROFILE_ACTION
            | buzz_core::kind::KIND_TEAM_COMPUTER_HEAD
            | buzz_core::kind::KIND_TEAM_COMPUTER_ACTION
```

In `docs/company-records.md`, in the kind registry table, after the `30656` row add:

```markdown
| 30657 | Business profile head | Relay signed, replaceable | Company profile |
| 30658 | Team computer head | Relay signed, replaceable | Team runtime |
```

and after the `47045` row add:

```markdown
| 47046 | Business profile action | Brokered | Company profile |
| 47047 | Team computer action | Brokered | Team runtime |
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-core --lib kind`
Expected: PASS, including `no_duplicate_kind_values` and the new test.

Run: `cargo test -p buzz-relay --lib business_profile_and_team_computer_kinds_are_global_only_message_writes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/kind.rs crates/buzz-relay/src/handlers/ingest.rs docs/company-records.md
git commit -s -m "feat(core): register business profile and team computer kinds"
```

---

### Task 1.6: Business profile type, validation and SDK builder

**Files:**
- Modify: `crates/buzz-core/Cargo.toml` (dependencies), `crates/buzz-core/src/lib.rs:21-23` (module list)
- Create: `crates/buzz-core/src/company_profile.rs`
- Modify: `crates/buzz-sdk/src/lib.rs:27-30` (module list)
- Create: `crates/buzz-sdk/src/company_profile.rs`
- Test: unit tests inside both new files

**Interfaces:**
- Consumes: `KIND_BUSINESS_PROFILE_ACTION` (Task 1.5), `buzz_core::company_records::CompanyRecordError`.
- Produces (in `buzz_core::company_profile`):

```rust
pub const BUSINESS_PROFILE_D_TAG: &str = "business-profile";
pub const BUSINESS_PROFILE_REVISION_TAG: &str = "revision";
pub const BUSINESS_PROFILE_SCHEMA_VERSION: u8 = 1;
pub const MAX_PROFILE_NAME_CHARS: usize = 120;
pub const MAX_PROFILE_TEXT_CHARS: usize = 500;
pub const MAX_PROFILE_LIST_ITEMS: usize = 10;
pub const MAX_PROFILE_BYTES: usize = 16 * 1024;
pub struct BusinessProfile { /* fields per the overview, camelCase JSON */ }
pub struct BusinessProfileContact { pub email, phone, whatsapp, address: Option<String> }
pub struct BusinessProfileInvoice { pub registered_name, registration_number, vat_number, bank_details: Option<String> }
pub struct BusinessProfileSocialAccounts { pub instagram, facebook, tiktok, linkedin, x: Option<String> }
pub struct BusinessProfileAction { pub profile: BusinessProfile, pub expected_revision: Option<u32> }
pub enum ProfileRevisionConflict { ProfileExists { current: u32 }, ProfileMissing, Stale { current: u32 } }
pub fn validate_business_profile(profile: &BusinessProfile) -> Result<(), CompanyRecordError>;
pub fn next_profile_revision(current: Option<u32>, expected: Option<u32>) -> Result<u32, ProfileRevisionConflict>;
```

and `buzz_sdk::company_profile::build_business_profile_action(action: &BusinessProfileAction) -> Result<nostr::EventBuilder, SdkError>`.

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-core/src/company_profile.rs` with only the tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn contract_json() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "name": "Lerato Designs",
            "whatYouSell": "Women's clothing in natural linen and cotton, made in Johannesburg.",
            "whoBuys": "Women aged 25 to 45 who like local, made-to-last clothing.",
            "whereYouSell": ["instagram", "website", "markets"],
            "city": "Johannesburg",
            "country": "South Africa",
            "timeZone": "Africa/Johannesburg",
            "links": ["https://leratodesigns.co.za", "https://instagram.com/leratodesigns"],
            "voiceWords": ["warm", "confident", "local"],
            "goals": ["More sales", "Bulk orders and stockists"],
            "contact": { "email": "hello@leratodesigns.co.za", "phone": null, "whatsapp": null, "address": null },
            "buyLink": null,
            "invoice": { "registeredName": null, "registrationNumber": null, "vatNumber": null, "bankDetails": null },
            "socialAccounts": { "instagram": "leratodesigns", "facebook": null, "tiktok": null, "linkedin": null, "x": null }
        })
    }

    fn sample() -> BusinessProfile {
        serde_json::from_value(contract_json()).expect("the overview's example profile parses")
    }

    #[test]
    fn contract_example_round_trips_with_the_same_field_names() {
        let profile = sample();
        validate_business_profile(&profile).expect("the contract example is valid");
        assert_eq!(
            serde_json::to_value(&profile).expect("serialize profile"),
            contract_json()
        );
    }

    #[test]
    fn unknown_keys_are_rejected_at_every_level() {
        let mut top = contract_json();
        top["mission"] = serde_json::json!("Dress the city");
        assert!(serde_json::from_value::<BusinessProfile>(top).is_err());
        let mut nested = contract_json();
        nested["contact"]["fax"] = serde_json::json!("011 555 0100");
        assert!(serde_json::from_value::<BusinessProfile>(nested).is_err());
    }

    #[test]
    fn name_schema_and_time_zone_are_checked() {
        let mut nameless = sample();
        nameless.name = "   ".into();
        assert!(validate_business_profile(&nameless).is_err());
        let mut long_name = sample();
        long_name.name = "n".repeat(MAX_PROFILE_NAME_CHARS + 1);
        assert!(validate_business_profile(&long_name).is_err());
        let mut bad_zone = sample();
        bad_zone.time_zone = "Mars/Olympus".into();
        assert!(validate_business_profile(&bad_zone).is_err());
        let mut missing_zone = contract_json();
        missing_zone
            .as_object_mut()
            .expect("profile object")
            .remove("timeZone");
        assert!(serde_json::from_value::<BusinessProfile>(missing_zone).is_err());
        let mut wrong_version = sample();
        wrong_version.schema_version = 2;
        assert_eq!(
            validate_business_profile(&wrong_version),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }

    #[test]
    fn text_lists_and_total_size_are_bounded() {
        let mut long_text = sample();
        long_text.what_you_sell = Some("w".repeat(MAX_PROFILE_TEXT_CHARS + 1));
        assert!(validate_business_profile(&long_text).is_err());
        let mut long_list = sample();
        long_list.goals = vec!["More sales".to_owned(); MAX_PROFILE_LIST_ITEMS + 1];
        assert!(validate_business_profile(&long_list).is_err());
        let mut control = sample();
        control.city = Some("Johannes\u{0007}burg".into());
        assert!(validate_business_profile(&control).is_err());

        let item = "x".repeat(MAX_PROFILE_TEXT_CHARS);
        let mut huge = sample();
        huge.where_you_sell = vec![item.clone(); MAX_PROFILE_LIST_ITEMS];
        huge.links = vec![item.clone(); MAX_PROFILE_LIST_ITEMS];
        huge.voice_words = vec![item.clone(); MAX_PROFILE_LIST_ITEMS];
        huge.goals = vec![item; MAX_PROFILE_LIST_ITEMS];
        assert_eq!(
            validate_business_profile(&huge),
            Err(CompanyRecordError::Invalid("profile must be at most 16 KB"))
        );

        let mut multi_line = sample();
        multi_line.contact.address = Some("12 Jan Smuts Avenue\nRosebank\nJohannesburg".into());
        validate_business_profile(&multi_line).expect("addresses may span lines");
    }

    #[test]
    fn revisions_start_at_one_and_must_match_the_current_head() {
        assert_eq!(next_profile_revision(None, None), Ok(1));
        assert_eq!(next_profile_revision(Some(3), Some(3)), Ok(4));
        assert_eq!(
            next_profile_revision(Some(3), None),
            Err(ProfileRevisionConflict::ProfileExists { current: 3 })
        );
        assert_eq!(
            next_profile_revision(Some(3), Some(2)),
            Err(ProfileRevisionConflict::Stale { current: 3 })
        );
        assert_eq!(
            next_profile_revision(None, Some(1)),
            Err(ProfileRevisionConflict::ProfileMissing)
        );
    }
}
```

In `crates/buzz-core/src/lib.rs`, after `pub mod company_members;` (line 21), add:

```rust
/// Typed company business profile and its revision rule.
pub mod company_profile;
```

Create `crates/buzz-sdk/src/company_profile.rs` with only its tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    fn action() -> BusinessProfileAction {
        let profile = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "name": "Lerato Designs",
            "timeZone": "Africa/Johannesburg"
        }))
        .expect("minimal profile");
        BusinessProfileAction {
            profile,
            expected_revision: None,
        }
    }

    #[test]
    fn profile_action_is_company_wide_with_the_fixed_coordinate() {
        let event = build_business_profile_action(&action())
            .expect("valid action")
            .sign_with_keys(&Keys::generate())
            .expect("sign action");
        assert_eq!(event.kind, Kind::Custom(KIND_BUSINESS_PROFILE_ACTION as u16));
        let d_tags: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .filter_map(|tag| tag.content())
            .collect();
        assert_eq!(d_tags, vec![BUSINESS_PROFILE_D_TAG]);
        assert!(event.tags.iter().all(|tag| tag.kind().to_string() != "h"));
        let parsed: BusinessProfileAction =
            serde_json::from_str(&event.content).expect("content round-trips");
        assert_eq!(parsed, action());
    }

    #[test]
    fn invalid_profiles_are_refused_before_signing() {
        let mut invalid = action();
        invalid.profile.time_zone = "Mars/Olympus".into();
        assert!(build_business_profile_action(&invalid).is_err());
    }
}
```

In `crates/buzz-sdk/src/lib.rs`, after `pub mod company_members;` (line 28), add:

```rust
/// Typed event builder for the company business profile.
pub mod company_profile;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-core --lib company_profile`
Expected: FAIL to compile with `cannot find type BusinessProfile in this scope`.

- [ ] **Step 3: Write the implementation**

In `crates/buzz-core/Cargo.toml`, after `chrono     = { workspace = true }`, add:

```toml
chrono-tz  = { workspace = true }
```

At the top of `crates/buzz-core/src/company_profile.rs`, before the tests module, add:

```rust
//! Typed company business profile (kinds 30657 and 47046).
//!
//! The profile is the company-wide set of facts every employee works from.
//! The relay stores it as one relay-signed head with a `revision` tag. Owners
//! and admins replace it with a member-signed action that names the revision
//! it was based on, so two people saving at once cannot overwrite each other.

use serde::{Deserialize, Serialize};

use crate::company_records::CompanyRecordError;

/// The `d` coordinate of the single business profile head per company.
pub const BUSINESS_PROFILE_D_TAG: &str = "business-profile";
/// Tag on the head that carries its revision number.
pub const BUSINESS_PROFILE_REVISION_TAG: &str = "revision";
/// Profile schema version this build understands.
pub const BUSINESS_PROFILE_SCHEMA_VERSION: u8 = 1;
/// Maximum characters in the business name.
pub const MAX_PROFILE_NAME_CHARS: usize = 120;
/// Maximum characters in any other text field or list item.
pub const MAX_PROFILE_TEXT_CHARS: usize = 500;
/// Maximum items in any list field.
pub const MAX_PROFILE_LIST_ITEMS: usize = 10;
/// Maximum serialized size of a profile in bytes.
pub const MAX_PROFILE_BYTES: usize = 16 * 1024;

/// Contact details shown to customers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileContact {
    /// Customer-facing email address.
    #[serde(default)]
    pub email: Option<String>,
    /// Customer-facing phone number.
    #[serde(default)]
    pub phone: Option<String>,
    /// WhatsApp number customers may use.
    #[serde(default)]
    pub whatsapp: Option<String>,
    /// Street or postal address; may span several lines.
    #[serde(default)]
    pub address: Option<String>,
}

/// Details printed on invoices and quotes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileInvoice {
    /// Registered business name.
    #[serde(default)]
    pub registered_name: Option<String>,
    /// Company registration number.
    #[serde(default)]
    pub registration_number: Option<String>,
    /// VAT number, when the business is registered for VAT.
    #[serde(default)]
    pub vat_number: Option<String>,
    /// Banking details printed on invoices.
    #[serde(default)]
    pub bank_details: Option<String>,
}

/// Social account names used to open the right app at posting time.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileSocialAccounts {
    /// Instagram account name.
    #[serde(default)]
    pub instagram: Option<String>,
    /// Facebook page name.
    #[serde(default)]
    pub facebook: Option<String>,
    /// TikTok account name.
    #[serde(default)]
    pub tiktok: Option<String>,
    /// LinkedIn page name.
    #[serde(default)]
    pub linkedin: Option<String>,
    /// X account name.
    #[serde(default)]
    pub x: Option<String>,
}

/// Company-wide business profile: the content of head kind 30657.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfile {
    /// Profile schema version; must be [`BUSINESS_PROFILE_SCHEMA_VERSION`].
    pub schema_version: u8,
    /// Business name, also shown everywhere as the company name.
    pub name: String,
    /// What the business sells, in one or two sentences.
    #[serde(default)]
    pub what_you_sell: Option<String>,
    /// Who usually buys.
    #[serde(default)]
    pub who_buys: Option<String>,
    /// Where the business sells today.
    #[serde(default)]
    pub where_you_sell: Vec<String>,
    /// City the business is based in.
    #[serde(default)]
    pub city: Option<String>,
    /// Country the business is based in.
    #[serde(default)]
    pub country: Option<String>,
    /// IANA time zone every routine follows.
    pub time_zone: String,
    /// Website and social links employees may read.
    #[serde(default)]
    pub links: Vec<String>,
    /// How the business sounds, in a few words.
    #[serde(default)]
    pub voice_words: Vec<String>,
    /// Goals for the next three months.
    #[serde(default)]
    pub goals: Vec<String>,
    /// Contact details customers see.
    #[serde(default)]
    pub contact: BusinessProfileContact,
    /// Link customers use to pay or order.
    #[serde(default)]
    pub buy_link: Option<String>,
    /// Details printed on invoices and quotes.
    #[serde(default)]
    pub invoice: BusinessProfileInvoice,
    /// Social account names.
    #[serde(default)]
    pub social_accounts: BusinessProfileSocialAccounts,
}

/// Owner- or admin-signed replacement of the profile: the content of kind 47046.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileAction {
    /// The complete new profile.
    pub profile: BusinessProfile,
    /// Revision the change was based on; `None` only for the first profile.
    pub expected_revision: Option<u32>,
}

/// Why a profile write was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileRevisionConflict {
    /// A profile exists, so the write must name its current revision.
    ProfileExists {
        /// The head's current revision.
        current: u32,
    },
    /// The write named a revision, but no profile exists yet.
    ProfileMissing,
    /// The write was based on an older revision.
    Stale {
        /// The head's current revision.
        current: u32,
    },
}

/// Check every profile rule from the contract.
pub fn validate_business_profile(profile: &BusinessProfile) -> Result<(), CompanyRecordError> {
    if profile.schema_version != BUSINESS_PROFILE_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if profile.name.trim().is_empty()
        || profile.name.chars().count() > MAX_PROFILE_NAME_CHARS
        || profile.name.chars().any(char::is_control)
    {
        return Err(CompanyRecordError::Invalid(
            "name must be 1 to 120 characters without control characters",
        ));
    }
    let texts = [
        &profile.what_you_sell,
        &profile.who_buys,
        &profile.city,
        &profile.country,
        &profile.buy_link,
        &profile.contact.email,
        &profile.contact.phone,
        &profile.contact.whatsapp,
        &profile.contact.address,
        &profile.invoice.registered_name,
        &profile.invoice.registration_number,
        &profile.invoice.vat_number,
        &profile.invoice.bank_details,
        &profile.social_accounts.instagram,
        &profile.social_accounts.facebook,
        &profile.social_accounts.tiktok,
        &profile.social_accounts.linkedin,
        &profile.social_accounts.x,
    ];
    for text in texts.into_iter().flatten() {
        check_text(text)?;
    }
    for list in [
        &profile.where_you_sell,
        &profile.links,
        &profile.voice_words,
        &profile.goals,
    ] {
        if list.len() > MAX_PROFILE_LIST_ITEMS {
            return Err(CompanyRecordError::Invalid("lists hold at most 10 items"));
        }
        for item in list {
            check_text(item)?;
        }
    }
    if profile.time_zone.parse::<chrono_tz::Tz>().is_err() {
        return Err(CompanyRecordError::Invalid(
            "timeZone must be an IANA time zone name",
        ));
    }
    let size = serde_json::to_vec(profile)
        .map_err(|_| CompanyRecordError::InvalidContent)?
        .len();
    if size > MAX_PROFILE_BYTES {
        return Err(CompanyRecordError::Invalid("profile must be at most 16 KB"));
    }
    Ok(())
}

/// Revision for a write based on `expected`, given the head's `current` revision.
pub fn next_profile_revision(
    current: Option<u32>,
    expected: Option<u32>,
) -> Result<u32, ProfileRevisionConflict> {
    match (current, expected) {
        (None, None) => Ok(1),
        (None, Some(_)) => Err(ProfileRevisionConflict::ProfileMissing),
        (Some(current), None) => Err(ProfileRevisionConflict::ProfileExists { current }),
        (Some(current), Some(expected)) if expected == current => current
            .checked_add(1)
            .ok_or(ProfileRevisionConflict::Stale { current }),
        (Some(current), Some(_)) => Err(ProfileRevisionConflict::Stale { current }),
    }
}

fn check_text(value: &str) -> Result<(), CompanyRecordError> {
    if value.chars().count() > MAX_PROFILE_TEXT_CHARS {
        return Err(CompanyRecordError::Invalid(
            "text fields hold at most 500 characters",
        ));
    }
    if value
        .chars()
        .any(|character| character.is_control() && character != '\n')
    {
        return Err(CompanyRecordError::Invalid(
            "text fields cannot contain control characters",
        ));
    }
    Ok(())
}
```

At the top of `crates/buzz-sdk/src/company_profile.rs`, before the tests module, add:

```rust
//! Typed event builder for the company business profile.
//!
//! The action is company-wide: it carries the fixed `d` coordinate and no
//! channel `h` tag.

use crate::SdkError;
use buzz_core::company_profile::{
    validate_business_profile, BusinessProfileAction, BUSINESS_PROFILE_D_TAG,
};
use buzz_core::kind::KIND_BUSINESS_PROFILE_ACTION;
use nostr::{EventBuilder, Kind, Tag};

/// Build an owner- or admin-signed business profile replacement.
pub fn build_business_profile_action(
    action: &BusinessProfileAction,
) -> Result<EventBuilder, SdkError> {
    validate_business_profile(&action.profile).map_err(|error| {
        SdkError::InvalidInput(format!("business profile is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "business profile action serialization failed: {error}"
        ))
    })?;
    let d = Tag::parse(["d", BUSINESS_PROFILE_D_TAG])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_BUSINESS_PROFILE_ACTION as u16), content).tag(d))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-core --lib company_profile`
Expected: PASS, 5 tests.

Run: `cargo test -p buzz-sdk --lib company_profile`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/Cargo.toml Cargo.lock crates/buzz-core/src/lib.rs \
  crates/buzz-core/src/company_profile.rs crates/buzz-sdk/src/lib.rs \
  crates/buzz-sdk/src/company_profile.rs
git commit -s -m "feat(core): typed business profile with revision rule and SDK builder"
```

---

### Task 1.7: Team computer type, rules and SDK builder

**Files:**
- Modify: `crates/buzz-core/src/lib.rs:59` (module list)
- Create: `crates/buzz-core/src/team_computer.rs`
- Modify: `crates/buzz-sdk/src/lib.rs:34` (module list)
- Create: `crates/buzz-sdk/src/team_computer.rs`
- Test: unit tests inside both new files

**Interfaces:**
- Consumes: `KIND_TEAM_COMPUTER_ACTION` (Task 1.5), `buzz_core::company_records::{CompanyRecordError, is_hex_id}`.
- Produces (in `buzz_core::team_computer`):

```rust
pub const TEAM_COMPUTER_D_TAG: &str = "team-computer";
pub const TEAM_COMPUTER_HEARTBEAT_MIN_SECS: i64 = 60;
pub const MAX_COMPUTER_NAME_CHARS: usize = 80;
pub enum TeamComputerActionKind { Claim, Heartbeat, Release }
pub struct TeamComputerAction { pub action, pub computer_id: String, pub computer_name: String, pub force: bool }
pub struct TeamComputerHead { pub computer_id, pub computer_name, pub claimed_by: String, pub claimed_at: i64, pub last_seen_at: i64, pub released_at: Option<i64> }
pub enum TeamComputerRefusal { HeldElsewhere { computer_name: String }, NoClaim, NotTheHolder, HeartbeatTooSoon { retry_after_secs: i64 } }
pub fn validate_team_computer_action(action: &TeamComputerAction) -> Result<(), CompanyRecordError>;
pub fn validate_team_computer_head(head: &TeamComputerHead) -> Result<(), CompanyRecordError>;
pub fn apply_team_computer_action(current: Option<&TeamComputerHead>, action: &TeamComputerAction, actor_pubkey: &str, now: i64) -> Result<TeamComputerHead, TeamComputerRefusal>;
```

and `buzz_sdk::team_computer::build_team_computer_action(action: &TeamComputerAction) -> Result<nostr::EventBuilder, SdkError>`.

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-core/src/team_computer.rs` with only the tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: &str = "3f6e0b8a-6c52-4b5f-9a0e-2d1c4b7e9f10";
    const DESKTOP: &str = "8b2d9c4e-1f3a-4e6b-8c7d-5a9e0f1b2c3d";
    const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const PARTNER: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    fn action(kind: TeamComputerActionKind, computer_id: &str, force: bool) -> TeamComputerAction {
        let computer_name = if computer_id == LAPTOP {
            "Lerato's MacBook Air"
        } else {
            "Kagiso's laptop"
        };
        TeamComputerAction {
            action: kind,
            computer_id: computer_id.to_owned(),
            computer_name: computer_name.to_owned(),
            force,
        }
    }

    fn held_by_laptop(last_seen_at: i64) -> TeamComputerHead {
        TeamComputerHead {
            computer_id: LAPTOP.to_owned(),
            computer_name: "Lerato's MacBook Air".to_owned(),
            claimed_by: OWNER.to_owned(),
            claimed_at: 1_000,
            last_seen_at,
            released_at: None,
        }
    }

    #[test]
    fn first_claim_takes_a_free_team() {
        let head = apply_team_computer_action(
            None,
            &action(TeamComputerActionKind::Claim, LAPTOP, false),
            OWNER,
            1_000,
        )
        .expect("a free team can be claimed");
        assert_eq!(head, held_by_laptop(1_000));
    }

    #[test]
    fn a_second_computer_cannot_take_a_held_team_without_force() {
        let current = held_by_laptop(1_100);
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Claim, DESKTOP, false),
                PARTNER,
                1_200,
            ),
            Err(TeamComputerRefusal::HeldElsewhere {
                computer_name: "Lerato's MacBook Air".to_owned()
            })
        );
        let moved = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Claim, DESKTOP, true),
            PARTNER,
            1_200,
        )
        .expect("a forced claim moves the team");
        assert_eq!(moved.computer_id, DESKTOP);
        assert_eq!(moved.claimed_by, PARTNER);
        assert_eq!(
            (moved.claimed_at, moved.last_seen_at, moved.released_at),
            (1_200, 1_200, None)
        );
    }

    #[test]
    fn the_holder_can_claim_again_after_a_restart() {
        let current = held_by_laptop(1_100);
        let refreshed = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Claim, LAPTOP, false),
            OWNER,
            1_150,
        )
        .expect("the holder re-claims");
        assert_eq!(refreshed.claimed_at, 1_000);
        assert_eq!(refreshed.last_seen_at, 1_150);
        assert_eq!(refreshed.claimed_by, OWNER);
    }

    #[test]
    fn heartbeats_come_only_from_the_holder_and_at_most_once_a_minute() {
        let current = held_by_laptop(1_000);
        assert_eq!(
            apply_team_computer_action(
                None,
                &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
                OWNER,
                1_100,
            ),
            Err(TeamComputerRefusal::NoClaim)
        );
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Heartbeat, DESKTOP, false),
                PARTNER,
                1_100,
            ),
            Err(TeamComputerRefusal::NotTheHolder)
        );
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
                OWNER,
                1_030,
            ),
            Err(TeamComputerRefusal::HeartbeatTooSoon {
                retry_after_secs: 30
            })
        );
        let beat = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
            OWNER,
            1_060,
        )
        .expect("a heartbeat a minute later");
        assert_eq!(beat.last_seen_at, 1_060);
        assert_eq!(beat.claimed_by, OWNER);
    }

    #[test]
    fn a_release_frees_the_team_for_any_computer() {
        let current = held_by_laptop(1_000);
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Release, DESKTOP, false),
                PARTNER,
                1_100,
            ),
            Err(TeamComputerRefusal::NotTheHolder)
        );
        let released = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Release, LAPTOP, false),
            OWNER,
            1_100,
        )
        .expect("the holder releases");
        assert_eq!(released.released_at, Some(1_100));
        assert_eq!(
            apply_team_computer_action(
                Some(&released),
                &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
                OWNER,
                1_200,
            ),
            Err(TeamComputerRefusal::NoClaim)
        );
        let taken = apply_team_computer_action(
            Some(&released),
            &action(TeamComputerActionKind::Claim, DESKTOP, false),
            PARTNER,
            1_200,
        )
        .expect("a released team is free again");
        assert_eq!((taken.computer_id.as_str(), taken.released_at), (DESKTOP, None));
    }

    #[test]
    fn actions_and_heads_are_validated() {
        validate_team_computer_action(&action(TeamComputerActionKind::Claim, LAPTOP, false))
            .expect("a valid claim");
        let mut not_a_uuid = action(TeamComputerActionKind::Claim, LAPTOP, false);
        not_a_uuid.computer_id = "laptop-1".into();
        assert!(validate_team_computer_action(&not_a_uuid).is_err());
        let mut upper = action(TeamComputerActionKind::Claim, LAPTOP, false);
        upper.computer_id = LAPTOP.to_uppercase();
        assert!(validate_team_computer_action(&upper).is_err());
        let mut version_one = action(TeamComputerActionKind::Claim, LAPTOP, false);
        version_one.computer_id = "3f6e0b8a-6c52-1b5f-9a0e-2d1c4b7e9f10".into();
        assert!(validate_team_computer_action(&version_one).is_err());
        let mut nameless = action(TeamComputerActionKind::Claim, LAPTOP, false);
        nameless.computer_name = " ".into();
        assert!(validate_team_computer_action(&nameless).is_err());
        assert!(
            validate_team_computer_action(&action(TeamComputerActionKind::Heartbeat, LAPTOP, true))
                .is_err(),
            "force is only allowed on a claim"
        );
        validate_team_computer_head(&held_by_laptop(1_000)).expect("a valid head");
        assert!(
            validate_team_computer_head(&held_by_laptop(900)).is_err(),
            "last seen cannot be before the claim"
        );
    }

    #[test]
    fn json_uses_the_contract_names_and_omits_the_release_while_held() {
        assert_eq!(
            serde_json::to_value(held_by_laptop(1_000)).expect("serialize head"),
            serde_json::json!({
                "computerId": LAPTOP,
                "computerName": "Lerato's MacBook Air",
                "claimedBy": OWNER,
                "claimedAt": 1_000,
                "lastSeenAt": 1_000
            })
        );
        assert_eq!(
            serde_json::to_value(action(TeamComputerActionKind::Claim, LAPTOP, false))
                .expect("serialize action"),
            serde_json::json!({
                "action": "claim",
                "computerId": LAPTOP,
                "computerName": "Lerato's MacBook Air",
                "force": false
            })
        );
    }
}
```

In `crates/buzz-core/src/lib.rs`, before `pub mod tenant;` (line 59), add:

```rust
/// Typed team computer record: which single computer runs a company's employees.
pub mod team_computer;
```

Create `crates/buzz-sdk/src/team_computer.rs` with only its tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::team_computer::TeamComputerActionKind;
    use nostr::Keys;

    fn claim() -> TeamComputerAction {
        TeamComputerAction {
            action: TeamComputerActionKind::Claim,
            computer_id: "3f6e0b8a-6c52-4b5f-9a0e-2d1c4b7e9f10".into(),
            computer_name: "Lerato's MacBook Air".into(),
            force: false,
        }
    }

    #[test]
    fn team_computer_action_is_company_wide_with_the_fixed_coordinate() {
        let event = build_team_computer_action(&claim())
            .expect("valid action")
            .sign_with_keys(&Keys::generate())
            .expect("sign action");
        assert_eq!(event.kind, Kind::Custom(KIND_TEAM_COMPUTER_ACTION as u16));
        let d_tags: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .filter_map(|tag| tag.content())
            .collect();
        assert_eq!(d_tags, vec![TEAM_COMPUTER_D_TAG]);
        assert!(event.tags.iter().all(|tag| tag.kind().to_string() != "h"));
        let parsed: TeamComputerAction =
            serde_json::from_str(&event.content).expect("content round-trips");
        assert_eq!(parsed, claim());
    }

    #[test]
    fn invalid_actions_are_refused_before_signing() {
        let mut invalid = claim();
        invalid.computer_id = "not-a-uuid".into();
        assert!(build_team_computer_action(&invalid).is_err());
    }
}
```

In `crates/buzz-sdk/src/lib.rs`, before `pub mod mentions;` (line 35), add:

```rust
/// Typed event builder for the company team computer record.
pub mod team_computer;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-core --lib team_computer`
Expected: FAIL to compile with `cannot find type TeamComputerAction in this scope`.

- [ ] **Step 3: Write the implementation**

At the top of `crates/buzz-core/src/team_computer.rs`, before the tests module, add:

```rust
//! Typed team computer record (kinds 30658 and 47047).
//!
//! A company's employees run on exactly one computer. The relay keeps one
//! relay-signed head naming that computer. An owner or admin claims it from
//! the computer that will run the team, that computer heartbeats it, and the
//! holder releases it. Moving the team to another computer is a forced claim.

use serde::{Deserialize, Serialize};

use crate::company_records::{is_hex_id, CompanyRecordError};

/// The `d` coordinate of the single team computer head per company.
pub const TEAM_COMPUTER_D_TAG: &str = "team-computer";
/// Minimum seconds between two heartbeats from the holding computer.
pub const TEAM_COMPUTER_HEARTBEAT_MIN_SECS: i64 = 60;
/// Maximum characters in a computer's display name.
pub const MAX_COMPUTER_NAME_CHARS: usize = 80;

/// What a team computer action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamComputerActionKind {
    /// Take the team for this computer.
    Claim,
    /// Report that the holding computer is still running the team.
    Heartbeat,
    /// Give the team up from the holding computer.
    Release,
}

/// Owner- or admin-signed team computer action: the content of kind 47047.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TeamComputerAction {
    /// What the action does.
    pub action: TeamComputerActionKind,
    /// Lowercase hyphenated UUID v4 the host generated once per install.
    pub computer_id: String,
    /// Name people see, for example "Lerato's MacBook Air".
    pub computer_name: String,
    /// On a claim, take the team even though another computer holds it.
    #[serde(default)]
    pub force: bool,
}

/// Which computer runs the team: the content of head kind 30658.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TeamComputerHead {
    /// The holding computer's install id.
    pub computer_id: String,
    /// The holding computer's display name.
    pub computer_name: String,
    /// Person who claimed the team for this computer.
    pub claimed_by: String,
    /// Relay time of the claim, in Unix seconds.
    pub claimed_at: i64,
    /// Relay time of the latest claim or heartbeat, in Unix seconds.
    pub last_seen_at: i64,
    /// Relay time the holder released the team; absent while it is held.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released_at: Option<i64>,
}

/// Why a team computer action was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamComputerRefusal {
    /// Another computer holds the team and the claim was not forced.
    HeldElsewhere {
        /// Name of the computer that holds the team.
        computer_name: String,
    },
    /// No computer holds the team.
    NoClaim,
    /// Only the holding computer may heartbeat or release.
    NotTheHolder,
    /// The previous heartbeat was less than a minute ago.
    HeartbeatTooSoon {
        /// Seconds until the next heartbeat is accepted.
        retry_after_secs: i64,
    },
}

/// Check an action's fields.
pub fn validate_team_computer_action(action: &TeamComputerAction) -> Result<(), CompanyRecordError> {
    let id = uuid::Uuid::parse_str(&action.computer_id)
        .map_err(|_| CompanyRecordError::Invalid("computerId must be a UUID v4"))?;
    if id.get_version_num() != 4 || id.to_string() != action.computer_id {
        return Err(CompanyRecordError::Invalid(
            "computerId must be a lowercase hyphenated UUID v4",
        ));
    }
    if action.computer_name.trim().is_empty()
        || action.computer_name.chars().count() > MAX_COMPUTER_NAME_CHARS
        || action.computer_name.chars().any(char::is_control)
    {
        return Err(CompanyRecordError::Invalid(
            "computerName must be 1 to 80 characters without control characters",
        ));
    }
    if action.force && action.action != TeamComputerActionKind::Claim {
        return Err(CompanyRecordError::Invalid("force is only allowed on claim"));
    }
    Ok(())
}

/// Check a stored head.
pub fn validate_team_computer_head(head: &TeamComputerHead) -> Result<(), CompanyRecordError> {
    validate_team_computer_action(&TeamComputerAction {
        action: TeamComputerActionKind::Claim,
        computer_id: head.computer_id.clone(),
        computer_name: head.computer_name.clone(),
        force: false,
    })?;
    if !is_hex_id(&head.claimed_by) {
        return Err(CompanyRecordError::Invalid(
            "claimedBy must be a 64-character lowercase hex public key",
        ));
    }
    if head.claimed_at <= 0
        || head.last_seen_at < head.claimed_at
        || head.released_at.is_some_and(|released| released < head.claimed_at)
    {
        return Err(CompanyRecordError::Invalid(
            "team computer times are out of order",
        ));
    }
    Ok(())
}

/// Apply a validated action to the current head at relay time `now`.
pub fn apply_team_computer_action(
    current: Option<&TeamComputerHead>,
    action: &TeamComputerAction,
    actor_pubkey: &str,
    now: i64,
) -> Result<TeamComputerHead, TeamComputerRefusal> {
    let held = current.filter(|head| head.released_at.is_none());
    match action.action {
        TeamComputerActionKind::Claim => match held {
            Some(head) if head.computer_id != action.computer_id && !action.force => {
                Err(TeamComputerRefusal::HeldElsewhere {
                    computer_name: head.computer_name.clone(),
                })
            }
            Some(head) if head.computer_id == action.computer_id => Ok(TeamComputerHead {
                computer_id: head.computer_id.clone(),
                computer_name: action.computer_name.clone(),
                claimed_by: head.claimed_by.clone(),
                claimed_at: head.claimed_at,
                last_seen_at: now.max(head.last_seen_at),
                released_at: None,
            }),
            _ => Ok(TeamComputerHead {
                computer_id: action.computer_id.clone(),
                computer_name: action.computer_name.clone(),
                claimed_by: actor_pubkey.to_owned(),
                claimed_at: now,
                last_seen_at: now,
                released_at: None,
            }),
        },
        TeamComputerActionKind::Heartbeat => {
            let head = held.ok_or(TeamComputerRefusal::NoClaim)?;
            if head.computer_id != action.computer_id {
                return Err(TeamComputerRefusal::NotTheHolder);
            }
            let elapsed = now - head.last_seen_at;
            if elapsed < TEAM_COMPUTER_HEARTBEAT_MIN_SECS {
                return Err(TeamComputerRefusal::HeartbeatTooSoon {
                    retry_after_secs: TEAM_COMPUTER_HEARTBEAT_MIN_SECS - elapsed,
                });
            }
            Ok(TeamComputerHead {
                computer_name: action.computer_name.clone(),
                last_seen_at: now,
                ..head.clone()
            })
        }
        TeamComputerActionKind::Release => {
            let head = held.ok_or(TeamComputerRefusal::NoClaim)?;
            if head.computer_id != action.computer_id {
                return Err(TeamComputerRefusal::NotTheHolder);
            }
            let released_at = now.max(head.last_seen_at);
            Ok(TeamComputerHead {
                last_seen_at: released_at,
                released_at: Some(released_at),
                ..head.clone()
            })
        }
    }
}
```

At the top of `crates/buzz-sdk/src/team_computer.rs`, before the tests module, add:

```rust
//! Typed event builder for the company team computer record.
//!
//! The action is company-wide: it carries the fixed `d` coordinate and no
//! channel `h` tag.

use crate::SdkError;
use buzz_core::kind::KIND_TEAM_COMPUTER_ACTION;
use buzz_core::team_computer::{
    validate_team_computer_action, TeamComputerAction, TEAM_COMPUTER_D_TAG,
};
use nostr::{EventBuilder, Kind, Tag};

/// Build an owner- or admin-signed team computer claim, heartbeat or release.
pub fn build_team_computer_action(action: &TeamComputerAction) -> Result<EventBuilder, SdkError> {
    validate_team_computer_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("team computer action is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("team computer action serialization failed: {error}"))
    })?;
    let d = Tag::parse(["d", TEAM_COMPUTER_D_TAG])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_TEAM_COMPUTER_ACTION as u16), content).tag(d))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-core --lib team_computer`
Expected: PASS, 7 tests.

Run: `cargo test -p buzz-sdk --lib team_computer`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-core/src/lib.rs crates/buzz-core/src/team_computer.rs \
  crates/buzz-sdk/src/lib.rs crates/buzz-sdk/src/team_computer.rs
git commit -s -m "feat(core): team computer claim, heartbeat and release rules"
```

---

### Task 1.8: Relay broker for the business profile

**Files:**
- Create: `crates/buzz-relay/src/handlers/company_singleton_records.rs`
- Modify: `crates/buzz-relay/src/handlers/mod.rs:25` (module list)
- Modify: `crates/buzz-relay/src/handlers/command_executor.rs:68-73` (routing)
- Modify: `.github/workflows/_ci-relay.yml:624` (Relay E2E lane)
- Modify: `docs/company-records.md:988` (new section before "Proof boundaries")
- Test: `crates/buzz-test-client/tests/e2e_company_profile.rs` (new file)

**Interfaces:**
- Consumes: `KIND_BUSINESS_PROFILE_ACTION`, `KIND_BUSINESS_PROFILE_HEAD` (Task 1.5); `BusinessProfile`, `BusinessProfileAction`, `validate_business_profile`, `next_profile_revision`, `ProfileRevisionConflict`, `BUSINESS_PROFILE_D_TAG`, `BUSINESS_PROFILE_REVISION_TAG` (Task 1.6); `buzz_sdk::company_profile::build_business_profile_action` (Task 1.6).
- Produces: `pub(super) async fn handle_business_profile(tenant: &TenantContext, state: &Arc<AppState>, event: Event, auth: IngestAuth) -> Result<IngestResult, IngestError>`, and in the same module the shared private helpers `require_member_signed_global_action`, `begin_fenced_transaction`, `require_owner_or_admin`, `event_already_stored`, `lock_current_head`, `insert_action`, `replace_head`, `duplicate_result`, `invalid`, `forbidden`, `conflict`, `internal` that Task 1.9 reuses. An accepted write answers `OK` with message `response:{"revision":n}`.

- [ ] **Step 1: Write the failing test**

Create `crates/buzz-test-client/tests/e2e_company_profile.rs`:

```rust
//! Company business profile and team computer relay integration tests.
//!
//! These tests exercise the company singleton brokers and require a local
//! relay, Postgres, and Redis. They are selected by the hosted relay E2E lane.

use std::time::Duration;

use buzz_core::company_profile::{
    BusinessProfile, BusinessProfileAction, BUSINESS_PROFILE_D_TAG, BUSINESS_PROFILE_REVISION_TAG,
};
use buzz_core::kind::{KIND_BUSINESS_PROFILE_ACTION, KIND_BUSINESS_PROFILE_HEAD};
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use serde_json::Value;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "company profile E2E tests only send events to a local relay"
    );
    url
}

fn relay_http_url() -> String {
    relay_url()
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string()
}

fn relay_authority() -> String {
    let url = url::Url::parse(&relay_http_url()).expect("relay HTTP URL");
    url[url::Position::BeforeHost..url::Position::AfterPort].to_string()
}

fn test_database_url() -> String {
    std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name a disposable E2E database")
}

async fn ensure_test_community(host: &str) -> Uuid {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities (id, host) VALUES ($1, $2) \
         ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(id)
    .bind(host)
    .execute(&pool)
    .await
    .expect("seed E2E community");
    sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
        .bind(host)
        .fetch_one(&pool)
        .await
        .expect("read E2E community")
}

async fn seed_relay_member(keys: &Keys, role: &str) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, $3, NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET role = $3, updated_at = now()",
    )
    .bind(community_id)
    .bind(keys.public_key().to_hex())
    .bind(role)
    .execute(&pool)
    .await
    .expect("seed E2E relay member");
}

async fn mark_managed_agent(agent: &Keys, owner: &Keys) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey) VALUES ($1, $2) \
         ON CONFLICT (community_id, pubkey) DO NOTHING",
    )
    .bind(community_id)
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed managed agent owner user");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET agent_owner_pubkey = EXCLUDED.agent_owner_pubkey",
    )
    .bind(community_id)
    .bind(agent.public_key().to_bytes().as_slice())
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed managed agent identity");
}

async fn post_event(keys: &Keys, event: &Event) -> Value {
    let response = reqwest::Client::new()
        .post(format!("{}/events", relay_http_url()))
        .header("X-Pubkey", keys.public_key().to_hex())
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(event).expect("serialize E2E event"))
        .send()
        .await
        .expect("submit E2E event");
    response.json().await.expect("parse E2E response")
}

fn assert_accepted(response: &Value) {
    assert!(
        response["accepted"].as_bool().unwrap_or(false),
        "event was rejected: {response}"
    );
}

fn assert_rejected(response: &Value, expected: &str) {
    assert!(
        !response["accepted"].as_bool().unwrap_or(false),
        "event should have been rejected: {response}"
    );
    let message = response["message"]
        .as_str()
        .or_else(|| response["error"].as_str())
        .unwrap_or_default();
    assert!(
        message.contains(expected),
        "rejection should explain {expected}: {response}"
    );
}

async fn query_one(keys: &Keys, kind: u32, d_tag: &str) -> Option<Event> {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to read a company singleton");
    let sub_id = format!("e2e-company-singleton-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(kind as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe company singleton");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read company singleton");
    client
        .disconnect()
        .await
        .expect("disconnect singleton query");
    events.into_iter().next()
}

fn sample_profile(name: &str) -> BusinessProfile {
    serde_json::from_value(serde_json::json!({
        "schemaVersion": 1,
        "name": name,
        "whatYouSell": "Women's clothing in natural linen and cotton, made in Johannesburg.",
        "whoBuys": "Women aged 25 to 45 who like local, made-to-last clothing.",
        "whereYouSell": ["instagram", "website", "markets"],
        "city": "Johannesburg",
        "country": "South Africa",
        "timeZone": "Africa/Johannesburg",
        "links": ["https://leratodesigns.co.za"],
        "voiceWords": ["warm", "confident", "local"],
        "goals": ["More sales"],
        "contact": { "email": "hello@leratodesigns.co.za", "phone": null, "whatsapp": null, "address": null },
        "buyLink": null,
        "invoice": { "registeredName": null, "registrationNumber": null, "vatNumber": null, "bankDetails": null },
        "socialAccounts": { "instagram": "leratodesigns", "facebook": null, "tiktok": null, "linkedin": null, "x": null }
    }))
    .expect("sample profile matches the contract")
}

async fn submit_profile(
    keys: &Keys,
    profile: BusinessProfile,
    expected_revision: Option<u32>,
) -> Value {
    let action = BusinessProfileAction {
        profile,
        expected_revision,
    };
    let event = buzz_sdk::company_profile::build_business_profile_action(&action)
        .expect("build profile action")
        .sign_with_keys(keys)
        .expect("sign profile action");
    post_event(keys, &event).await
}

async fn current_profile(keys: &Keys) -> Option<(u32, BusinessProfile)> {
    query_one(keys, KIND_BUSINESS_PROFILE_HEAD, BUSINESS_PROFILE_D_TAG)
        .await
        .map(|event| {
            let revision = event
                .tags
                .iter()
                .find(|tag| tag.kind().to_string() == BUSINESS_PROFILE_REVISION_TAG)
                .and_then(|tag| tag.content())
                .and_then(|value| value.parse::<u32>().ok())
                .expect("profile head carries a revision tag");
            let profile = serde_json::from_str(&event.content).expect("parse profile head");
            (revision, profile)
        })
}

#[tokio::test]
#[ignore]
async fn business_profile_is_written_by_owners_and_admins_and_read_by_members_and_employees() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let member = Keys::generate();
    let employee = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&member, "member").await;
    mark_managed_agent(&employee, &owner).await;

    assert_rejected(
        &submit_profile(&member, sample_profile("Member Designs"), None).await,
        "only a company owner or admin",
    );

    let before = current_profile(&owner).await.map(|(revision, _)| revision);
    let owner_name = format!("Lerato Designs {}", Uuid::new_v4().simple());
    assert_accepted(&submit_profile(&owner, sample_profile(&owner_name), before).await);
    let (first_revision, first) = current_profile(&owner)
        .await
        .expect("profile head after the owner's write");
    assert_eq!(first_revision, before.map_or(1, |revision| revision + 1));
    assert_eq!(first.name, owner_name);

    assert_rejected(
        &submit_profile(&owner, sample_profile(&owner_name), None).await,
        "already exists",
    );

    let admin_name = format!("Lerato Designs Studio {}", Uuid::new_v4().simple());
    assert_accepted(&submit_profile(&admin, sample_profile(&admin_name), Some(first_revision)).await);
    assert_rejected(
        &submit_profile(&owner, sample_profile(&owner_name), Some(first_revision)).await,
        "business profile changed",
    );

    let current_revision = first_revision + 1;
    let mut bad_zone = sample_profile(&owner_name);
    bad_zone.time_zone = "Mars/Olympus".into();
    let invalid = BusinessProfileAction {
        profile: bad_zone,
        expected_revision: Some(current_revision),
    };
    // The SDK refuses invalid profiles, so this one is built by hand.
    let invalid_event = EventBuilder::new(
        Kind::Custom(KIND_BUSINESS_PROFILE_ACTION as u16),
        serde_json::to_string(&invalid).expect("serialize invalid action"),
    )
    .tag(Tag::parse(["d", BUSINESS_PROFILE_D_TAG]).expect("d tag"))
    .sign_with_keys(&owner)
    .expect("sign invalid action");
    assert_rejected(&post_event(&owner, &invalid_event).await, "timeZone");

    for reader in [&member, &employee] {
        let (revision, profile) = current_profile(reader)
            .await
            .expect("members and employees read the profile");
        assert_eq!(revision, current_revision);
        assert_eq!(profile.name, admin_name);
    }
}
```

In `.github/workflows/_ci-relay.yml`, in the "Relay E2E tests" step, after the line ending in `money_ask_approval_atomically_commits_allowance_for_an_authorized_human -- --ignored --nocapture` (line 624), add:

```yaml
          cargo test -p buzz-test-client --test e2e_company_profile -- --ignored --nocapture
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./scripts/start-relay-for-tests.sh` (once), then `RELAY_URL=ws://localhost:3000 BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz cargo test -p buzz-test-client --test e2e_company_profile business_profile_is_written -- --ignored --nocapture`
Expected: FAIL: the owner's write is rejected with a message from the generic company broker (`unsupported company command kind`), because no handler routes kind 47046 yet.

- [ ] **Step 3: Write the broker**

Create `crates/buzz-relay/src/handlers/company_singleton_records.rs`:

```rust
//! Brokers for company-wide singleton records.
//!
//! A company has exactly one business profile (kind 47046 to head 30657) and
//! exactly one team computer record (kind 47047 to head 30658). Owners and
//! admins write both. Each accepted action becomes a relay-signed head with a
//! fixed `d` coordinate, replaced only with a create-only or exact-revision
//! precondition so concurrent writers cannot both win.

use std::sync::Arc;

use nostr::{Event, EventBuilder, Kind, Tag};
use sqlx::{Postgres, Transaction};

use buzz_core::company_profile::{
    next_profile_revision, validate_business_profile, BusinessProfile, BusinessProfileAction,
    ProfileRevisionConflict, BUSINESS_PROFILE_D_TAG, BUSINESS_PROFILE_REVISION_TAG,
};
use buzz_core::kind::{KIND_BUSINESS_PROFILE_ACTION, KIND_BUSINESS_PROFILE_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_datastore_tracing::datastore_span;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles an owner- or admin-signed business profile replacement (kind 47046).
#[datastore_span(name = "company_business_profile_action", system = "postgresql")]
pub(super) async fn handle_business_profile(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_BUSINESS_PROFILE_ACTION {
        return Err(IngestError::Rejected(
            "restricted: unsupported business profile action kind".into(),
        ));
    }
    let action = serde_json::from_str::<BusinessProfileAction>(&event.content)
        .map_err(|_| invalid("business profile action content is invalid"))?;
    validate_business_profile(&action.profile)
        .map_err(|error| invalid(format!("business profile: {error}")))?;
    require_member_signed_global_action(&event, &auth, BUSINESS_PROFILE_D_TAG)?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let mut tx = begin_fenced_transaction(state, community_id).await?;
    require_owner_or_admin(
        &mut tx,
        community_id,
        &actor_pubkey,
        "change the business profile",
    )
    .await?;
    if event_already_stored(&mut tx, community_id, &event).await? {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let (current_head_id, current_stored) = lock_current_head(
        &mut tx,
        state,
        community_id,
        KIND_BUSINESS_PROFILE_HEAD,
        BUSINESS_PROFILE_D_TAG,
    )
    .await?;
    let current_revision = current_stored
        .as_ref()
        .map(stored_profile_revision)
        .transpose()?;
    let revision = next_profile_revision(current_revision, action.expected_revision)
        .map_err(revision_conflict)?;
    let head_event =
        profile_head_event(&action.profile, revision, current_stored.as_ref(), state)?;
    let Some(stored_action) = insert_action(&mut tx, community_id, &event).await? else {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    };
    let stored_head = replace_head(
        &mut tx,
        state,
        community_id,
        &head_event,
        BUSINESS_PROFILE_D_TAG,
        current_head_id.as_deref(),
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_BUSINESS_PROFILE_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_head,
        KIND_BUSINESS_PROFILE_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: format!("response:{}", serde_json::json!({ "revision": revision })),
    })
}

/// The signer must be the authenticated person, writing company-wide with
/// exactly one fixed `d` coordinate and no channel `h` tag.
fn require_member_signed_global_action(
    event: &Event,
    auth: &IngestAuth,
    d_tag: &str,
) -> Result<(), IngestError> {
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write company-wide records",
        ));
    }
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .filter_map(|tag| tag.content())
        .collect::<Vec<_>>();
    let h_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "h")
        .count();
    if d_tags != [d_tag] || h_tags != 0 {
        return Err(invalid(format!(
            "this action needs exactly one d tag \"{d_tag}\" and no h tag"
        )));
    }
    Ok(())
}

async fn begin_fenced_transaction(
    state: &AppState,
    community_id: CommunityId,
) -> Result<Transaction<'static, Postgres>, IngestError> {
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community_id)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    Ok(tx)
}

async fn require_owner_or_admin(
    tx: &mut Transaction<'static, Postgres>,
    community_id: CommunityId,
    actor_pubkey: &str,
    what: &str,
) -> Result<(), IngestError> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR SHARE",
    )
    .bind(community_id.as_uuid())
    .bind(actor_pubkey)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)?;
    if matches!(role.as_deref(), Some("owner" | "admin")) {
        Ok(())
    } else {
        Err(forbidden(format!("only a company owner or admin can {what}")))
    }
}

async fn event_already_stored(
    tx: &mut Transaction<'static, Postgres>,
    community_id: CommunityId,
    event: &Event,
) -> Result<bool, IngestError> {
    let command_id = event.id.to_bytes();
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community_id.as_uuid())
    .bind(command_id.as_slice())
    .fetch_one(&mut **tx)
    .await
    .map_err(internal)
}

/// Lock the singleton coordinate and load its current head, refusing to go
/// on if the head moved between the lock and the read.
async fn lock_current_head(
    tx: &mut Transaction<'static, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    kind: u32,
    d_tag: &str,
) -> Result<(Option<Vec<u8>>, Option<StoredEvent>), IngestError> {
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        kind,
        &state.relay_keypair.public_key().to_bytes(),
        d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_singleton_head(state, community_id, kind, d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(IngestError::Internal(
            "error: company singleton head changed while its transaction lock was held".into(),
        ));
    }
    Ok((current_head_id, current_stored))
}

async fn current_singleton_head(
    state: &AppState,
    community_id: CommunityId,
    kind: u32,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![kind as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.to_owned());
    query.global_only = true;
    query.limit = Some(2);
    let mut rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() > 1 {
        return Err(IngestError::Internal(
            "error: duplicate company singleton head coordinate".into(),
        ));
    }
    Ok(rows.pop())
}

async fn insert_action(
    tx: &mut Transaction<'static, Postgres>,
    community_id: CommunityId,
    event: &Event,
) -> Result<Option<StoredEvent>, IngestError> {
    let (stored, inserted) =
        buzz_db::event::insert_event_in_transaction(tx, community_id, event, None)
            .await
            .map_err(internal)?;
    Ok(inserted.then_some(stored))
}

async fn replace_head(
    tx: &mut Transaction<'static, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    head_event: &Event,
    d_tag: &str,
    current_head_id: Option<&[u8]>,
) -> Result<StoredEvent, IngestError> {
    let precondition = current_head_id.map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            head_event,
            d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err(conflict(
            "this record changed before the action committed; refresh and retry",
        ));
    }
    Ok(replaced.event)
}

fn stored_profile_revision(stored: &StoredEvent) -> Result<u32, IngestError> {
    stored
        .event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == BUSINESS_PROFILE_REVISION_TAG)
        .and_then(|tag| tag.content())
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|revision| *revision > 0)
        .ok_or_else(|| {
            IngestError::Internal("error: stored business profile head has no valid revision".into())
        })
}

fn profile_head_event(
    profile: &BusinessProfile,
    revision: u32,
    previous: Option<&StoredEvent>,
    state: &AppState,
) -> Result<Event, IngestError> {
    let now = nostr::Timestamp::now().as_secs();
    let created_at = previous.map_or(now, |stored| {
        now.max(stored.event.created_at.as_secs().saturating_add(1))
    });
    let content = serde_json::to_string(profile).map_err(internal)?;
    let tags = [
        Tag::parse(["d", BUSINESS_PROFILE_D_TAG]).map_err(internal)?,
        Tag::parse([BUSINESS_PROFILE_REVISION_TAG, revision.to_string().as_str()])
            .map_err(internal)?,
    ];
    EventBuilder::new(Kind::Custom(KIND_BUSINESS_PROFILE_HEAD as u16), content)
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn revision_conflict(reason: ProfileRevisionConflict) -> IngestError {
    match reason {
        ProfileRevisionConflict::ProfileExists { current } => conflict(format!(
            "a business profile already exists at revision {current}; send expectedRevision"
        )),
        ProfileRevisionConflict::ProfileMissing => {
            conflict("no business profile exists yet; send expectedRevision as null")
        }
        ProfileRevisionConflict::Stale { current } => conflict(format!(
            "business profile changed; current revision is {current}"
        )),
    }
}

fn duplicate_result(event: &Event) -> IngestResult {
    IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: "duplicate: already processed".into(),
    }
}

fn invalid(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("invalid: {}", message.into()))
}

fn forbidden(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("restricted: {}", message.into()))
}

fn conflict(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("conflict: {}", message.into()))
}

fn internal(error: impl std::fmt::Display) -> IngestError {
    IngestError::Internal(format!("error: {error}"))
}
```

In `crates/buzz-relay/src/handlers/mod.rs`, after `pub mod company_member_records;` (line 25), add:

```rust
/// Brokers for company-wide singleton records: business profile and team computer.
pub mod company_singleton_records;
```

In `crates/buzz-relay/src/handlers/command_executor.rs`, replace (lines 68-73):

```rust
    if kind == KIND_MEMBER_POSITION_ACTION {
        return super::company_member_records::handle(tenant, state, event, auth).await;
    }
```

with:

```rust
    if kind == KIND_MEMBER_POSITION_ACTION {
        return super::company_member_records::handle(tenant, state, event, auth).await;
    }
    if kind == KIND_BUSINESS_PROFILE_ACTION {
        return super::company_singleton_records::handle_business_profile(
            tenant, state, event, auth,
        )
        .await;
    }
```

In `docs/company-records.md`, before `## Proof boundaries` (line 988), add:

```markdown
## Business profile

The business profile is one company-wide record: the facts every employee
works from, and the company name people see. An owner or admin writes kind
47046 with `{ "profile": <profile>, "expectedRevision": <n or null> }`; the
relay validates the profile (name 1 to 120 characters, other text at most 500,
lists at most 10 items, an IANA time zone, no unknown keys, at most 16 KB) and
writes relay-signed head kind 30657 with `d` = `business-profile` and a
`["revision", "<n>"]` tag. The first write sends `expectedRevision: null`;
every later write must name the current revision, so two people saving at once
cannot overwrite each other. Members and employees read the head. Employees
read it with `colony profile show`.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo check -p buzz-relay`
Expected: no errors.

Run (relay restarted with this build): `RELAY_URL=ws://localhost:3000 BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz cargo test -p buzz-test-client --test e2e_company_profile business_profile_is_written -- --ignored --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/handlers/company_singleton_records.rs \
  crates/buzz-relay/src/handlers/mod.rs crates/buzz-relay/src/handlers/command_executor.rs \
  crates/buzz-test-client/tests/e2e_company_profile.rs .github/workflows/_ci-relay.yml \
  docs/company-records.md
git commit -s -m "feat(relay): broker the company business profile with revisions"
```

---

### Task 1.9: Relay broker for the team computer

**Files:**
- Modify: `crates/buzz-relay/src/handlers/company_singleton_records.rs` (new handler and helpers)
- Modify: `crates/buzz-relay/src/handlers/command_executor.rs` (routing, next to Task 1.8's)
- Modify: `docs/company-records.md` (section after "Business profile")
- Test: `crates/buzz-test-client/tests/e2e_company_profile.rs` (second test)

**Interfaces:**
- Consumes: Task 1.8's private helpers in `company_singleton_records.rs`; `KIND_TEAM_COMPUTER_ACTION`, `KIND_TEAM_COMPUTER_HEAD` (Task 1.5); `TeamComputerAction`, `TeamComputerActionKind`, `TeamComputerHead`, `TeamComputerRefusal`, `apply_team_computer_action`, `validate_team_computer_action`, `validate_team_computer_head`, `TEAM_COMPUTER_D_TAG` (Task 1.7); `buzz_sdk::team_computer::build_team_computer_action` (Task 1.7); `super::business_records::relay_global_head_event` (existing, `crates/buzz-relay/src/handlers/business_records.rs:2630`).
- Produces: `pub(super) async fn handle_team_computer(tenant: &TenantContext, state: &Arc<AppState>, event: Event, auth: IngestAuth) -> Result<IngestResult, IngestError>`. Refusals: `conflict: the team runs on <name>; move it with a forced claim`, `conflict: no computer holds the team; claim it first`, `restricted: only the computer that runs the team can do this`, `rate-limited: heartbeat at most once every 60 seconds; retry in <n> seconds`, `restricted: only a company owner or admin can change which computer runs the team`. Claims and releases are stored as events; heartbeats only replace the head.

- [ ] **Step 1: Write the failing test**

In `crates/buzz-test-client/tests/e2e_company_profile.rs`, extend the `use` lines:

```rust
use buzz_core::kind::{
    KIND_BUSINESS_PROFILE_ACTION, KIND_BUSINESS_PROFILE_HEAD, KIND_TEAM_COMPUTER_HEAD,
};
use buzz_core::team_computer::{
    TeamComputerAction, TeamComputerActionKind, TeamComputerHead, TEAM_COMPUTER_D_TAG,
};
```

and append:

```rust
fn computer_action(
    action: TeamComputerActionKind,
    computer_id: &str,
    computer_name: &str,
    force: bool,
) -> TeamComputerAction {
    TeamComputerAction {
        action,
        computer_id: computer_id.to_owned(),
        computer_name: computer_name.to_owned(),
        force,
    }
}

async fn submit_computer(keys: &Keys, action: TeamComputerAction) -> Value {
    let event = buzz_sdk::team_computer::build_team_computer_action(&action)
        .expect("build team computer action")
        .sign_with_keys(keys)
        .expect("sign team computer action");
    post_event(keys, &event).await
}

async fn current_team_computer(keys: &Keys) -> TeamComputerHead {
    let event = query_one(keys, KIND_TEAM_COMPUTER_HEAD, TEAM_COMPUTER_D_TAG)
        .await
        .expect("a team computer head exists");
    serde_json::from_str(&event.content).expect("parse team computer head")
}

#[tokio::test]
#[ignore]
async fn team_computer_has_one_holder_heartbeats_releases_and_moves_by_force() {
    use TeamComputerActionKind::{Claim, Heartbeat, Release};

    let owner = Keys::generate();
    let admin = Keys::generate();
    let member = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&member, "member").await;
    let laptop = Uuid::new_v4().to_string();
    let desktop = Uuid::new_v4().to_string();
    let laptop_name = "Lerato's MacBook Air";
    let desktop_name = "Kagiso's laptop";

    // A forced claim gives every run a known starting point on the shared community.
    assert_accepted(&submit_computer(&owner, computer_action(Claim, &laptop, laptop_name, true)).await);
    let head = current_team_computer(&owner).await;
    assert_eq!(head.computer_id, laptop);
    assert_eq!(head.claimed_by, owner.public_key().to_hex());
    assert_eq!(head.released_at, None);

    assert_rejected(
        &submit_computer(&admin, computer_action(Claim, &desktop, desktop_name, false)).await,
        "the team runs on Lerato's MacBook Air",
    );
    assert_rejected(
        &submit_computer(&member, computer_action(Claim, &desktop, "Member laptop", true)).await,
        "only a company owner or admin",
    );
    assert_accepted(&submit_computer(&owner, computer_action(Claim, &laptop, laptop_name, false)).await);
    assert_rejected(
        &submit_computer(&owner, computer_action(Heartbeat, &laptop, laptop_name, false)).await,
        "rate-limited",
    );
    assert_rejected(
        &submit_computer(&admin, computer_action(Heartbeat, &desktop, desktop_name, false)).await,
        "only the computer that runs the team",
    );

    assert_accepted(&submit_computer(&admin, computer_action(Claim, &desktop, desktop_name, true)).await);
    let moved = current_team_computer(&owner).await;
    assert_eq!(moved.computer_id, desktop);
    assert_eq!(moved.claimed_by, admin.public_key().to_hex());

    assert_rejected(
        &submit_computer(&owner, computer_action(Release, &laptop, laptop_name, false)).await,
        "only the computer that runs the team",
    );
    assert_accepted(&submit_computer(&admin, computer_action(Release, &desktop, desktop_name, false)).await);
    assert!(current_team_computer(&owner).await.released_at.is_some());

    assert_accepted(&submit_computer(&owner, computer_action(Claim, &laptop, laptop_name, false)).await);
    let reclaimed = current_team_computer(&owner).await;
    assert_eq!(reclaimed.computer_id, laptop);
    assert_eq!(reclaimed.released_at, None);

    // Two computers racing for a free team: exactly one wins.
    assert_accepted(&submit_computer(&owner, computer_action(Release, &laptop, laptop_name, false)).await);
    let racer_a = Uuid::new_v4().to_string();
    let racer_b = Uuid::new_v4().to_string();
    let (first, second) = tokio::join!(
        submit_computer(&owner, computer_action(Claim, &racer_a, "Racer A", false)),
        submit_computer(&admin, computer_action(Claim, &racer_b, "Racer B", false)),
    );
    let winners = [&first, &second]
        .iter()
        .filter(|response| response["accepted"].as_bool() == Some(true))
        .count();
    assert_eq!(winners, 1, "exactly one computer may take a free team: {first} {second}");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `RELAY_URL=ws://localhost:3000 BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz cargo test -p buzz-test-client --test e2e_company_profile team_computer_has_one_holder -- --ignored --nocapture`
Expected: FAIL: the first forced claim is rejected with `unsupported company command kind`, because kind 47047 is not routed yet.

- [ ] **Step 3: Write the broker**

In `crates/buzz-relay/src/handlers/company_singleton_records.rs`, replace the `buzz_core::kind` import with:

```rust
use buzz_core::kind::{
    KIND_BUSINESS_PROFILE_ACTION, KIND_BUSINESS_PROFILE_HEAD, KIND_TEAM_COMPUTER_ACTION,
    KIND_TEAM_COMPUTER_HEAD,
};
use buzz_core::team_computer::{
    apply_team_computer_action, validate_team_computer_action, validate_team_computer_head,
    TeamComputerAction, TeamComputerActionKind, TeamComputerHead, TeamComputerRefusal,
    TEAM_COMPUTER_D_TAG,
};
use chrono::Utc;
```

After `handle_business_profile`, add:

```rust
/// Handles an owner- or admin-signed team computer claim, heartbeat or
/// release (kind 47047). Claims and releases are stored as events; a heartbeat
/// only replaces the head, so a running team does not add one stored event a
/// minute forever.
#[datastore_span(name = "company_team_computer_action", system = "postgresql")]
pub(super) async fn handle_team_computer(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_TEAM_COMPUTER_ACTION {
        return Err(IngestError::Rejected(
            "restricted: unsupported team computer action kind".into(),
        ));
    }
    let action = serde_json::from_str::<TeamComputerAction>(&event.content)
        .map_err(|_| invalid("team computer action content is invalid"))?;
    validate_team_computer_action(&action)
        .map_err(|error| invalid(format!("team computer action: {error}")))?;
    require_member_signed_global_action(&event, &auth, TEAM_COMPUTER_D_TAG)?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let stores_action = action.action != TeamComputerActionKind::Heartbeat;
    let mut tx = begin_fenced_transaction(state, community_id).await?;
    require_owner_or_admin(
        &mut tx,
        community_id,
        &actor_pubkey,
        "change which computer runs the team",
    )
    .await?;
    if stores_action && event_already_stored(&mut tx, community_id, &event).await? {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let (current_head_id, current_stored) = lock_current_head(
        &mut tx,
        state,
        community_id,
        KIND_TEAM_COMPUTER_HEAD,
        TEAM_COMPUTER_D_TAG,
    )
    .await?;
    let current = current_stored
        .as_ref()
        .map(parse_team_computer_head)
        .transpose()?;
    let next = apply_team_computer_action(
        current.as_ref(),
        &action,
        &actor_pubkey,
        Utc::now().timestamp(),
    )
    .map_err(team_computer_refusal)?;
    let head_event = super::business_records::relay_global_head_event(
        KIND_TEAM_COMPUTER_HEAD,
        TEAM_COMPUTER_D_TAG,
        &next,
        current_stored.as_ref(),
        state,
    )?;
    let stored_action = if stores_action {
        let Some(stored) = insert_action(&mut tx, community_id, &event).await? else {
            tx.rollback().await.map_err(internal)?;
            return Ok(duplicate_result(&event));
        };
        Some(stored)
    } else {
        None
    };
    let stored_head = replace_head(
        &mut tx,
        state,
        community_id,
        &head_event,
        TEAM_COMPUTER_D_TAG,
        current_head_id.as_deref(),
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    if let Some(stored_action) = stored_action {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            &stored_action,
            KIND_TEAM_COMPUTER_ACTION,
            &actor_pubkey,
            None,
        )
        .await;
    }
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_head,
        KIND_TEAM_COMPUTER_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

fn parse_team_computer_head(stored: &StoredEvent) -> Result<TeamComputerHead, IngestError> {
    let head = serde_json::from_str::<TeamComputerHead>(&stored.event.content).map_err(|_| {
        IngestError::Internal("error: stored team computer head is invalid".into())
    })?;
    validate_team_computer_head(&head)
        .map_err(|error| internal(format!("stored team computer head: {error}")))?;
    Ok(head)
}

fn team_computer_refusal(refusal: TeamComputerRefusal) -> IngestError {
    match refusal {
        TeamComputerRefusal::HeldElsewhere { computer_name } => conflict(format!(
            "the team runs on {computer_name}; move it with a forced claim"
        )),
        TeamComputerRefusal::NoClaim => conflict("no computer holds the team; claim it first"),
        TeamComputerRefusal::NotTheHolder => {
            forbidden("only the computer that runs the team can do this")
        }
        TeamComputerRefusal::HeartbeatTooSoon { retry_after_secs } => IngestError::Rejected(format!(
            "rate-limited: heartbeat at most once every 60 seconds; retry in {retry_after_secs} seconds"
        )),
    }
}
```

In `crates/buzz-relay/src/handlers/command_executor.rs`, after the business profile routing added in Task 1.8, add:

```rust
    if kind == KIND_TEAM_COMPUTER_ACTION {
        return super::company_singleton_records::handle_team_computer(tenant, state, event, auth)
            .await;
    }
```

In `docs/company-records.md`, after the "Business profile" section, add:

```markdown
## Team computer

A company's employees run on exactly one computer. Kind 47047 carries
`{ "action": "claim" | "heartbeat" | "release", "computerId", "computerName",
"force" }` from an owner or admin, signed by the host on that computer;
relay-signed head kind 30658 (`d` = `team-computer`) holds `computerId`,
`computerName`, `claimedBy`, `claimedAt`, `lastSeenAt` and, after a release,
`releasedAt` (Unix seconds, relay time). A claim takes a free or released team,
refreshes the holder's own claim, or, with `force`, moves the team from another
computer. A heartbeat comes only from the holder and at most once every 60
seconds; a release comes only from the holder. Heads are replaced with a
create-only or exact-revision precondition, so two computers claiming a free
team at the same moment never both win. Claims and releases are stored;
heartbeats only replace the head.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo check -p buzz-relay`
Expected: no errors.

Run (relay restarted with this build): `RELAY_URL=ws://localhost:3000 BUZZ_TEST_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5432/buzz cargo test -p buzz-test-client --test e2e_company_profile -- --ignored --nocapture`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-relay/src/handlers/company_singleton_records.rs \
  crates/buzz-relay/src/handlers/command_executor.rs \
  crates/buzz-test-client/tests/e2e_company_profile.rs docs/company-records.md
git commit -s -m "feat(relay): broker the team computer record with one holder"
```

---

### Task 1.10: `colony profile show`

**Files:**
- Create: `crates/buzz-cli/src/commands/profile.rs`
- Modify: `crates/buzz-cli/src/commands/mod.rs:32` (module list)
- Modify: `crates/buzz-cli/src/lib.rs:279` (command enum), after `:1321` (new `ProfileCmd`), `:3120` (dispatch), `:3290-3324` and `:3620-3640` (inventory tests)
- Test: unit tests inside `profile.rs`; the inventory tests in `lib.rs`

**Interfaces:**
- Consumes: `KIND_BUSINESS_PROFILE_HEAD` (Task 1.5), `BusinessProfile`, `validate_business_profile`, `BUSINESS_PROFILE_D_TAG`, `BUSINESS_PROFILE_REVISION_TAG` (Task 1.6), `BuzzClient::{get_public, query_all_bounded}`, `normalize_events`, `validate_hex64` (existing).
- Produces: `colony profile show` prints a JSON array with the one relay-signed profile head event (the seven canonical fields) after checking its kind, author (the relay's NIP-11 `self` key), signature, `d` tag, revision tag and content. Exit codes: 0 found, 1 no profile yet (`NotFound`), 2 network or relay error, 4 a head that fails verification.

- [ ] **Step 1: Write the failing tests**

Create `crates/buzz-cli/src/commands/profile.rs` with only the tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn profile_json() -> String {
        serde_json::json!({
            "schemaVersion": 1,
            "name": "Lerato Designs",
            "timeZone": "Africa/Johannesburg"
        })
        .to_string()
    }

    fn head(relay: &Keys, d_tag: &str, revision: Option<&str>, content: String) -> Value {
        let mut builder = EventBuilder::new(Kind::Custom(KIND_BUSINESS_PROFILE_HEAD as u16), content)
            .tag(Tag::parse(["d", d_tag]).expect("d tag"));
        if let Some(revision) = revision {
            builder = builder.tag(Tag::parse(["revision", revision]).expect("revision tag"));
        }
        serde_json::to_value(builder.sign_with_keys(relay).expect("sign head")).expect("head JSON")
    }

    #[test]
    fn profile_head_verification_binds_author_coordinate_revision_and_content() {
        let relay = Keys::generate();
        let relay_self = relay.public_key().to_hex();
        let valid = head(&relay, BUSINESS_PROFILE_D_TAG, Some("3"), profile_json());
        let profile = verify_business_profile_head_event(&valid, &relay_self).expect("valid head");
        assert_eq!(profile.name, "Lerato Designs");

        assert!(verify_business_profile_head_event(&valid, &Keys::generate().public_key().to_hex()).is_err());
        assert!(verify_business_profile_head_event(
            &head(&relay, "company:profile", Some("3"), profile_json()),
            &relay_self
        )
        .is_err());
        assert!(verify_business_profile_head_event(
            &head(&relay, BUSINESS_PROFILE_D_TAG, None, profile_json()),
            &relay_self
        )
        .is_err());
        assert!(verify_business_profile_head_event(
            &head(&relay, BUSINESS_PROFILE_D_TAG, Some("0"), profile_json()),
            &relay_self
        )
        .is_err());
        assert!(verify_business_profile_head_event(
            &head(
                &relay,
                BUSINESS_PROFILE_D_TAG,
                Some("3"),
                serde_json::json!({ "schemaVersion": 1, "name": "No zone" }).to_string()
            ),
            &relay_self
        )
        .is_err());
    }
}
```

In `crates/buzz-cli/src/commands/mod.rs`, after `pub mod pr;`, add:

```rust
pub mod profile;
```

In `crates/buzz-cli/src/lib.rs`, in `command_inventory_is_stable`, insert `"profile",` between `"pr",` and `"projects",` in `expected_groups`; in `subcommand_counts_are_stable`, insert `("profile", 1),` between `("pr", 5),` and `("projects", 8),`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p buzz-cli profile`
Expected: FAIL to compile with `cannot find function verify_business_profile_head_event in this scope`.

- [ ] **Step 3: Write the command**

At the top of `crates/buzz-cli/src/commands/profile.rs`, before the tests module, add:

```rust
//! Read the company business profile.

use buzz_core::company_profile::{
    validate_business_profile, BusinessProfile, BUSINESS_PROFILE_D_TAG,
    BUSINESS_PROFILE_REVISION_TAG,
};
use buzz_core::kind::KIND_BUSINESS_PROFILE_HEAD;
use serde_json::Value;

use crate::client::{normalize_events, BuzzClient};
use crate::error::CliError;
use crate::validate::validate_hex64;

pub async fn dispatch(cmd: crate::ProfileCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::ProfileCmd;
    match cmd {
        ProfileCmd::Show => cmd_show(client).await,
    }
}

async fn cmd_show(client: &BuzzClient) -> Result<(), CliError> {
    let relay_self = relay_self_pubkey(client).await?;
    let events = client
        .query_all_bounded(
            serde_json::json!({
                "kinds": [KIND_BUSINESS_PROFILE_HEAD],
                "authors": [relay_self],
                "#d": [BUSINESS_PROFILE_D_TAG],
            }),
            1,
        )
        .await?;
    let event = events
        .into_iter()
        .next()
        .ok_or_else(|| CliError::NotFound("this company has no business profile yet".into()))?;
    verify_business_profile_head_event(&event, &relay_self)?;
    println!("{}", normalize_events(std::slice::from_ref(&event)));
    Ok(())
}

async fn relay_self_pubkey(client: &BuzzClient) -> Result<String, CliError> {
    let nip11_raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let nip11: Value = serde_json::from_str(&nip11_raw).map_err(|error| {
        CliError::Other(format!("relay info document is not valid JSON: {error}"))
    })?;
    let relay_self = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?
        .trim();
    validate_hex64(relay_self)?;
    Ok(relay_self.to_lowercase())
}

fn verify_business_profile_head_event(
    event: &Value,
    relay_self: &str,
) -> Result<BusinessProfile, CliError> {
    let signed: nostr::Event = serde_json::from_value(event.clone())
        .map_err(|error| CliError::Other(format!("business profile event is malformed: {error}")))?;
    if signed.kind != nostr::Kind::Custom(KIND_BUSINESS_PROFILE_HEAD as u16) {
        return Err(CliError::Other("business profile event has the wrong kind".into()));
    }
    if signed.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "business profile event author does not match the relay self key".into(),
        ));
    }
    signed.verify().map_err(|error| {
        CliError::Other(format!("business profile signature is invalid: {error}"))
    })?;
    let d_tags = signed
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .filter_map(|tag| tag.content())
        .collect::<Vec<_>>();
    if d_tags != [BUSINESS_PROFILE_D_TAG] {
        return Err(CliError::Other(
            "business profile head must have exactly one business-profile d tag".into(),
        ));
    }
    let revision = signed
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == BUSINESS_PROFILE_REVISION_TAG)
        .and_then(|tag| tag.content())
        .and_then(|value| value.parse::<u32>().ok());
    if !matches!(revision, Some(revision) if revision > 0) {
        return Err(CliError::Other(
            "business profile head has no valid revision tag".into(),
        ));
    }
    let profile: BusinessProfile = serde_json::from_str(&signed.content).map_err(|error| {
        CliError::Other(format!("business profile content is invalid: {error}"))
    })?;
    validate_business_profile(&profile)
        .map_err(|error| CliError::Other(format!("business profile is invalid: {error}")))?;
    Ok(profile)
}
```

In `crates/buzz-cli/src/lib.rs`, in `enum Cmd`, after `Team(TeamCmd),` (line 279), add:

```rust
    /// Read the company's business profile
    #[command(subcommand)]
    Profile(ProfileCmd),
```

After the `TeamCmd` enum (it ends at line 1321), add:

```rust

#[derive(Subcommand)]
pub enum ProfileCmd {
    /// Show the company's current business profile (relay-signed head)
    Show,
}
```

In the dispatch match, after `Cmd::Team(sub) => commands::team::dispatch(sub, &client).await,` (line 3120), add:

```rust
        Cmd::Profile(sub) => commands::profile::dispatch(sub, &client).await,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p buzz-cli profile`
Expected: PASS for `profile_head_verification_binds_author_coordinate_revision_and_content`.

Run: `cargo test -p buzz-cli command_inventory_is_stable subcommand_counts_are_stable`
Expected: PASS.

Run: `cargo test -p buzz-cli brand`
Expected: PASS (no "Buzz", "Fizz" or "Honey" in the new help text).

- [ ] **Step 5: Commit**

```bash
git add crates/buzz-cli/src/commands/profile.rs crates/buzz-cli/src/commands/mod.rs \
  crates/buzz-cli/src/lib.rs
git commit -s -m "feat(cli): colony profile show reads the verified business profile"
```

---

## Contract changes

These refine the overview; parts C, D and E rely on them.

1. **Team computer head gains `releasedAt`** (Unix seconds, relay time; omitted while a computer holds the team). The overview's "claim succeeds when the head was released" needs the release to be visible in the head.
2. **A claim from the computer that already holds the team succeeds** and refreshes `lastSeenAt` (and `computerName`), so the host can claim at every start without first checking status.
3. **Heartbeat actions are not stored as events**; only the head changes. Claims and releases are stored. This keeps a running team from adding one stored event a minute forever.
4. **The host (part D) should heartbeat every 2 minutes.** The relay refuses heartbeats less than 60 seconds apart with `rate-limited:`; a 60-second timer would collide with that limit through jitter.
5. **Account codes last 15 minutes** (the existing `ACCOUNT_CODE_TTL`). Screen O-02 and email W-06 say 10 minutes; their copy should say 15.
6. **`POST /api/accounts/code/verify` errors:** a wrong code returns `400 {"error":"invalid_code","attempts_left":n}`; a malformed code returns `400 {"error":"invalid_code"}` without `attempts_left` (it does not count as an attempt); a missing or bad `termsVersion` returns `400 {"error":"invalid_request"}`.
7. **`POST /api/accounts/code/start` never returns `429` for a cooldown or a burned code:** it returns `200` with the wait in `resendAfterSeconds` and sends nothing new. It still returns `429 rate_limited` past the per-email (10 a minute) or per-address (60 a minute) limit, like every account route.
8. **Business profile writes answer `response:{"revision":n}`** in the OK message, so the app can keep `expectedRevision` without re-reading the head.
9. **Self-serve account mode:** `BUZZ_SELF_PROVISION_ACCOUNTS`, `BUZZ_SELF_PROVISION_ACCOUNT_IP_LIMIT` (default 10 per hour) and `BUZZ_SELF_PROVISION_ACCOUNT_GLOBAL_LIMIT` (default 500 per hour); `GET /api/communities/config` gains `"accounts": bool`. Public mode, when on, still takes precedence.
10. **Migration number:** 0056 here; if another part lands a migration first, renumber and update the migrator count test.

## Self-review

- **Engine items covered:** E-02 (Tasks 1.1 to 1.3: code sign-in, terms record, Google terms, no account enumeration, burned codes); E-03 (Task 1.4: verified-account company creation, configurable hourly limits, per-owner cap kept); E-04 (Tasks 1.5, 1.6, 1.8, 1.10: kinds, type, broker, CLI); minimal team computer record, relay side of E-12 (Tasks 1.5, 1.7, 1.9). Overview review focus 2 is pinned in Tasks 1.7 and 1.9, review focus 3 in Tasks 1.1 and 1.2.
- **Placeholder scan:** done; every code step carries the code, every run step names the command and the expected result.
- **Type consistency:** `StartSignInCodeOutcome`, `ConsumeSignInCodeOutcome`, `BusinessProfile`, `BusinessProfileAction`, `ProfileRevisionConflict`, `TeamComputerAction`, `TeamComputerActionKind`, `TeamComputerHead` and `TeamComputerRefusal` are defined once (Tasks 1.1, 1.6, 1.7) and used with the same names and fields in Tasks 1.2, 1.3, 1.8, 1.9 and 1.10. The JSON field names match the overview contract (`schemaVersion`, `whatYouSell`, `timeZone`, `expectedRevision`, `computerId`, `computerName`, `claimedBy`, `claimedAt`, `lastSeenAt`, `force`).
- **Known risks left open:** unverified accounts created by `code/start` are never cleaned up (no retention job exists for unverified accounts today); the relay-side team computer record cannot stop an old desktop (1.0.7 or older) from running employees, which only the host change in part D enforces.
