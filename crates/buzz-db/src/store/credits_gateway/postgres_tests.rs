use super::*;
use crate::deletion::{
    FrozenInventory, KeyStreamDigest, LeaseToken, PrefixManifest, StorageManifest,
    DEFAULT_LEASE_DURATION,
};
use crate::payments::CreditDebitOutcome;
use nostr::Keys;
use sqlx::{postgres::PgPoolOptions, PgPool};

async fn fixture() -> (Db, PgPool, CommunityId, Keys, Vec<Uuid>) {
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&crate::test_support::database_url())
        .await
        .unwrap();
    let db = Db::from_pool(pool.clone());
    let owner = Keys::generate();
    let account = Uuid::new_v4();
    let community = Uuid::new_v4();
    sqlx::query("INSERT INTO communities (id,host) VALUES ($1,$2)")
        .bind(community)
        .bind(format!("{}.example", community))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO accounts (id,email,pubkey,email_verified_at,wrapped_dek,kek_id,sealed_nsec,nonce) VALUES ($1,$2,$3,now(),$4,'test',$5,$6)")
        .bind(account).bind(format!("{account}@example.invalid")).bind(owner.public_key().to_hex()).bind(vec![1u8;28]).bind(vec![2u8;16]).bind(vec![3u8;12]).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO users (community_id,pubkey) VALUES ($1,$2)")
        .bind(community)
        .bind(owner.public_key().to_bytes().to_vec())
        .execute(&pool)
        .await
        .unwrap();
    let agent = Keys::generate();
    sqlx::query("INSERT INTO users (community_id,pubkey,agent_owner_pubkey) VALUES ($1,$2,$3)")
        .bind(community)
        .bind(agent.public_key().to_bytes().to_vec())
        .bind(owner.public_key().to_bytes().to_vec())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO account_credit_ledger (account_id,entry_type,amount_nanousd,source_id,description) VALUES ($1,'purchase',1000000000,'fixture','test grant')").bind(account).execute(&pool).await.unwrap();
    let community = CommunityId::from_uuid(community);
    let session = db
        .create_credit_ai_session(
            &owner.public_key().to_hex(),
            community,
            agent.public_key().as_bytes(),
        )
        .await
        .unwrap();
    (db, pool, community, agent, vec![account, session])
}

