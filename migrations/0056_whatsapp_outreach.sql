-- WhatsApp outreach on the official Cloud API, one number per company.
-- Secrets are sealed with the relay KEK (AES-GCM); the plaintext never lands here.
-- A company's settings (cap, Outreach channel, visible issues) survive a disconnect;
-- the connection row, and with it the sealed secrets, does not.
CREATE TABLE whatsapp_settings (
    community_id UUID NOT NULL PRIMARY KEY REFERENCES communities(id),
    daily_new_chat_cap INTEGER NOT NULL DEFAULT 30
        CHECK (daily_new_chat_cap BETWEEN 0 AND 1000),
    outreach_channel_id UUID,
    send_paused BOOLEAN NOT NULL DEFAULT false,
    pause_reason TEXT,
    issues JSONB NOT NULL DEFAULT '[]'::jsonb,
    templates_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (community_id, outreach_channel_id)
        REFERENCES channels (community_id, id)
);

CREATE TABLE whatsapp_connections (
    community_id UUID NOT NULL PRIMARY KEY REFERENCES communities(id),
    id UUID NOT NULL,
    phone_number_id TEXT NOT NULL CHECK (length(phone_number_id) BETWEEN 1 AND 64),
    waba_id TEXT NOT NULL CHECK (length(waba_id) BETWEEN 1 AND 64),
    display_phone_number TEXT,
    verified_name TEXT,
    quality_rating TEXT NOT NULL DEFAULT 'UNKNOWN',
    phone_status TEXT,
    kek_id TEXT NOT NULL,
    sealed_token BYTEA NOT NULL,
    token_nonce BYTEA NOT NULL CHECK (octet_length(token_nonce) = 12),
    sealed_app_secret BYTEA NOT NULL,
    app_secret_nonce BYTEA NOT NULL CHECK (octet_length(app_secret_nonce) = 12),
    verify_token_hash BYTEA NOT NULL CHECK (octet_length(verify_token_hash) = 32),
    created_by BYTEA NOT NULL CHECK (octet_length(created_by) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (community_id, id)
);

CREATE TABLE whatsapp_templates (
    community_id UUID NOT NULL REFERENCES communities(id),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 512),
    language TEXT NOT NULL CHECK (length(language) BETWEEN 1 AND 16),
    category TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    slots INTEGER NOT NULL DEFAULT 0 CHECK (slots BETWEEN 0 AND 64),
    buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, name, language)
);

CREATE TABLE whatsapp_contacts (
    community_id UUID NOT NULL REFERENCES communities(id),
    wa_id TEXT NOT NULL CHECK (wa_id ~ '^[0-9]{6,15}$'),
    display_name TEXT NOT NULL DEFAULT '',
    lead_id TEXT,
    owner_pubkey BYTEA CHECK (owner_pubkey IS NULL OR octet_length(owner_pubkey) = 32),
    thread_root_event_id BYTEA CHECK (
        thread_root_event_id IS NULL OR octet_length(thread_root_event_id) = 32
    ),
    last_inbound_at TIMESTAMPTZ,
    last_outbound_at TIMESTAMPTZ,
    outbound_since_inbound INTEGER NOT NULL DEFAULT 0 CHECK (outbound_since_inbound >= 0),
    opted_out_at TIMESTAMPTZ,
    opt_out_reason TEXT,
    paused_at TIMESTAMPTZ,
    pause_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, wa_id)
);

CREATE TABLE whatsapp_batches (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL,
    created_by BYTEA NOT NULL CHECK (octet_length(created_by) = 32),
    template_name TEXT NOT NULL,
    language TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
    note TEXT NOT NULL DEFAULT '',
    material_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    request_event_id BYTEA CHECK (
        request_event_id IS NULL OR octet_length(request_event_id) = 32
    ),
    decided_by BYTEA CHECK (decided_by IS NULL OR octet_length(decided_by) = 32),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id)
);

-- Inbound and outbound messages. An outbound batch row is a message in state
-- 'held' (pending approval), 'ready' (approved, waiting for its pacing slot) or
-- 'dropped'. One idempotency key is at most one Graph send.
CREATE TABLE whatsapp_messages (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL,
    wa_id TEXT NOT NULL CHECK (wa_id ~ '^[0-9]{6,15}$'),
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    kind TEXT NOT NULL DEFAULT 'text'
        CHECK (kind IN ('text', 'template', 'media', 'button', 'other')),
    body TEXT NOT NULL DEFAULT '',
    template_name TEXT,
    template_language TEXT,
    params JSONB NOT NULL DEFAULT '[]'::jsonb,
    state TEXT NOT NULL
        CHECK (state IN ('held', 'ready', 'dropped', 'skipped', 'queued', 'sending',
                         'sent', 'delivered', 'read', 'failed', 'unconfirmed', 'received')),
    skip_reason TEXT,
    wamid TEXT,
    error_code TEXT,
    error_text TEXT,
    event_id BYTEA CHECK (event_id IS NULL OR octet_length(event_id) = 32),
    idempotency_key TEXT,
    batch_id UUID,
    batch_idx INTEGER,
    new_chat BOOLEAN NOT NULL DEFAULT false,
    sender_pubkey BYTEA CHECK (sender_pubkey IS NULL OR octet_length(sender_pubkey) = 32),
    send_after TIMESTAMPTZ,
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    FOREIGN KEY (community_id, wa_id) REFERENCES whatsapp_contacts (community_id, wa_id),
    FOREIGN KEY (community_id, batch_id) REFERENCES whatsapp_batches (community_id, id),
    UNIQUE (community_id, idempotency_key),
    UNIQUE (community_id, wamid),
    UNIQUE (community_id, batch_id, batch_idx),
    CHECK ((state = 'sending') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX whatsapp_messages_due
    ON whatsapp_messages (community_id, created_at)
    WHERE state IN ('ready', 'queued', 'sending');
CREATE INDEX whatsapp_messages_thread
    ON whatsapp_messages (community_id, wa_id, created_at DESC);
CREATE INDEX whatsapp_messages_new_chat_day
    ON whatsapp_messages (community_id, sent_at)
    WHERE new_chat AND sent_at IS NOT NULL;

SELECT attach_community_write_fence('whatsapp_settings');
SELECT attach_community_write_fence('whatsapp_connections');
SELECT attach_community_write_fence('whatsapp_templates');
SELECT attach_community_write_fence('whatsapp_contacts');
SELECT attach_community_write_fence('whatsapp_batches');
SELECT attach_community_write_fence('whatsapp_messages');
