import * as React from "react";

import { leadInitial } from "./leadShared";
import {
  buildTimeLogoToken,
  resolveBusinessLogoSource,
  shouldShowBusinessLogo,
} from "./businessLogo";

import "./business-logo.css";

const MAX_FAILED_LOGO_SOURCES = 256;
const failedLogoSources = new Set<string>();

function rememberFailedLogoSource(source: string) {
  failedLogoSources.delete(source);
  failedLogoSources.add(source);
  if (failedLogoSources.size > MAX_FAILED_LOGO_SOURCES) {
    const oldest = failedLogoSources.values().next().value;
    if (oldest) failedLogoSources.delete(oldest);
  }
}

export function BusinessLogoMark({
  name,
  website,
  logoUrl,
  placePhotoUrl,
  className,
  style,
}: {
  name: string;
  website: string | null | undefined;
  logoUrl?: string | null;
  placePhotoUrl?: string | null;
  className: string;
  style?: React.CSSProperties;
}) {
  const token = buildTimeLogoToken();
  const src = resolveBusinessLogoSource({
    website,
    logoUrl,
    placePhotoUrl,
    token,
  });
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const imageFailed = Boolean(
    src && (failedLogoSources.has(src) || failedSrc === src),
  );
  const showLogo = shouldShowBusinessLogo(src, imageFailed);

  return (
    <span
      aria-hidden="true"
      className={`business-logo-mark ${className}`}
      style={style}
    >
      {showLogo ? (
        <img
          alt={name}
          decoding="async"
          loading="lazy"
          onError={() => {
            if (!src) return;
            rememberFailedLogoSource(src);
            setFailedSrc(src);
          }}
          src={src ?? undefined}
        />
      ) : (
        <span aria-hidden="true" className="business-logo-fallback">
          {leadInitial(name)}
        </span>
      )}
    </span>
  );
}
