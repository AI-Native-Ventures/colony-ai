//! Deployment-global account persistence for password and Google identities.
//!
//! Account rows deliberately have no community_id: a Nostr pubkey is one
//! identity across every community on a relay deployment. Account creation,
//! code use, password updates, and mail outbox insertion are transactionally
//! bound so partial requests leave durable retry state.

use buzz_core::tenant::CommunityId;
use buzz_datastore_tracing::datastore_span;
use chrono::{DateTime, Duration, Utc};
use sqlx::{PgPool, Postgres, Row, Transaction};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::error::{DbError, Result};
use crate::{observability, Db};

/// Maximum lifetime of an account email code.
pub const ACCOUNT_CODE_TTL: Duration = Duration::minutes(15);
/// Maximum number of submissions checked for one issued code.
pub const ACCOUNT_CODE_MAX_ATTEMPTS: i32 = 5;
/// Number of failed password attempts before a temporary account lock.
pub const ACCOUNT_PASSWORD_FAILURE_LIMIT: i32 = 5;
/// Duration of the progressive password lockout.
pub const ACCOUNT_PASSWORD_LOCKOUT: Duration = Duration::minutes(15);
/// Upper bound for one account mail outbox batch.
pub const ACCOUNT_MAIL_BATCH_LIMIT: i64 = 32;
const ACCOUNT_RETENTION_BATCH_LIMIT: i64 = 1_000;

/// One deployment-global account, including its encrypted key envelope.
///
/// Do not add Debug formatting: this record contains wrapped custody material
/// and a password hash. Ciphertext accessors are for relay-side session creation.
pub struct AccountRecord {
    /// Database identity.
    pub id: Uuid,
    /// Normalized account email.
    pub email: String,
    /// Email verification timestamp, if verified.
    pub email_verified_at: Option<DateTime<Utc>>,
    /// Lowercase Nostr public key.
    pub pubkey: String,
    password_hash: Option<String>,
    wrapped_dek: Vec<u8>,
    kek_id: String,
    sealed_nsec: Vec<u8>,
    nonce: Vec<u8>,
    /// Whether a Google identity is linked.
    pub google_linked: bool,
    /// Consecutive failed password attempts.
    pub failed_attempts: i32,
    /// Active password lock expiry, if locked.
    pub locked_until: Option<DateTime<Utc>>,
}

impl AccountRecord {
    /// Return the stored Argon2id PHC string, if this account has a password.
    pub fn password_hash(&self) -> Option<&str> {
        self.password_hash.as_deref()
    }

    /// Return the wrapped data-encryption key bytes.
    pub fn wrapped_dek(&self) -> &[u8] {
        &self.wrapped_dek
    }

    /// Return the key-encryption key identifier.
    pub fn kek_id(&self) -> &str {
        &self.kek_id
    }

    /// Return the encrypted Nostr secret bytes.
    pub fn sealed_nsec(&self) -> &[u8] {
        &self.sealed_nsec
    }

    /// Return the nonce used to encrypt the Nostr secret bytes.
    pub fn nonce(&self) -> &[u8] {
        &self.nonce
    }
}

/// Account fields prepared by the relay before one atomic account insert.
pub struct NewAccount {
    /// Normalized email address.
    pub email: String,
    /// Lowercase Nostr public key.
    pub pubkey: String,
    /// Argon2id PHC string, or None for Google-only accounts.
    pub password_hash: Option<String>,
    /// AES-GCM envelope containing the random data-encryption key.
    pub wrapped_dek: Vec<u8>,
    /// Key-encryption key identifier.
    pub kek_id: String,
    /// AES-GCM ciphertext of the account nsec.
    pub sealed_nsec: Vec<u8>,
    /// Nonce used for sealed_nsec.
    pub nonce: Vec<u8>,
    /// Whether the email is already verified.
    pub email_verified: bool,
}

/// A one-time code and its separately encrypted durable mail payload.
pub struct NewAccountCode {
    /// Unique account-code row id, also used as mail AEAD context.
    pub code_id: Uuid,
    /// Unique durable mail outbox row id.
    pub outbox_id: Uuid,
    /// Code hash produced by the relay's keyed code-hash function.
    pub code_hash: [u8; 32],
    /// AES-GCM ciphertext of the six digit code for retryable delivery.
    pub code_ciphertext: Vec<u8>,
    /// Nonce used for the encrypted mail code.
    pub nonce: Vec<u8>,
    /// Code purpose.
    pub purpose: AccountCodePurpose,
}

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

