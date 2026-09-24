//! Deployment-global account credits and PayFast subscriptions.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use buzz_db::payments::{
    CreatePaymentIntentOutcome, CreateSiteSubscriptionOutcome, PaymentIntentRecord,
    SiteSubscriptionRecord,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::credit_packs::{self, Currency};
use crate::payfast::{PayFast, PayFastCredentials};
use crate::payments_provider::{
    nano_usd_from_cents, CheckoutAuthorization, PaymentProvider, ProviderError, ProviderEvent,
    ReconciledPayment, NANO_USD_PER_CENT,
};
use crate::state::AppState;
use buzz_db::accounts::AccountRecord;

use super::{accounts::normalize_email, api_error, bridge};

const PAYMENT_BODY_LIMIT: usize = 16 * 1024;
const MAX_PAYFAST_EMAIL_BYTES: usize = 100;
const MAX_REFERENCE_BYTES: usize = 200;

/// Build the account payment routes.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/packs", get(packs))
        .route("/balance", get(balance))
        .route("/usage", get(usage))
        .route("/history", get(history))
        .route("/checkout", post(checkout))
        .route("/intents/{reference}", get(read_intent))
        .route(
            "/site-subscriptions",
            get(site_subscriptions).post(create_site_subscription),
        )
        .route("/site-subscriptions/{id}", get(read_site_subscription))
        .route(
            "/site-subscriptions/{id}/cancel",
            post(cancel_site_subscription),
        )
        .route("/webhook/payfast", post(payfast_webhook))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            PAYMENT_BODY_LIMIT,
        ))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutRequest {
    pack_id: String,
    idempotency_key: Uuid,
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SiteSubscriptionRequest {
    site_id: String,
    idempotency_key: Uuid,
}

fn configured_payfast(state: &AppState) -> Result<PayFast, (StatusCode, Json<Value>)> {
    let config = &state.config.payments;
    if !config.enabled() {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "payment_unavailable",
        ));
    }
    let (Some(merchant_id), Some(merchant_key), Some(passphrase)) = (
        config.merchant_id(),
        config.merchant_key(),
        config.passphrase(),
    ) else {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "payment_unavailable",
        ));
    };
    let credentials = PayFastCredentials {
        merchant_id: Zeroizing::new(merchant_id.to_owned()),
        merchant_key: Zeroizing::new(merchant_key.to_owned()),
        passphrase: Zeroizing::new(passphrase.to_owned()),
        sandbox: config.sandbox(),
    };
    PayFast::new(credentials).map_err(|error| {
        tracing::error!(error = %error, "PayFast client initialization failed");
        api_error(StatusCode::SERVICE_UNAVAILABLE, "payment_unavailable")
    })
}

async fn authenticate_account(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<AccountRecord, (StatusCode, Json<Value>)> {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "not_found"))?;
    let url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, path);
    let auth =
        bridge::verify_bridge_auth_with_options(headers, method, &url, body, true, body.is_some())?;
    bridge::check_nip98_replay(state, &tenant, auth.event_id_bytes).await?;
    state
        .db
        .account_by_pubkey(&auth.pubkey.to_hex())
        .await
        .map_err(|error| map_db_error("account lookup", error))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "account_not_found"))
}

fn ensure_verified_account(account: &AccountRecord) -> Result<(), (StatusCode, Json<Value>)> {
    if account.email_verified_at.is_none() {
        return Err(api_error(StatusCode::FORBIDDEN, "email_unverified"));
    }
    Ok(())
}

fn map_db_error(operation: &'static str, error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    tracing::error!(operation, error = %error, "account payments database operation failed");
    api_error(StatusCode::INTERNAL_SERVER_ERROR, "payment_unavailable")
}

/// Public server-priced pack list.
async fn packs(State(state): State<Arc<AppState>>) -> Json<Value> {
    let packs: Vec<Value> = credit_packs::CREDIT_PACKS
        .iter()
        .map(|pack| {
            json!({
                "id": pack.id,
                "name": pack.name,
                "chargeMinorUnits": pack.zar_cents,
                "chargeCurrency": Currency::Zar.code(),
                "grantNanousd": pack.grant_nanousd.to_string(),
                "grantUsdCents": pack.grant_nanousd / NANO_USD_PER_CENT,
            })
        })
        .collect();
    Json(json!({
        "provider": "payfast",
        "currency": "ZAR",
        "sandbox": state.config.payments.sandbox(),
        "enabled": state.config.payments.enabled(),
        "packs": packs,
    }))
}

