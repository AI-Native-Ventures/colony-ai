-- Durable scheduled check-in delivery for business-scoped company work watchdogs.
-- The current config is a signed kind:30652 record; this table only journals
-- each explicit schedule occurrence and its bounded delivery retries.
CREATE TABLE company_work_watchdog_deliveries (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    work_item_id UUID NOT NULL,
    config_event_id BYTEA NOT NULL CHECK (octet_length(config_event_id) = 32),
    channel_id UUID NOT NULL,
    thread_root_event_id BYTEA NOT NULL CHECK (octet_length(thread_root_event_id) = 32),
    scheduled_for TIMESTAMPTZ NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'sending', 'delivered', 'cancelled', 'failed')),
    lease_owner TEXT,
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    message_event_id BYTEA CHECK (
        message_event_id IS NULL OR octet_length(message_event_id) = 32
    ),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    FOREIGN KEY (community_id, channel_id)
        REFERENCES channels (community_id, id),
    UNIQUE (community_id, work_item_id, config_event_id, scheduled_for),
    CHECK (
        (state = 'sending' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
            AND lease_until IS NOT NULL)
        OR (state <> 'sending' AND lease_owner IS NULL AND lease_token IS NULL
            AND lease_until IS NULL)
    ),
    CHECK (
        (state = 'delivered' AND message_event_id IS NOT NULL)
        OR (state <> 'delivered' AND message_event_id IS NULL)
    )
);

CREATE INDEX company_work_watchdog_deliveries_due
    ON company_work_watchdog_deliveries (next_attempt_at, scheduled_for)
    WHERE state = 'pending';
CREATE INDEX company_work_watchdog_deliveries_recovery
    ON company_work_watchdog_deliveries (lease_until)
    WHERE state = 'sending';
CREATE INDEX company_work_watchdog_deliveries_work
    ON company_work_watchdog_deliveries (community_id, work_item_id, scheduled_for DESC);

SELECT attach_community_write_fence('company_work_watchdog_deliveries');