async fn extra_session(pool: &PgPool, account: Uuid, community: CommunityId, agent: &Keys) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO account_ai_sessions (id,account_id,community_id,agent_pubkey,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 hour')")
        .bind(id).bind(account).bind(community.as_uuid()).bind(agent.public_key().to_bytes().to_vec()).execute(pool).await.unwrap();
    id
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn aggregate_holds_allow_four_employees_and_block_fifth_and_other_debits() {
    let (db, pool, community, agent, ids) = fixture().await;
    let mut sessions = vec![ids[1]];
    for _ in 0..4 {
        sessions.push(extra_session(&pool, ids[0], community, &agent).await);
    }
    let digest = "a".repeat(64);
    let requests: Vec<_> = (0..5).map(|_| Uuid::new_v4()).collect();
    // Both futures retain this borrow until join completes.
    let agent_pubkey = agent.public_key();
    let a = db.admit_credit_ai_request(
        "fixture",
        community,
        agent_pubkey.as_bytes(),
        sessions[0],
        requests[0],
        &digest,
        200_000_000,
    );
    let b = db.admit_credit_ai_request(
        "fixture",
        community,
        agent_pubkey.as_bytes(),
        sessions[1],
        requests[1],
        &digest,
        200_000_000,
    );
    let (a, b) = tokio::join!(a, b);
    assert_eq!(a.unwrap(), Admission::New { account_id: ids[0] });
    assert_eq!(b.unwrap(), Admission::New { account_id: ids[0] });
    for i in 2..4 {
        assert_eq!(
            db.admit_credit_ai_request(
                "fixture",
                community,
                agent.public_key().as_bytes(),
                sessions[i],
                requests[i],
                &digest,
                200_000_000
            )
            .await
            .unwrap(),
            Admission::New { account_id: ids[0] }
        );
    }
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            sessions[4],
            requests[4],
            &digest,
            200_000_000
        )
        .await
        .unwrap(),
        Admission::Busy
    );
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        200_000_000
    );
    assert_eq!(
        db.record_account_credit_debit(ids[0], "other", 200_000_001, "other usage", &json!({}))
            .await
            .unwrap(),
        CreditDebitOutcome::InsufficientBalance
    );
    db.settle_credit_ai_request(requests[0], 12_000_000, false)
        .await
        .unwrap();
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            sessions[4],
            requests[4],
            &digest,
            400_000_000
        )
        .await
        .unwrap(),
        Admission::Insufficient
    );
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            sessions[4],
            requests[4],
            &digest,
            200_000_000
        )
        .await
        .unwrap(),
        Admission::New { account_id: ids[0] }
    );
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn settlement_lost_ack_replay_is_exactly_once_and_estimate_correction_refunds_once() {
    let (db, pool, community, agent, ids) = fixture().await;
    let request = Uuid::new_v4();
    let digest = "a".repeat(64);
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &digest,
            100_000_000
        )
        .await
        .unwrap(),
        Admission::New { account_id: ids[0] }
    );
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &digest,
            100_000_000
        )
        .await
        .unwrap(),
        Admission::Pending
    );
    assert!(db
        .admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &"b".repeat(64),
            100_000_000
        )
        .await
        .is_err());
    db.settle_credit_ai_request(request, 100_000_000, true)
        .await
        .unwrap();
    // Reconstruct the store after a committed transaction's acknowledgement is lost.
    let restarted = Db::from_pool(pool.clone());
    restarted
        .settle_credit_ai_request(request, 100_000_000, true)
        .await
        .unwrap();
    restarted
        .settle_credit_ai_request(request, 12_000_000, false)
        .await
        .unwrap();
    restarted
        .settle_credit_ai_request(request, 12_000_000, false)
        .await
        .unwrap();
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        988_000_000
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM account_credit_ledger WHERE account_id=$1 AND entry_type='refund'",
    )
    .bind(ids[0])
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &digest,
            100_000_000
        )
        .await
        .unwrap(),
        Admission::Completed {
            charged: 12_000_000,
            provisional: false
        }
    );
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn session_identity_community_expiry_and_ownership_are_enforced() {
    let (db, pool, community, agent, ids) = fixture().await;
    let digest = "a".repeat(64);
    let other = Keys::generate();
    assert!(db
        .admit_credit_ai_request(
            "fixture",
            community,
            other.public_key().as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &digest,
            1
        )
        .await
        .is_err());
    assert!(db
        .admit_credit_ai_request(
            "fixture",
            CommunityId::from_uuid(Uuid::new_v4()),
            agent.public_key().as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &digest,
            1
        )
        .await
        .is_err());
    sqlx::query("UPDATE account_ai_sessions SET expires_at=now()-interval '1 second' WHERE id=$1")
        .bind(ids[1])
        .execute(&pool)
        .await
        .unwrap();
    assert!(db
        .admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &digest,
            1
        )
        .await
        .is_err());
    sqlx::query("UPDATE account_ai_sessions SET expires_at=now()+interval '1 hour' WHERE id=$1")
        .bind(ids[1])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET agent_owner_pubkey=NULL WHERE community_id=$1 AND pubkey=$2")
        .bind(community.as_uuid())
        .bind(agent.public_key().to_bytes().to_vec())
        .execute(&pool)
        .await
        .unwrap();
    assert!(db
        .admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &digest,
            1
        )
        .await
        .is_err());
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        1_000_000_000
    );
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn zero_cost_releases_hold_and_recovery_claims_are_bounded_and_back_off() {
    let (db, pool, community, agent, ids) = fixture().await;
    let request = Uuid::new_v4();
    db.admit_credit_ai_request(
        "fixture",
        community,
        agent.public_key().as_bytes(),
        ids[1],
        request,
        &"a".repeat(64),
        100,
    )
    .await
    .unwrap();
    sqlx::query("UPDATE account_ai_requests SET next_retry_at=now() WHERE id=$1")
        .bind(request)
        .execute(&pool)
        .await
        .unwrap();
    let (a, b) = tokio::join!(db.claim_credit_ai_recovery(), db.claim_credit_ai_recovery());
    assert_eq!(a.unwrap().len() + b.unwrap().len(), 1);
    assert!(db.claim_credit_ai_recovery().await.unwrap().is_empty());
    db.settle_credit_ai_request(request, 0, false)
        .await
        .unwrap();
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        1_000_000_000
    );
    let zero: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM account_credit_ledger WHERE account_id=$1 AND entry_type='usage'",
    )
    .bind(ids[0])
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(zero, 0);
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn migration_schema_gateway_authorization_and_reservations_use_migrated_tables() {
    let pool = PgPool::connect(&crate::test_support::database_url())
        .await
        .unwrap();
    crate::migration::run_migrations(&pool).await.unwrap();
    let (db, _, community, agent, ids) = fixture().await;
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &"a".repeat(64),
            100
        )
        .await
        .unwrap(),
        Admission::New { account_id: ids[0] }
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM _operator_global_tables WHERE table_name IN ('account_ai_sessions','account_ai_requests')").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn admission_recovers_expired_session_even_when_background_worker_is_backlogged() {
    let (db, pool, community, agent, ids) = fixture().await;
    let old = Uuid::new_v4();
    db.admit_credit_ai_request(
        "fixture",
        community,
        agent.public_key().as_bytes(),
        ids[1],
        old,
        &"a".repeat(64),
        100_000_000,
    )
    .await
    .unwrap();
    sqlx::query("UPDATE account_ai_requests SET created_at=now()-interval '16 minutes', next_retry_at=now()+interval '1 hour' WHERE id=$1").bind(old).execute(&pool).await.unwrap();
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &"b".repeat(64),
            100_000_000
        )
        .await
        .unwrap(),
        Admission::New { account_id: ids[0] }
    );
    let status: String = sqlx::query_scalar("SELECT status FROM account_ai_requests WHERE id=$1")
        .bind(old)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "estimated");
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        800_000_000
    );
}

