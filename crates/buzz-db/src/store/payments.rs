//! Deployment-global account credit ledger, PayFast intents, and subscriptions.

use buzz_datastore_tracing::datastore_span;
use chrono::{DateTime, Utc};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::error::{DbError, Result};
use crate::{observability, Db};

/// A server ledger row used by account history and usage reads.
#[derive(Debug, Clone)]
pub struct CreditLedgerEntry {
    /// Stable row identifier.
    pub id: Uuid,
    /// Ledger transaction type.
    pub entry_type: String,
    /// Signed balance delta in nanoUSD.
    pub amount_nanousd: i64,
    /// Server-defined idempotency source.
    pub source_id: String,
    /// Related payment or usage reference.
    pub reference: Option<String>,
    /// Human-readable transaction description.
    pub description: String,
    /// Non-sensitive server metadata.
    pub metadata: serde_json::Value,
    /// Transaction time.
    pub created_at: DateTime<Utc>,
}

/// One monthly rollup of server-confirmed credit debits.
#[derive(Debug, Clone)]
pub struct CreditUsageMonth {
    /// UTC start of the month.
    pub month: DateTime<Utc>,
    /// Credits debited, in nanoUSD.
    pub spent_nanousd: i64,
    /// Number of usage ledger entries.
    pub entry_count: i64,
}

/// Durable payment-intent terms and lifecycle state.
#[derive(Debug, Clone)]
pub struct PaymentIntentRecord {
    /// Merchant reference returned to the checkout caller.
    pub reference: String,
    /// Owning deployment-global account id.
    pub account_id: Uuid,
    /// Client idempotency key fixed at checkout creation.
    pub idempotency_key: Uuid,
    /// Stable credit pack id.
    pub pack_id: String,
    /// Amount asked of PayFast, in ZAR cents.
    pub charge_minor_units: i64,
    /// Credit grant fixed at intent creation, in nanoUSD.
    pub grant_nanousd: i64,
    /// Current payment-intent state.
    pub status: String,
    /// PayFast payment id, if one was confirmed.
    pub provider_payment_id: Option<String>,
    /// Last PayFast lifecycle status.
    pub provider_status: Option<String>,
    /// Amount received from PayFast, in ZAR cents.
    pub paid_minor_units: Option<i64>,
    /// Checkout creation time.
    pub created_at: DateTime<Utc>,
    /// Last lifecycle transition time.
    pub updated_at: DateTime<Utc>,
}

/// Result of writing a payment intent under the account row lock.
#[derive(Debug, Clone)]
pub enum CreatePaymentIntentOutcome {
    /// This call created the intent.
    Created(PaymentIntentRecord),
    /// This idempotency key already owns the same intent.
    Existing(PaymentIntentRecord),
    /// Another unresolved intent must be reconciled before a new checkout.
    OpenIntent(PaymentIntentRecord),
}

/// Result of applying a verified, idempotent payment provider notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentNotificationOutcome {
    /// The notification changed the intent and ledger.
    Applied,
    /// The same signed body was already processed.
    Duplicate,
    /// The reference does not map to a stored intent.
    Unmatched,
    /// The provider reported an ambiguous or mismatched result.
    Uncertain,
    /// A provider payment id was already associated with a different charge.
    DuplicatePayment,
}

/// Credit debit result after account-level transactional serialization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreditDebitOutcome {
    /// The requested debit was inserted.
    Applied,
    /// This source id already debited the same amount.
    Duplicate,
    /// Available credits were below the requested debit.
    InsufficientBalance,
}

/// Durable per-site PayFast hosting subscription.
#[derive(Clone)]
pub struct SiteSubscriptionRecord {
    /// Stable database id.
    pub id: Uuid,
    /// Owning deployment-global account id.
    pub account_id: Uuid,
    /// Website identifier supplied by the hosting surface.
    pub site_id: String,
    /// Merchant reference for the initial hosted checkout.
    pub reference: String,
    /// PayFast's recurring token after its first verified notification.
    pub provider_token: Option<String>,
    /// Subscription lifecycle state.
    pub status: String,
    /// USD list price in cents, currently fixed at 1000 per month.
    pub monthly_usd_cents: i32,
    /// Configured PayFast recurring amount in ZAR cents.
    pub monthly_zar_cents: i64,
    /// Last provider status received.
    pub provider_status: Option<String>,
    /// Latest durable PayFast cancellation request marker.
    pub cancel_requested_at: Option<DateTime<Utc>>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last lifecycle transition time.
    pub updated_at: DateTime<Utc>,
}

impl std::fmt::Debug for SiteSubscriptionRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SiteSubscriptionRecord")
            .field("id", &self.id)
            .field("account_id", &self.account_id)
            .field("site_id", &self.site_id)
            .field("reference", &self.reference)
            .field("provider_token", &"[REDACTED]")
            .field("status", &self.status)
            .field("monthly_usd_cents", &self.monthly_usd_cents)
            .field("monthly_zar_cents", &self.monthly_zar_cents)
            .field("provider_status", &self.provider_status)
            .field("cancel_requested_at", &self.cancel_requested_at)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

/// Result of starting a site subscription under the account row lock.
#[derive(Debug, Clone)]
pub enum CreateSiteSubscriptionOutcome {
    /// This call created a subscription checkout.
    Created(SiteSubscriptionRecord),
    /// This idempotency key already owns the same subscription.
    Existing(SiteSubscriptionRecord),
    /// The site already has a current subscription.
    Current(SiteSubscriptionRecord),
}

