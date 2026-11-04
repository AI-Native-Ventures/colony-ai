-- Inbound WhatsApp media (images, video, voice notes, audio, documents, stickers, locations,
-- contact cards). Until now only a text placeholder was kept, so the Meta media id was lost and
-- the picture could never be fetched (Meta media ids expire after 30 days).
--
-- media:          what the webhook said about the media: {type, mediaId, mime, sha256, caption,
--                 filename, animated, voice, ...}. Location and contact cards live here in full
--                 because they have nothing to download.
-- media_state:    NULL = no media or nothing to download; pending = download not done yet (or
--                 being retried); stored = the bytes are in the community media store;
--                 failed = gave up or refused, the owner may retry; gone = Meta no longer has it.
-- media_stored:   {sha256, ext, mime, size, opaque} of the stored blob (the file is served from
--                 /media/<sha256>.<ext> on the community host).
-- media_attempts / media_retry_at / media_error: the durable retry record. A failed download
--                 backs off and is retried by the sender loop; it is never silently dropped.
-- media_linked:   the Colony message event already carries the media link. When a download
--                 finishes after the event was posted, one follow-up message adds the link.
ALTER TABLE whatsapp_messages
    ADD COLUMN media JSONB,
    ADD COLUMN media_state TEXT CHECK (
        media_state IS NULL OR media_state IN ('pending', 'stored', 'failed', 'gone')
    ),
    ADD COLUMN media_stored JSONB,
    ADD COLUMN media_attempts INTEGER NOT NULL DEFAULT 0 CHECK (media_attempts >= 0),
    ADD COLUMN media_retry_at TIMESTAMPTZ,
    ADD COLUMN media_error TEXT,
    ADD COLUMN media_linked BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX whatsapp_messages_media_due
    ON whatsapp_messages (community_id, media_retry_at)
    WHERE media_state = 'pending';
