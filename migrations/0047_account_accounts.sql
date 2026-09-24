-- Deployment-global email, password, and Google accounts. These identities
-- follow a pubkey across communities and are deliberately outside community
-- deletion. Custody ciphertext and verification records are tied to one account.
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254),
    email_verified_at TIMESTAMPTZ,
    pubkey TEXT NOT NULL UNIQUE CHECK (pubkey ~ '^[0-9a-f]{64}$'),
    password_hash TEXT,
    wrapped_dek BYTEA NOT NULL CHECK (octet_length(wrapped_dek) >= 28),
    kek_id TEXT NOT NULL CHECK (length(kek_id) BETWEEN 1 AND 64),
    sealed_nsec BYTEA NOT NULL CHECK (octet_length(sealed_nsec) >= 16),
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_signin_at TIMESTAMPTZ,
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ
);
CREATE UNIQUE INDEX accounts_email_lower_key ON accounts (lower(email));

CREATE TABLE account_google_identities (
    sub TEXT PRIMARY KEY CHECK (length(sub) BETWEEN 1 AND 255),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_google_identities_account_idx ON account_google_identities (account_id);

CREATE TABLE account_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    code_hash BYTEA NOT NULL CHECK (octet_length(code_hash) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_codes_one_active_purpose
    ON account_codes (account_id, purpose) WHERE consumed_at IS NULL;
CREATE INDEX account_codes_expiry_idx ON account_codes (expires_at);

-- Durable encrypted mail payloads let request handlers return the contract's
-- generic 202 without losing a message when Resend is temporarily unavailable.
CREATE TABLE account_mail_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    code_id UUID NOT NULL UNIQUE REFERENCES account_codes(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL CHECK (length(recipient) <= 254),
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    code_ciphertext BYTEA NOT NULL CHECK (octet_length(code_ciphertext) >= 16),
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claim_token UUID,
    delivered_at TIMESTAMPTZ,
    last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 64)
);
CREATE INDEX account_mail_outbox_due_idx
    ON account_mail_outbox (next_attempt_at, created_at)
    WHERE delivered_at IS NULL;

-- Used only by COLONY_MAIL_SINK=log in development and CI. Production mail
-- delivery never writes plaintext verification codes to this table.
CREATE TABLE account_test_mail (
    outbox_id UUID PRIMARY KEY REFERENCES account_mail_outbox(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL CHECK (length(recipient) <= 254),
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    code TEXT NOT NULL CHECK (code ~ '^[0-9]{6}$'),
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO _operator_global_tables (table_name, reason) VALUES
    ('accounts', 'deployment-global identities and server-held signing-key custody'),
    ('account_google_identities', 'deployment-global provider links to account identities'),
    ('account_codes', 'deployment-global one-time account recovery and verification codes'),
    ('account_mail_outbox', 'deployment-global durable account email delivery retry queue'),
    ('account_test_mail', 'development and CI account mail sink; not tenant-visible');
