-- Durable queue of wakes for Scout in co-founder mode. A wake is a reason
-- (daily start, inbound reply, worker finished, approval given, deadline near)
-- that the relay turns into one short message to Scout. The unique dedupe key
-- makes every wake idempotent, and a worker coalesces everything pending into
-- one message per company per interval, so a burst of events cannot storm Scout.
-- The queue holds reasons and ids only, never message text from outside the
-- company.
CREATE TABLE cofounder_wakes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id),
    reason TEXT NOT NULL
        CHECK (reason IN ('mode_on', 'daily_start', 'inbound_reply', 'worker_finished',
                          'approval_given', 'deadline_near')),
    dedupe_key TEXT NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
    detail TEXT NOT NULL DEFAULT '' CHECK (char_length(detail) <= 300),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'skipped')),
    outcome TEXT NOT NULL DEFAULT '' CHECK (char_length(outcome) <= 300),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    message_event_id BYTEA,
    UNIQUE (community_id, dedupe_key)
);

CREATE INDEX cofounder_wakes_pending
    ON cofounder_wakes (community_id, next_attempt_at)
    WHERE status = 'pending';
CREATE INDEX cofounder_wakes_delivered
    ON cofounder_wakes (community_id, delivered_at DESC)
    WHERE status = 'delivered';

SELECT attach_community_write_fence('cofounder_wakes');
