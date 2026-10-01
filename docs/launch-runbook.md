# Colony production launch runbook

This runbook prepares the manual Fly rollout for the existing production relay. It does not authorize or perform a production deploy. The deployment workflow is `fly-deploy-relay-prod.yml`; it runs only from `workflow_dispatch`, defaults to `dry_run=true`, and refuses a live run unless it is dispatched from `main` with the typed confirmation and a recorded old-data decision.

## Production targets

| Role | Fly app or host |
| --- | --- |
| Relay | `colony-relay` |
| Postgres | `colony-db-iad` |
| Redis | `colony-redis` |
| Relay and media host | `relay.colony.ainative.ventures` |
| API and admin host | `api.colony.ainative.ventures` |
| Existing aliases to verify | `app.colony.ainative.ventures`, `www.colony.ainative.ventures` |

The production Fly file uses the existing IAD relay volume name `colony_relay_data`. The workflow checks that this volume exists before snapshotting the database. It also requires exactly one Postgres volume. If the live inventory differs, the workflow stops before the release migration. The file does not declare a VM size or machine count.

The release command runs `/usr/local/bin/buzz-admin migrate` on Fly's temporary release machine before relay machines switch. The production image uses the shared Fly entrypoint wrapper to dispatch this command. Relay startup has `BUZZ_AUTO_MIGRATE=false`, so a machine restart cannot unexpectedly start a schema change.

## DECISION BOX: old Colony production data

This decision is open. The canary data-loss approval does not apply to production. Select and record exactly one strategy before a live dispatch:

1. **Preserve via snapshot archive, then drop.** Archive the old database to an owner-approved durable store, outside Fly's short-lived volume snapshots. Restore the archive into an isolated database and reconcile counts before selecting `preserve-via-snapshot-archive-then-drop` in the workflow. Record the archive and restore evidence. The deploy workflow snapshot is a rollback point, not a long-term archive.
2. **Migrate.** Prepare a separate, reviewed data migration that maps old Colony records into the new schema. Rehearse it against a protected copy, reconcile source and destination counts, and record the migration evidence before selecting `migrate`. The `buzz-admin migrate` release command applies this repository's SQLx migrations; it does not itself convert old Colony records.
3. **Fresh database.** Provision a new Postgres app through the owner's approved Fly process, set the production relay's `DATABASE_URL` to it, and record the approved app and cost decision. Select `fresh-database` and pass that database app in the workflow input. The workflow rejects `fresh-database` when `database_app` is still `colony-db-iad`.

The workflow defaults to `unresolved`; a live run cannot proceed with that value. `data_plan_record` must be a short, non-secret reference to the approval or rehearsal evidence. Do not put credentials or database URLs in workflow inputs.

## Required secret names

Set these names on the `colony-relay` Fly app. The workflow checks secret names only and never reads or prints their values. Supply values from the owner's approved secret manager.

- `DATABASE_URL`
- `REDIS_URL`
- `BUZZ_RELAY_PRIVATE_KEY`
- `RELAY_OWNER_PUBKEY`
- `BUZZ_S3_ACCESS_KEY`
- `BUZZ_S3_SECRET_KEY`
- `BUZZ_S3_BUCKET`
- `COLONY_ACCOUNT_KEK`
- `RESEND_API_KEY`
- `COLONY_GOOGLE_CLIENT_IDS`
- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE`

`BUZZ_S3_BUCKET` and `COLONY_GOOGLE_CLIENT_IDS` are configuration identifiers, not credentials. They are listed in Fly secrets so the workflow can fail closed if either setting is absent. Use the existing production Tigris bucket name for `BUZZ_S3_BUCKET`; this rollout does not create a bucket or choose a new storage vendor.

Set these GitHub Actions repository secrets for a live dispatch:

- `FLY_API_TOKEN`, scoped to the `colony-relay` app.
- `FLY_DB_API_TOKEN`, scoped to the selected database app so the workflow can create and inspect its volume snapshot.

GitHub provides `GITHUB_TOKEN` to the job for publishing the immutable image. Dry runs use none of these secrets and make no Fly API calls.

The checked-in canary contract lists `DATABASE_URL`, `REDIS_URL`, `BUZZ_RELAY_PRIVATE_KEY`, `RELAY_OWNER_PUBKEY`, `BUZZ_S3_ACCESS_KEY`, `BUZZ_S3_SECRET_KEY`, `COLONY_ACCOUNT_KEK`, `RESEND_API_KEY`, and `COLONY_GOOGLE_CLIENT_IDS`. The additional PayFast names come from `crates/buzz-relay/src/config.rs`. `fly.prod.toml` supplies the public S3 endpoint, relay URL, mail sender, and host values. Payment processing remains disabled by `COLONY_PAYMENTS_ENABLED=false`.

The exact live canary secret-name inventory was not queried for this change because no `FLY_API_TOKEN` was available in the worker environment. The live production workflow checks the production name set when the owner dispatches it. Secret values were not accessed.

### PayFast activation is a separate owner action

The live credentials may be staged while the feature remains disabled. To activate live payments later, the owner must explicitly set `COLONY_PAYMENTS_ENABLED=true`, `COLONY_PAYMENTS_SANDBOX=false`, and `COLONY_PAYMENTS_NOTIFY_URL` to the verified HTTPS callback `https://api.colony.ainative.ventures/api/payments/webhook/payfast`. Confirm the PayFast account and callback before enabling the feature. No payment is sent or charged by this deployment workflow.

