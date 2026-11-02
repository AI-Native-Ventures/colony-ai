-- Operator admin: precomputed counts for the admin boards (docs/admin-api-contract.md).
--
-- Every table here is deployment-global (operator-only reads), holds counts, ids and
-- timestamps only, and never a message, a WhatsApp text or lead data. The rollup tables are
-- rebuilt idempotently by the relay's metrics job, so a day can always be recomputed from
-- events, users and the AI journal; the collector tables are written live by the relay.

-- One row per UTC day: the headline people and business counts.
CREATE TABLE metrics_daily_active (
    day DATE PRIMARY KEY,
    dau INTEGER NOT NULL CHECK (dau >= 0),
    wau INTEGER NOT NULL CHECK (wau >= 0),
    mau INTEGER NOT NULL CHECK (mau >= 0),
    people_total INTEGER NOT NULL CHECK (people_total >= 0),
    new_people INTEGER NOT NULL CHECK (new_people >= 0),
    new_accounts INTEGER NOT NULL CHECK (new_accounts >= 0),
    businesses_total INTEGER NOT NULL CHECK (businesses_total >= 0),
    businesses_archived INTEGER NOT NULL CHECK (businesses_archived >= 0),
    businesses_active_7d INTEGER NOT NULL CHECK (businesses_active_7d >= 0),
    businesses_created INTEGER NOT NULL CHECK (businesses_created >= 0),
    agents_total INTEGER NOT NULL CHECK (agents_total >= 0),
    agents_scout INTEGER NOT NULL CHECK (agents_scout >= 0),
    agents_active_7d INTEGER NOT NULL CHECK (agents_active_7d >= 0),
    agents_never_started INTEGER NOT NULL CHECK (agents_never_started >= 0),
    -- false while the day is still running (refreshed every 15 minutes), true once finalised.
    is_final BOOLEAN NOT NULL DEFAULT false,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which humans were active in which business on which day (a count of events, no content).
-- DAU, WAU and MAU are distinct pubkeys over this table, so the nightly job scans one day of
-- events, never a 30 day window.
CREATE TABLE metrics_person_daily (
    day DATE NOT NULL,
    community_id UUID NOT NULL,
    pubkey BYTEA NOT NULL CHECK (octet_length(pubkey) = 32),
    human_events INTEGER NOT NULL CHECK (human_events > 0),
    last_event_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (day, community_id, pubkey)
);
CREATE INDEX metrics_person_daily_by_community ON metrics_person_daily (community_id, day);
CREATE INDEX metrics_person_daily_by_person ON metrics_person_daily (pubkey, day);

-- Per agent per day: events published, and the mention-to-answer pairs behind the
-- "answers within 5 minutes" rate (an answer is a reply by that agent in the same channel).
CREATE TABLE metrics_agent_daily (
    day DATE NOT NULL,
    community_id UUID NOT NULL,
    agent_pubkey BYTEA NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    events INTEGER NOT NULL DEFAULT 0 CHECK (events >= 0),
    last_event_at TIMESTAMPTZ,
    mentions INTEGER NOT NULL DEFAULT 0 CHECK (mentions >= 0),
    answered_5m INTEGER NOT NULL DEFAULT 0 CHECK (answered_5m >= 0 AND answered_5m <= mentions),
    answer_seconds_sum BIGINT NOT NULL DEFAULT 0 CHECK (answer_seconds_sum >= 0),
    PRIMARY KEY (day, community_id, agent_pubkey)
);
CREATE INDEX metrics_agent_daily_by_community ON metrics_agent_daily (community_id, day);

-- Free AI gateway usage per day per business per model, from the AI journal.
CREATE TABLE metrics_ai_daily (
    day DATE NOT NULL,
    community_id UUID NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    requests BIGINT NOT NULL CHECK (requests >= 0),
    settled BIGINT NOT NULL CHECK (settled >= 0),
    estimated BIGINT NOT NULL CHECK (estimated >= 0),
    rejected BIGINT NOT NULL CHECK (rejected >= 0),
    input_tokens BIGINT NOT NULL CHECK (input_tokens >= 0),
    output_tokens BIGINT NOT NULL CHECK (output_tokens >= 0),
    charged_nanousd BIGINT NOT NULL CHECK (charged_nanousd >= 0),
    PRIMARY KEY (day, community_id, model)
);
CREATE INDEX metrics_ai_daily_by_community ON metrics_ai_daily (community_id, day);

-- App opens: one row per person per business per day, written when a WebSocket connection
-- authenticates. A new session starts when the previous connection was over 30 minutes ago.
-- app_version is the desktop's own version from the AUTH event's client tag, when it sent one.
CREATE TABLE metrics_app_sessions_daily (
    day DATE NOT NULL,
    community_id UUID NOT NULL,
    pubkey BYTEA NOT NULL CHECK (octet_length(pubkey) = 32),
    sessions INTEGER NOT NULL DEFAULT 1 CHECK (sessions >= 1),
    connections INTEGER NOT NULL DEFAULT 1 CHECK (connections >= 1),
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    app_version TEXT CHECK (app_version IS NULL OR char_length(app_version) BETWEEN 1 AND 40),
    PRIMARY KEY (day, community_id, pubkey)
);
CREATE INDEX metrics_app_sessions_daily_by_person ON metrics_app_sessions_daily (pubkey, day);

-- Relay HTTP responses per hour per route template: the 5xx counter.
CREATE TABLE metrics_http_hourly (
    hour TIMESTAMPTZ NOT NULL,
    route TEXT NOT NULL CHECK (char_length(route) BETWEEN 1 AND 200),
    requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
    errors_4xx BIGINT NOT NULL DEFAULT 0 CHECK (errors_4xx >= 0),
    errors_5xx BIGINT NOT NULL DEFAULT 0 CHECK (errors_5xx >= 0),
    PRIMARY KEY (hour, route)
);

-- How each free AI gateway request ended, per hour: answered, handed to the next model,
-- refused, timed out. handed_on is true when more than one model was called.
CREATE TABLE metrics_gateway_outcomes_hourly (
    hour TIMESTAMPTZ NOT NULL,
    outcome TEXT NOT NULL CHECK (char_length(outcome) BETWEEN 1 AND 40),
    handed_on BOOLEAN NOT NULL,
    requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
    PRIMARY KEY (hour, outcome, handed_on)
);

-- Append-only record of operator reads of the admin boards. Roster changes keep their own
-- trail in relay_operator_audit; this one holds reads only (actor, route, time).
CREATE TABLE relay_operator_read_audit (
    id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_pubkey BYTEA NOT NULL CHECK (octet_length(actor_pubkey) = 32),
    route TEXT NOT NULL CHECK (char_length(route) BETWEEN 1 AND 200),
    read_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX relay_operator_read_audit_recent ON relay_operator_read_audit (read_at DESC);

INSERT INTO _operator_global_tables (table_name, reason) VALUES
    ('metrics_daily_active', 'deployment-global daily people and business rollup for the operator admin'),
    ('metrics_person_daily', 'deployment-global per-person activity counts for the operator admin'),
    ('metrics_agent_daily', 'deployment-global per-agent activity and answer counts for the operator admin'),
    ('metrics_ai_daily', 'deployment-global free AI gateway rollup for the operator admin'),
    ('metrics_app_sessions_daily', 'deployment-global app session counter for the operator admin'),
    ('metrics_http_hourly', 'deployment-global relay HTTP response counter'),
    ('metrics_gateway_outcomes_hourly', 'deployment-global free AI gateway outcome counter'),
    ('relay_operator_read_audit', 'deployment-global append-only record of operator admin reads');

-- Model and token counts become real columns, filled by the database from the stored usage
-- JSON. Rows written before this migration are backfilled by the same expression, and the
-- columns can never drift from the usage the gateway recorded.
ALTER TABLE account_ai_requests
    ADD COLUMN model TEXT GENERATED ALWAYS AS (NULLIF(left(usage ->> 'model', 120), '')) STORED,
    ADD COLUMN input_tokens BIGINT GENERATED ALWAYS AS (
        CASE WHEN usage ->> 'prompt_tokens' ~ '^[0-9]{1,15}$'
             THEN (usage ->> 'prompt_tokens')::bigint END
    ) STORED,
    ADD COLUMN output_tokens BIGINT GENERATED ALWAYS AS (
        CASE WHEN usage ->> 'completion_tokens' ~ '^[0-9]{1,15}$'
             THEN (usage ->> 'completion_tokens')::bigint END
    ) STORED;
CREATE INDEX account_ai_requests_created ON account_ai_requests (created_at);
