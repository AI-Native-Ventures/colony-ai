# Email, password and Google accounts (phase 3 contract)

Status: agreed contract for the phase-3 lanes. Owner decisions (2026-09-23):
an email reset restores the full account including the signing key
(server-assisted custody), and Google is the only social provider.

Users never see, paste or download a key. The Nostr keypair still exists
(every event is signed and sockets authenticate with NIP-42); it is created,
held and returned by the relay's account service, and the client stores it
exactly as it stores an imported key today.

## Why HTTP, not events

Signup happens before the user has a key, so no Nostr event can carry it.
Like `POST /api/invites/claim`, these routes are a deliberate exception to
the Nostr-first rule. Once a client holds its key, everything else stays on
events.

## Custody model

- The relay generates the keypair at signup (or accepts an existing key at
  claim) and stores the secret key envelope-encrypted: a random per-account
  data key (AES-256-GCM) encrypts the nsec; the data key is wrapped by the
  deployment master key `COLONY_ACCOUNT_KEK` (32 random bytes, base64, a
  deployment secret; never in the database, never logged). Rows carry
  `kek_id` so the master key can be rotated.
- The relay returns the secret key only in the response to a successful
  authentication (password signin, Google signin, verified reset, verified
  signup, claim), over TLS. It never returns it anywhere else.
- Consequence, accepted by the owner: a deployment operator with the master
  key can recover any account's key. Keep the master key out of logs, CI and
  source control; restrict who can read deployment secrets.

## Accounts are deployment-global

One email = one account = one identity across every community on the
deployment (communities keep their own membership). The tables are
operator-global, not community-scoped, and are registered as such in the
tenant-isolation lint and deletion catalogs. Account deletion (`DELETE`,
below) removes the account row and wipes custody material.

## Data model (sketch; lane owns exact SQL)

- `accounts`: `id uuid pk`, `email text` (unique on `lower(email)`),
  `email_verified_at timestamptz null`, `pubkey text unique`,
  `password_hash text null` (Argon2id PHC; null for Google-only),
  `wrapped_dek bytea`, `kek_id text`, `sealed_nsec bytea`, `nonce bytea`,
  `created_at`, `updated_at`, `last_signin_at`, `failed_attempts int`,
  `locked_until timestamptz null`. Table name must not collide with existing
  tables; check `schema/schema.sql` and pick a free name.
- `account_google_identities`: `sub text pk`, `account_id fk`, `email`,
  `created_at`.
- `account_codes`: one-time 6-digit codes for `verify_email` and
  `reset_password`; store HMAC-SHA256 of the code keyed by a key derived from `COLONY_ACCOUNT_KEK` (plain hashes of six-digit codes are brute-forceable from a database dump), `expires_at` (15 min),
  `attempts` (max 5), `consumed_at`.

## Endpoints (JSON over HTTPS on any community host)

Common errors: `400 invalid_request`, `401 invalid_credentials`,
`403 email_unverified`, `409 email_taken`, `409 identity_taken`,
`410 code_expired`, `422 weak_password` (min 10 chars), and `429 rate_limited`
with `retry_after_secs`. Code routes also return `422 wrong_code` with
`attempts_left`, `429 too_many_attempts` with `retry_after_secs`, or
`429 resend_cooldown` with `retry_after_secs`. The code errors distinguish an
active challenge from a missing, expired, or consumed challenge, including for
password reset. Reset request and successful resend responses remain generic
for unknown email addresses. Signup email conflicts remain an accepted,
rate-limited enumeration trade-off.