async fn deletion_preserves_billing_recovery() {
    let (db, pool, community, agent, ids) = fixture().await;
    let request = Uuid::new_v4();
    let digest = "a".repeat(64);
    db.admit_credit_ai_request(
        "fixture",
        community,
        agent.public_key().as_bytes(),
        ids[1],
        request,
        &digest,
        100_000_000,
    )
    .await
    .unwrap();
    let owner: String = sqlx::query_scalar("SELECT pubkey FROM accounts WHERE id=$1")
        .bind(ids[0])
        .fetch_one(&pool)
        .await
        .unwrap();
    let host: String = sqlx::query_scalar("SELECT host FROM communities WHERE id=$1")
        .bind(community.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap();
    let store = db.deletion_store();
    // This production catalog check failed before the SQL exclusion fix.
    store.validate_catalog().await.unwrap();
    let submitted = store.submit(&host, "test-operator", None).await.unwrap();
    let storage = StorageManifest {
        version: 4,
        prefixes: ["_meta", "_uploads", "repos"]
            .into_iter()
            .map(|prefix| PrefixManifest {
                prefix: format!("{prefix}/{community}/"),
                object_count: 0,
                total_bytes: 0,
                keys_digest: KeyStreamDigest::new().finish().0,
            })
            .collect(),
    };
    let inventory = FrozenInventory {
        schema: store.inventory_schema(community).await.unwrap(),
        storage,
    };
    store
        .freeze_inventory(submitted.id, &inventory)
        .await
        .unwrap();
    store
        .approve(submitted.id, "test-approver", None)
        .await
        .unwrap();
    let claim = store
        .claim_specific(submitted.id, "test-executor", DEFAULT_LEASE_DURATION)
        .await
        .unwrap()
        .unwrap();
    store.begin_quiescing(&claim.lease).await.unwrap();
    // Ownership rows still exist here. Removing either explicit production
    // fence therefore lets this operation succeed and fails the regression.
    assert!(db
        .create_credit_ai_session(&owner, community, agent.public_key().as_bytes())
        .await
        .is_err());
    assert!(db
        .admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &digest,
            100_000_000,
        )
        .await
        .is_err());
    let generation = store.fence(&claim.lease).await.unwrap();
    let token = LeaseToken {
        fence_generation: Some(generation),
        ..claim.lease
    };
    store
        .freeze_destructive_storage_manifest(&token, &inventory.storage)
        .await
        .unwrap();
    store.mark_drained(&token).await.unwrap();
    store
        .mark_bindings_removed(&token, json!({"keys":0}))
        .await
        .unwrap();
    let purged = store.purge_postgres(&token).await.unwrap();
    assert_eq!(purged["users"], 2);
    assert!(!purged.contains_key("account_ai_sessions"));
    store
        .mark_cache_purged(&token, json!({"keys":0}))
        .await
        .unwrap();
    store
        .verify_postgres_logically_deleted(&token)
        .await
        .unwrap();
    let state: String = sqlx::query_scalar("SELECT deletion_state FROM communities WHERE id=$1")
        .bind(community.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "tombstone");
    // Tenant removal must not strand the reservation or destroy its session FK.
    sqlx::query("UPDATE account_ai_requests SET next_retry_at=now() WHERE id=$1")
        .bind(request)
        .execute(&pool)
        .await
        .unwrap();
    let due = db.claim_credit_ai_recovery().await.unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, request);
    db.settle_credit_ai_request(request, 12_000_000, false)
        .await
        .unwrap();
    db.settle_credit_ai_request(request, 12_000_000, false)
        .await
        .unwrap();
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        988_000_000
    );
    let retained: i64 = sqlx::query_scalar("SELECT count(*) FROM account_ai_requests r JOIN account_ai_sessions s ON s.id=r.session_id WHERE r.id=$1 AND s.community_id=$2 AND r.status='settled'")
        .bind(request).bind(community.as_uuid()).fetch_one(&pool).await.unwrap();
    assert_eq!(retained, 1);
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn community_deletion_fences_new_spend_and_preserves_billing_recovery() {
    deletion_preserves_billing_recovery().await;
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn migration_schema_community_deletion_fences_new_spend_and_preserves_billing_recovery() {
    let pool = PgPool::connect(&crate::test_support::database_url())
        .await
        .unwrap();
    crate::migration::run_migrations(&pool).await.unwrap();
    deletion_preserves_billing_recovery().await;
}

async fn account_email(pool: &PgPool, account: Uuid) -> String {
    sqlx::query_scalar("SELECT email FROM accounts WHERE id = $1")
        .bind(account)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn free_policy(email: String) -> GatewayPolicy {
    GatewayPolicy {
        free_ai_accounts: vec![email],
        ..GatewayPolicy::default()
    }
}

async fn ledger_rows(pool: &PgPool, account: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM account_credit_ledger WHERE account_id = $1")
        .bind(account)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn free_ai_account_runs_without_credits_and_never_touches_its_ledger() {
    let (db, pool, community, agent, ids) = fixture().await;
    sqlx::query("DELETE FROM account_credit_ledger WHERE account_id = $1")
        .bind(ids[0])
        .execute(&pool)
        .await
        .unwrap();
    let policy = free_policy(account_email(&pool, ids[0]).await);
    let digest = "a".repeat(64);
    let request = Uuid::new_v4();
    // Control: the same empty account cannot start a request without the policy.
    assert_eq!(
        db.admit_credit_ai_request(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &digest,
            100_000_000
        )
        .await
        .unwrap(),
        Admission::Insufficient
    );
    assert_eq!(
        db.admit_credit_ai_request_with_policy(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &digest,
            100_000_000,
            &policy
        )
        .await
        .unwrap(),
        Admission::New { account_id: ids[0] }
    );
    assert_eq!(ledger_rows(&pool, ids[0]).await, 0);
    db.settle_credit_ai_request(request, 12_000_000, false)
        .await
        .unwrap();
    // A lost settlement acknowledgement replays without error or ledger rows.
    db.settle_credit_ai_request(request, 12_000_000, false)
        .await
        .unwrap();
    let (status, charged): (String, i64) =
        sqlx::query_as("SELECT status, charged_nanousd FROM account_ai_requests WHERE id = $1")
            .bind(request)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), charged), ("settled", 12_000_000));
    // Provisional recovery and its downward correction stay journal-only too.
    let second = Uuid::new_v4();
    assert_eq!(
        db.admit_credit_ai_request_with_policy(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            second,
            &digest,
            100_000_000,
            &policy
        )
        .await
        .unwrap(),
        Admission::New { account_id: ids[0] }
    );
    db.settle_credit_ai_request(second, 100_000_000, true)
        .await
        .unwrap();
    db.settle_credit_ai_request(second, 5_000_000, false)
        .await
        .unwrap();
    let (status, charged): (String, i64) =
        sqlx::query_as("SELECT status, charged_nanousd FROM account_ai_requests WHERE id = $1")
            .bind(second)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), charged), ("settled", 5_000_000));
    assert_eq!(ledger_rows(&pool, ids[0]).await, 0);
    assert_eq!(db.account_credit_balance(ids[0]).await.unwrap(), 0);
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn payer_account_balance_and_ledger_behave_exactly_as_before_when_another_account_is_free() {
    let (db, _pool, community, agent, ids) = fixture().await;
    // The policy names some other account, never this payer.
    let policy = free_policy("someone-else@example.invalid".into());
    let digest = "a".repeat(64);
    let request = Uuid::new_v4();
    assert_eq!(
        db.admit_credit_ai_request_with_policy(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            request,
            &digest,
            100_000_000,
            &policy
        )
        .await
        .unwrap(),
        Admission::New { account_id: ids[0] }
    );
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        900_000_000
    );
    db.settle_credit_ai_request(request, 12_000_000, false)
        .await
        .unwrap();
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        988_000_000
    );
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn free_ai_accounts_share_many_in_flight_requests_across_devices() {
    let (db, pool, community, agent, ids) = fixture().await;
    let policy = GatewayPolicy {
        free_ai_max_in_flight: 6,
        ..free_policy(account_email(&pool, ids[0]).await)
    };
    let mut sessions = vec![ids[1]];
    for _ in 0..6 {
        sessions.push(extra_session(&pool, ids[0], community, &agent).await);
    }
    let digest = "a".repeat(64);
    // Six devices at once: well past the regular four.
    for session in &sessions[..6] {
        assert_eq!(
            db.admit_credit_ai_request_with_policy(
                "fixture",
                community,
                agent.public_key().as_bytes(),
                *session,
                Uuid::new_v4(),
                &digest,
                1_000_000,
                &policy
            )
            .await
            .unwrap(),
            Admission::New { account_id: ids[0] }
        );
    }
    // The configured ceiling still bounds the account.
    assert_eq!(
        db.admit_credit_ai_request_with_policy(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            sessions[6],
            Uuid::new_v4(),
            &digest,
            1_000_000,
            &policy
        )
        .await
        .unwrap(),
        Admission::Busy
    );
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn free_ai_account_gets_a_session_per_device_beyond_the_regular_limit() {
    let (db, pool, community, _agent, ids) = fixture().await;
    let owner: String = sqlx::query_scalar("SELECT pubkey FROM accounts WHERE id = $1")
        .bind(ids[0])
        .fetch_one(&pool)
        .await
        .unwrap();
    let policy = free_policy(account_email(&pool, ids[0]).await);
    let mut devices = Vec::new();
    for _ in 0..24 {
        let device = Keys::generate();
        sqlx::query("INSERT INTO users (community_id,pubkey,agent_owner_pubkey) VALUES ($1,$2,decode($3,'hex'))")
            .bind(community.as_uuid())
            .bind(device.public_key().to_bytes().to_vec())
            .bind(&owner)
            .execute(&pool)
            .await
            .unwrap();
        devices.push(device);
    }
    // The fixture holds one live session; fifteen more reach the regular limit.
    for device in &devices[..15] {
        db.create_credit_ai_session(&owner, community, device.public_key().as_bytes())
            .await
            .unwrap();
    }
    assert!(matches!(
        db.create_credit_ai_session(&owner, community, devices[15].public_key().as_bytes())
            .await,
        Err(DbError::InvalidData(_))
    ));
    for device in &devices[15..] {
        db.create_credit_ai_session_with_policy(
            &owner,
            community,
            device.public_key().as_bytes(),
            &policy,
        )
        .await
        .unwrap();
    }
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM account_ai_sessions WHERE account_id = $1 AND NOT revoked AND expires_at > now()",
    )
    .bind(ids[0])
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active, 25);
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn global_daily_cap_counts_holds_and_spend_refuses_new_inference_and_resets_at_utc_day() {
    let (db, pool, community, agent, ids) = fixture().await;
    let policy = GatewayPolicy {
        global_daily_cap_nanousd: Some(150_000_000),
        ..GatewayPolicy::default()
    };
    let sessions = [
        ids[1],
        extra_session(&pool, ids[0], community, &agent).await,
        extra_session(&pool, ids[0], community, &agent).await,
    ];
    let requests: Vec<_> = (0..3).map(|_| Uuid::new_v4()).collect();
    let digest = "a".repeat(64);
    let agent_pubkey = agent.public_key();
    let admit = |session: Uuid, request: Uuid| {
        db.admit_credit_ai_request_with_policy(
            "fixture",
            community,
            agent_pubkey.as_bytes(),
            session,
            request,
            &digest,
            100_000_000,
            &policy,
        )
    };
    assert_eq!(
        admit(sessions[0], requests[0]).await.unwrap(),
        Admission::New { account_id: ids[0] }
    );
    // The first hold already counts, so a second hold would pass the ceiling.
    assert_eq!(
        admit(sessions[1], requests[1]).await.unwrap(),
        Admission::DailyLimit
    );
    let journaled: i64 =
        sqlx::query_scalar("SELECT count(*) FROM account_ai_requests WHERE id = $1")
            .bind(requests[1])
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(journaled, 0, "a refused request leaves no hold or journal");
    assert_eq!(
        db.account_credit_balance(ids[0]).await.unwrap(),
        900_000_000
    );
    // Settled usage counts what was charged, not the hold.
    db.settle_credit_ai_request(requests[0], 10_000_000, false)
        .await
        .unwrap();
    assert_eq!(
        admit(sessions[1], requests[1]).await.unwrap(),
        Admission::New { account_id: ids[0] }
    );
    // A replay of finished work is never new spend, even at the ceiling.
    assert_eq!(
        admit(sessions[0], requests[0]).await.unwrap(),
        Admission::Completed {
            charged: 10_000_000,
            provisional: false
        }
    );
    assert_eq!(
        admit(sessions[2], requests[2]).await.unwrap(),
        Admission::DailyLimit
    );
    // The ceiling is per UTC day: yesterday's spend no longer counts.
    db.settle_credit_ai_request(requests[1], 100_000_000, false)
        .await
        .unwrap();
    sqlx::query("UPDATE account_ai_requests SET created_at = created_at - interval '1 day'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        admit(sessions[2], requests[2]).await.unwrap(),
        Admission::New { account_id: ids[0] }
    );
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn global_daily_cap_also_bounds_free_ai_accounts_and_leaves_their_ledger_empty() {
    let (db, pool, community, agent, ids) = fixture().await;
    sqlx::query("DELETE FROM account_credit_ledger WHERE account_id = $1")
        .bind(ids[0])
        .execute(&pool)
        .await
        .unwrap();
    let policy = GatewayPolicy {
        global_daily_cap_nanousd: Some(50_000_000),
        ..free_policy(account_email(&pool, ids[0]).await)
    };
    assert_eq!(
        db.admit_credit_ai_request_with_policy(
            "fixture",
            community,
            agent.public_key().as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &"a".repeat(64),
            100_000_000,
            &policy
        )
        .await
        .unwrap(),
        Admission::DailyLimit
    );
    assert_eq!(ledger_rows(&pool, ids[0]).await, 0);
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn global_daily_cap_holds_under_concurrent_admissions_from_different_payers() {
    let payers = tokio::join!(
        fixture(),
        fixture(),
        fixture(),
        fixture(),
        fixture(),
        fixture()
    );
    let payers = [payers.0, payers.1, payers.2, payers.3, payers.4, payers.5];
    // Two 100M holds fit under 250M; the other four must be refused even
    // though each payer's own balance and row lock are independent.
    let policy = GatewayPolicy {
        global_daily_cap_nanousd: Some(250_000_000),
        ..GatewayPolicy::default()
    };
    let digest = "a".repeat(64);
    let pubkeys: Vec<_> = payers.iter().map(|payer| payer.3.public_key()).collect();
    let attempt = |index: usize| {
        let (db, _, community, _, ids) = &payers[index];
        db.admit_credit_ai_request_with_policy(
            "fixture",
            *community,
            pubkeys[index].as_bytes(),
            ids[1],
            Uuid::new_v4(),
            &digest,
            100_000_000,
            &policy,
        )
    };
    let results = tokio::join!(
        attempt(0),
        attempt(1),
        attempt(2),
        attempt(3),
        attempt(4),
        attempt(5)
    );
    let results = [
        results.0, results.1, results.2, results.3, results.4, results.5,
    ];
    let admitted = results
        .iter()
        .filter(|result| matches!(result, Ok(Admission::New { .. })))
        .count();
    let refused = results
        .iter()
        .filter(|result| matches!(result, Ok(Admission::DailyLimit)))
        .count();
    assert_eq!((admitted, refused), (2, 4), "{results:?}");
}
