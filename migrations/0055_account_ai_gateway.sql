-- Private managed-session inference billing, independent of checkout providers.
CREATE TABLE account_ai_sessions (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
    agent_pubkey BYTEA NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX account_ai_active_sessions ON account_ai_sessions(account_id, expires_at) WHERE NOT revoked;
CREATE TABLE account_ai_requests (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    session_id UUID NOT NULL REFERENCES account_ai_sessions(id) ON DELETE RESTRICT,
    upstream_id TEXT NOT NULL CHECK (length(upstream_id) BETWEEN 1 AND 64),
    body_sha256 TEXT NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    reserved_nanousd BIGINT NOT NULL CHECK (reserved_nanousd > 0 AND reserved_nanousd <= 400000000),
    charged_nanousd BIGINT CHECK (charged_nanousd >= 0 AND charged_nanousd <= reserved_nanousd),
    generation_id TEXT CHECK (generation_id IS NULL OR length(generation_id) BETWEEN 1 AND 200),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'estimated')),
    usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_nanousd BIGINT CHECK (observed_nanousd >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 seconds',
    recovery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempts BETWEEN 0 AND 16),
    UNIQUE (upstream_id, generation_id),
    CHECK ((status <> 'pending') = (charged_nanousd IS NOT NULL))
);
CREATE UNIQUE INDEX account_ai_one_session_request ON account_ai_requests(session_id) WHERE status = 'pending';
CREATE INDEX account_ai_pending_account ON account_ai_requests(account_id) WHERE status = 'pending';
CREATE INDEX account_ai_recovery_due ON account_ai_requests(next_retry_at) WHERE status = 'pending';
CREATE INDEX account_ai_request_history ON account_ai_requests(account_id, created_at DESC);
INSERT INTO _operator_global_tables (table_name, reason) VALUES
    ('account_ai_sessions', 'deployment-global payer authorization bound to a managed agent and community'),
    ('account_ai_requests', 'deployment-global durable AI spend reservation and reconciliation journal');
