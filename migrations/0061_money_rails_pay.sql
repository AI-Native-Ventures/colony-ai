-- Money rails, payment links from any provider (docs/money-rails-pay-contract.md).
-- Additive only: new tables, nothing existing is changed. Provider keys and signing secrets are
-- sealed with the relay KEK (AES-GCM); the plaintext never lands here.
CREATE TABLE money_rails_connections (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL,
    notice_id UUID NOT NULL,
    provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 48),
    route TEXT NOT NULL CHECK (route IN ('api', 'browser')),
    status TEXT NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'needs_attention', 'disconnected')),
    is_default BOOLEAN NOT NULL DEFAULT false,
    config JSONB NOT NULL,
    kek_id TEXT,
    sealed_api_key BYTEA,
    api_key_nonce BYTEA CHECK (api_key_nonce IS NULL OR octet_length(api_key_nonce) = 12),
    sealed_signing_secret BYTEA,
    signing_secret_nonce BYTEA
        CHECK (signing_secret_nonce IS NULL OR octet_length(signing_secret_nonce) = 12),
    created_by BYTEA NOT NULL CHECK (octet_length(created_by) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, notice_id),
    CHECK ((sealed_api_key IS NULL) = (api_key_nonce IS NULL)),
    CHECK ((sealed_signing_secret IS NULL) = (signing_secret_nonce IS NULL)),
    CHECK ((sealed_api_key IS NULL AND sealed_signing_secret IS NULL) OR kek_id IS NOT NULL)
);

CREATE UNIQUE INDEX money_rails_connections_one_default
    ON money_rails_connections (community_id)
    WHERE is_default AND status <> 'disconnected';

-- The private side of a payment link card. The full address never enters an event; the head
-- carries only this row's opaque reference and a masked display. Rows are never updated: a
-- changed recipient is a new reference, so an approval stays pinned to the address it covered.
CREATE TABLE money_rails_recipients (
    community_id UUID NOT NULL REFERENCES communities(id),
    recipient_ref UUID NOT NULL,
    link_id UUID NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
    address TEXT NOT NULL CHECK (length(address) BETWEEN 3 AND 254),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 400),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, recipient_ref)
);

CREATE INDEX money_rails_recipients_link
    ON money_rails_recipients (community_id, link_id);

-- Durable work for a card: create the link, send the message, record payment evidence, expire
-- the link, close the browser window. One row per (card, kind); the sweeper leases due rows and
-- retries with a bounded backoff.
CREATE TABLE money_rails_jobs (
    community_id UUID NOT NULL REFERENCES communities(id),
    link_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('create', 'send', 'evidence', 'expire', 'grant')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 400),
    done_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, link_id, kind)
);

CREATE INDEX money_rails_jobs_due
    ON money_rails_jobs (next_at)
    WHERE done_at IS NULL;

-- Payment notices posted to a connection's private address. Raw bodies are kept 90 days and
-- then reduced to the evidence fields; the dedupe row stays so a replay is still a duplicate.
CREATE TABLE money_rails_notices (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL,
    connection_id UUID NOT NULL,
    dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) <= 300),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    body BYTEA CHECK (body IS NULL OR octet_length(body) <= 65536),
    signature_state TEXT NOT NULL
        CHECK (signature_state IN ('verified', 'invalid', 'unsigned', 'no_secret')),
    signature_header TEXT CHECK (signature_header IS NULL OR length(signature_header) <= 512),
    link_id UUID,
    reference TEXT CHECK (reference IS NULL OR length(reference) <= 200),
    amount_minor BIGINT,
    currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
    judgement TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (judgement IN ('unmatched', 'ignored', 'reported', 'verified')),
    reduced_at TIMESTAMPTZ,
    PRIMARY KEY (community_id, id),
    UNIQUE (community_id, connection_id, dedupe_key),
    FOREIGN KEY (community_id, connection_id)
        REFERENCES money_rails_connections (community_id, id)
);

CREATE INDEX money_rails_notices_link
    ON money_rails_notices (community_id, link_id)
    WHERE link_id IS NOT NULL;
CREATE INDEX money_rails_notices_rate
    ON money_rails_notices (community_id, connection_id, received_at DESC);
CREATE INDEX money_rails_notices_reduce
    ON money_rails_notices (received_at)
    WHERE body IS NOT NULL;

SELECT attach_community_write_fence('money_rails_connections');
SELECT attach_community_write_fence('money_rails_recipients');
SELECT attach_community_write_fence('money_rails_jobs');
SELECT attach_community_write_fence('money_rails_notices');
