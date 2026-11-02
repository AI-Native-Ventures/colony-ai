import * as React from "react";
import {
  ImageOff,
  Loader2,
  MapPin,
  Mic,
  Paperclip,
  Phone,
  RotateCcw,
  Sticker,
  UserRound,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { AudioMessageAttachment } from "@/features/messages/ui/AudioMessageAttachment";
import { KIND_WHATSAPP_CONTACT_UPDATE } from "@/shared/constants/kinds";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { Button } from "@/shared/ui/button";
import { FileCard } from "@/shared/ui/markdown/FileCard";
import { SimpleImageLightbox } from "@/shared/ui/SimpleImageLightbox";
import {
  whatsappMessagePreview,
  type WhatsAppMedia,
  type WhatsAppMediaType,
  type WhatsAppMessage,
} from "./whatsappOutreachModels";
import { useWhatsAppCommand } from "./whatsappOutreachQueries";

const NOUN: Record<WhatsAppMediaType, string> = {
  image: "photo",
  video: "video",
  audio: "audio file",
  voice: "voice note",
  document: "document",
  sticker: "sticker",
  location: "location",
  contacts: "contact card",
};

function capitalised(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function mapsHref(media: WhatsAppMedia): string | null {
  if (media.latitude === null || media.longitude === null) return null;
  return `https://www.google.com/maps?q=${media.latitude},${media.longitude}`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/gu, "")}`;
}

function mediaIcon(type: WhatsAppMediaType) {
  if (type === "sticker") return <Sticker aria-hidden="true" size={18} />;
  if (type === "voice" || type === "audio") {
    return <Mic aria-hidden="true" size={18} />;
  }
  if (type === "video") return <Video aria-hidden="true" size={18} />;
  if (type === "location") return <MapPin aria-hidden="true" size={18} />;
  if (type === "contacts") return <UserRound aria-hidden="true" size={18} />;
  if (type === "image") return <ImageOff aria-hidden="true" size={18} />;
  return <Paperclip aria-hidden="true" size={18} />;
}

/** The file could not be shown yet: loading, gone, too large or failed (with Retry). */
function MediaNote({
  media,
  message,
}: {
  media: WhatsAppMedia;
  message: WhatsAppMessage;
}) {
  const command = useWhatsAppCommand();
  const [busy, setBusy] = React.useState(false);
  const noun = NOUN[media.type];

  async function retry() {
    setBusy(true);
    try {
      await command(KIND_WHATSAPP_CONTACT_UPDATE, {
        v: 1,
        waId: message.waId,
        retryMedia: message.id,
      });
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : `Could not retry this ${noun}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (media.state === "pending") {
    return (
      <div
        className="c3wa-media-card c3wa-media-note"
        data-testid="whatsapp-media-pending"
        role="status"
      >
        <span aria-hidden="true" className="c3wa-media-icon">
          <Loader2 className="animate-spin" size={18} />
        </span>
        <span>
          <strong>Loading {noun}</strong>
          <small>It will appear here in a moment.</small>
        </span>
      </div>
    );
  }
  const tooLarge = media.error === "too_large";
  const gone = media.state === "gone";
  return (
    <div
      className="c3wa-media-card c3wa-media-note is-problem"
      data-testid="whatsapp-media-unavailable"
      role="status"
    >
      <span aria-hidden="true" className="c3wa-media-icon">
        {mediaIcon(media.type)}
      </span>
      <span>
        <strong>
          {gone
            ? `${capitalised(noun)} is no longer available`
            : tooLarge
              ? `${capitalised(noun)} is too large to show`
              : `${capitalised(noun)} could not be loaded`}
        </strong>
        <small>
          {gone
            ? "WhatsApp no longer has this file."
            : tooLarge
              ? "Ask them to send a smaller one."
              : "The download did not finish."}
        </small>
      </span>
      {media.canRetry ? (
        <Button
          className="c3wa-media-retry"
          data-testid="whatsapp-media-retry"
          disabled={busy}
          onClick={() => void retry()}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcw aria-hidden="true" size={14} />
          {busy ? "Retrying…" : "Retry"}
        </Button>
      ) : null}
    </div>
  );
}

function PhotoWithLightbox({ alt, src }: { alt: string; src: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        aria-label={`Open ${alt}`}
        className="c3wa-media-image-button"
        data-testid="whatsapp-media-image"
        onClick={() => setOpen(true)}
        type="button"
      >
        <img alt={alt} className="c3wa-media-image" loading="lazy" src={src} />
      </button>
      <SimpleImageLightbox
        alt={alt}
        onOpenChange={setOpen}
        open={open}
        src={src}
      />
    </>
  );
}

