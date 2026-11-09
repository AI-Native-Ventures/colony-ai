-- Durable, bounded reconciliation for legacy outbound contacts that were created without a
-- business id. A no-match or ambiguity receives a durable check timestamp so later contacts
-- are not starved and a sender restart can retry the unresolved row safely.
ALTER TABLE whatsapp_contacts
    ADD COLUMN lead_link_checked_at TIMESTAMPTZ;

CREATE INDEX whatsapp_contacts_lead_link_due
    ON whatsapp_contacts (community_id, lead_link_checked_at, created_at, wa_id)
    WHERE lead_id IS NULL;
