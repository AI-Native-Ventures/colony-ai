-- Cloud agents, second step. 0069 is already applied where it ran, so these changes live in a
-- new migration.

-- Sessions the relay mints for a cloud agent's machine. A cloud session may choose a model the
-- owner pays for (`paid_allowed`) unless the account uses the gateway free.
ALTER TABLE account_ai_sessions
    ADD COLUMN cloud BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN paid_allowed BOOLEAN NOT NULL DEFAULT false;

-- Operations of one agent run in the order they were queued, even when two are queued in one
-- transaction: order by the clock, not the transaction start.
ALTER TABLE cloud_agent_ops ALTER COLUMN created_at SET DEFAULT clock_timestamp();
