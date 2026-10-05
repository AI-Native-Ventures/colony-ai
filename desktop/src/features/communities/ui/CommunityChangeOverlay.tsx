import * as React from "react";

import { useCommunities } from "../useCommunities";
import { CommunityEditForm } from "./CommunityEditForm";
import {
  RemoveCommunityControl,
  SwitchCommunityList,
  useCommunityEscape,
} from "./CommunityEscapeActions";

type CommunityChangeOverlayProps = {
  onClose: () => void;
  onUpdated?: (name: string, relayUrl: string) => void;
  /**
   * Failure screens pass this to offer a way out of the failing community
   * (switch to another one, or remove this one from the device).
   */
  escape?: {
    onPrepareLanding?: (communityId: string) => void;
    onEscaped?: () => void;
  };
};

export function CommunityChangeOverlay({
  onClose,
  onUpdated,
  escape: escapeOptions,
}: CommunityChangeOverlayProps) {
  const { activeCommunity, updateCommunity } = useCommunities();
  const escapeOnEscaped = escapeOptions?.onEscaped;
  const exit = useCommunityEscape({
    onPrepareLanding: escapeOptions?.onPrepareLanding,
    onEscaped: React.useCallback(() => {
      escapeOnEscaped?.();
      onClose();
    }, [escapeOnEscaped, onClose]),
  });
  const [error, setError] = React.useState<string | null>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);

  // Focus trap: focus the overlay on mount
  React.useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  // Escape key closes the overlay
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = React.useCallback(
    (name: string, relayUrl: string) => {
      if (!activeCommunity) return;
      setError(null);
      const result = updateCommunity(activeCommunity.id, { name, relayUrl });
      switch (result.kind) {
        case "unchanged":
          onClose();
          break;
        case "updated":
          onUpdated?.(name, relayUrl);
          // If reinit is needed, the communityKey change will trigger a remount.
          // If not (name-only), just close.
          if (!result.requiresReinit) {
            onClose();
          }
          // If requiresReinit, the tree remounts — overlay unmounts naturally.
          break;
        case "duplicate-relay":
          setError("Another community already uses this relay URL.");
          break;
        case "not-found":
          setError("Community not found.");
          break;
      }
    },
    [activeCommunity, onClose, onUpdated, updateCommunity],
  );

  if (!activeCommunity) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      data-testid="community-change-overlay"
      ref={overlayRef}
      role="dialog"
      tabIndex={-1}
    >
      {/* Background click closes */}
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-background p-8 shadow-2xl">
        <h2 className="text-xl font-semibold tracking-tight">
          Change community
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Update your community name or relay URL.
        </p>
        <div className="mt-6">
          <CommunityEditForm
            initialName={activeCommunity.name}
            initialRelayUrl={activeCommunity.relayUrl}
            onCancel={onClose}
            onSubmit={handleSubmit}
            submitLabel="Save changes"
          />
        </div>
        {error ? (
          <p className="mt-4 text-center text-sm text-destructive">{error}</p>
        ) : null}
        {escapeOptions ? (
          <div
            className="mt-6 flex flex-col gap-3 border-t border-border pt-6"
            data-testid="community-change-overlay-escape"
          >
            <p className="text-sm text-muted-foreground">
              Not working? Leave this community instead.
            </p>
            <SwitchCommunityList exit={exit} />
            <RemoveCommunityControl exit={exit} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
