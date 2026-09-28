-- Pin each execution to the active definition it started with and persist
-- delegated agent waits so replies and expirations survive relay restarts.

ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'waiting_agent';
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'timed_out';

ALTER TABLE workflow_runs
    ADD COLUMN workflow_channel_id UUID,
    ADD COLUMN definition_version BYTEA
        CHECK (definition_version IS NULL OR octet_length(definition_version) = 32),
    ADD COLUMN definition_snapshot JSONB;

CREATE TYPE workflow_agent_wait_status AS ENUM ('pending', 'completed', 'timed_out', 'failed');

CREATE TABLE workflow_agent_waits (
    community_id UUID NOT NULL REFERENCES communities(id),
    workflow_id UUID NOT NULL,
    run_id UUID NOT NULL,
    step_id VARCHAR(64) NOT NULL,
    step_index INT NOT NULL,
    channel_id UUID NOT NULL,
    agent_pubkey BYTEA NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    request_event_id BYTEA NOT NULL CHECK (octet_length(request_event_id) = 32),
    status workflow_agent_wait_status NOT NULL DEFAULT 'pending',
    reply_event_id BYTEA CHECK (reply_event_id IS NULL OR octet_length(reply_event_id) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, run_id, step_id),
    UNIQUE (community_id, request_event_id),
    FOREIGN KEY (community_id, workflow_id)
        REFERENCES workflows (community_id, id) ON DELETE CASCADE,
    FOREIGN KEY (community_id, run_id)
        REFERENCES workflow_runs (community_id, id) ON DELETE CASCADE,
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_workflow_agent_waits_pending_expiry
    ON workflow_agent_waits (expires_at, community_id)
    WHERE status = 'pending';

CREATE INDEX idx_workflow_agent_waits_request
    ON workflow_agent_waits (community_id, request_event_id, agent_pubkey)
    WHERE status = 'pending';

SELECT attach_community_write_fence('workflow_agent_waits');
