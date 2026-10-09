use super::*;
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
    let a = db.admit_credit_ai_request(
        "fixture",
        community,
        agent.public_key().as_bytes(),
        sessions[0],
        requests[0],
        &digest,
        200_000_000,
    );
    let b = db.admit_credit_ai_request(
        "fixture",
        community,
        agent.public_key().as_bytes(),
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
