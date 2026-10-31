import * as React from "react";

import { readBusinessLogoForWorkspace } from "@/features/communities/businessProfileStorage";
import { useActiveCommunityIcon } from "@/features/communities/useCommunityIcons";

type WorkspaceMarkProps = {
  name: string;
  relayUrl?: string;
  communityId?: string;
  /** Explicit profile logo. When omitted, the saved business profile is read. */
  businessLogoUrl?: string | null;
  className: string;
  imageClassName?: string;
  imageFit?: "cover" | "contain";
  communityIconFit?: "cover" | "contain";
  fallbackText?: string;
  fallbackContent?: React.ReactNode;
  dot?: React.ReactNode;
  dataSize?: string;
  dataTone?: string;
  dataTestId?: string;
  imageTestId?: string;
  style?: React.CSSProperties;
  onLogoError?: () => void;
};

/**
 * The shared workspace mark resolver. A cached or fetched NIP-11 icon wins,
 * then the saved business-profile logo, then the workspace initial.
 */
export function WorkspaceMark(props: WorkspaceMarkProps) {
  return props.relayUrl ? (
    <WorkspaceMarkWithCommunityIcon {...props} relayUrl={props.relayUrl} />
  ) : (
    <WorkspaceMarkContent {...props} communityIcon={null} />
  );
}

function WorkspaceMarkWithCommunityIcon(
  props: WorkspaceMarkProps & { relayUrl: string },
) {
  const communityIconQuery = useActiveCommunityIcon(props.relayUrl);
  return (
    <WorkspaceMarkContent
      {...props}
      communityIcon={communityIconQuery.data ?? null}
    />
  );
}

function WorkspaceMarkContent({
  name,
  relayUrl,
  communityId,
  businessLogoUrl,
  className,
  imageClassName,
  imageFit = "contain",
  communityIconFit = "cover",
  fallbackText,
  fallbackContent,
  dot,
  dataSize,
  dataTone,
  dataTestId,
  imageTestId,
  style,
  onLogoError,
  communityIcon,
}: WorkspaceMarkProps & { communityIcon: string | null }) {
  const profileLogo =
    businessLogoUrl !== undefined
      ? businessLogoUrl
      : readBusinessLogoForWorkspace({ communityId, relayUrl });
  const [failedUrls, setFailedUrls] = React.useState(() => new Set<string>());
  const [loadedUrl, setLoadedUrl] = React.useState<string | null>(null);
  const candidate =
    (communityIcon && !failedUrls.has(communityIcon) ? communityIcon : null) ??
    (profileLogo && !failedUrls.has(profileLogo) ? profileLogo : null);
  const isCommunityIcon = candidate !== null && candidate === communityIcon;
  const initial = name.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <span
      aria-hidden="true"
      className={className}
      data-logo={candidate ? "true" : undefined}
      data-size={dataSize}
      data-source={
        candidate ? (isCommunityIcon ? "community" : "profile") : "initial"
      }
      data-testid={dataTestId}
      data-tone={dataTone}
      style={style}
    >
      {candidate ? (
        <img
          alt=""
          className={imageClassName}
          data-testid={imageTestId}
          draggable={false}
          onError={() => {
            setFailedUrls((current) => new Set(current).add(candidate));
            setLoadedUrl(null);
            if (!isCommunityIcon) onLogoError?.();
          }}
          onLoad={() => setLoadedUrl(candidate)}
          src={candidate}
          style={{
            height: "100%",
            objectFit: isCommunityIcon ? communityIconFit : imageFit,
            visibility: loadedUrl === candidate ? "visible" : "hidden",
            width: "100%",
          }}
        />
      ) : (
        <>
          {fallbackContent ?? fallbackText ?? initial}
          {dot}
        </>
      )}
    </span>
  );
}
