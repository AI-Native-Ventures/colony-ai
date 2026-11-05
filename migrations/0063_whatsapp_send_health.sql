-- Durable WhatsApp send-health state. Account health is kept separately from the generic
-- settings issue list so a confirmed later send can clear exactly this automatic pause. A
-- recipient engagement retry stays failed until its due time; it never relies on a desktop
-- timer or an in-memory worker task.
ALTER TABLE whatsapp_settings
    ADD COLUMN account_health_code TEXT CHECK (
        account_health_code IS NULL OR char_length(account_health_code) BETWEEN 1 AND 64
    ),
    ADD COLUMN account_health_text TEXT CHECK (
        account_health_text IS NULL OR char_length(account_health_text) BETWEEN 1 AND 500
    ),
    ADD COLUMN account_health_at TIMESTAMPTZ,
    ADD COLUMN account_health_resume_requested_at TIMESTAMPTZ;

ALTER TABLE whatsapp_contacts
    ADD COLUMN retry_after TIMESTAMPTZ;

CREATE INDEX whatsapp_contacts_retry_due
    ON whatsapp_contacts (community_id, retry_after)
    WHERE retry_after IS NOT NULL;