/// Result of an account insert, preserving the signup-specific email conflict.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CreateAccountOutcome {
    /// Account and optional code plus outbox entry committed.
    Created(Uuid),
    /// Another account owns the normalized email.
    EmailTaken,
    /// Another account owns the Nostr public key.
    IdentityTaken,
}

/// Result of atomically consuming a verification or password-reset code.
pub enum ConsumeAccountCodeOutcome {
    /// Code accepted and its account updated in the same transaction.
    Accepted(Box<AccountRecord>),
    /// The supplied code does not match the active code.
    Invalid {
        /// Failed submissions remaining before this code is locked.
        attempts_left: i32,
    },
    /// No active code exists or the active code expired.
    Expired,
    /// The active code reached its attempt limit.
    AttemptsExceeded {
        /// Seconds until this code expires and can be replaced.
        retry_after_secs: i64,
    },
}

/// Result of checking an account code without consuming a valid code.
pub enum CheckAccountCodeOutcome {
    /// Code matches the active code and remains available for confirmation.
    Valid,
    /// The supplied code does not match the active code.
    Invalid {
        /// Failed submissions remaining before this code is locked.
        attempts_left: i32,
    },
    /// No active code exists or the active code expired.
    Expired,
    /// The active code reached its attempt limit.
    AttemptsExceeded {
        /// Seconds until this code expires and can be replaced.
        retry_after_secs: i64,
    },
}

/// Result of atomically issuing a new account code.
pub enum IssueAccountCodeOutcome {
    /// The code and encrypted mail retry were committed.
    Issued,
    /// A previous code reached its attempt limit and has not expired.
    Locked {
        /// Seconds until the locked code expires.
        retry_after_secs: i64,
    },
}

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

/// Encrypted account email work claimed by one delivery worker.
pub struct AccountMailOutboxRecord {
    /// Outbox row id.
    pub id: Uuid,
    /// Related account id.
    pub account_id: Uuid,
    /// Normalized destination email.
    pub recipient: String,
    /// Account email purpose.
    pub purpose: String,
    /// Encrypted six digit code.
    pub code_ciphertext: Vec<u8>,
    /// Mail-code encryption nonce.
    pub nonce: Vec<u8>,
    /// Attempt number assigned when the lease was claimed.
    pub attempts: i64,
    /// Fencing token required to complete or release the lease.
    pub claim_token: Uuid,
}

impl Db {
    /// Find an account by normalized email.
    #[datastore_span(name = "account_find_by_email", system = "postgresql")]
    pub async fn account_by_email(&self, email: &str) -> Result<Option<AccountRecord>> {
        load_account_by_email(&self.pool, email).await
    }