/// Deployment-global account balance from confirmed ledger entries only.
async fn balance(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let account =
        authenticate_account(&state, &headers, "GET", "/api/payments/balance", None).await?;
    let balance = state
        .db
        .account_credit_balance(account.id)
        .await
        .map_err(|error| map_db_error("balance", error))?;
    Ok(Json(json!({
        "balanceNanousd": balance.to_string(),
        "balanceUsdCents": balance / NANO_USD_PER_CENT,
        "currency": "USD",
        "source": "account_credit_ledger",
    })))
}

/// Monthly account usage from server-confirmed credit debits.
async fn usage(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let account =
        authenticate_account(&state, &headers, "GET", "/api/payments/usage", None).await?;
    let months = state
        .db
        .account_credit_usage(account.id)
        .await
        .map_err(|error| map_db_error("usage", error))?;
    let entries: Vec<Value> = months
        .iter()
        .map(|month| {
            json!({
                "month": month.month,
                "spentNanousd": month.spent_nanousd.to_string(),
                "spentUsdCents": month.spent_nanousd / NANO_USD_PER_CENT,
                "entryCount": month.entry_count,
            })
        })
        .collect();
    let current_month = entries
        .first()
        .cloned()
        .unwrap_or_else(|| json!({ "spentNanousd": "0", "spentUsdCents": 0, "entryCount": 0 }));
    Ok(Json(json!({
        "source": "server_credit_ledger",
        "period": "monthly_utc",
        "currentMonth": current_month,
        "months": entries,
    })))
}

/// Credit ledger and checkout-intent history for the signed-in account.
async fn history(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let account =
        authenticate_account(&state, &headers, "GET", "/api/payments/history", None).await?;
    let ledger = state
        .db
        .account_credit_history(account.id, 100)
        .await
        .map_err(|error| map_db_error("history", error))?;
    let intents = state
        .db
        .account_payment_intent_history(account.id, 100)
        .await
        .map_err(|error| map_db_error("intent history", error))?;
    let subscriptions = state
        .db
        .account_site_subscription_history(account.id, 100)
        .await
        .map_err(|error| map_db_error("subscription history", error))?;
    Ok(Json(json!({
        "ledger": ledger.iter().map(ledger_entry_json).collect::<Vec<_>>(),
        "paymentIntents": intents.iter().map(payment_intent_json).collect::<Vec<_>>(),
        "siteSubscriptions": subscriptions.iter().map(site_subscription_json).collect::<Vec<_>>(),
    })))
}

