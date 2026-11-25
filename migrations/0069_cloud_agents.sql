-- Cloud agents: where each managed agent works ("This Mac" or "Cloud"), the sealed key and
-- runnable config the relay needs to start the agent's cloud machine, the durable journal
-- of Fly operations, and the once-per-account starter credit marker.
--
-- One row per agent that has uploaded a cloud bundle. The agent nsec is sealed with the
-- deployment key (envelope encryption, the same scheme as account keys) and is only
-- decrypted to configure that agent's own machine. The home token and boot token are
-- stored as SHA-256 hashes only.

CREATE TABLE cloud_agents (
    community_id UUID NOT NULL REFERENCES communities(id),
    agent_pubkey BYTEA NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    owner_pubkey BYTEA NOT NULL CHECK (octet_length(owner_pubkey) = 32),
    home TEXT NOT NULL DEFAULT 'mac' CHECK (home IN ('mac', 'cloud')),
    generation BIGINT NOT NULL DEFAULT 0 CHECK (generation >= 0),
    cloud_model TEXT CHECK (cloud_model IS NULL OR char_length(cloud_model) BETWEEN 1 AND 120),
    status TEXT CHECK (status IS NULL OR status IN ('asleep', 'waking', 'working', 'failed', 'outOfCredit')),
    wrapped_dek BYTEA NOT NULL CHECK (octet_length(wrapped_dek) >= 28),
    sealed_nsec BYTEA NOT NULL CHECK (octet_length(sealed_nsec) >= 16),
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
    kek_id TEXT NOT NULL CHECK (char_length(kek_id) BETWEEN 1 AND 64),
    auth_tag TEXT CHECK (auth_tag IS NULL OR char_length(auth_tag) <= 2048),
    config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
    config_version BIGINT NOT NULL DEFAULT 0 CHECK (config_version >= 0),
    fly_machine_id TEXT CHECK (fly_machine_id IS NULL OR char_length(fly_machine_id) BETWEEN 1 AND 64),
    fly_volume_id TEXT CHECK (fly_volume_id IS NULL OR char_length(fly_volume_id) BETWEEN 1 AND 64),
    home_token_hash BYTEA CHECK (home_token_hash IS NULL OR octet_length(home_token_hash) = 32),
    boot_token_hash BYTEA CHECK (boot_token_hash IS NULL OR octet_length(boot_token_hash) = 32),
    boot_token_expires_at TIMESTAMPTZ,
    wake_attempts INTEGER NOT NULL DEFAULT 0 CHECK (wake_attempts >= 0),
    last_wake_at TIMESTAMPTZ,
    last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, agent_pubkey),
    CHECK ((home = 'cloud') = (status IS NOT NULL)),
    CHECK ((boot_token_hash IS NULL) = (boot_token_expires_at IS NULL))
);

-- Boot tokens are looked up by hash alone (the machine knows no community), so this
-- index does not lead with community_id. It is not unique: tokens are 256 random bits.
CREATE INDEX cloud_agents_boot_token_lookup
    ON cloud_agents (boot_token_hash)
    WHERE boot_token_hash IS NOT NULL;
CREATE INDEX cloud_agents_owner_cloud
    ON cloud_agents (owner_pubkey)
    WHERE home = 'cloud';
CREATE INDEX cloud_agents_machines
    ON cloud_agents (community_id)
    WHERE fly_machine_id IS NOT NULL;

SELECT attach_community_write_fence('cloud_agents');

-- Durable journal of Fly operations. A worker claims a due operation with a short lease, so
-- a crash never loses it and never runs it twice at once. An operation older than the
-- agent's current placement generation is skipped by the worker.
CREATE TABLE cloud_agent_ops (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id),
    agent_pubkey BYTEA NOT NULL CHECK (octet_length(agent_pubkey) = 32),
    op TEXT NOT NULL CHECK (op IN ('ensure', 'start', 'stop', 'destroy')),
    generation BIGINT NOT NULL CHECK (generation >= 0),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_until TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id)
);

CREATE UNIQUE INDEX cloud_agent_ops_pending_once
    ON cloud_agent_ops (community_id, agent_pubkey, op, generation)
    WHERE status = 'pending';
CREATE INDEX cloud_agent_ops_due
    ON cloud_agent_ops (next_attempt_at)
    WHERE status = 'pending';

SELECT attach_community_write_fence('cloud_agent_ops');

-- Each account gets one starter credit, the first time it puts an agent in the cloud.
CREATE TABLE cloud_starter_grants (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO _operator_global_tables (table_name, reason) VALUES
    ('cloud_starter_grants', 'deployment-global once-per-account cloud starter credit marker');