    /// Find an account by its Nostr public key.
    #[datastore_span(name = "account_find_by_pubkey", system = "postgresql")]
    pub async fn account_by_pubkey(&self, pubkey: &str) -> Result<Option<AccountRecord>> {
        // This query only interpolates the private, compile-time ACCOUNT_SELECT constant.
        let row = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{ACCOUNT_SELECT} WHERE a.pubkey = $1"
        )))
        .bind(pubkey)
        .fetch_optional(&self.pool)
        .await?;
        row.map(account_from_row).transpose()
    }

    /// Atomically create an account and, when present, its code and mail retry.
    #[datastore_span(name = "account_create", system = "postgresql")]
    pub async fn create_account(
        &self,
        account: &NewAccount,
        code: Option<&NewAccountCode>,
    ) -> Result<CreateAccountOutcome> {
        self.create_account_with_profile(account, code, None).await
    }

    /// Atomically create an account, its initial profile event, and optional
    /// verification code plus mail retry.
    #[datastore_span(name = "account_create_with_profile", system = "postgresql")]
    pub async fn create_account_with_profile(
        &self,
        account: &NewAccount,
        code: Option<&NewAccountCode>,
        profile: Option<(&nostr::Event, CommunityId)>,
    ) -> Result<CreateAccountOutcome> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let account_id = insert_account(&mut tx, account).await?;
        let Some(account_id) = account_id else {
            let email_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM accounts WHERE lower(email) = lower($1))",
            )
            .bind(&account.email)
            .fetch_one(&mut *tx)
            .await?;
            let pubkey_exists: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM accounts WHERE pubkey = $1)")
                    .bind(&account.pubkey)
                    .fetch_one(&mut *tx)
                    .await?;
            tx.commit().await?;
            return if email_exists {
                Ok(CreateAccountOutcome::EmailTaken)
            } else if pubkey_exists {
                Ok(CreateAccountOutcome::IdentityTaken)
            } else {
                Err(DbError::InvalidData(
                    "account insert conflict had no matching key".to_owned(),
                ))
            };
        };

        if let Some((event, community_id)) = profile {
            crate::store::event::insert_event_in_transaction(&mut tx, community_id, event, None)
                .await?;
        }

        if let Some(code) = code {
            insert_account_code(&mut tx, account_id, &account.email, code).await?;
        }
        tx.commit().await?;
        Ok(CreateAccountOutcome::Created(account_id))
    }

    /// Create or reissue a code and its durable encrypted mail row atomically.
    #[datastore_span(name = "account_issue_code", system = "postgresql")]
    pub async fn issue_account_code(
        &self,
        account_id: Uuid,
        email: &str,
        code: &NewAccountCode,
    ) -> Result<IssueAccountCodeOutcome> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        // Code writers and consumers take the account lock before any code lock.
        sqlx::query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE")
            .bind(account_id)
            .execute(&mut *tx)
            .await?;
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
                return Ok(IssueAccountCodeOutcome::Locked { retry_after_secs });
            }
        }
        replace_active_code(&mut tx, account_id, code.purpose).await?;
        insert_account_code(&mut tx, account_id, email, code).await?;
        prune_old_account_mail(&mut tx).await?;
        tx.commit().await?;
        Ok(IssueAccountCodeOutcome::Issued)
    }

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
        let existing: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM accounts WHERE lower(email) = lower($1) FOR UPDATE")
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

    /// Return how long a locked code remains blocked from resending.
    #[datastore_span(name = "account_code_lockout_remaining", system = "postgresql")]
    pub async fn account_code_lockout_remaining(
        &self,
        email: &str,
        purpose: AccountCodePurpose,
    ) -> Result<Option<i64>> {
        sqlx::query_scalar(
            "SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (latest.expires_at - now())))::BIGINT) \
             FROM (SELECT c.attempts, c.expires_at FROM account_codes c \
                   JOIN accounts a ON a.id = c.account_id \
                   WHERE lower(a.email) = lower($1) AND c.purpose = $2 \
                   ORDER BY c.created_at DESC, c.id DESC LIMIT 1) latest \
             WHERE latest.attempts >= $3 AND latest.expires_at > now()",
        )
        .bind(email)
        .bind(purpose.as_str())
        .bind(ACCOUNT_CODE_MAX_ATTEMPTS)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

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
        let (code_id, account_id) =
            match lock_and_check_code(&mut tx, email, AccountCodePurpose::SignIn, provided_hash)
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
                crate::store::event::insert_event_in_transaction(
                    &mut tx,
                    community_id,
                    event,
                    None,
                )
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

    /// Check a reset code without consuming a valid code or changing the
    /// account. Invalid submissions still count against the active code.
    #[datastore_span(name = "account_check_code", system = "postgresql")]
    pub async fn check_account_code(
        &self,
        email: &str,
        purpose: AccountCodePurpose,
        provided_hash: &[u8; 32],
    ) -> Result<CheckAccountCodeOutcome> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let row = sqlx::query(
            "SELECT c.id, c.code_hash, c.expires_at, c.attempts, c.consumed_at \
             FROM account_codes c JOIN accounts a ON a.id = c.account_id \
             WHERE lower(a.email) = lower($1) AND c.purpose = $2 \
             ORDER BY c.created_at DESC, c.id DESC LIMIT 1 FOR UPDATE OF c",
        )
        .bind(email)
        .bind(purpose.as_str())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(CheckAccountCodeOutcome::Expired);
        };

        let code_id: Uuid = row.try_get("id")?;
        let stored_hash: Vec<u8> = row.try_get("code_hash")?;
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
        let attempts: i32 = row.try_get("attempts")?;
        let consumed_at: Option<DateTime<Utc>> = row.try_get("consumed_at")?;
        if expires_at <= Utc::now() {
            if consumed_at.is_none() {
                sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
                    .bind(code_id)
                    .execute(&mut *tx)
                    .await?;
                delete_code_outbox(&mut tx, code_id).await?;
            }
            tx.commit().await?;
            return Ok(CheckAccountCodeOutcome::Expired);
        }
        if attempts >= ACCOUNT_CODE_MAX_ATTEMPTS {
            if consumed_at.is_none() {
                sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
                    .bind(code_id)
                    .execute(&mut *tx)
                    .await?;
                delete_code_outbox(&mut tx, code_id).await?;
            }
            let retry_after_secs = retry_after_until(expires_at);
            tx.commit().await?;
            return Ok(CheckAccountCodeOutcome::AttemptsExceeded { retry_after_secs });
        }
        if consumed_at.is_some() {
            tx.rollback().await?;
            return Ok(CheckAccountCodeOutcome::Expired);
        }

        let matches = bool::from(stored_hash.as_slice().ct_eq(provided_hash.as_slice()));
        if matches {
            tx.commit().await?;
            return Ok(CheckAccountCodeOutcome::Valid);
        }

        let next_attempts = attempts.saturating_add(1);
        sqlx::query(
            "UPDATE account_codes SET attempts = $2, \
             consumed_at = CASE WHEN $2 >= $3 THEN now() ELSE consumed_at END \
             WHERE id = $1",
        )
        .bind(code_id)
        .bind(next_attempts)
        .bind(ACCOUNT_CODE_MAX_ATTEMPTS)
        .execute(&mut *tx)
        .await?;
        let outcome = if next_attempts >= ACCOUNT_CODE_MAX_ATTEMPTS {
            delete_code_outbox(&mut tx, code_id).await?;
            CheckAccountCodeOutcome::AttemptsExceeded {
                retry_after_secs: retry_after_until(expires_at),
            }
        } else {
            CheckAccountCodeOutcome::Invalid {
                attempts_left: ACCOUNT_CODE_MAX_ATTEMPTS.saturating_sub(next_attempts),
            }
        };
        tx.commit().await?;
        Ok(outcome)
    }

    /// Update last sign-in and clear password lockout after a valid password.
    #[datastore_span(name = "account_password_signin_success", system = "postgresql")]
    pub async fn account_password_signin_success(
        &self,
        account_id: Uuid,
    ) -> Result<Option<AccountRecord>> {
        let row = sqlx::query(
            "UPDATE accounts SET last_signin_at = now(), updated_at = now(), \
             failed_attempts = 0, locked_until = NULL \
             WHERE id = $1 AND email_verified_at IS NOT NULL \
               AND (locked_until IS NULL OR locked_until <= now()) RETURNING id",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?;
        if row.is_none() {
            return Ok(None);
        }
        let row = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{ACCOUNT_SELECT} WHERE a.id = $1"
        )))
        .bind(account_id)
        .fetch_one(&self.pool)
        .await?;
        account_from_row(row).map(Some)
    }

    /// Increment a failed password attempt and start a 15 minute lock at five.
    #[datastore_span(name = "account_password_signin_failure", system = "postgresql")]
    pub async fn account_password_signin_failure(&self, account_id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE accounts SET \
             failed_attempts = CASE \
                 WHEN locked_until > now() THEN failed_attempts \
                 WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 \
                 ELSE LEAST(failed_attempts + 1, $2) END, \
             locked_until = CASE \
                 WHEN locked_until > now() THEN locked_until \
                 WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL \
                 WHEN failed_attempts + 1 >= $2 THEN now() + interval '15 minutes' \
                 ELSE NULL END, updated_at = now() WHERE id = $1",
        )
        .bind(account_id)
        .bind(ACCOUNT_PASSWORD_FAILURE_LIMIT)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

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

    /// Set a password for the NIP-98 authenticated public key.
    #[datastore_span(name = "account_set_password", system = "postgresql")]
    pub async fn account_set_password(&self, pubkey: &str, password_hash: &str) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE accounts SET password_hash = $2, failed_attempts = 0, \
             locked_until = NULL, updated_at = now() WHERE pubkey = $1",
        )
        .bind(pubkey)
        .bind(password_hash)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Delete an account and cascade its key envelope, provider links, codes, and mail.
    #[datastore_span(name = "account_delete", system = "postgresql")]
    pub async fn delete_account(&self, pubkey: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM accounts WHERE pubkey = $1")
            .bind(pubkey)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Claim a bounded batch of due, unexpired mail rows with fencing tokens.
    #[datastore_span(name = "account_mail_claim", system = "postgresql")]
    pub async fn claim_account_mail_outbox(
        &self,
        limit: i64,
    ) -> Result<Vec<AccountMailOutboxRecord>> {
        let connection =
            observability::acquire_writer(&self.pool, observability::WriterOperation::Maintenance)
                .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        prune_old_account_mail(&mut tx).await?;
        let rows = sqlx::query(
            "WITH candidates AS ( \
                 SELECT o.id FROM account_mail_outbox o \
                 JOIN account_codes c ON c.id = o.code_id \
                 WHERE o.delivered_at IS NULL AND o.next_attempt_at <= now() \
                   AND (o.lease_until IS NULL OR o.lease_until <= now()) \
                   AND c.consumed_at IS NULL AND c.expires_at > now() \
                 ORDER BY o.created_at, o.id FOR UPDATE OF o SKIP LOCKED LIMIT $1 \
             ) \
             UPDATE account_mail_outbox o SET attempts = o.attempts + 1, \
                 lease_until = now() + interval '30 seconds', claim_token = gen_random_uuid() \
             FROM candidates WHERE o.id = candidates.id \
             RETURNING o.id, o.account_id, o.recipient, o.purpose, o.code_ciphertext, \
                       o.nonce, o.attempts, o.claim_token",
        )
        .bind(limit.clamp(1, ACCOUNT_MAIL_BATCH_LIMIT))
        .fetch_all(&mut *tx)
        .await?;
        let mut claimed = Vec::with_capacity(rows.len());
        for row in rows {
            claimed.push(AccountMailOutboxRecord {
                id: row.try_get("id")?,
                account_id: row.try_get("account_id")?,
                recipient: row.try_get("recipient")?,
                purpose: row.try_get("purpose")?,
                code_ciphertext: row.try_get("code_ciphertext")?,
                nonce: row.try_get("nonce")?,
                attempts: row.try_get("attempts")?,
                claim_token: row.try_get("claim_token")?,
            });
        }
        tx.commit().await?;
        Ok(claimed)
    }

    /// Mark mail delivered only if the claimant still owns its lease.
    #[datastore_span(name = "account_mail_complete", system = "postgresql")]
    pub async fn complete_account_mail_outbox(
        &self,
        outbox_id: Uuid,
        claim_token: Uuid,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE account_mail_outbox SET delivered_at = now(), lease_until = NULL, \
             claim_token = NULL, last_error_code = NULL \
             WHERE id = $1 AND claim_token = $2 AND delivered_at IS NULL",
        )
        .bind(outbox_id)
        .bind(claim_token)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Release a failed mail lease and persist its retry schedule.
    #[datastore_span(name = "account_mail_retry", system = "postgresql")]
    pub async fn retry_account_mail_outbox(
        &self,
        outbox_id: Uuid,
        claim_token: Uuid,
        next_attempt_at: DateTime<Utc>,
        error_code: &'static str,
    ) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE account_mail_outbox SET lease_until = NULL, claim_token = NULL, \
             next_attempt_at = $3, last_error_code = $4 \
             WHERE id = $1 AND claim_token = $2 AND delivered_at IS NULL",
        )
        .bind(outbox_id)
        .bind(claim_token)
        .bind(next_attempt_at)
        .bind(error_code)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Record one delivered code for COLONY_MAIL_SINK=log, idempotently.
    #[datastore_span(name = "account_test_mail_record", system = "postgresql")]
    pub async fn record_account_test_mail(
        &self,
        outbox_id: Uuid,
        account_id: Uuid,
        recipient: &str,
        purpose: &str,
        code: &str,
    ) -> Result<()> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        sqlx::query(
            "INSERT INTO account_test_mail (outbox_id, account_id, recipient, purpose, code) \
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (outbox_id) DO NOTHING",
        )
        .bind(outbox_id)
        .bind(account_id)
        .bind(recipient)
        .bind(purpose)
        .bind(code)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

