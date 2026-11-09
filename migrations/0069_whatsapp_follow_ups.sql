-- Owner-controlled WhatsApp follow-up sequences. Every due item is durable and unique per
-- campaign or list, contact and step, so a restart or retry cannot create a second send.
CREATE TABLE whatsapp_follow_up_sequences (
    community_id UUID NOT NULL REFERENCES communities(id),
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('outreach_list', 'campaign')),
    scope_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_by BYTEA NOT NULL CHECK (octet_length(created_by) = 32),
    updated_by BYTEA NOT NULL CHECK (octet_length(updated_by) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, scope_kind, scope_id)
);

CREATE TABLE whatsapp_follow_up_steps (
    community_id UUID NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id UUID NOT NULL,
    step SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 3),
    delay_days SMALLINT NOT NULL CHECK (delay_days BETWEEN 1 AND 90),
    PRIMARY KEY (community_id, scope_kind, scope_id, step),
    FOREIGN KEY (community_id, scope_kind, scope_id)
        REFERENCES whatsapp_follow_up_sequences (community_id, scope_kind, scope_id)
        ON DELETE CASCADE
);

ALTER TABLE whatsapp_messages
    ADD COLUMN follow_up_scope_kind TEXT CHECK (
        follow_up_scope_kind IS NULL OR follow_up_scope_kind IN ('outreach_list', 'campaign')
    ),
    ADD COLUMN follow_up_scope_id UUID,
    ADD COLUMN follow_up_due_id UUID,
    ADD CONSTRAINT whatsapp_messages_follow_up_scope_complete
        CHECK ((follow_up_scope_kind IS NULL) = (follow_up_scope_id IS NULL));

CREATE UNIQUE INDEX whatsapp_messages_follow_up_due_unique
    ON whatsapp_messages (community_id, follow_up_due_id)
    WHERE follow_up_due_id IS NOT NULL;

CREATE TABLE whatsapp_follow_up_due (
    community_id UUID NOT NULL REFERENCES communities(id),
    id UUID NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('outreach_list', 'campaign')),
    scope_id UUID NOT NULL,
    wa_id TEXT NOT NULL CHECK (wa_id ~ '^[0-9]{6,15}$'),
    business_id TEXT,
    step SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 3),
    predecessor_message_id UUID NOT NULL,
    draft_message_id UUID,
    due_at TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN ('scheduled', 'held', 'draft', 'ready', 'sending', 'sent', 'stopped', 'done')
    ),
    reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, id),
    FOREIGN KEY (community_id, wa_id)
        REFERENCES whatsapp_contacts (community_id, wa_id),
    FOREIGN KEY (community_id, scope_kind, scope_id)
        REFERENCES whatsapp_follow_up_sequences (community_id, scope_kind, scope_id),
    UNIQUE (community_id, draft_message_id)
);

CREATE UNIQUE INDEX whatsapp_follow_up_due_lead_step_unique
    ON whatsapp_follow_up_due (
        community_id, scope_kind, scope_id, COALESCE(business_id, wa_id), step
    );
CREATE INDEX whatsapp_follow_up_due_pending
    ON whatsapp_follow_up_due (community_id, due_at, state)
    WHERE state IN ('scheduled', 'held', 'draft', 'ready');
CREATE INDEX whatsapp_follow_up_due_business
    ON whatsapp_follow_up_due (community_id, business_id)
    WHERE state IN ('scheduled', 'held', 'draft', 'ready', 'sending');

ALTER TABLE whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_follow_up_due_fkey
        FOREIGN KEY (community_id, follow_up_due_id)
        REFERENCES whatsapp_follow_up_due (community_id, id)
        ON DELETE SET NULL (follow_up_due_id);
ALTER TABLE whatsapp_follow_up_due
    ADD CONSTRAINT whatsapp_follow_up_due_predecessor_fkey
        FOREIGN KEY (community_id, predecessor_message_id)
        REFERENCES whatsapp_messages (community_id, id),
    ADD CONSTRAINT whatsapp_follow_up_due_draft_fkey
        FOREIGN KEY (community_id, draft_message_id)
        REFERENCES whatsapp_messages (community_id, id);

SELECT attach_community_write_fence('whatsapp_follow_up_sequences');
SELECT attach_community_write_fence('whatsapp_follow_up_steps');
SELECT attach_community_write_fence('whatsapp_follow_up_due');
