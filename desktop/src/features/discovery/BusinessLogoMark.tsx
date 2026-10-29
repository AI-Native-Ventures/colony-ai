import * as React from "react";

import { leadInitial } from "./leadShared";
import {
  buildTimeLogoToken,
  businessLogoUrl,
  shouldShowBusinessLogo,
} from "./businessLogo";

import "./business-logo.css";

export function BusinessLogoMark({
  name,
  website,
  className,
}: {
  name: string;
  website: string | null | undefined;
  className: string;
}) {
  const token = buildTimeLogoToken();
  const src = businessLogoUrl(website, token);
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const showLogo = Boolean(
    src &&
      shouldShowBusinessLogo(
        website,
        token,
        failedSrc !== null && failedSrc === src,
      ),
  );

  return (
    <span className={`business-logo-mark ${className}`}>
      {showLogo ? (
        <img
          alt={name}
          decoding="async"
          loading="lazy"
          onError={() => setFailedSrc(src)}
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