const ACCOUNT_SELECT: &str =
    "SELECT a.id, a.email, a.email_verified_at, a.pubkey, a.password_hash, \
     a.wrapped_dek, a.kek_id, a.sealed_nsec, a.nonce, a.failed_attempts, a.locked_until, \
     EXISTS (SELECT 1 FROM account_google_identities g WHERE g.account_id = a.id) \
         AS google_linked FROM accounts a";

async fn load_account_by_email(pool: &PgPool, email: &str) -> Result<Option<AccountRecord>> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "{ACCOUNT_SELECT} WHERE lower(a.email) = lower($1)"
    )))
    .bind(email)
    .fetch_optional(pool)
    .await?;
    row.map(account_from_row).transpose()
}

async fn load_account_by_id_tx(
    tx: &mut Transaction<'_, Postgres>,
    account_id: Uuid,
) -> Result<AccountRecord> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!(
        "{ACCOUNT_SELECT} WHERE a.id = $1 FOR UPDATE OF a"
    )))
    .bind(account_id)
    .fetch_one(&mut **tx)
    .await?;
    account_from_row(row)
}

async fn insert_account(
    tx: &mut Transaction<'_, Postgres>,
    account: &NewAccount,
) -> Result<Option<Uuid>> {
    sqlx::query_scalar(
        "INSERT INTO accounts (email, email_verified_at, pubkey, password_hash, wrapped_dek, \
         kek_id, sealed_nsec, nonce) VALUES ($1, \
         CASE WHEN $2 THEN now() ELSE NULL END, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(&account.email)
    .bind(account.email_verified)
    .bind(&account.pubkey)
    .bind(&account.password_hash)
    .bind(&account.wrapped_dek)
    .bind(&account.kek_id)
    .bind(&account.sealed_nsec)
    .bind(&account.nonce)
    .fetch_optional(&mut **tx)
    .await
    .map_err(Into::into)
}

async fn insert_account_code(
    tx: &mut Transaction<'_, Postgres>,
    account_id: Uuid,
    email: &str,
    code: &NewAccountCode,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO account_codes (id, account_id, purpose, code_hash, expires_at) \
         VALUES ($1, $2, $3, $4, now() + interval '15 minutes')",
    )
    .bind(code.code_id)
    .bind(account_id)
    .bind(code.purpose.as_str())
    .bind(code.code_hash.as_slice())
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO account_mail_outbox (id, account_id, code_id, recipient, purpose, \
         code_ciphertext, nonce) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(code.outbox_id)
    .bind(account_id)
    .bind(code.code_id)
    .bind(email)
    .bind(code.purpose.as_str())
    .bind(&code.code_ciphertext)
    .bind(&code.nonce)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn replace_active_code(
    tx: &mut Transaction<'_, Postgres>,
    account_id: Uuid,
    purpose: AccountCodePurpose,
) -> Result<()> {
    sqlx::query(
        "DELETE FROM account_mail_outbox WHERE code_id IN ( \
             SELECT id FROM account_codes WHERE account_id = $1 AND purpose = $2 \
               AND consumed_at IS NULL)",
    )
    .bind(account_id)
    .bind(purpose.as_str())
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE account_codes SET consumed_at = now() \
         WHERE account_id = $1 AND purpose = $2 AND consumed_at IS NULL",
    )
    .bind(account_id)
    .bind(purpose.as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_code_outbox(tx: &mut Transaction<'_, Postgres>, code_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM account_mail_outbox WHERE code_id = $1")
        .bind(code_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

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
    // Match issuance and deletion: account first, then code. Otherwise a
    // resend holding the account can deadlock against verification of its code.
    sqlx::query("SELECT id FROM accounts WHERE lower(email) = lower($1) FOR UPDATE")
        .bind(email)
        .execute(&mut **tx)
        .await?;
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

async fn prune_old_account_mail(tx: &mut Transaction<'_, Postgres>) -> Result<()> {
    sqlx::query(
        "WITH stale AS ( \
             SELECT id FROM account_mail_outbox \
             WHERE (delivered_at IS NOT NULL AND delivered_at < now() - interval '1 day') \
                OR code_id IN (SELECT id FROM account_codes WHERE expires_at < now() - interval '1 day') \
             ORDER BY created_at LIMIT $1 \
         ) DELETE FROM account_mail_outbox o USING stale WHERE o.id = stale.id",
    )
    .bind(ACCOUNT_RETENTION_BATCH_LIMIT)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "WITH stale AS ( \
             SELECT id FROM account_codes WHERE expires_at < now() - interval '1 day' \
               AND NOT EXISTS (SELECT 1 FROM account_mail_outbox o WHERE o.code_id = account_codes.id) \
             ORDER BY expires_at LIMIT $1 \
         ) DELETE FROM account_codes c USING stale WHERE c.id = stale.id",
    )
    .bind(ACCOUNT_RETENTION_BATCH_LIMIT)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn retry_after_until(expires_at: DateTime<Utc>) -> i64 {
    let remaining_millis = (expires_at - Utc::now()).num_milliseconds();
    remaining_millis
        .saturating_add(999)
        .div_euclid(1_000)
        .max(1)
}

fn account_from_row(row: sqlx::postgres::PgRow) -> Result<AccountRecord> {
    Ok(AccountRecord {
        id: row.try_get("id")?,
        email: row.try_get("email")?,
        email_verified_at: row.try_get("email_verified_at")?,
        pubkey: row.try_get("pubkey")?,
        password_hash: row.try_get("password_hash")?,
        wrapped_dek: row.try_get("wrapped_dek")?,
        kek_id: row.try_get("kek_id")?,
        sealed_nsec: row.try_get("sealed_nsec")?,
        nonce: row.try_get("nonce")?,
        google_linked: row.try_get("google_linked")?,
        failed_attempts: row.try_get("failed_attempts")?,
        locked_until: row.try_get("locked_until")?,
    })
}

#[cfg(test)]
mod sign_in_code_postgres_tests {
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
                assert!(
                    !created,
                    "a verified account signs in; it is not created again"
                );
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

#[cfg(test)]
mod sign_in_lock_postgres_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cluster_global_sign_in_locks_the_account_before_the_code() {
        assert_account_locked_before_code(false).await;
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cluster_global_reissue_locks_the_account_before_the_code() {
        assert_account_locked_before_code(true).await;
    }

    async fn assert_account_locked_before_code(reissue: bool) {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&crate::test_support::database_url())
            .await
            .expect("connect to the account test database");
        let db = Db::from_pool(pool.clone());
        let email = format!("lock-{}@example.invalid", Uuid::new_v4().simple());
        let candidate = NewAccount {
            email: email.clone(),
            pubkey: format!("{:064x}", Uuid::new_v4().as_u128()),
            password_hash: None,
            wrapped_dek: vec![1_u8; 28],
            kek_id: "test-kek".to_owned(),
            sealed_nsec: vec![2_u8; 16],
            nonce: vec![3_u8; 12],
            email_verified: false,
        };
        let code = NewAccountCode {
            code_id: Uuid::new_v4(),
            outbox_id: Uuid::new_v4(),
            code_hash: [41; 32],
            code_ciphertext: vec![4_u8; 16],
            nonce: vec![5_u8; 12],
            purpose: AccountCodePurpose::SignIn,
        };
        db.start_sign_in_code(&candidate, &code)
            .await
            .expect("issue code");

        let mut blocker = pool.begin().await.expect("begin account blocker");
        let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *blocker)
            .await
            .expect("blocker connection id");
        let account_id: Uuid =
            sqlx::query_scalar("SELECT id FROM accounts WHERE email = $1 FOR UPDATE")
                .bind(&email)
                .fetch_one(&mut *blocker)
                .await
                .expect("hold the account lock");
        let original_code_id = code.code_id;
        let operation = tokio::spawn(async move {
            if reissue {
                let replacement = NewAccountCode {
                    code_id: Uuid::new_v4(),
                    outbox_id: Uuid::new_v4(),
                    ..code
                };
                db.issue_account_code(account_id, &email, &replacement)
                    .await
                    .map(|outcome| matches!(outcome, IssueAccountCodeOutcome::Issued))
            } else {
                db.consume_sign_in_code(&email, &[41; 32], "2026-10-11", None)
                    .await
                    .map(|outcome| matches!(outcome, ConsumeSignInCodeOutcome::Accepted { .. }))
            }
        });
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let waiting: bool = sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity \
                     WHERE datname = current_database() \
                       AND $1 = ANY(pg_blocking_pids(pid)))",
                )
                .bind(blocker_pid)
                .fetch_one(&pool)
                .await
                .expect("observe account lock waiter");
                if waiting {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("operation reaches the account lock within ten seconds");
        let mut probe = pool.begin().await.expect("begin code lock probe");
        let code_available = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM account_codes WHERE id = $1 FOR UPDATE NOWAIT",
        )
        .bind(original_code_id)
        .fetch_one(&mut *probe)
        .await;
        probe.rollback().await.expect("release code probe");
        blocker.commit().await.expect("release account blocker");
        let succeeded = tokio::time::timeout(std::time::Duration::from_secs(10), operation)
            .await
            .expect("code operation finishes within ten seconds")
            .expect("join code operation")
            .expect("complete code operation");
        assert!(
            code_available.is_ok(),
            "code operations must wait for the account before locking its code"
        );
        assert!(succeeded);
    }
}