## Before dispatch

1. Confirm the intended commit is on protected `main` and its required GitHub checks are green.
2. Resolve the old-data decision above. Confirm that the selected `database_app` matches the Fly app addressed by the relay's `DATABASE_URL` secret.
3. Confirm every Fly app secret name listed above. This command prints names only:

   ```sh
   flyctl secrets list --app colony-relay --json \
     | jq -r '.[] | (.Name // .name // empty)' | sort
   ```

4. Confirm the selected Postgres app has the expected volume inventory and that the relay volume is `colony_relay_data`. The workflow checks these again before it snapshots or deploys.
5. Confirm the verified production bucket is already provisioned and the configured S3 keys can access it. This rollout does not create a bucket or upload a test object.
6. Review a `dry_run=true` workflow summary. It renders `fly.prod.toml`, prints the commit, image tag, database app, release command, and data-plan input. It does not require secrets, call Fly, create a snapshot, or deploy.
7. For a live dispatch, choose `dry_run=false`, enter `deploy-colony-production`, select the recorded data plan, supply its evidence reference, and confirm the database app. Only dispatch from `main`.

## DNS and TLS checks

Cloudflare is outside this rollout. Do not change the apex, `app`, or `www` records as part of this deployment. Verify the four supplied CNAMEs still resolve to `colony-relay.fly.dev`, then verify the certificates for each host:

```sh
for host in app www relay api; do
  fqdn="$host.colony.ainative.ventures"
  printf '%s: ' "$fqdn"
  dig +short CNAME "$fqdn"
  openssl s_client -connect "$fqdn:443" -servername "$fqdn" \
    -verify_return_error </dev/null 2>&1 | rg 'Verify return code|Verification'
done
```

Also check the Fly certificate inventory without changing it:

```sh
flyctl certs list --app colony-relay
```

The live workflow checks HTTPS through the relay host by requesting `/health` and NIP-11. A successful TLS connection and NIP-11 version match are deployment checks, not proof that `app` and `www` marketing behavior is correct.

## Backup and restore drill

Fly volume snapshots are useful rollback points, but they are not the durable archive required by the preserve-data option. The workflow snapshots the selected Postgres app immediately before the schema release, identifies the new snapshot, and proceeds only after its status is `created`. It stops on a missing, failed, or timed-out snapshot.

Before Saturday's production rollout, rehearse the restore sequence against a canary snapshot, never against production data:

1. Record the canary Postgres image reference, volume ID, volume size, and a canary snapshot ID.
2. Create an isolated restore app from that canary snapshot using the same Postgres image and a volume at least as large as the source. Keep the restore app in IAD.
3. Connect to the restored app using the owner's secure Fly access path. Verify Postgres starts and compare a small set of canary-only row counts and migration state against the source record.
4. Save the drill result in the launch record. Remove temporary resources only after the owner reviews the evidence and confirms cleanup.

Fly's unmanaged Postgres restore procedure creates a new Postgres app from a snapshot and then reconnects the application. The relevant Fly guide is archived, so verify the commands against the installed `flyctl` version and the current canary setup before relying on them. A restored cluster must use a compatible Postgres image and a volume at least as large as the source. See [Fly Postgres backup and restore](https://docs.fly.io/unmanaged-postgres/managing/backup-and-restore) and [Fly volume snapshots](https://www.fly.io/docs/flyctl/volumes/).

### Production recovery after a failed release

The workflow prints these steps and the snapshot ID in its failed run summary. It does not restore a database automatically because an automatic restore can discard writes made after the snapshot.

1. Inspect the failed GitHub job and Fly release logs. Do not retry a failed release blindly.
2. For a code-only rollback, select the previously running immutable image from `flyctl releases --app colony-relay --image`. Deploy that image with `--skip-release-command`; this avoids rerunning the migration. Code rollback does not undo schema changes.
3. If the schema or data must be restored, record the snapshot ID and Postgres image from the failed run. Restore into a new Postgres app, using the same Postgres image and a volume at least as large as the source. Verify the restored database before reconnecting the relay.
4. Reconnect only after the owner approves the recovery. For an unmanaged Fly Postgres app, the documented sequence is detach the existing Postgres app from `colony-relay`, then attach the restored Postgres app. Keep generated credentials in the owner's secret manager, never in logs, PR text, or workflow inputs.
5. Run the health and NIP-11 smoke checks after code rollback or database reconnection.