/// Create or safely recover one server-priced PayFast credit checkout.
async fn checkout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let account = authenticate_account(
        &state,
        &headers,
        "POST",
        "/api/payments/checkout",
        Some(&body),
    )
    .await?;
    ensure_verified_account(&account)?;
    let request: CheckoutRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_request"))?;
    let Some(pack) = credit_packs::find_pack(&request.pack_id) else {
        return Err(api_error(StatusCode::BAD_REQUEST, "unknown_pack"));
    };
    let account_email = normalize_email(&account.email)
        .ok_or_else(|| api_error(StatusCode::INTERNAL_SERVER_ERROR, "payment_unavailable"))?;
    if account_email.len() > MAX_PAYFAST_EMAIL_BYTES {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_email"));
    }
    if let Some(email) = request.email.as_deref() {
        if email.len() > MAX_PAYFAST_EMAIL_BYTES
            || normalize_email(email).as_deref() != Some(account_email.as_str())
            || !email.contains('@')
        {
            return Err(api_error(StatusCode::BAD_REQUEST, "invalid_email"));
        }
    }
    let provider = configured_payfast(&state)?;
    let charge_minor_units = pack.price_in(provider.currency());
    let grant_nanousd = nano_usd_from_cents(pack.grant_nanousd / NANO_USD_PER_CENT)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "unknown_pack"))?;
    if grant_nanousd != pack.grant_nanousd {
        return Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "payment_unavailable",
        ));
    }
    let reference = format!("credit-{}", Uuid::new_v4());
    let intent_outcome = state
        .db
        .create_account_payment_intent(
            account.id,
            &reference,
            request.idempotency_key,
            pack.id,
            charge_minor_units,
            grant_nanousd,
        )
        .await
        .map_err(|error| map_payment_create_error(error))?;

    match intent_outcome {
        CreatePaymentIntentOutcome::Created(intent) => {
            resolve_credit_intent(&state, &provider, &account, intent).await
        }
        CreatePaymentIntentOutcome::Existing(intent) => {
            reconcile_open_intent(&state, &provider, &intent).await?;
            let latest = state
                .db
                .account_payment_intent(account.id, &intent.reference)
                .await
                .map_err(|error| map_db_error("idempotent intent lookup", error))?
                .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "unknown_reference"))?;
            match latest.status.as_str() {
                "paid" => Ok(Json(intent_response(
                    &latest,
                    None,
                    &latest.idempotency_key,
                    state.config.payments.sandbox(),
                ))),
                "pending" | "delayed" | "uncertain" => Err(open_intent_error(&latest)),
                _ => Err(closed_intent_error(&latest)),
            }
        }
        CreatePaymentIntentOutcome::OpenIntent(intent) => {
            reconcile_open_intent(&state, &provider, &intent).await?;
            let latest = state
                .db
                .account_payment_intent(account.id, &intent.reference)
                .await
                .map_err(|error| map_db_error("reconciled intent lookup", error))?
                .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "unknown_reference"))?;
            match latest.status.as_str() {
                "failed" | "cancelled" => {
                    let created_reference = format!("credit-{}", Uuid::new_v4());
                    let retry = state
                        .db
                        .create_account_payment_intent(
                            account.id,
                            &created_reference,
                            request.idempotency_key,
                            pack.id,
                            charge_minor_units,
                            grant_nanousd,
                        )
                        .await
                        .map_err(map_payment_create_error)?;
                    match retry {
                        CreatePaymentIntentOutcome::Created(new_intent) => {
                            resolve_credit_intent(&state, &provider, &account, new_intent).await
                        }
                        CreatePaymentIntentOutcome::Existing(existing) => {
                            Err(open_intent_error(&existing))
                        }
                        CreatePaymentIntentOutcome::OpenIntent(still_open) => {
                            Err(open_intent_error(&still_open))
                        }
                    }
                }
                "paid" => Ok(Json(intent_response(
                    &latest,
                    None,
                    &latest.idempotency_key,
                    state.config.payments.sandbox(),
                ))),
                _ => Err(open_intent_error(&latest)),
            }
        }
    }
}

fn map_payment_create_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    if matches!(error, buzz_db::DbError::NotFound(_)) {
        api_error(StatusCode::NOT_FOUND, "account_not_found")
    } else if matches!(error, buzz_db::DbError::InvalidData(_)) {
        api_error(StatusCode::CONFLICT, "idempotency_conflict")
    } else {
        map_db_error("create intent", error)
    }
}

fn open_intent_error(intent: &PaymentIntentRecord) -> (StatusCode, Json<Value>) {
    let error = if intent.status == "uncertain" {
        "payment_uncertain"
    } else {
        "payment_pending"
    };
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": error,
            "reference": intent.reference,
            "status": intent.status,
            "providerPaymentId": intent.provider_payment_id,
        })),
    )
}

fn closed_intent_error(intent: &PaymentIntentRecord) -> (StatusCode, Json<Value>) {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": "checkout_closed",
            "reference": intent.reference,
            "status": intent.status,
            "idempotencyKey": intent.idempotency_key,
        })),
    )
}

