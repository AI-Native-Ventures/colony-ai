import * as React from "react";

import {
  discoveryCoverUrl,
  shouldShowDiscoveryCover,
  type DiscoveryCoverSize,
} from "./discoveryCovers";

export function DiscoveryCoverPicture({
  id,
  size,
  className,
  placeholder,
}: {
  id: string;
  size: DiscoveryCoverSize;
  className: string;
  placeholder: React.ReactNode;
}) {
  const url = discoveryCoverUrl(id, size);
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const showImage = shouldShowDiscoveryCover(id, size, failedUrl);

  return (
    <span aria-hidden="true" className={className}>
      {showImage && url ? (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setFailedUrl(url)}
          src={url}
        />
      ) : (
        <span className="d4-picture-placeholder">{placeholder}</span>
      )}
    </span>
  );
}
