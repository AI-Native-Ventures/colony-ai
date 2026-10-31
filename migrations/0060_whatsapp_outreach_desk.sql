-- Outreach desk: a person's stage and label for a WhatsApp contact, and the intent of an
-- inbound quick-reply tap. All additive; apps and rows that predate the desk keep working.
--
-- manual_stage / manual_stage_by / manual_stage_at: the stage an owner, admin, Scout or Outreach
-- member set by hand (set together or not at all). It wins over derived signals until a newer
-- WhatsApp event implies a later stage (see buzz_core::whatsapp_stage).
-- label: the owner's name for the contact; shown instead of the WhatsApp profile name.
-- whatsapp_messages.intent: 'wants_call' when an inbound tap was on the template's first
-- quick-reply button (the positive one).
ALTER TABLE whatsapp_contacts
    ADD COLUMN label TEXT CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 120),
    ADD COLUMN manual_stage TEXT CHECK (
        manual_stage IS NULL OR manual_stage IN
            ('contacted', 'replied', 'wants_call', 'call_booked', 'quote_sent', 'client', 'no_thanks')
    ),
    ADD COLUMN manual_stage_by BYTEA CHECK (
        manual_stage_by IS NULL OR octet_length(manual_stage_by) = 32
    ),
    ADD COLUMN manual_stage_at TIMESTAMPTZ,
    ADD CONSTRAINT whatsapp_contacts_manual_stage_complete CHECK (
        (manual_stage IS NULL) = (manual_stage_by IS NULL)
        AND (manual_stage IS NULL) = (manual_stage_at IS NULL)
    );

ALTER TABLE whatsapp_messages
    ADD COLUMN intent TEXT CHECK (intent IS NULL OR intent IN ('wants_call'));

-- Taps recorded before the desk had no intent. The two known positive openers are read by their
-- literal text, once; later taps are classified from the stored template buttons.
UPDATE whatsapp_messages
   SET intent = 'wants_call'
 WHERE direction = 'in' AND kind = 'button' AND intent IS NULL
   AND lower(btrim(body)) IN ('yes, call me', 'yes, tell me more');

-- Old opt-outs all read "asked to stop". They stay as they are and read as stopped.