async fn resolve_credit_intent(
    state: &AppState,
    provider: &PayFast,
    account: &AccountRecord,
    intent: PaymentIntentRecord,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if intent.status == "paid" {
        return Ok(Json(intent_response(
            &intent,
            None,
            &intent.idempotency_key,
            state.config.payments.sandbox(),
        )));
    }
    if intent.status != "pending" {
        return Err(api_error(StatusCode::CONFLICT, "checkout_closed"));
    }
    let notify_url = state
        .config
        .payments
        .notify_url()
        .ok_or_else(|| api_error(StatusCode::SERVICE_UNAVAILABLE, "payment_unavailable"))?;
    let email = normalize_email(&account.email)
        .ok_or_else(|| api_error(StatusCode::INTERNAL_SERVER_ERROR, "payment_unavailable"))?;
    let checkout_url = provider
        .initialize(
            intent.charge_minor_units,
            &email,
            &intent.reference,
            notify_url,
        )
        .await
        .map_err(|error| provider_error(error, "checkout"))?;
    Ok(Json(intent_response(
        &intent,
        Some(checkout_url),
        &intent.idempotency_key,
        state.config.payments.sandbox(),
    )))
}

async fn reconcile_open_intent(
    state: &AppState,
    provider: &PayFast,
    intent: &PaymentIntentRecord,
) -> Result<(), (StatusCode, Json<Value>)> {
    if !matches!(intent.status.as_str(), "pending" | "delayed" | "uncertain") {
        return Ok(());
    }
    let Some(provider_payment_id) = intent.provider_payment_id.as_deref() else {
        return Ok(());
    };
    let reconciled = provider
        .reconcile_payment(provider_payment_id)
        .await
        .map_err(|error| provider_error(error, "reconciliation"))?;
    apply_reconciliation(state, intent, &reconciled).await
}

async fn apply_reconciliation(
    state: &AppState,
    intent: &PaymentIntentRecord,
    reconciled: &ReconciledPayment,
) -> Result<(), (StatusCode, Json<Value>)> {
    let expected_reference_matches = reconciled.reference == intent.reference;
    let status = if expected_reference_matches {
        reconciled.status.as_str()
    } else {
        "RECONCILIATION_REFERENCE_MISMATCH"
    };
    let event_data = json!({
        "reference": intent.reference,
        "providerReference": reconciled.reference,
        "providerPaymentId": reconciled.provider_payment_id,
        "status": status,
        "amountMinorUnits": reconciled.amount_minor_units,
    });
    let serialized_event = serde_json::to_vec(&event_data).map_err(|error| {
        tracing::error!(error = %error, "could not encode PayFast reconciliation result");
        api_error(StatusCode::INTERNAL_SERVER_ERROR, "payment_unavailable")
    })?;
    let event_id = hex::encode(Sha256::digest(serialized_event));
    state
        .db
        .apply_account_payment_notification(
            &event_id,
            Some(&intent.reference),
            Some(&reconciled.provider_payment_id),
            status,
            reconciled.amount_minor_units,
        )
        .await
        .map_err(|error| map_db_error("apply reconciled payment", error))?;
    Ok(())
}

fn intent_response(
    intent: &PaymentIntentRecord,
    authorization: Option<CheckoutAuthorization>,
    idempotency_key: &Uuid,
    sandbox: bool,
) -> Value {
    let (authorization_url, authorization_method, authorization_fields) =
        authorization_response(authorization);
    json!({
        "authorizationUrl": authorization_url,
        "authorizationMethod": authorization_method,
        "authorizationFields": authorization_fields,
        "reference": intent.reference,
        "status": intent.status,
        "idempotencyKey": idempotency_key,
        "amountMinorUnits": intent.charge_minor_units,
        "currency": "ZAR",
        "grantNanousd": intent.grant_nanousd.to_string(),
        "grantUsdCents": intent.grant_nanousd / NANO_USD_PER_CENT,
        "sandbox": sandbox,
    })
}

fn authorization_response(
    authorization: Option<CheckoutAuthorization>,
) -> (Option<String>, Option<&'static str>, Vec<Value>) {
    match authorization {
        Some(authorization) => (
            Some(authorization.url),
            Some("POST"),
            authorization
                .fields
                .into_iter()
                .map(|(name, value)| json!({ "name": name, "value": value }))
                .collect(),
        ),
        None => (None, None, Vec::new()),
    }
}

/// Read one account-owned payment intent.
async fn read_intent(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(reference): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/payments/intents/{reference}");
    let account = authenticate_account(&state, &headers, "GET", &path, None).await?;
    if reference.is_empty() || reference.len() > MAX_REFERENCE_BYTES {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_request"));
    }
    let intent = state
        .db
        .account_payment_intent(account.id, &reference)
        .await
        .map_err(|error| map_db_error("read intent", error))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "unknown_reference"))?;
    Ok(Json(payment_intent_json(&intent)))
}

