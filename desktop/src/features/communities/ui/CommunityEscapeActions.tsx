import * as React from "react";

import { FirstRunButton } from "@/features/onboarding/ui/firstRunControls";
import "@/features/onboarding/ui/firstRun.css";

import { markCommunityDiscoveryAfterLeave } from "../communityStorage";
import type { Community } from "../types";
import { useCommunities } from "../useCommunities";

type CommunityEscapeOptions = {
  /**
   * Runs synchronously before the app leaves the failing community, so the
   * router can be pointed at the destination community's last location.
   */
  onPrepareLanding?: (communityId: string) => void;
  /** Runs once a switch or removal has been requested. */
  onEscaped?: () => void;
};

export type CommunityEscape = {
  /** The community that is failing, or null when none is active. */
  failing: Community | null;
  /** Every other community on this device, in list order. */
  others: Community[];
  leaving: "switching" | "removing" | null;
  actionError: string | null;
  switchTo: (communityId: string) => void;
  remove: () => void;
};

/**
 * Ways out of a failing community: switch to another one or drop this one
 * from the device. Removal is local cleanup only; it does not touch relay
 * membership, which is correct when the identity is not a member.
 */
export function useCommunityEscape({
  onPrepareLanding,
  onEscaped,
}: CommunityEscapeOptions = {}): CommunityEscape {
  const { activeCommunity, communities, switchCommunity, removeCommunity } =
    useCommunities();
  const [leaving, setLeaving] =
    React.useState<CommunityEscape["leaving"]>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const failing = activeCommunity;
  const others = React.useMemo(
    () => communities.filter((community) => community.id !== failing?.id),
    [communities, failing?.id],
  );

  const switchTo = React.useCallback(
    (communityId: string) => {
      if (leaving) return;
      setLeaving("switching");
      onPrepareLanding?.(communityId);
      switchCommunity(communityId);
      onEscaped?.();
    },
    [leaving, onEscaped, onPrepareLanding, switchCommunity],
  );

  const remove = React.useCallback(() => {
    if (leaving || !failing) return;
    setActionError(null);
    const landing = others[0];
    if (landing) {
      onPrepareLanding?.(landing.id);
    } else if (!markCommunityDiscoveryAfterLeave()) {
      // Without this marker a default-relay build would reconnect the same
      // community on the next launch instead of showing first-run setup.
      setActionError(
        "Colony could not save this change. Restart Colony and try again.",
      );
      return;
    }
    setLeaving("removing");
    removeCommunity(failing.id);
    onEscaped?.();
  }, [failing, leaving, onEscaped, onPrepareLanding, others, removeCommunity]);

  return { failing, others, leaving, actionError, switchTo, remove };
}

export function SwitchCommunityList({
  exit,
  firstActionRef,
  primary,
}: {
  exit: CommunityEscape;
  firstActionRef?: React.Ref<HTMLButtonElement>;
  /** Render the switch actions as the primary call to action. */
  primary?: boolean;
}) {
  if (exit.others.length === 0) return null;
  const single = exit.others.length === 1;
  return (
    <>
      {exit.others.map((community, index) => (
        <FirstRunButton
          className="c3fr-gate-button"
          data-testid={`community-escape-switch-${community.id}`}
          key={community.id}
          kind={primary ? "primary" : "secondary"}
          onClick={() => exit.switchTo(community.id)}
          ref={index === 0 ? firstActionRef : undefined}
        >
          <span className="c3fr-truncate">
            {single ? "Switch community" : `Switch to ${community.name}`}
          </span>
          {single ? (
            <span className="c3fr-sr-only"> to {community.name}</span>
          ) : null}
        </FirstRunButton>
      ))}
    </>
  );
}

export function RemoveCommunityControl({ exit }: { exit: CommunityEscape }) {
  const [isConfirming, setIsConfirming] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const keepRef = React.useRef<HTMLButtonElement>(null);
  const restoreTriggerFocusRef = React.useRef(false);

  React.useEffect(() => {
    if (isConfirming) {
      keepRef.current?.focus();
    } else if (restoreTriggerFocusRef.current) {
      restoreTriggerFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [isConfirming]);

  const cancelConfirm = React.useCallback(() => {
    restoreTriggerFocusRef.current = true;
    setIsConfirming(false);
  }, []);

  if (!exit.failing) return null;
  const name = exit.failing.name;

  return (
    <>
      {isConfirming ? (
        <fieldset
          className="c3fr-confirm"
          data-testid="community-escape-remove-confirm-panel"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Closing this prompt must not also close a surrounding overlay.
            event.stopPropagation();
            cancelConfirm();
          }}
        >
          <legend className="c3fr-sr-only">Confirm removing {name}</legend>
          <p>
            Remove {name} from this device? This only clears it here. You can
            add it again later.
          </p>
          <div className="c3fr-confirm-actions">
            <FirstRunButton
              data-testid="community-escape-remove-keep"
              onClick={cancelConfirm}
              ref={keepRef}
              size="small"
            >
              Keep it
            </FirstRunButton>
            <button
              className="c3fr-button c3fr-danger-button"
              data-size="small"
              data-testid="community-escape-remove-confirm"
              onClick={exit.remove}
              type="button"
            >
              <span className="c3fr-truncate">Remove {name}</span>
            </button>
          </div>
        </fieldset>
      ) : (
        <button
          className="c3fr-danger-link"
          data-testid="community-escape-remove"
          onClick={() => setIsConfirming(true)}
          ref={triggerRef}
          type="button"
        >
          Remove community
          <span className="c3fr-sr-only"> ({name}) from this device</span>
        </button>
      )}
      {exit.actionError ? (
        <p className="c3fr-error" role="alert">
          {exit.actionError}
        </p>
      ) : null}
    </>
  );
}
