//! Deployment-global account persistence for password and Google identities.
//!
//! Account rows deliberately have no community_id: a Nostr pubkey is one
//! identity across every community on a relay deployment. Account creation,
//! code use, password updates, and mail outbox insertion are transactionally
//! bound so partial requests leave durable retry state.

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
}

impl AccountCodePurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::VerifyEmail => "verify_email",
            Self::ResetPassword => "reset_password",
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
    Invalid,
    /// No active code exists or the active code expired.
    Expired,
    /// The active code reached its attempt limit.
    AttemptsExceeded,
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
    ) -> Result<()> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        replace_active_code(&mut tx, account_id, code.purpose).await?;
        insert_account_code(&mut tx, account_id, email, code).await?;
        prune_old_account_mail(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Atomically compare, count, and consume a code while updating its account.
    #[datastore_span(name = "account_consume_code", system = "postgresql")]
    pub async fn consume_account_code(
        &self,
        email: &str,
        purpose: AccountCodePurpose,
        provided_hash: &[u8; 32],
        new_password_hash: Option<&str>,
    ) -> Result<ConsumeAccountCodeOutcome> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let row = sqlx::query(
            "SELECT c.id, c.account_id, c.code_hash, c.expires_at, c.attempts \
             FROM account_codes c JOIN accounts a ON a.id = c.account_id \
             WHERE lower(a.email) = lower($1) AND c.purpose = $2 AND c.consumed_at IS NULL \
             ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c",
        )
        .bind(email)
        .bind(purpose.as_str())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(ConsumeAccountCodeOutcome::Expired);
        };

        let code_id: Uuid = row.try_get("id")?;
        let account_id: Uuid = row.try_get("account_id")?;
        let stored_hash: Vec<u8> = row.try_get("code_hash")?;
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
        let attempts: i32 = row.try_get("attempts")?;
        if expires_at <= Utc::now() {
            sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
                .bind(code_id)
                .execute(&mut *tx)
                .await?;
            delete_code_outbox(&mut tx, code_id).await?;
            tx.commit().await?;
            return Ok(ConsumeAccountCodeOutcome::Expired);
        }
        if attempts >= ACCOUNT_CODE_MAX_ATTEMPTS {
            sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
                .bind(code_id)
                .execute(&mut *tx)
                .await?;
            delete_code_outbox(&mut tx, code_id).await?;
            tx.commit().await?;
            return Ok(ConsumeAccountCodeOutcome::AttemptsExceeded);
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
            .execute(&mut *tx)
            .await?;
            if next_attempts >= ACCOUNT_CODE_MAX_ATTEMPTS {
                delete_code_outbox(&mut tx, code_id).await?;
            }
            tx.commit().await?;
            return Ok(if next_attempts >= ACCOUNT_CODE_MAX_ATTEMPTS {
                ConsumeAccountCodeOutcome::AttemptsExceeded
            } else {
                ConsumeAccountCodeOutcome::Invalid
            });
        }

        sqlx::query("UPDATE account_codes SET consumed_at = now() WHERE id = $1")
            .bind(code_id)
            .execute(&mut *tx)
            .await?;
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
    #[datastore_span(name = "account_google_signin", system = "postgresql")]
    pub async fn account_google_signin(
        &self,
        sub: &str,
        verified_email: &str,
        new_account: &NewAccount,
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
            sqlx::query(
                "UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, now()), \
                 last_signin_at = now(), updated_at = now() WHERE id = $1",
            )
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
            sqlx::query(
                "UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, now()), \
                 last_signin_at = now(), updated_at = now() WHERE id = $1",
            )
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