/// Authenticated PayFast instant transaction notification.
async fn payfast_webhook(
    State(state): State<Arc<AppState>>,
    ConnectInfo(source): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let provider = match configured_payfast(&state) {
        Ok(provider) => provider,
        Err((status, body)) => return (status, body).into_response(),
    };
    let source_ip: Option<IpAddr> = Some(source.ip());
    let event = match provider.verify_callback(&body, &headers, source_ip).await {
        Ok(event) => event,
        Err(error) => return provider_error(error, "ITN verification").into_response(),
    };
    let event_id = hex::encode(Sha256::digest(&body));
    let result = match event {
        ProviderEvent::Ignored => return StatusCode::OK.into_response(),
        ProviderEvent::Payment {
            reference,
            provider_payment_id,
            provider_status,
            amount_minor_units,
        } => {
            state
                .db
                .apply_account_payment_notification(
                    &event_id,
                    Some(&reference),
                    provider_payment_id.as_deref(),
                    &provider_status,
                    amount_minor_units,
                )
                .await
        }
        ProviderEvent::Subscription {
            reference,
            token,
            provider_payment_id,
            provider_status,
            amount_minor_units,
        } => {
            state
                .db
                .apply_account_site_subscription_notification(
                    &event_id,
                    reference.as_deref(),
                    &token,
                    provider_payment_id.as_deref(),
                    &provider_status,
                    amount_minor_units,
                )
                .await
        }
    };
    match result {
        Ok(_) => StatusCode::OK.into_response(),
        Err(error) => {
            tracing::error!(error = %error, "PayFast ITN persistence failed");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

fn provider_error(error: ProviderError, operation: &'static str) -> (StatusCode, Json<Value>) {
    match error {
        ProviderError::RejectedCallback(_) => {
            api_error(StatusCode::BAD_REQUEST, "invalid_notification")
        }
        _ => {
            tracing::warn!(operation, "PayFast operation failed");
            api_error(StatusCode::SERVICE_UNAVAILABLE, "payment_unavailable")
        }
    }
}

/// Read site subscription rows for this account.
async fn site_subscriptions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let account = authenticate_account(
        &state,
        &headers,
        "GET",
        "/api/payments/site-subscriptions",
        None,
    )
    .await?;
    let subscriptions = state
        .db
        .account_site_subscription_history(account.id, 100)
        .await
        .map_err(|error| map_db_error("site subscription list", error))?;
    Ok(Json(json!({
        "monthlyUsdCents": 1000,
        "monthlyZarCents": state.config.payments.hosting_monthly_zar_cents(),
        "subscriptions": subscriptions.iter().map(site_subscription_json).collect::<Vec<_>>(),
    })))
}

/// Create a monthly PayFast website hosting subscription checkout.
async fn create_site_subscription(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let account = authenticate_account(
        &state,
        &headers,
        "POST",
        "/api/payments/site-subscriptions",
        Some(&body),
    )
    .await?;
    ensure_verified_account(&account)?;
    let request: SiteSubscriptionRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_request"))?;
    validate_site_id(&request.site_id)?;
    let email = normalize_email(&account.email)
        .ok_or_else(|| api_error(StatusCode::INTERNAL_SERVER_ERROR, "payment_unavailable"))?;
    if email.len() > MAX_PAYFAST_EMAIL_BYTES {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_email"));
    }
    let monthly_zar_cents = state
        .config
        .payments
        .hosting_monthly_zar_cents()
        .ok_or_else(|| api_error(StatusCode::SERVICE_UNAVAILABLE, "subscription_unavailable"))?;
    let provider = configured_payfast(&state)?;
    let reference = format!("site-sub-{}", Uuid::new_v4());
    let outcome = state
        .db
        .create_account_site_subscription(
            account.id,
            &request.site_id,
            &reference,
            request.idempotency_key,
            monthly_zar_cents,
        )
        .await
        .map_err(|error| map_payment_create_error(error))?;
    match outcome {
        CreateSiteSubscriptionOutcome::Created(subscription) => {
            subscription_response(&state, &provider, &account, subscription).await
        }
        CreateSiteSubscriptionOutcome::Existing(existing)
        | CreateSiteSubscriptionOutcome::Current(existing) => {
            Err(site_subscription_conflict(&existing))
        }
    }
}

fn site_subscription_conflict(subscription: &SiteSubscriptionRecord) -> (StatusCode, Json<Value>) {
    let error = match subscription.status.as_str() {
        "active" => "subscription_exists",
        "failed" => "subscription_payment_failed",
        "cancelled" => "subscription_cancelled",
        _ => "subscription_pending",
    };
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": error,
            "subscriptionId": subscription.id,
            "reference": subscription.reference,
            "status": subscription.status,
        })),
    )
}

