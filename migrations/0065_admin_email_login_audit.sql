-- Deployment-global audit trail for the allowlisted emailed operator-session flow.
--
-- This table intentionally records only fixed-width keyed hashes of the email
-- and source IP bucket. The one-time code, its salted hash, and its salt stay
-- solely in Redis with a short TTL and never enter Postgres.

CREATE TABLE relay_operator_email_login_audit (
    id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    operation TEXT NOT NULL CHECK (operation IN ('start', 'verify')),
    outcome TEXT NOT NULL CHECK (char_length(outcome) BETWEEN 1 AND 64),
    email_hash BYTEA NOT NULL CHECK (octet_length(email_hash) = 32),
    ip_bucket_hash BYTEA NOT NULL CHECK (octet_length(ip_bucket_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX relay_operator_email_login_audit_recent
    ON relay_operator_email_login_audit (created_at DESC);

INSERT INTO _operator_global_tables (table_name, reason) VALUES
    ('relay_operator_email_login_audit', 'deployment-global append-only audit for emailed operator-session attempts');
