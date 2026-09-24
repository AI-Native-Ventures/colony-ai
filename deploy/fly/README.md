# Fly canary relay

The manual deploy workflow targets colony-relay-canary at
relay-canary.colony.ainative.ventures. It reuses the existing Postgres app
colony-db-canary-iad. The first fork schema apply drops old Colony tables;
the owner has accepted that data loss.

## One-time secrets

Add the account service values to the existing Fly relay app. Replace each
placeholder using the owner's secret manager. Do not put the values in the
repository, workflow inputs, or PR text.

```sh
flyctl secrets set --app colony-relay-canary \
  COLONY_ACCOUNT_KEK='<base64-encoded-32-random-bytes>' \
  RESEND_API_KEY='<resend-api-key>' \
  COLONY_GOOGLE_CLIENT_IDS='<desktop-client-id>,<mobile-client-id>'
```

COLONY_MAIL_FROM is a non-secret value in fly.canary.toml. Configure the
sender address with Resend before relying on verification and reset email.
Set the GitHub repository secret FLY_API_TOKEN before a non-dry-run dispatch.
The existing DATABASE_URL, REDIS_URL, BUZZ_RELAY_PRIVATE_KEY,
RELAY_OWNER_PUBKEY, BUZZ_S3_ACCESS_KEY, and BUZZ_S3_SECRET_KEY remain Fly
secrets on the app. Membership mode requires the canary relay key and owner
pubkey to remain configured.

## Back up before deployment

Before the first fork deployment, create and verify an on-demand snapshot of
the existing Postgres volume. Keep the returned snapshot ID with the rollout
record. The workflow creates another snapshot and waits for its created
state immediately before it starts the Fly release command.

```sh
DATABASE_APP=colony-db-canary-iad
flyctl volumes list --app "$DATABASE_APP" --json

VOLUME_ID='<postgres-volume-id>'
SNAPSHOT_JSON="$(flyctl volumes snapshots create "$VOLUME_ID" \
  --app "$DATABASE_APP" --json)"
printf '%s\n' "$SNAPSHOT_JSON" | jq .

SNAPSHOT_ID="$(printf '%s\n' "$SNAPSHOT_JSON" | jq -r '.id')"
flyctl volumes snapshots list "$VOLUME_ID" --app "$DATABASE_APP" --json \
  | jq --arg id "$SNAPSHOT_ID" '.[] | select(.id == $id)'
```

Continue only after that snapshot reports status: created.

## Trigger

First use dry_run=true to parse and print fly.canary.toml with the selected
commit, image tag, schema release step, and backup plan. That job does not
need a Fly token, deploy, or call the Fly API.

```sh
gh workflow run fly-deploy-relay-canary.yml \
  --ref feat/phase3-auth --field dry_run=true
```

After reviewing the dry-run summary and confirming FLY_API_TOKEN is set,
dispatch with dry_run=false:

```sh
gh workflow run fly-deploy-relay-canary.yml \
  --ref feat/phase3-auth --field dry_run=false
```

The deployment builds runtime-canary, pushes a full-commit sha-<commit>
image tag, snapshots the Postgres volume, then runs pgschema apply followed
by scripts/reconcile-schema-after-pgschema.sql as Fly's release command.
It verifies the running image, NIP-11, and
GET /api/communities/config.

## Roll back the image

List the deployed images and select the previous full-commit SHA tag:

```sh
flyctl releases --app colony-relay-canary --image
PREVIOUS_IMAGE='registry.fly.io/colony-relay-canary:sha-<previous-full-commit>'
flyctl deploy --config deploy/fly/fly.canary.toml \
  --app colony-relay-canary --image "$PREVIOUS_IMAGE" \
  --strategy immediate --skip-release-command --yes
```

This restores relay code only. It does not reverse the schema apply or restore
the previous database contents. Database recovery requires restoring the
recorded Fly volume snapshot and reconnecting the relay to that database.