impl Db {
    /// Read the account's deployment-global credit balance from the writer.
    #[datastore_span(name = "account_credit_balance", system = "postgresql")]
    pub async fn account_credit_balance(&self, account_id: Uuid) -> Result<i64> {
        let amount = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(amount_nanousd), 0)::bigint \
             FROM account_credit_ledger WHERE account_id = $1",
        )
        .bind(account_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(amount)
    }

    /// Read recent credit ledger rows for one deployment-global account.
    #[datastore_span(name = "account_credit_history", system = "postgresql")]
    pub async fn account_credit_history(
        &self,
        account_id: Uuid,
        limit: i64,
    ) -> Result<Vec<CreditLedgerEntry>> {
        let rows = sqlx::query(
            "SELECT id, entry_type, amount_nanousd, source_id, reference, description, metadata, created_at \
             FROM account_credit_ledger WHERE account_id = $1 \
             ORDER BY created_at DESC, id DESC LIMIT $2",
        )
        .bind(account_id)
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ledger_entry_from_row).collect()
    }

    /// Read up to twelve months of server-confirmed debit totals.
    #[datastore_span(name = "account_credit_usage", system = "postgresql")]
    pub async fn account_credit_usage(&self, account_id: Uuid) -> Result<Vec<CreditUsageMonth>> {
        let rows = sqlx::query(
            "WITH month_limits AS ( \
                 SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AS current_month \
             ), months AS ( \
                 SELECT generate_series( \
                     current_month - interval '11 months', current_month, interval '1 month' \
                 ) AS month_utc FROM month_limits \
             ), usage_totals AS ( \
                 SELECT date_trunc('month', created_at AT TIME ZONE 'UTC') AS month_utc, \
                        -SUM(amount_nanousd)::bigint AS spent_nanousd, \
                        COUNT(*)::bigint AS entry_count \
                 FROM account_credit_ledger \
                 WHERE account_id = $1 AND entry_type = 'usage' \
                   AND amount_nanousd < 0 \
                   AND created_at >= (SELECT current_month - interval '11 months' \
                                      FROM month_limits) AT TIME ZONE 'UTC' \
                 GROUP BY date_trunc('month', created_at AT TIME ZONE 'UTC') \
             ) \
             SELECT months.month_utc AT TIME ZONE 'UTC' AS month, \
                    COALESCE(usage_totals.spent_nanousd, 0)::bigint AS spent_nanousd, \
                    COALESCE(usage_totals.entry_count, 0)::bigint AS entry_count \
             FROM months LEFT JOIN usage_totals USING (month_utc) \
             ORDER BY month DESC",
        )
        .bind(account_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(CreditUsageMonth {
                    month: row.try_get("month")?,
                    spent_nanousd: row.try_get("spent_nanousd")?,
                    entry_count: row.try_get("entry_count")?,
                })
            })
            .collect()
    }

    /// Create or recover a credit checkout intent under the account row lock.
    #[datastore_span(name = "account_payment_intent_create", system = "postgresql")]
    pub async fn create_account_payment_intent(
        &self,
        account_id: Uuid,
        reference: &str,
        idempotency_key: Uuid,
        pack_id: &str,
        charge_minor_units: i64,
        grant_nanousd: i64,
    ) -> Result<CreatePaymentIntentOutcome> {
        if reference.is_empty()
            || reference.len() > 200
            || pack_id.is_empty()
            || pack_id.len() > 64
            || charge_minor_units <= 0
            || grant_nanousd <= 0
        {
            return Err(DbError::InvalidData(
                "invalid payment intent terms".to_owned(),
            ));
        }
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let account_exists =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM accounts WHERE id = $1 FOR UPDATE")
                .bind(account_id)
                .fetch_optional(&mut *tx)
                .await?;
        if account_exists.is_none() {
            return Err(DbError::NotFound("account not found".to_owned()));
        }

        if let Some(row) = sqlx::query(
            "SELECT reference, account_id, idempotency_key, pack_id, charge_minor_units, \
                    grant_nanousd, status, provider_payment_id, provider_status, paid_minor_units, \
                    created_at, updated_at \
             FROM account_payment_intents WHERE account_id = $1 AND idempotency_key = $2",
        )
        .bind(account_id)
        .bind(idempotency_key)
        .fetch_optional(&mut *tx)
        .await?
        {
            let existing = payment_intent_from_row(row)?;
            if existing.pack_id != pack_id
                || existing.charge_minor_units != charge_minor_units
                || existing.grant_nanousd != grant_nanousd
            {
                return Err(DbError::InvalidData(
                    "idempotency key was reused with different checkout terms".to_owned(),
                ));
            }
            tx.commit().await?;
            return Ok(CreatePaymentIntentOutcome::Existing(existing));
        }

        if let Some(row) = sqlx::query(
            "SELECT reference, account_id, idempotency_key, pack_id, charge_minor_units, \
                    grant_nanousd, status, provider_payment_id, provider_status, paid_minor_units, \
                    created_at, updated_at \
             FROM account_payment_intents WHERE account_id = $1 \
               AND status IN ('pending', 'delayed', 'uncertain') \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(account_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            let open = payment_intent_from_row(row)?;
            tx.commit().await?;
            return Ok(CreatePaymentIntentOutcome::OpenIntent(open));
        }

        let row = sqlx::query(
            "INSERT INTO account_payment_intents \
             (reference, account_id, idempotency_key, provider, pack_id, charge_minor_units, \
              charge_currency, grant_nanousd) \
             VALUES ($1, $2, $3, 'payfast', $4, $5, 'ZAR', $6) \
             RETURNING reference, account_id, idempotency_key, pack_id, charge_minor_units, \
                       grant_nanousd, status, provider_payment_id, provider_status, paid_minor_units, \
                       created_at, updated_at",
        )
        .bind(reference)
        .bind(account_id)
        .bind(idempotency_key)
        .bind(pack_id)
        .bind(charge_minor_units)
        .bind(grant_nanousd)
        .fetch_one(&mut *tx)
        .await?;
        let created = payment_intent_from_row(row)?;
        tx.commit().await?;
        Ok(CreatePaymentIntentOutcome::Created(created))
    }

    /// Find one checkout intent belonging to this account.
    #[datastore_span(name = "account_payment_intent_find", system = "postgresql")]
    pub async fn account_payment_intent(
        &self,
        account_id: Uuid,
        reference: &str,
    ) -> Result<Option<PaymentIntentRecord>> {
        let row = sqlx::query(
            "SELECT reference, account_id, idempotency_key, pack_id, charge_minor_units, \
                    grant_nanousd, status, provider_payment_id, provider_status, paid_minor_units, \
                    created_at, updated_at \
             FROM account_payment_intents WHERE account_id = $1 AND reference = $2",
        )
        .bind(account_id)
        .bind(reference)
        .fetch_optional(&self.pool)
        .await?;
        row.map(payment_intent_from_row).transpose()
    }

    /// Read recent payment intents for account history, including non-paid states.
    #[datastore_span(name = "account_payment_intent_history", system = "postgresql")]
    pub async fn account_payment_intent_history(
        &self,
        account_id: Uuid,
        limit: i64,
    ) -> Result<Vec<PaymentIntentRecord>> {
        let rows = sqlx::query(
            "SELECT reference, account_id, idempotency_key, pack_id, charge_minor_units, \
                    grant_nanousd, status, provider_payment_id, provider_status, paid_minor_units, \
                    created_at, updated_at FROM account_payment_intents \
             WHERE account_id = $1 ORDER BY created_at DESC, reference DESC LIMIT $2",
        )
        .bind(account_id)
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(payment_intent_from_row).collect()
    }

    /// Find an unresolved account checkout that must be reconciled before retry.
    #[datastore_span(name = "account_payment_intent_open", system = "postgresql")]
    pub async fn open_account_payment_intent(
        &self,
        account_id: Uuid,
    ) -> Result<Option<PaymentIntentRecord>> {
        let row = sqlx::query(
            "SELECT reference, account_id, idempotency_key, pack_id, charge_minor_units, \
                    grant_nanousd, status, provider_payment_id, provider_status, paid_minor_units, \
                    created_at, updated_at \
             FROM account_payment_intents WHERE account_id = $1 \
               AND status IN ('pending', 'delayed', 'uncertain') \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(payment_intent_from_row).transpose()
    }

    /// Atomically journal one verified ITN and settle or update its intent.
    #[datastore_span(name = "account_payment_notification_apply", system = "postgresql")]
    pub async fn apply_account_payment_notification(
        &self,
        event_id: &str,
        reference: Option<&str>,
        provider_payment_id: Option<&str>,
        provider_status: &str,
        amount_zar_cents: Option<i64>,
    ) -> Result<PaymentNotificationOutcome> {
        validate_notification(
            event_id,
            provider_payment_id,
            provider_status,
            amount_zar_cents,
        )?;
        validate_payment_reference(reference)?;
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let inserted = sqlx::query(
            "INSERT INTO account_payment_notifications \
             (event_id, reference, provider_payment_id, provider_status, amount_zar_cents, result) \
             VALUES ($1, $2, $3, $4, $5, 'processing') ON CONFLICT (event_id) DO NOTHING \
             RETURNING event_id",
        )
        .bind(event_id)
        .bind(reference)
        .bind(provider_payment_id)
        .bind(provider_status)
        .bind(amount_zar_cents)
        .fetch_optional(&mut *tx)
        .await?;
        if inserted.is_none() {
            tx.commit().await?;
            return Ok(PaymentNotificationOutcome::Duplicate);
        }

        let row = if let Some(reference) = reference {
            sqlx::query(
                "SELECT reference, account_id, idempotency_key, pack_id, charge_minor_units, \
                        grant_nanousd, status, provider_payment_id, provider_status, paid_minor_units, \
                        created_at, updated_at \
                 FROM account_payment_intents WHERE reference = $1 FOR UPDATE",
            )
            .bind(reference)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            None
        };
        let Some(row) = row else {
            finish_notification(&mut tx, event_id, "unmatched").await?;
            tx.commit().await?;
            return Ok(PaymentNotificationOutcome::Unmatched);
        };
        let intent = payment_intent_from_row(row)?;

        let existing_payment_owner = if let Some(provider_payment_id) = provider_payment_id {
            sqlx::query_scalar::<_, String>(
                "SELECT reference FROM account_payment_intents \
                 WHERE provider_payment_id = $1 AND reference <> $2",
            )
            .bind(provider_payment_id)
            .bind(&intent.reference)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            None
        };
        if existing_payment_owner.is_some() {
            sqlx::query(
                "UPDATE account_payment_intents SET status = 'uncertain', provider_status = $2, \
                 updated_at = now() WHERE reference = $1 AND status <> 'paid'",
            )
            .bind(&intent.reference)
            .bind(provider_status)
            .execute(&mut *tx)
            .await?;
            finish_notification(&mut tx, event_id, "duplicate_payment").await?;
            tx.commit().await?;
            return Ok(PaymentNotificationOutcome::DuplicatePayment);
        }

        if intent.status == "paid" {
            let same_payment = intent.provider_payment_id.as_deref() == provider_payment_id;
            let result = if same_payment {
                "already_applied"
            } else {
                "duplicate_payment"
            };
            finish_notification(&mut tx, event_id, result).await?;
            tx.commit().await?;
            return Ok(if same_payment {
                PaymentNotificationOutcome::Duplicate
            } else {
                PaymentNotificationOutcome::DuplicatePayment
            });
        }

        if intent
            .provider_payment_id
            .as_deref()
            .is_some_and(|existing| provider_payment_id != Some(existing))
        {
            update_intent_status(
                &mut tx,
                &intent.reference,
                "uncertain",
                provider_status,
                provider_payment_id,
                amount_zar_cents,
            )
            .await?;
            finish_notification(&mut tx, event_id, "uncertain").await?;
            tx.commit().await?;
            return Ok(PaymentNotificationOutcome::Uncertain);
        }

        let callback_status = provider_status.to_ascii_uppercase();
        let amount_matches = amount_zar_cents == Some(intent.charge_minor_units);
        let (next_status, result) = match callback_status.as_str() {
            "COMPLETE" if amount_matches => {
                let Some(provider_payment_id) = provider_payment_id else {
                    update_intent_status(
                        &mut tx,
                        &intent.reference,
                        "uncertain",
                        provider_status,
                        None,
                        amount_zar_cents,
                    )
                    .await?;
                    finish_notification(&mut tx, event_id, "uncertain").await?;
                    tx.commit().await?;
                    return Ok(PaymentNotificationOutcome::Uncertain);
                };
                let source_id = format!("payfast:{provider_payment_id}");
                let inserted = sqlx::query(
                    "INSERT INTO account_credit_ledger \
                     (account_id, entry_type, amount_nanousd, source_id, reference, description, metadata) \
                     VALUES ($1, 'purchase', $2, $3, $4, $5, $6) \
                     ON CONFLICT (account_id, source_id) DO NOTHING",
                )
                .bind(intent.account_id)
                .bind(intent.grant_nanousd)
                .bind(&source_id)
                .bind(&intent.reference)
                .bind(format!("PayFast {} credit pack", intent.pack_id))
                .bind(serde_json::json!({
                    "provider": "payfast",
                    "providerPaymentId": provider_payment_id,
                    "packId": intent.pack_id,
                    "chargeMinorUnits": intent.charge_minor_units,
                    "chargeCurrency": "ZAR",
                }))
                .execute(&mut *tx)
                .await?;
                if inserted.rows_affected() == 0 {
                    let same_ledger_entry = sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS (SELECT 1 FROM account_credit_ledger \
                         WHERE account_id = $1 AND source_id = $2 AND reference = $3 \
                           AND amount_nanousd = $4)",
                    )
                    .bind(intent.account_id)
                    .bind(&source_id)
                    .bind(&intent.reference)
                    .bind(intent.grant_nanousd)
                    .fetch_one(&mut *tx)
                    .await?;
                    if !same_ledger_entry {
                        update_intent_status(
                            &mut tx,
                            intent.reference.as_str(),
                            "uncertain",
                            provider_status,
                            Some(provider_payment_id),
                            amount_zar_cents,
                        )
                        .await?;
                        finish_notification(&mut tx, event_id, "uncertain").await?;
                        tx.commit().await?;
                        return Ok(PaymentNotificationOutcome::Uncertain);
                    }
                }
                ("paid", "applied")
            }
            "COMPLETE" => ("uncertain", "uncertain"),
            "PENDING" | "DELAYED" => ("delayed", "applied"),
            "FAILED" => ("failed", "applied"),
            "CANCELLED" | "CANCELED" => ("cancelled", "applied"),
            _ => ("uncertain", "uncertain"),
        };

        if !(intent.status == "failed" || intent.status == "cancelled")
            || next_status == "paid"
            || next_status == "uncertain"
        {
            update_intent_status(
                &mut tx,
                intent.reference.as_str(),
                next_status,
                provider_status,
                provider_payment_id,
                amount_zar_cents,
            )
            .await?;
        }
        finish_notification(&mut tx, event_id, result).await?;
        tx.commit().await?;
        Ok(if next_status == "uncertain" {
            PaymentNotificationOutcome::Uncertain
        } else {
            PaymentNotificationOutcome::Applied
        })
    }

    /// Record a server-side usage debit without allowing an overdraft.
    #[datastore_span(name = "account_credit_debit", system = "postgresql")]
    pub async fn record_account_credit_debit(
        &self,
        account_id: Uuid,
        source_id: &str,
        amount_nanousd: i64,
        description: &str,
        metadata: &serde_json::Value,
    ) -> Result<CreditDebitOutcome> {
        if source_id.is_empty()
            || source_id.len() > 200
            || amount_nanousd <= 0
            || description.is_empty()
            || description.len() > 256
            || !metadata.is_object()
        {
            return Err(DbError::InvalidData(
                "invalid credit debit terms".to_owned(),
            ));
        }
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let account_exists =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM accounts WHERE id = $1 FOR UPDATE")
                .bind(account_id)
                .fetch_optional(&mut *tx)
                .await?;
        if account_exists.is_none() {
            return Err(DbError::NotFound("account not found".to_owned()));
        }
        if let Some(existing_amount) = sqlx::query_scalar::<_, i64>(
            "SELECT amount_nanousd FROM account_credit_ledger \
             WHERE account_id = $1 AND source_id = $2",
        )
        .bind(account_id)
        .bind(source_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            if existing_amount != -amount_nanousd {
                return Err(DbError::InvalidData(
                    "credit debit source was reused with a different amount".to_owned(),
                ));
            }
            tx.commit().await?;
            return Ok(CreditDebitOutcome::Duplicate);
        }
        let balance = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(amount_nanousd), 0)::bigint \
             FROM account_credit_ledger WHERE account_id = $1",
        )
        .bind(account_id)
        .fetch_one(&mut *tx)
        .await?;
        if balance < amount_nanousd {
            tx.commit().await?;
            return Ok(CreditDebitOutcome::InsufficientBalance);
        }
        sqlx::query(
            "INSERT INTO account_credit_ledger \
             (account_id, entry_type, amount_nanousd, source_id, description, metadata) \
             VALUES ($1, 'usage', $2, $3, $4, $5)",
        )
        .bind(account_id)
        .bind(-amount_nanousd)
        .bind(source_id)
        .bind(description)
        .bind(metadata)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(CreditDebitOutcome::Applied)
    }

    /// Create or recover one monthly PayFast subscription for a website.
    #[datastore_span(name = "account_site_subscription_create", system = "postgresql")]
    pub async fn create_account_site_subscription(
        &self,
        account_id: Uuid,
        site_id: &str,
        reference: &str,
        idempotency_key: Uuid,
        monthly_zar_cents: i64,
    ) -> Result<CreateSiteSubscriptionOutcome> {
        if site_id.is_empty()
            || site_id.len() > 128
            || site_id.chars().any(char::is_control)
            || reference.is_empty()
            || reference.len() > 200
            || monthly_zar_cents < 500
        {
            return Err(DbError::InvalidData(
                "invalid site subscription terms".to_owned(),
            ));
        }
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let account_exists =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM accounts WHERE id = $1 FOR UPDATE")
                .bind(account_id)
                .fetch_optional(&mut *tx)
                .await?;
        if account_exists.is_none() {
            return Err(DbError::NotFound("account not found".to_owned()));
        }
        if let Some(row) = subscription_by_idempotency(&mut tx, account_id, idempotency_key).await?
        {
            let existing = site_subscription_from_row(row)?;
            if existing.site_id != site_id || existing.monthly_zar_cents != monthly_zar_cents {
                return Err(DbError::InvalidData(
                    "idempotency key was reused with different subscription terms".to_owned(),
                ));
            }
            tx.commit().await?;
            return Ok(CreateSiteSubscriptionOutcome::Existing(existing));
        }
        if let Some(row) = sqlx::query(
            "SELECT id, account_id, site_id, reference, provider_token, status, \
                    monthly_usd_cents, monthly_zar_cents, provider_status, cancel_requested_at, \
                    created_at, updated_at \
             FROM account_site_subscriptions WHERE account_id = $1 AND site_id = $2 \
               AND status IN ('pending', 'active', 'delayed', 'failed', 'uncertain') \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(account_id)
        .bind(site_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            let current = site_subscription_from_row(row)?;
            tx.commit().await?;
            return Ok(CreateSiteSubscriptionOutcome::Current(current));
        }
        let row = sqlx::query(
            "INSERT INTO account_site_subscriptions \
             (account_id, site_id, reference, idempotency_key, provider, monthly_zar_cents) \
             VALUES ($1, $2, $3, $4, 'payfast', $5) \
             RETURNING id, account_id, site_id, reference, provider_token, status, \
                       monthly_usd_cents, monthly_zar_cents, provider_status, cancel_requested_at, \
                       created_at, updated_at",
        )
        .bind(account_id)
        .bind(site_id)
        .bind(reference)
        .bind(idempotency_key)
        .bind(monthly_zar_cents)
        .fetch_one(&mut *tx)
        .await?;
        let created = site_subscription_from_row(row)?;
        tx.commit().await?;
        Ok(CreateSiteSubscriptionOutcome::Created(created))
    }

    /// Read one subscription owned by the account.
    #[datastore_span(name = "account_site_subscription_find", system = "postgresql")]
    pub async fn account_site_subscription(
        &self,
        account_id: Uuid,
        subscription_id: Uuid,
    ) -> Result<Option<SiteSubscriptionRecord>> {
        let row = sqlx::query(
            "SELECT id, account_id, site_id, reference, provider_token, status, \
                    monthly_usd_cents, monthly_zar_cents, provider_status, cancel_requested_at, \
                    created_at, updated_at \
             FROM account_site_subscriptions WHERE account_id = $1 AND id = $2",
        )
        .bind(account_id)
        .bind(subscription_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(site_subscription_from_row).transpose()
    }

    /// Read the current account subscriptions for its website list.
    #[datastore_span(name = "account_site_subscription_history", system = "postgresql")]
    pub async fn account_site_subscription_history(
        &self,
        account_id: Uuid,
        limit: i64,
    ) -> Result<Vec<SiteSubscriptionRecord>> {
        let rows = sqlx::query(
            "SELECT id, account_id, site_id, reference, provider_token, status, \
                    monthly_usd_cents, monthly_zar_cents, provider_status, cancel_requested_at, \
                    created_at, updated_at FROM account_site_subscriptions \
             WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
        )
        .bind(account_id)
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(site_subscription_from_row).collect()
    }

    /// Persist a cancellation request before calling PayFast.
    #[datastore_span(
        name = "account_site_subscription_cancel_request",
        system = "postgresql"
    )]
    pub async fn request_account_site_subscription_cancel(
        &self,
        account_id: Uuid,
        subscription_id: Uuid,
    ) -> Result<Option<SiteSubscriptionRecord>> {
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let row = sqlx::query(
            "UPDATE account_site_subscriptions SET cancel_requested_at = COALESCE(cancel_requested_at, now()), \
             updated_at = now() WHERE account_id = $1 AND id = $2 \
               AND status IN ('active', 'delayed', 'failed', 'uncertain') \
             RETURNING id, account_id, site_id, reference, provider_token, status, \
                       monthly_usd_cents, monthly_zar_cents, provider_status, cancel_requested_at, \
                       created_at, updated_at",
        )
        .bind(account_id)
        .bind(subscription_id)
        .fetch_optional(&mut *tx)
        .await?;
        let subscription = row.map(site_subscription_from_row).transpose()?;
        tx.commit().await?;
        Ok(subscription)
    }

    /// Complete a cancellation only after PayFast confirms it.
    #[datastore_span(
        name = "account_site_subscription_cancel_complete",
        system = "postgresql"
    )]
    pub async fn complete_account_site_subscription_cancel(
        &self,
        account_id: Uuid,
        subscription_id: Uuid,
        provider_status: &str,
    ) -> Result<bool> {
        let updated = sqlx::query(
            "UPDATE account_site_subscriptions SET status = 'cancelled', provider_status = $3, \
             cancel_requested_at = COALESCE(cancel_requested_at, now()), updated_at = now() \
             WHERE account_id = $1 AND id = $2 AND provider_token IS NOT NULL \
             RETURNING id",
        )
        .bind(account_id)
        .bind(subscription_id)
        .bind(provider_status)
        .fetch_optional(&self.pool)
        .await?;
        Ok(updated.is_some())
    }

    /// Apply a verified initial or recurring PayFast subscription notification.
    #[datastore_span(name = "account_site_subscription_notification", system = "postgresql")]
    pub async fn apply_account_site_subscription_notification(
        &self,
        event_id: &str,
        reference: Option<&str>,
        provider_token: &str,
        provider_payment_id: Option<&str>,
        provider_status: &str,
        amount_zar_cents: Option<i64>,
    ) -> Result<PaymentNotificationOutcome> {
        validate_notification(
            event_id,
            provider_payment_id,
            provider_status,
            amount_zar_cents,
        )?;
        validate_payment_reference(reference)?;
        if provider_token.is_empty()
            || provider_token.len() > 36
            || !provider_token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(DbError::InvalidData(
                "invalid PayFast subscription token".to_owned(),
            ));
        }
        let connection = observability::acquire_writer(
            &self.pool,
            observability::WriterOperation::Authorization,
        )
        .await?;
        let mut tx = Transaction::begin(connection, None).await?;
        let inserted = sqlx::query(
            "INSERT INTO account_payment_notifications \
             (event_id, reference, provider_payment_id, provider_status, amount_zar_cents, result) \
             VALUES ($1, $2, $3, $4, $5, 'processing') ON CONFLICT (event_id) DO NOTHING \
             RETURNING event_id",
        )
        .bind(event_id)
        .bind(reference)
        .bind(provider_payment_id)
        .bind(provider_status)
        .bind(amount_zar_cents)
        .fetch_optional(&mut *tx)
        .await?;
        if inserted.is_none() {
            tx.commit().await?;
            return Ok(PaymentNotificationOutcome::Duplicate);
        }

        let rows = sqlx::query(
            "SELECT id, account_id, site_id, reference, provider_token, status, \
                    monthly_usd_cents, monthly_zar_cents, provider_status, cancel_requested_at, \
                    created_at, updated_at \
             FROM account_site_subscriptions \
             WHERE provider_token = $1 OR reference = $2 \
             ORDER BY id FOR UPDATE",
        )
        .bind(provider_token)
        .bind(reference)
        .fetch_all(&mut *tx)
        .await?;
        let subscriptions = rows
            .into_iter()
            .map(site_subscription_from_row)
            .collect::<Result<Vec<_>>>()?;
        let by_token = subscriptions
            .iter()
            .find(|subscription| subscription.provider_token.as_deref() == Some(provider_token))
            .cloned();
        let by_reference = reference.and_then(|reference| {
            subscriptions
                .iter()
                .find(|subscription| subscription.reference == reference)
                .cloned()
        });
        let subscription = match (by_token, by_reference) {
            (Some(token_record), Some(reference_record)) => {
                if token_record.id != reference_record.id {
                    update_subscription_status(
                        &mut tx,
                        token_record.id,
                        "uncertain",
                        provider_status,
                        None,
                    )
                    .await?;
                    update_subscription_status(
                        &mut tx,
                        reference_record.id,
                        "uncertain",
                        provider_status,
                        None,
                    )
                    .await?;
                    finish_notification(&mut tx, event_id, "uncertain").await?;
                    tx.commit().await?;
                    return Ok(PaymentNotificationOutcome::Uncertain);
                }
                token_record
            }
            (Some(subscription), None) | (None, Some(subscription)) => subscription,
            (None, None) => {
                finish_notification(&mut tx, event_id, "unmatched").await?;
                tx.commit().await?;
                return Ok(PaymentNotificationOutcome::Unmatched);
            }
        };
        if subscription.provider_token.is_none()
            && reference.is_some_and(|value| value != subscription.reference)
        {
            update_subscription_status(
                &mut tx,
                subscription.id,
                "uncertain",
                provider_status,
                Some(provider_token),
            )
            .await?;
            finish_notification(&mut tx, event_id, "uncertain").await?;
            tx.commit().await?;
            return Ok(PaymentNotificationOutcome::Uncertain);
        }
        if subscription
            .provider_token
            .as_deref()
            .is_some_and(|existing| existing != provider_token)
        {
            update_subscription_status(
                &mut tx,
                subscription.id,
                "uncertain",
                provider_status,
                Some(provider_token),
            )
            .await?;
            finish_notification(&mut tx, event_id, "uncertain").await?;
            tx.commit().await?;
            return Ok(PaymentNotificationOutcome::Uncertain);
        }
        if let Some(provider_payment_id) = provider_payment_id {
            let another_subscription = sqlx::query_scalar::<_, Uuid>(
                "SELECT subscription_id FROM account_site_subscription_payments \
                 WHERE provider_payment_id = $1 AND subscription_id <> $2",
            )
            .bind(provider_payment_id)
            .bind(subscription.id)
            .fetch_optional(&mut *tx)
            .await?;
            if another_subscription.is_some() {
                update_subscription_status(
                    &mut tx,
                    subscription.id,
                    "uncertain",
                    provider_status,
                    Some(provider_token),
                )
                .await?;
                finish_notification(&mut tx, event_id, "duplicate_payment").await?;
                tx.commit().await?;
                return Ok(PaymentNotificationOutcome::DuplicatePayment);
            }
        }

        let callback_status = provider_status.to_ascii_uppercase();
        let amount_matches = amount_zar_cents == Some(subscription.monthly_zar_cents);
        let (next_status, payment_status, result) = match callback_status.as_str() {
            "COMPLETE" if amount_matches && provider_payment_id.is_some() => {
                ("active", Some("paid"), "applied")
            }
            "COMPLETE" => ("uncertain", Some("uncertain"), "uncertain"),
            "PENDING" | "DELAYED" => ("delayed", Some("delayed"), "applied"),
            "FAILED" => ("failed", Some("failed"), "applied"),
            "CANCELLED" | "CANCELED" => ("cancelled", Some("cancelled"), "applied"),
            _ => ("uncertain", Some("uncertain"), "uncertain"),
        };
        if let (Some(provider_payment_id), Some(payment_status)) =
            (provider_payment_id, payment_status)
        {
            let persisted_payment_status = sqlx::query_scalar::<_, String>(
                "INSERT INTO account_site_subscription_payments \
                 (provider_payment_id, subscription_id, provider_status, status, amount_zar_cents) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (provider_payment_id) DO UPDATE SET \
                   provider_status = CASE \
                       WHEN account_site_subscription_payments.status = 'paid' \
                            AND EXCLUDED.status <> 'paid' \
                       THEN account_site_subscription_payments.provider_status \
                       ELSE EXCLUDED.provider_status END, \
                   status = CASE \
                       WHEN account_site_subscription_payments.status = 'paid' \
                       THEN 'paid' ELSE EXCLUDED.status END, \
                   amount_zar_cents = CASE \
                       WHEN account_site_subscription_payments.status = 'paid' \
                       THEN account_site_subscription_payments.amount_zar_cents \
                       ELSE EXCLUDED.amount_zar_cents END, \
                   updated_at = now() \
                 WHERE account_site_subscription_payments.subscription_id = EXCLUDED.subscription_id \
                 RETURNING status",
            )
            .bind(provider_payment_id)
            .bind(subscription.id)
            .bind(provider_status)
            .bind(payment_status)
            .bind(amount_zar_cents)
            .fetch_optional(&mut *tx)
            .await?;
            let Some(persisted_payment_status) = persisted_payment_status else {
                update_subscription_status(
                    &mut tx,
                    subscription.id,
                    "uncertain",
                    provider_status,
                    Some(provider_token),
                )
                .await?;
                finish_notification(&mut tx, event_id, "duplicate_payment").await?;
                tx.commit().await?;
                return Ok(PaymentNotificationOutcome::DuplicatePayment);
            };
            if persisted_payment_status == "paid" && matches!(payment_status, "delayed" | "failed")
            {
                finish_notification(&mut tx, event_id, "already_applied").await?;
                tx.commit().await?;
                return Ok(PaymentNotificationOutcome::Applied);
            }
        }
        update_subscription_status(
            &mut tx,
            subscription.id,
            next_status,
            provider_status,
            Some(provider_token),
        )
        .await?;
        if let Some(provider_payment_id) = provider_payment_id {
            sqlx::query(
                "UPDATE account_site_subscriptions SET last_provider_payment_id = $2 \
                 WHERE id = $1",
            )
            .bind(subscription.id)
            .bind(provider_payment_id)
            .execute(&mut *tx)
            .await?;
        }
        finish_notification(&mut tx, event_id, result).await?;
        tx.commit().await?;
        Ok(if next_status == "uncertain" {
            PaymentNotificationOutcome::Uncertain
        } else {
            PaymentNotificationOutcome::Applied
        })
    }
}

