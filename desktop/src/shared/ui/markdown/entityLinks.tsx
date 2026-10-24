import type * as React from "react";

import { isEntityLink, type ParsedEntityLink } from "@/shared/lib/entityLink";
import { parseSupportedLinkPreview } from "@/shared/lib/linkPreview";

/**
 * Goals, projects, repositories and the rest of the entity surfaces are no
 * longer part of the app, so `buzz://` entity links have nowhere to go. They
 * stay in the message as plain text instead of rich cards or in-app
 * navigation.
 */
const noopOpenEntityLink = (_link: ParsedEntityLink) => {};

export function useOpenEntityLink(): (link: ParsedEntityLink) => void {
  return noopOpenEntityLink;
}

/**
 * Resolve an anchor href to a canonical `buzz://` entity link, accepting
 * both the deep-link scheme directly and HTTPS relay clone URLs (which the
 * preview parser normalizes onto `buzz://repo` only when the URL origin
 * matches the active relay origin).
 */
function resolveEntityHref(
  href: string,
  relayOrigin: string | null,
): string | null {
  if (isEntityLink(href)) return href;
  if (!/^https?:\/\//i.test(href)) return null;

  const preview = parseSupportedLinkPreview(href, relayOrigin);
  return preview && isEntityLink(preview.href) ? preview.href : null;
}

/**
 * Render an entity link (`buzz://` or an HTTPS relay clone URL whose
 * origin matches the active relay) as plain text. Returns null when the href
 * is not an entity link so the caller can fall through to its default anchor.
 */
export function renderEntityLinkAnchor({
  children,
  href,
  relayOrigin,
}: {
  children: React.ReactNode;
  href: string | undefined;
  relayOrigin: string | null;
  onOpenEntityLink?: (link: ParsedEntityLink) => void;
  interactive?: boolean;
  asChip?: boolean;
}): React.ReactElement | null {
  if (!href) return null;
  if (!resolveEntityHref(href, relayOrigin)) return null;
  return <span data-entity-link="">{children}</span>;
}

export function EntityLinkAnchor({
  children,
  href,
  relayOrigin,
}: {
  children?: React.ReactNode;
  href: string;
  onOpenEntityLink?: (link: ParsedEntityLink) => void;
  relayOrigin: string | null;
  interactive?: boolean;
  asChip?: boolean;
}): React.ReactElement | null {
  return (
    renderEntityLinkAnchor({ children, href, relayOrigin }) ?? <>{children}</>
  );
}
