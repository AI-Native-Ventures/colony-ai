-- Bounded retry of the Colony post that mirrors a WhatsApp message. A post that fails is
-- retried with exponential backoff (5 s doubling to 1 h) instead of every 5 s for ever, and
-- after 24 failed attempts the row stops being retried (`post_gave_up_at`). The WhatsApp
-- message itself is untouched: the thread API reads it from this table, so nothing is lost.
ALTER TABLE whatsapp_messages
    ADD COLUMN post_attempts INTEGER NOT NULL DEFAULT 0 CHECK (post_attempts >= 0),
    ADD COLUMN post_retry_at TIMESTAMPTZ,
    ADD COLUMN post_gave_up_at TIMESTAMPTZ;
