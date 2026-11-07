-- Keep independently-caused send stops durable. The legacy public columns remain the
-- aggregate projection that old desktop clients already read.
ALTER TABLE whatsapp_settings
    ADD COLUMN owner_paused BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN owner_paused_by BYTEA,
    ADD COLUMN owner_paused_at TIMESTAMPTZ,
    ADD COLUMN quality_paused BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN system_paused BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN system_pause_reason TEXT;

ALTER TABLE whatsapp_settings
    ADD CONSTRAINT whatsapp_settings_owner_pause_actor_check
        CHECK (owner_paused_by IS NULL OR octet_length(owner_paused_by) = 32),
    ADD CONSTRAINT whatsapp_settings_system_pause_reason_check
        CHECK (system_pause_reason IS NULL OR char_length(system_pause_reason) <= 500),
    ADD CONSTRAINT whatsapp_settings_owner_pause_metadata_check
        CHECK (
            (owner_paused AND owner_paused_by IS NOT NULL AND owner_paused_at IS NOT NULL)
            OR (NOT owner_paused AND owner_paused_by IS NULL AND owner_paused_at IS NULL)
        );

-- Existing rows have only the aggregate state. Preserve a legacy non-quality pause as a
-- system pause, while retaining the known quality pause as its own recovery source.
UPDATE whatsapp_settings
SET quality_paused = send_paused
        AND pause_reason = 'Quality rating is RED. Sending stopped.',
    system_paused = send_paused
        AND pause_reason IS DISTINCT FROM 'Quality rating is RED. Sending stopped.',
    system_pause_reason = CASE
        WHEN send_paused
             AND pause_reason IS DISTINCT FROM 'Quality rating is RED. Sending stopped.'
            THEN pause_reason
        ELSE NULL
    END;