Example command shapes, with values filled from the failed run and Fly inventory:

```sh
flyctl releases --app colony-relay --image
PREVIOUS_IMAGE='registry.fly.io/colony-relay:sha-<previous-full-commit>'
flyctl deploy --config deploy/fly/fly.prod.toml \
  --app colony-relay --image "$PREVIOUS_IMAGE" \
  --strategy immediate --skip-release-command --yes
```

For database restore, first create a new Postgres app from the recorded snapshot using the original Postgres image and volume size, then use the Fly Postgres detach and attach commands after owner approval. The [Fly restore guide](https://docs.fly.io/unmanaged-postgres/managing/backup-and-restore) describes this new-app recovery shape.

## Migration review since fork base `475fcf5a`

The repository diff from the fork base contains migrations `0048` through `0053`. The first five create new records or add narrow constraints; `0052` is the only explicit full-table rewrite in this set.

| Migration | Statements and observed risk |
| --- | --- |
| `0048_account_payments.sql` | Creates five new payment and ledger tables, indexes them while empty, and adds table-name registry rows. No existing event or account heap rewrite. |
| `0049_account_site_subscription_cycle_fence.sql` | Adds two `NOT NULL DEFAULT 0` columns with checks to `account_site_subscriptions`. The constant defaults avoid a heap rewrite on modern PostgreSQL, but validating the checks may scan existing subscription rows under an `ALTER TABLE` lock. |
| `0050_business_proposal_conversion_claims.sql` | Adds nullable `communities.business_channel_id`, then validates a foreign key against `channels`. The FK validation can scan existing communities and holds a `SHARE ROW EXCLUSIVE` lock on both tables. The new claims table and its index start empty. |
| `0051_workflow_versions_and_agent_waits.sql` | Adds enum values and nullable `workflow_runs` columns, creates a new enum, table, and indexes. No explicit update/backfill or heap rewrite is present; the enum and table alterations still take schema locks. |
| `0052_company_records_fts_exclusion.sql` | Drops and re-adds generated stored `events.search_tsv`, then rebuilds its GIN index inside one `DO` statement. This rewrites the partitioned event data and holds an `ACCESS EXCLUSIVE` lock on `events` until the statement commits. It blocks normal reads and writes for the lock window. |
| `0053_company_work_watchdog.sql` | Creates a new delivery-journal table and three indexes while empty, then attaches the community write fence. No existing-row rewrite. |

PostgreSQL takes `ACCESS EXCLUSIVE` for most `ALTER TABLE` forms; validated checks and foreign keys can scan existing rows. See [PostgreSQL 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html) and [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html).

### `0052` measurement and window recommendation

`scripts/bench-migration-0052.py` creates a disposable partitioned `events` table with a representative row shape and indexes, loads each requested row count, applies the repository's actual `0052` SQL, and verifies row count, company-kind exclusion, retained ordinary search vectors, and GIN index validity. It monitors granted `AccessExclusiveLock` entries on the parent `events` table from a second connection. The script accepts only loopback or local CI hosts; it rejects Fly and production hosts.

Local measurement used a disposable PostgreSQL 17.11 container on `127.0.0.1:55432`. The existing Buzz Postgres container and all Fly apps were untouched.

| Synthetic rows | Migration runtime | Observed `ACCESS EXCLUSIVE` lock |
| ---: | ---: | ---: |
| 10,000 | 0.259 s | 0.224 s |
| 100,000 | 2.159 s | 2.111 s |
| 1,000,000 | 20.886 s | 20.746 s |

For a rehearsed database of up to 1M rows on comparable PostgreSQL 17 storage, reserve a 15-minute maintenance window for the migration, with the release command capped at 30 minutes. This gives substantial room above the measured synthetic lock window. Production row count, Postgres image, and storage performance were not read, so do not extrapolate these times as production proof. If a protected copy contains more than 1M rows, or uses slower storage, rerun the benchmark on a copy with the production Postgres version and representative storage before selecting a launch window.

No lock-free `0054` was added. The measured 1M-row synthetic case does not make a 15-minute window unacceptable, while the actual production size remains unknown. More importantly, a new migration after `0052` cannot avoid the `0052` lock on first application because SQLx runs migrations in order. A safe lock-free cutover would require a separately rehearsed staged-column, concurrent-index, dual-write, and batched-backfill plan, or choosing a fresh database. Do not edit an already-applied SQLx migration to bypass its checksum.

## What this runbook does not prove

- No production Fly app, database, DNS record, or production workflow was accessed or changed while preparing this runbook.
- The benchmark proves behavior only for synthetic PostgreSQL 17.11 data, not the production row count or storage.
- A draft PR, a green CI run, or a `dry_run=true` dispatch is not a production deploy or live recovery drill.
- The old production data decision remains open until the owner records one option in the DECISION BOX.