async fn subscription_by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    account_id: Uuid,
    idempotency_key: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>> {
    Ok(sqlx::query(
        "SELECT id, account_id, site_id, reference, provider_token, status, \
                monthly_usd_cents, monthly_zar_cents, provider_status, cancel_requested_at, \
                created_at, updated_at FROM account_site_subscriptions \
         WHERE account_id = $1 AND idempotency_key = $2",
    )
    .bind(account_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn update_subscription_status(
    tx: &mut Transaction<'_, Postgres>,
    subscription_id: Uuid,
    status: &str,
    provider_status: &str,
    provider_token: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE account_site_subscriptions SET status = CASE \
             WHEN status = 'cancelled' OR $2 = 'cancelled' THEN 'cancelled' \
             WHEN cancel_requested_at IS NOT NULL AND $2 = 'active' THEN status \
             ELSE $2 END, provider_status = $3, \
         provider_token = COALESCE(provider_token, $4), \
         cancel_requested_at = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancel_requested_at, now()) \
                                    ELSE cancel_requested_at END, \
         updated_at = now() WHERE id = $1",
    )
    .bind(subscription_id)
    .bind(status)
    .bind(provider_status)
    .bind(provider_token)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn finish_notification(
    tx: &mut Transaction<'_, Postgres>,
    event_id: &str,
    result: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE account_payment_notifications SET result = $2, processed_at = now() WHERE event_id = $1",
    )
    .bind(event_id)
    .bind(result)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn update_intent_status(
    tx: &mut Transaction<'_, Postgres>,
    reference: &str,
    status: &str,
    provider_status: &str,
    provider_payment_id: Option<&str>,
    amount_zar_cents: Option<i64>,
) -> Result<()> {
    sqlx::query(
        "UPDATE account_payment_intents SET status = $2, provider_status = $3, \
         provider_payment_id = COALESCE(provider_payment_id, $4), \
         paid_minor_units = CASE WHEN $2 = 'paid' THEN $5 ELSE paid_minor_units END, \
         updated_at = now() WHERE reference = $1",
    )
    .bind(reference)
    .bind(status)
    .bind(provider_status)
    .bind(provider_payment_id)
    .bind(amount_zar_cents)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn validate_notification(
    event_id: &str,
    provider_payment_id: Option<&str>,
    provider_status: &str,
    amount_zar_cents: Option<i64>,
) -> Result<()> {
    if event_id.len() != 64
        || !event_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || provider_status.len() > 64
        || provider_payment_id.is_some_and(|value| {
            value.is_empty() || value.len() > 32 || !value.bytes().all(|byte| byte.is_ascii_digit())
        })
        || amount_zar_cents.is_some_and(|amount| amount < 0)
    {
        return Err(DbError::InvalidData(
            "invalid verified payment notification".to_owned(),
        ));
    }
    Ok(())
}

fn validate_payment_reference(reference: Option<&str>) -> Result<()> {
    if reference.is_some_and(|value| value.is_empty() || value.len() > 200) {
        return Err(DbError::InvalidData(
            "invalid payment notification reference".to_owned(),
        ));
    }
    Ok(())
}

fn ledger_entry_from_row(row: sqlx::postgres::PgRow) -> Result<CreditLedgerEntry> {
    Ok(CreditLedgerEntry {
        id: row.try_get("id")?,
        entry_type: row.try_get("entry_type")?,
        amount_nanousd: row.try_get("amount_nanousd")?,
        source_id: row.try_get("source_id")?,
        reference: row.try_get("reference")?,
        description: row.try_get("description")?,
        metadata: row.try_get("metadata")?,
        created_at: row.try_get("created_at")?,
    })
}

fn payment_intent_from_row(row: sqlx::postgres::PgRow) -> Result<PaymentIntentRecord> {
    Ok(PaymentIntentRecord {
        reference: row.try_get("reference")?,
        account_id: row.try_get("account_id")?,
        idempotency_key: row.try_get("idempotency_key")?,
        pack_id: row.try_get("pack_id")?,
        charge_minor_units: row.try_get("charge_minor_units")?,
        grant_nanousd: row.try_get("grant_nanousd")?,
        status: row.try_get("status")?,
        provider_payment_id: row.try_get("provider_payment_id")?,
        provider_status: row.try_get("provider_status")?,
        paid_minor_units: row.try_get("paid_minor_units")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn site_subscription_from_row(row: sqlx::postgres::PgRow) -> Result<SiteSubscriptionRecord> {
    Ok(SiteSubscriptionRecord {
        id: row.try_get("id")?,
        account_id: row.try_get("account_id")?,
        site_id: row.try_get("site_id")?,
        reference: row.try_get("reference")?,
        provider_token: row.try_get("provider_token")?,
        status: row.try_get("status")?,
        monthly_usd_cents: row.try_get("monthly_usd_cents")?,
        monthly_zar_cents: row.try_get("monthly_zar_cents")?,
        provider_status: row.try_get("provider_status")?,
        cancel_requested_at: row.try_get("cancel_requested_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use sqlx::{postgres::PgPoolOptions, PgPool};

    const CREDIT_GRANT_NANOUSD: i64 = 5_000_000_000;
    const CREDIT_CHARGE_ZAR_CENTS: i64 = 11_900;
    const HOSTING_MONTHLY_ZAR_CENTS: i64 = 18_500;

    fn new_event_id() -> String {
        format!("{:064x}", Uuid::new_v4().as_u128())
    }

    fn new_provider_payment_id() -> String {
        format!("{:032}", Uuid::new_v4().as_u128() % 10_u128.pow(32))
    }

    fn unique_reference(prefix: &str) -> String {
        format!("{prefix}-{}", Uuid::new_v4().simple())
    }

    fn unique_provider_token() -> String {
        format!("pf-{}", Uuid::new_v4().simple())
    }

    async fn setup_db() -> (Db, PgPool) {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&crate::test_support::database_url())
            .await
            .expect("connect to isolated payment test database");
        (Db::from_pool(pool.clone()), pool)
    }

    async fn make_account(pool: &PgPool) -> Uuid {
        let id = Uuid::new_v4();
        let pubkey = format!("{:064x}", id.as_u128());
        sqlx::query(
            "INSERT INTO accounts \
             (id, email, pubkey, wrapped_dek, kek_id, sealed_nsec, nonce) \
             VALUES ($1, $2, $3, $4, 'test-kek', $5, $6)",
        )
        .bind(id)
        .bind(format!("payment-test-{}@example.invalid", id.simple()))
        .bind(pubkey)
        .bind(vec![1_u8; 28])
        .bind(vec![2_u8; 16])
        .bind(vec![3_u8; 12])
        .execute(pool)
        .await
        .expect("insert payment test account");
        id
    }

    async fn make_credit_intent(db: &Db, account_id: Uuid) -> PaymentIntentRecord {
        let reference = format!("credit-test-{}", Uuid::new_v4().simple());
        match db
            .create_account_payment_intent(
                account_id,
                &reference,
                Uuid::new_v4(),
                "starter",
                CREDIT_CHARGE_ZAR_CENTS,
                CREDIT_GRANT_NANOUSD,
            )
            .await
            .expect("create payment intent")
        {
            CreatePaymentIntentOutcome::Created(intent) => intent,
            CreatePaymentIntentOutcome::Existing(_) | CreatePaymentIntentOutcome::OpenIntent(_) => {
                panic!("new test account unexpectedly has an existing intent")
            }
        }
    }

    async fn make_site_subscription(
        db: &Db,
        account_id: Uuid,
        site_id: &str,
        reference: &str,
        idempotency_key: Uuid,
    ) -> SiteSubscriptionRecord {
        match db
            .create_account_site_subscription(
                account_id,
                site_id,
                reference,
                idempotency_key,
                HOSTING_MONTHLY_ZAR_CENTS,
            )
            .await
            .expect("create site subscription")
        {
            CreateSiteSubscriptionOutcome::Created(subscription) => subscription,
            CreateSiteSubscriptionOutcome::Existing(_)
            | CreateSiteSubscriptionOutcome::Current(_) => {
                panic!("new test site unexpectedly has a current subscription")
            }
        }
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn desired_state_payment_tables_are_present_and_operator_global() {
        let (_db, pool) = setup_db().await;
        let names = [
            "account_credit_ledger",
            "account_payment_intents",
            "account_site_subscriptions",
            "account_site_subscription_payments",
            "account_payment_notifications",
        ];
        for name in names {
            let table_exists = sqlx::query_scalar::<_, bool>(
                "SELECT to_regclass(format('%I.%I', current_schema(), $1)) IS NOT NULL",
            )
            .bind(name)
            .fetch_one(&pool)
            .await
            .expect("check payment table in live catalog");
            let registered = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM _operator_global_tables WHERE table_name = $1)",
            )
            .bind(name)
            .fetch_one(&pool)
            .await
            .expect("check payment table global registration");
            assert!(table_exists, "desired-state table {name} is missing");
            assert!(
                registered,
                "desired-state table {name} is not operator-global"
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn same_itn_event_replay_is_rejected_before_reapplying_payment_state() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let intent = make_credit_intent(&db, account_id).await;
        let event_id = new_event_id();
        let provider_payment_id = new_provider_payment_id();

        assert_eq!(
            db.apply_account_payment_notification(
                &event_id,
                Some(&intent.reference),
                Some(&provider_payment_id),
                "PENDING",
                Some(CREDIT_CHARGE_ZAR_CENTS),
            )
            .await
            .expect("apply first notification"),
            PaymentNotificationOutcome::Applied
        );
        assert_eq!(
            db.apply_account_payment_notification(
                &event_id,
                Some(&intent.reference),
                Some(&provider_payment_id),
                "PENDING",
                Some(CREDIT_CHARGE_ZAR_CENTS),
            )
            .await
            .expect("replay notification"),
            PaymentNotificationOutcome::Duplicate
        );
        assert_eq!(
            db.account_payment_intent(account_id, &intent.reference)
                .await
                .expect("read intent")
                .expect("intent remains present")
                .status,
            "delayed"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM account_payment_notifications WHERE event_id = $1",
            )
            .bind(event_id)
            .fetch_one(&pool)
            .await
            .expect("count replay journal rows"),
            1
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn distinct_callbacks_for_one_provider_payment_credit_once() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let intent = make_credit_intent(&db, account_id).await;
        let provider_payment_id = new_provider_payment_id();
        let pending_event_id = new_event_id();
        let complete_event_id = new_event_id();
        let duplicate_event_id = new_event_id();

        assert_eq!(
            db.apply_account_payment_notification(
                &pending_event_id,
                Some(&intent.reference),
                Some(&provider_payment_id),
                "PENDING",
                Some(CREDIT_CHARGE_ZAR_CENTS),
            )
            .await
            .expect("apply pending callback"),
            PaymentNotificationOutcome::Applied
        );
        assert_eq!(
            db.apply_account_payment_notification(
                &complete_event_id,
                Some(&intent.reference),
                Some(&provider_payment_id),
                "COMPLETE",
                Some(CREDIT_CHARGE_ZAR_CENTS),
            )
            .await
            .expect("apply completed callback"),
            PaymentNotificationOutcome::Applied
        );
        assert_eq!(
            db.account_credit_balance(account_id)
                .await
                .expect("read account balance"),
            CREDIT_GRANT_NANOUSD
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM account_credit_ledger WHERE account_id = $1 AND source_id = $2",
            )
            .bind(account_id)
            .bind(format!("payfast:{provider_payment_id}"))
            .fetch_one(&pool)
            .await
            .expect("count ledger entries for provider payment"),
            1
        );
        assert_eq!(
            db.apply_account_payment_notification(
                &duplicate_event_id,
                Some(&intent.reference),
                Some(&provider_payment_id),
                "COMPLETE",
                Some(CREDIT_CHARGE_ZAR_CENTS),
            )
            .await
            .expect("apply repeated complete callback"),
            PaymentNotificationOutcome::Duplicate
        );
        assert_eq!(
            db.account_credit_balance(account_id)
                .await
                .expect("read final account balance"),
            CREDIT_GRANT_NANOUSD
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn credit_balance_history_and_intents_are_account_scoped() {
        let (db, pool) = setup_db().await;
        let owner = make_account(&pool).await;
        let other = make_account(&pool).await;
        let intent = make_credit_intent(&db, owner).await;
        let event_id = new_event_id();
        let provider_payment_id = new_provider_payment_id();
        db.apply_account_payment_notification(
            &event_id,
            Some(&intent.reference),
            Some(&provider_payment_id),
            "COMPLETE",
            Some(CREDIT_CHARGE_ZAR_CENTS),
        )
        .await
        .expect("settle owner's payment");

        assert_eq!(
            db.account_credit_balance(owner)
                .await
                .expect("read owner balance"),
            CREDIT_GRANT_NANOUSD
        );
        assert_eq!(
            db.account_credit_balance(other)
                .await
                .expect("read other account balance"),
            0
        );
        assert_eq!(
            db.account_credit_history(other, 20)
                .await
                .expect("read other account history")
                .len(),
            0
        );
        assert!(db
            .account_payment_intent(other, &intent.reference)
            .await
            .expect("read other account intent")
            .is_none());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn amount_mismatch_never_adds_a_credit_ledger_entry() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let intent = make_credit_intent(&db, account_id).await;
        let event_id = new_event_id();
        let provider_payment_id = new_provider_payment_id();

        assert_eq!(
            db.apply_account_payment_notification(
                &event_id,
                Some(&intent.reference),
                Some(&provider_payment_id),
                "COMPLETE",
                Some(CREDIT_CHARGE_ZAR_CENTS - 1),
            )
            .await
            .expect("journal mismatched amount"),
            PaymentNotificationOutcome::Uncertain
        );
        assert_eq!(
            db.account_credit_balance(account_id)
                .await
                .expect("read account balance"),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM account_credit_ledger WHERE account_id = $1",
            )
            .bind(account_id)
            .fetch_one(&pool)
            .await
            .expect("count account credit ledger entries"),
            0
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn idempotent_subscription_retry_returns_the_original_reference() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let idempotency_key = Uuid::new_v4();
        let original_reference = unique_reference("site-sub-original");
        let retry_reference = unique_reference("site-sub-retry");
        let original = make_site_subscription(
            &db,
            account_id,
            "site-retry",
            &original_reference,
            idempotency_key,
        )
        .await;

        let retry = db
            .create_account_site_subscription(
                account_id,
                "site-retry",
                &retry_reference,
                idempotency_key,
                HOSTING_MONTHLY_ZAR_CENTS,
            )
            .await
            .expect("retry with original idempotency key");
        let CreateSiteSubscriptionOutcome::Existing(recovered) = retry else {
            panic!("same idempotency key must recover its existing subscription")
        };

        assert_eq!(recovered.id, original.id);
        assert_eq!(recovered.reference, original_reference);
        assert_eq!(recovered.status, "pending");
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM account_site_subscriptions WHERE account_id = $1 AND site_id = $2",
            )
            .bind(account_id)
            .bind("site-retry")
            .fetch_one(&pool)
            .await
            .expect("count site subscription rows"),
            1
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn stale_pending_and_failed_callbacks_cannot_regress_a_paid_subscription() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let reference = unique_reference("site-sub-stale-paid-ordering");
        let provider_token = unique_provider_token();
        let provider_payment_id = new_provider_payment_id();
        let active =
            make_site_subscription(&db, account_id, "site-active", &reference, Uuid::new_v4())
                .await;
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&active.reference),
            &provider_token,
            Some(&provider_payment_id),
            "PENDING",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("apply delayed pending callback for an already paid payment");
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&active.reference),
            &provider_token,
            Some(&provider_payment_id),
            "COMPLETE",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("activate subscription");
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&active.reference),
            &provider_token,
            Some(&provider_payment_id),
            "FAILED",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("apply delayed failure callback for an already paid payment");
        let active_after_stale = db
            .account_site_subscription(account_id, active.id)
            .await
            .expect("read active subscription")
            .expect("active subscription remains present");
        assert_eq!(active_after_stale.status, "active");
        let payment_status = sqlx::query_scalar::<_, String>(
            "SELECT status FROM account_site_subscription_payments WHERE provider_payment_id = $1",
        )
        .bind(provider_payment_id)
        .fetch_one(&pool)
        .await
        .expect("read provider payment status");
        assert_eq!(payment_status, "paid");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn failed_recurring_payment_marks_active_subscription_failed() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let reference = unique_reference("site-sub-renewal-failed");
        let provider_token = unique_provider_token();
        let initial_payment_id = new_provider_payment_id();
        let renewal_payment_id = new_provider_payment_id();
        let subscription = make_site_subscription(
            &db,
            account_id,
            "site-renewal-failed",
            &reference,
            Uuid::new_v4(),
        )
        .await;

        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&subscription.reference),
            &provider_token,
            Some(&initial_payment_id),
            "COMPLETE",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("activate subscription with first payment");
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&subscription.reference),
            &provider_token,
            Some(&renewal_payment_id),
            "FAILED",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("apply failed renewal payment");

        let failed = db
            .account_site_subscription(account_id, subscription.id)
            .await
            .expect("read subscription after renewal failure")
            .expect("subscription remains present");
        assert_eq!(failed.status, "failed");
        let payment_status = sqlx::query_scalar::<_, String>(
            "SELECT status FROM account_site_subscription_payments WHERE provider_payment_id = $1",
        )
        .bind(renewal_payment_id)
        .fetch_one(&pool)
        .await
        .expect("read renewal payment status");
        assert_eq!(payment_status, "failed");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cancellation_request_fences_late_subscription_activation() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let reference = unique_reference("site-sub-cancellation-race");
        let provider_token = unique_provider_token();
        let failed_payment_id = new_provider_payment_id();
        let completion_payment_id = new_provider_payment_id();
        let cancellation_race = make_site_subscription(
            &db,
            account_id,
            "site-cancellation-race",
            &reference,
            Uuid::new_v4(),
        )
        .await;
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&cancellation_race.reference),
            &provider_token,
            Some(&failed_payment_id),
            "FAILED",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("record a subscription with a recoverable failed payment");
        db.request_account_site_subscription_cancel(account_id, cancellation_race.id)
            .await
            .expect("persist cancellation request")
            .expect("failed subscription accepts cancellation request");
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&cancellation_race.reference),
            &provider_token,
            Some(&completion_payment_id),
            "COMPLETE",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("apply completion racing with cancellation");
        let requested = db
            .account_site_subscription(account_id, cancellation_race.id)
            .await
            .expect("read cancellation-racing subscription")
            .expect("subscription remains present");
        assert_eq!(requested.status, "failed");
        assert!(requested.cancel_requested_at.is_some());
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cancelled_subscription_cannot_be_reactivated_by_a_late_complete_callback() {
        let (db, pool) = setup_db().await;
        let account_id = make_account(&pool).await;
        let reference = unique_reference("site-sub-cancelled-terminal");
        let provider_token = unique_provider_token();
        let initial_payment_id = new_provider_payment_id();
        let late_payment_id = new_provider_payment_id();
        let subscription = make_site_subscription(
            &db,
            account_id,
            "site-cancelled-terminal",
            &reference,
            Uuid::new_v4(),
        )
        .await;
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&subscription.reference),
            &provider_token,
            Some(&initial_payment_id),
            "COMPLETE",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("activate subscription before cancellation");
        db.request_account_site_subscription_cancel(account_id, subscription.id)
            .await
            .expect("persist cancellation request")
            .expect("active subscription accepts cancellation request");
        assert!(db
            .complete_account_site_subscription_cancel(account_id, subscription.id, "CANCELLED",)
            .await
            .expect("complete provider cancellation"));
        db.apply_account_site_subscription_notification(
            &new_event_id(),
            Some(&subscription.reference),
            &provider_token,
            Some(&late_payment_id),
            "COMPLETE",
            Some(HOSTING_MONTHLY_ZAR_CENTS),
        )
        .await
        .expect("apply completion after cancellation");
        let cancelled = db
            .account_site_subscription(account_id, subscription.id)
            .await
            .expect("read cancelled subscription")
            .expect("cancelled subscription remains present");
        assert_eq!(cancelled.status, "cancelled");
    }
}
