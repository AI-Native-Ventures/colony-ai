-- Guessing budgets belong to the email, not to a replaceable code.
CREATE TABLE account_code_failures (
    email TEXT PRIMARY KEY CHECK (email = lower(btrim(email)) AND length(email) <= 254),
    failed_attempts INTEGER NOT NULL CHECK (failed_attempts BETWEEN 1 AND 10),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_code_failures_expiry_idx ON account_code_failures (window_started_at);

INSERT INTO _operator_global_tables (table_name, reason) VALUES
    ('account_code_failures', 'deployment-global hourly email code guessing budgets');