fn validate_site_id(site_id: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if site_id.is_empty() || site_id.len() > 128 || site_id.chars().any(char::is_control) {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_request"));
    }
    Ok(())
}

async fn subscription_response(
    state: &AppState,
    provider: &PayFast,
    account: &AccountRecord,
    subscription: SiteSubscriptionRecord,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let email = normalize_email(&account.email)
        .ok_or_else(|| api_error(StatusCode::INTERNAL_SERVER_ERROR, "payment_unavailable"))?;
    if email.len() > MAX_PAYFAST_EMAIL_BYTES {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_email"));
    }
    let authorization = if subscription.status == "pending" {
        let notify_url = state
            .config
            .payments
            .notify_url()
            .ok_or_else(|| api_error(StatusCode::SERVICE_UNAVAILABLE, "payment_unavailable"))?;
        Some(
            provider
                .subscription_checkout_url(
                    subscription.monthly_zar_cents,
                    &email,
                    &subscription.reference,
                    notify_url,
                )
                .map_err(|error| provider_error(error, "subscription checkout"))?,
        )
    } else {
        None
    };
    let (authorization_url, authorization_method, authorization_fields) =
        authorization_response(authorization);
    Ok(Json(json!({
        "authorizationUrl": authorization_url,
        "authorizationMethod": authorization_method,
        "authorizationFields": authorization_fields,
        "subscription": site_subscription_json(&subscription),
        "monthlyUsdCents": 1000,
        "monthlyZarCents": subscription.monthly_zar_cents,
        "sandbox": state.config.payments.sandbox(),
    })))
}

/// Read one account-owned site subscription.
async fn read_site_subscription(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/payments/site-subscriptions/{id}");
    let account = authenticate_account(&state, &headers, "GET", &path, None).await?;
    let id =
        Uuid::parse_str(&id).map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_request"))?;
    let subscription = state
        .db
        .account_site_subscription(account.id, id)
        .await
        .map_err(|error| map_db_error("site subscription read", error))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "subscription_not_found"))?;
    Ok(Json(site_subscription_json(&subscription)))
}

/// Cancel one account-owned PayFast subscription after recording the request.
async fn cancel_site_subscription(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/api/payments/site-subscriptions/{id}/cancel");
    let account = authenticate_account(&state, &headers, "POST", &path, Some(&body)).await?;
    let _: Value = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_request"))?;
    let id =
        Uuid::parse_str(&id).map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_request"))?;
    let current = state
        .db
        .account_site_subscription(account.id, id)
        .await
        .map_err(|error| map_db_error("site subscription read", error))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "subscription_not_found"))?;
    if current.status == "cancelled" {
        return Ok(Json(json!({ "status": "cancelled", "subscriptionId": id })));
    }
    let request = state
        .db
        .request_account_site_subscription_cancel(account.id, id)
        .await
        .map_err(|error| map_db_error("persist cancellation request", error))?
        .ok_or_else(|| api_error(StatusCode::CONFLICT, "subscription_pending"))?;
    let token = request
        .provider_token
        .as_deref()
        .ok_or_else(|| api_error(StatusCode::CONFLICT, "subscription_pending"))?;
    let provider = configured_payfast(&state)?;
    let cancelled = provider
        .cancel_subscription(token)
        .await
        .map_err(|error| provider_error(error, "subscription cancel"))?;
    if !cancelled {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "subscription_cancel_pending",
        ));
    }
    let completed = state
        .db
        .complete_account_site_subscription_cancel(account.id, id, "CANCELLED")
        .await
        .map_err(|error| map_db_error("complete subscription cancellation", error))?;
    if !completed {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "subscription_cancel_pending",
        ));
    }
    Ok(Json(json!({
        "subscriptionId": id,
        "status": "cancelled",
    })))
}

