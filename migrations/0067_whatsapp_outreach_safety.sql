-- Durable outreach safety: contact opt-outs, owner-maintained never-contact entries, whole
-- business reply stops, and owner-only recovery for an unknown send outcome.
CREATE TABLE whatsapp_suppressions (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    identity_kind TEXT NOT NULL CHECK (identity_kind IN ('phone', 'email', 'domain')),
    identity_value TEXT NOT NULL CHECK (char_length(identity_value) BETWEEN 1 AND 320),
    scope TEXT NOT NULL CHECK (scope IN ('opt_out', 'never_contact')),
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    matched_rule TEXT CHECK (matched_rule IS NULL OR char_length(matched_rule) <= 120),
    source TEXT NOT NULL CHECK (source IN ('inbound', 'owner')),
    created_by BYTEA CHECK (created_by IS NULL OR octet_length(created_by) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    undone_by BYTEA CHECK (undone_by IS NULL OR octet_length(undone_by) = 32),
    undone_at TIMESTAMPTZ,
    undo_reason TEXT CHECK (undo_reason IS NULL OR char_length(undo_reason) <= 500),
    PRIMARY KEY (community_id, id),
    CHECK ((undone_at IS NULL) = (undone_by IS NULL))
);

CREATE UNIQUE INDEX whatsapp_suppressions_active_identity_scope
    ON whatsapp_suppressions (community_id, identity_kind, identity_value, scope)
    WHERE undone_at IS NULL;
CREATE INDEX whatsapp_suppressions_active_lookup
    ON whatsapp_suppressions (community_id, identity_kind, identity_value)
    WHERE undone_at IS NULL;

CREATE TABLE whatsapp_business_stops (
    community_id UUID NOT NULL REFERENCES communities(id),
    business_id TEXT NOT NULL CHECK (char_length(business_id) BETWEEN 1 AND 128),
    source_wa_id TEXT NOT NULL CHECK (source_wa_id ~ '^[0-9]{6,15}$'),
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    matched_rule TEXT CHECK (matched_rule IS NULL OR char_length(matched_rule) <= 120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, business_id)
);

CREATE INDEX whatsapp_business_stops_source
    ON whatsapp_business_stops (community_id, source_wa_id);

CREATE TABLE whatsapp_unknown_send_recoveries (
    community_id UUID NOT NULL REFERENCES communities(id),
    message_id UUID NOT NULL,
    checked_at TIMESTAMPTZ,
    checked_by BYTEA CHECK (checked_by IS NULL OR octet_length(checked_by) = 32),
    marked_delivered_at TIMESTAMPTZ,
    marked_delivered_by BYTEA CHECK (
        marked_delivered_by IS NULL OR octet_length(marked_delivered_by) = 32
    ),
    replacement_message_id UUID,
    replacement_created_at TIMESTAMPTZ,
    replacement_created_by BYTEA CHECK (
        replacement_created_by IS NULL OR octet_length(replacement_created_by) = 32
    ),
    PRIMARY KEY (community_id, message_id),
    FOREIGN KEY (community_id, message_id)
        REFERENCES whatsapp_messages (community_id, id),
    FOREIGN KEY (community_id, replacement_message_id)
        REFERENCES whatsapp_messages (community_id, id),
    CHECK (
        (replacement_message_id IS NULL)
        = (replacement_created_at IS NULL)
        AND (replacement_message_id IS NULL)
        = (replacement_created_by IS NULL)
    )
);

CREATE UNIQUE INDEX whatsapp_unknown_send_recoveries_replacement
    ON whatsapp_unknown_send_recoveries (community_id, replacement_message_id)
    WHERE replacement_message_id IS NOT NULL;

SELECT attach_community_write_fence('whatsapp_suppressions');
SELECT attach_community_write_fence('whatsapp_business_stops');
SELECT attach_community_write_fence('whatsapp_unknown_send_recoveries');