function StoredMedia({ media }: { media: WhatsAppMedia }) {
  const url = media.url ?? "";
  const shown = rewriteRelayUrl(url);
  const filename =
    media.filename ??
    (media.type === "voice"
      ? "Voice note"
      : media.type === "audio"
        ? "Audio"
        : capitalised(NOUN[media.type]));
  if (media.opaque && media.type !== "voice" && media.type !== "audio") {
    return (
      <div className="c3wa-media-file" data-testid="whatsapp-media-file">
        <FileCard
          filename={media.filename ?? `${capitalised(NOUN[media.type])} file`}
          href={url}
          size={media.size ?? undefined}
        />
      </div>
    );
  }
  switch (media.type) {
    case "sticker":
      return (
        <img
          alt="Sticker"
          className="c3wa-media-sticker"
          data-animated={media.animated ? "true" : undefined}
          data-testid="whatsapp-media-sticker"
          loading="lazy"
          src={shown}
        />
      );
    case "image":
      return <PhotoWithLightbox alt="Photo from the customer" src={shown} />;
    case "video":
      return (
        // biome-ignore lint/a11y/useMediaCaption: customer videos have no caption track
        <video
          className="c3wa-media-video"
          controls
          data-testid="whatsapp-media-video"
          preload="metadata"
          src={shown}
        />
      );
    case "voice":
    case "audio":
      return (
        <div className="c3wa-media-audio" data-testid="whatsapp-media-audio">
          <AudioMessageAttachment
            displayLabel={filename}
            downloadUrl={media.type === "audio" ? url : undefined}
            filename={filename}
            href={url}
          />
        </div>
      );
    default:
      return (
        <div className="c3wa-media-file" data-testid="whatsapp-media-file">
          <FileCard
            filename={filename}
            href={url}
            size={media.size ?? undefined}
          />
        </div>
      );
  }
}

function LocationCard({ media }: { media: WhatsAppMedia }) {
  const href = mapsHref(media);
  return (
    <div
      className="c3wa-media-card c3wa-media-place"
      data-testid="whatsapp-media-location"
    >
      <span aria-hidden="true" className="c3wa-media-icon">
        <MapPin size={18} />
      </span>
      <span>
        <strong>{media.name ?? "Shared a location"}</strong>
        {media.address ? <small>{media.address}</small> : null}
        {href ? (
          <a
            className="c3wa-media-link"
            href={href}
            rel="noreferrer noopener"
            target="_blank"
          >
            Open in Maps
          </a>
        ) : (
          <small>No coordinates were sent.</small>
        )}
      </span>
    </div>
  );
}

function ContactsCard({ media }: { media: WhatsAppMedia }) {
  return (
    <div
      className="c3wa-media-card c3wa-media-contacts"
      data-testid="whatsapp-media-contacts"
    >
      <span aria-hidden="true" className="c3wa-media-icon">
        <UserRound size={18} />
      </span>
      <ul>
        {media.contacts.length === 0 ? (
          <li>
            <strong>Shared a contact card</strong>
          </li>
        ) : (
          media.contacts.map((card) => (
            <li key={`${card.name ?? "contact"}:${card.phones.join(",")}`}>
              <strong>{card.name ?? "Contact"}</strong>
              {card.phones.map((phone) => (
                <a
                  className="c3wa-media-link"
                  href={telHref(phone)}
                  key={phone}
                >
                  <Phone aria-hidden="true" size={12} /> {phone}
                </a>
              ))}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * The media of one WhatsApp message in the chat: a sticker as a picture, a photo with a
 * lightbox, a video or voice note with its player, a document as a file card, a location with
 * a map link, a contact card. A file that is still loading, gone or failed says so, with Retry
 * when retrying can help. Everything stays inside its card at every width.
 */
export function WhatsAppMessageMedia({
  media,
  message,
}: {
  media: WhatsAppMedia;
  message: WhatsAppMessage;
}) {
  const caption = media.caption?.trim();
  let body: React.ReactNode;
  if (media.type === "location") {
    body = <LocationCard media={media} />;
  } else if (media.type === "contacts") {
    body = <ContactsCard media={media} />;
  } else if (media.state === "stored" && media.url) {
    body = <StoredMedia media={media} />;
  } else {
    body = <MediaNote media={media} message={message} />;
  }
  return (
    <div className="c3wa-media" data-media-type={media.type}>
      {body}
      {caption ? (
        <p className="c3wa-message-text c3wa-media-caption">{caption}</p>
      ) : null}
    </div>
  );
}

/**
 * A compact view for lists and quotes (the desk's Needs you card, the customer record): a small
 * picture for a stored photo or sticker, otherwise a one-line sentence. Never the bracket
 * placeholder.
 */
export function WhatsAppMessagePreview({
  message,
}: {
  message: WhatsAppMessage;
}) {
  const media = message.media;
  const text = whatsappMessagePreview(message);
  if (
    media &&
    media.state === "stored" &&
    media.url &&
    !media.opaque &&
    (media.type === "sticker" || media.type === "image")
  ) {
    return (
      <span className="c3wa-media-preview">
        <img
          alt={media.type === "sticker" ? "Sticker" : "Photo"}
          className="c3wa-media-thumb"
          data-testid="whatsapp-media-thumb"
          loading="lazy"
          src={rewriteRelayUrl(media.url)}
        />
        <span>{text}</span>
      </span>
    );
  }
  return <span className="c3wa-media-preview-text">{text}</span>;
}