fn ledger_entry_json(entry: &buzz_db::payments::CreditLedgerEntry) -> Value {
    json!({
        "id": entry.id,
        "type": entry.entry_type,
        "amountNanousd": entry.amount_nanousd.to_string(),
        "sourceId": entry.source_id,
        "reference": entry.reference,
        "description": entry.description,
        "metadata": entry.metadata,
        "createdAt": entry.created_at,
    })
}

fn payment_intent_json(intent: &PaymentIntentRecord) -> Value {
    json!({
        "reference": intent.reference,
        "idempotencyKey": intent.idempotency_key,
        "packId": intent.pack_id,
        "chargeMinorUnits": intent.charge_minor_units,
        "currency": "ZAR",
        "grantNanousd": intent.grant_nanousd.to_string(),
        "status": intent.status,
        "providerPaymentId": intent.provider_payment_id,
        "providerStatus": intent.provider_status,
        "paidMinorUnits": intent.paid_minor_units,
        "createdAt": intent.created_at,
        "updatedAt": intent.updated_at,
    })
}

fn site_subscription_json(subscription: &SiteSubscriptionRecord) -> Value {
    json!({
        "id": subscription.id,
        "siteId": subscription.site_id,
        "reference": subscription.reference,
        "status": subscription.status,
        "monthlyUsdCents": subscription.monthly_usd_cents,
        "monthlyZarCents": subscription.monthly_zar_cents,
        "providerStatus": subscription.provider_status,
        "cancellationRequested": subscription.cancel_requested_at.is_some(),
        "createdAt": subscription.created_at,
        "updatedAt": subscription.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paid_credit_amount_conversion_uses_server_integer_units() {
        let amount = 500 * NANO_USD_PER_CENT;
        assert_eq!(amount / NANO_USD_PER_CENT, 500);
        assert_eq!(nano_usd_from_cents(500).ok(), Some(amount));
    }

    #[test]
    fn site_identifier_validation_rejects_empty_control_and_oversized_values() {
        assert!(validate_site_id("site-1").is_ok());
        assert!(validate_site_id("").is_err());
        assert!(validate_site_id("bad\nsite").is_err());
        assert!(validate_site_id(&"s".repeat(129)).is_err());
    }

    #[test]
    fn provider_status_payload_keeps_amounts_as_exact_strings() {
        let intent = PaymentIntentRecord {
            reference: "credit-1".to_owned(),
            account_id: Uuid::nil(),
            idempotency_key: Uuid::nil(),
            pack_id: "starter".to_owned(),
            charge_minor_units: 11_900,
            grant_nanousd: 5_000_000_000,
            status: "paid".to_owned(),
            provider_payment_id: Some("123".to_owned()),
            provider_status: Some("COMPLETE".to_owned()),
            paid_minor_units: Some(11_900),
            created_at: chrono::DateTime::UNIX_EPOCH,
            updated_at: chrono::DateTime::UNIX_EPOCH,
        };
        let response = payment_intent_json(&intent);
        assert_eq!(response["grantNanousd"], "5000000000");
        assert_eq!(response["status"], "paid");
    }

    #[test]
    fn site_subscription_payload_does_not_expose_provider_token() {
        let subscription = SiteSubscriptionRecord {
            id: Uuid::nil(),
            account_id: Uuid::nil(),
            site_id: "site-1".to_owned(),
            reference: "site-sub-1".to_owned(),
            provider_token: Some("secret-provider-token".to_owned()),
            status: "active".to_owned(),
            monthly_usd_cents: 1000,
            monthly_zar_cents: 18_500,
            provider_status: Some("ACTIVE".to_owned()),
            cancel_requested_at: None,
            created_at: chrono::DateTime::UNIX_EPOCH,
            updated_at: chrono::DateTime::UNIX_EPOCH,
        };
        let response = site_subscription_json(&subscription);
        assert!(response.get("providerToken").is_none());
        assert!(!format!("{subscription:?}").contains("secret-provider-token"));
    }
}