| Route | Body | Success |
|---|---|---|
| `POST /api/accounts/signup` | `{email, password, display_name?}` | `202 {status:"verification_sent", retry_after_secs:30}`; account created unverified, key generated and sealed |
| `POST /api/accounts/verify` | `{email, code}` | `200 {account}` + `nsec` (see Session payload) |
| `POST /api/accounts/resend-code` | `{email, purpose:"verify"\|"reset"}` | `202 {status:"verification_sent", retry_after_secs:30}`; `429 resend_cooldown` while the 30-second cooldown is active |
| `POST /api/accounts/signin` | `{email, password}` | `200` session payload; `403 email_unverified` (a new code is sent) |
| `POST /api/accounts/google` | `{id_token}` | `200` session payload; creates the account on first use (email taken from the verified Google token, marked verified); links to an existing account with the same verified email |
| `POST /api/accounts/reset/request` | `{email}` | `202 {status:"verification_sent", retry_after_secs:30}` always; emails a reset code if the account exists |
| `POST /api/accounts/reset/check` | `{email, code}` | `200 {status:"code_valid"}`; validates without consuming the code |
| `POST /api/accounts/reset/confirm` | `{email, code, new_password}` | `200` session payload (same key as before: history preserved) |
| `POST /api/accounts/claim` | NIP-98 signed; `{email, password, nsec}` | `202 verification_sent`; binds an existing key-based identity to a new account; `nsec` must match the NIP-98 signer |
| `POST /api/accounts/password` | NIP-98 signed; `{new_password}` | `204` |
| `GET /api/accounts/me` | NIP-98 signed | `200 {account}`; `404 {"error":"account_not_found"}` when the signer has no account (clients use this to offer the claim prompt) |
| `DELETE /api/accounts/me` | NIP-98 signed | `204` |

Session payload: `{account: {id, email, pubkey, has_password, google_linked}, nsec}`.
Clients hand `nsec` to the existing `import_identity` path, then drop it from
memory; they never display it.

Signup trims an optional `display_name`, treats blank input as omitted, and
rejects names longer than 80 characters or containing control characters.
The relay signs a Nostr kind 0 profile event with the newly generated account
key. Its content is `{"display_name":"..."}` when a name was provided and
`{}` otherwise. The account, profile event, verification code, and encrypted
mail outbox entry commit in one database transaction. The committed profile
event is also published to the community's global event stream; event history
remains available if live publication fails.

Verification and reset codes expire after 15 minutes and remain single-use.
The relay stores only an HMAC-SHA256 code hash keyed from `COLONY_ACCOUNT_KEK`;
the encrypted outbox copy exists only to support retryable mail delivery.
Five incorrect submissions lock the challenge until expiry. The first four
return `422 {error:"wrong_code", attempts_left:4..1}`; the fifth and later
submissions return `429 {error:"too_many_attempts", retry_after_secs:N}`.
Expired, missing, superseded, and consumed codes return
`410 {error:"code_expired"}`. Resend attempts share a 30-second cooldown per
email and purpose in Redis. Redis errors fail the account request closed.
While a code is locked, resend returns `too_many_attempts` with the remaining
challenge lifetime. `POST /api/accounts/reset/check` counts wrong submissions
but does not consume a valid code. Reset confirmation checks and consumes it
again atomically with the password update.

Google: the relay verifies the ID token signature against Google's JWKS
(cached, respecting cache headers), `iss`, `exp`, `email_verified == true`,
and `aud` in `COLONY_GOOGLE_CLIENT_IDS` (comma-separated: desktop and mobile
client ids). Desktop obtains the ID token with the system browser, OAuth 2.0
PKCE and a loopback redirect; mobile uses the platform Google sign-in SDK.

Mail: Resend HTTP API, `RESEND_API_KEY`, `COLONY_MAIL_FROM`. With
`COLONY_MAIL_SINK=log` (dev/CI only, refused when `RESEND_API_KEY` is set)
the relay writes outgoing codes to a test-only table/log so tests can read
them.

Rate limits: per IP and per email on every route; progressive lockout on
`failed_attempts` (5 failures -> 15 min).

## Client behaviour

- First run offers: Create account (email + password), Continue with Google,
  Sign in. Key import stays only behind an "Advanced: use an existing Nostr
  identity" link.
- Existing key-only identities get a persistent (not onboarding) prompt to
  claim an account: email + password -> verify code. Degrades to "try again
  later" if the relay is unreachable; never blocks local use.
- Forgot password: email -> code -> new password -> signed in.
- The word "key" does not appear outside the advanced path.
