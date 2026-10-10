//! HTTP regression tests using the production payment router and isolated storage.
use super::*;
use axum::body::{to_bytes, Body};
use axum::http::Request;
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, KeyInit, Mac};
use nostr::{EventBuilder, Keys, Kind, Tag};
use tower::ServiceExt;

async fn state() -> (Arc<AppState>, Keys, Uuid, String) {
    let mut state = crate::state::tests::test_state_with_database_url_and_acquire_timeout(
        &crate::test_support::database_url(),
        std::time::Duration::from_secs(5),
    )
    .await;
    let host = format!("stripe-{}.example", Uuid::new_v4().simple());
    let mutable = Arc::get_mut(&mut state).expect("unique state");
    let config = Arc::make_mut(&mut mutable.config);
    config.payments = crate::config::PaymentsConfig::stripe_test_config();
    config.relay_url = format!("wss://{host}");
    state
        .db
        .ensure_configured_community(&host)
        .await
        .expect("community");
    let pool = sqlx::PgPool::connect(&crate::test_support::database_url())
        .await
        .expect("isolated database");
    let keys = Keys::generate();
    let account = Uuid::new_v4();
    sqlx::query("INSERT INTO accounts (id, email, pubkey, email_verified_at, wrapped_dek, kek_id, sealed_nsec, nonce) VALUES ($1, $2, $3, now(), $4, 'test-kek', $5, $6)")
        .bind(account).bind(format!("stripe-{}@example.invalid", account.simple())).bind(keys.public_key().to_hex())
        .bind(vec![1u8;28]).bind(vec![2u8;16]).bind(vec![3u8;12]).execute(&pool).await.expect("account");
    (state, keys, account, host)
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn stripe_checkout_http_rejects_unknown_and_payfast_packs_without_creating_an_intent() {
    let (state, keys, account, host) = state().await;
    for pack in ["unknown-pack", "starter"] {
        let body = serde_json::to_vec(&json!({"packId": pack, "idempotencyKey": Uuid::new_v4()}))
            .expect("body");
        let url = format!("https://{host}/api/payments/checkout");
        let event = EventBuilder::new(Kind::HttpAuth, "")
            .tags([
                Tag::parse(["u", url.as_str()]).expect("url"),
                Tag::parse(["method", "POST"]).expect("method"),
                Tag::parse(["payload", hex::encode(Sha256::digest(&body)).as_str()])
                    .expect("payload"),
                Tag::parse(["nonce", Uuid::new_v4().to_string().as_str()]).expect("nonce"),
            ])
            .sign_with_keys(&keys)
            .expect("sign");
        let response = router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/checkout")
                    .header("host", &host)
                    .header(
                        "authorization",
                        format!(
                            "Nostr {}",
                            STANDARD.encode(serde_json::to_vec(&event).expect("event"))
                        ),
                    )
                    .body(Body::from(body))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let payload: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.expect("body"))
                .expect("JSON");
        assert_eq!(payload["error"], "unknown_pack");
    }
    assert!(state
        .db
        .account_payment_intent_history(account, 100)
        .await
        .expect("history")
        .is_empty());
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn stripe_webhook_http_accepts_signed_duplicate_delivery_and_grants_exactly_once() {
    let (state, _, account, _) = state().await;
    let reference = format!("credit-{}", Uuid::new_v4());
    state
        .db
        .create_account_payment_intent_for_provider(
            account,
            &reference,
            Uuid::new_v4(),
            "usd-5",
            500,
            5_000_000_000,
            "stripe",
            "USD",
        )
        .await
        .expect("intent");
    let body = serde_json::to_vec(
        &json!({"id":"evt_http_test", "type":"checkout.session.completed", "data":{"object":{
            "id":"cs_http_test", "mode":"payment", "client_reference_id":reference,
            "payment_status":"paid", "amount_total":500, "currency":"usd"
        }}}),
    )
    .expect("body");
    let timestamp = chrono::Utc::now().timestamp();
    let mut mac = Hmac::<Sha256>::new_from_slice(b"fake-webhook").expect("hmac");
    mac.update(format!("{timestamp}.").as_bytes());
    mac.update(&body);
    let signature = format!(
        "t={timestamp},v1={}",
        hex::encode(mac.finalize().into_bytes())
    );
    for _ in 0..2 {
        let response = router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/webhook/stripe")
                    .header("stripe-signature", &signature)
                    .body(Body::from(body.clone()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert_eq!(
        state
            .db
            .account_credit_balance(account)
            .await
            .expect("balance"),
        5_000_000_000
    );
    assert_eq!(
        state
            .db
            .account_credit_history(account, 100)
            .await
            .expect("ledger")
            .len(),
        1
    );
    assert_eq!(
        state
            .db
            .account_payment_intent(account, &reference)
            .await
            .expect("lookup")
            .expect("intent")
            .status,
        "paid"
    );
}
