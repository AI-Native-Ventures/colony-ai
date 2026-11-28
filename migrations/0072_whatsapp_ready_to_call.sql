-- "Ready to call": a pipeline stage a person sets by hand between `wants_call` and
-- `call_booked`, and the call brief that goes with it. All additive; apps and rows that predate
-- it keep working.
--
-- manual_stage gains 'ready_to_call': the preparation for the call is done.
-- call_brief_link: where the prepared work is (a preview site, a quote, a folder).
-- call_brief_note: what the person who calls needs to know.
-- call_assignee: the person who will phone the business and close the deal. Never an agent.
-- call_brief_by / call_brief_at: who last changed the brief and when (set together or not at
-- all).
ALTER TABLE whatsapp_contacts
    DROP CONSTRAINT whatsapp_contacts_manual_stage_check;

ALTER TABLE whatsapp_contacts
    ADD CONSTRAINT whatsapp_contacts_manual_stage_check CHECK (
        manual_stage IS NULL OR manual_stage IN
            ('contacted', 'replied', 'wants_call', 'ready_to_call', 'call_booked', 'quote_sent',
             'client', 'no_thanks')
    ),
    ADD COLUMN call_brief_link TEXT CHECK (
        call_brief_link IS NULL OR char_length(call_brief_link) BETWEEN 1 AND 2000
    ),
    ADD COLUMN call_brief_note TEXT CHECK (
        call_brief_note IS NULL OR char_length(call_brief_note) BETWEEN 1 AND 2000
    ),
    ADD COLUMN call_assignee BYTEA CHECK (
        call_assignee IS NULL OR octet_length(call_assignee) = 32
    ),
    ADD COLUMN call_brief_by BYTEA CHECK (
        call_brief_by IS NULL OR octet_length(call_brief_by) = 32
    ),
    ADD COLUMN call_brief_at TIMESTAMPTZ,
    ADD CONSTRAINT whatsapp_contacts_call_brief_complete CHECK (
        (call_brief_by IS NULL) = (call_brief_at IS NULL)
    );
