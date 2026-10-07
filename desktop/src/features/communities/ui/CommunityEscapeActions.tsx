import * as React from "react";

import { Button } from "@/shared/ui/button";

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
  return (
    <ul className="flex flex-col gap-3" data-testid="community-escape-switch">
      {exit.others.map((community, index) => (
        <li className="flex" key={community.id}>
          <Button
            className="h-10 w-full min-w-0"
            data-testid={`community-escape-switch-${community.id}`}
            onClick={() => exit.switchTo(community.id)}
            ref={index === 0 ? firstActionRef : undefined}
            type="button"
            variant={primary ? "default" : "secondary"}
          >
            <span className="truncate">Switch to {community.name}</span>
          </Button>
        </li>
      ))}
    </ul>
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
    <div className="flex flex-col gap-3">
      {isConfirming ? (
        <fieldset
          className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border border-destructive/40 p-3 text-left"
          data-testid="community-escape-remove-confirm-panel"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Closing this prompt must not also close a surrounding overlay.
            event.stopPropagation();
            cancelConfirm();
          }}
        >
          <legend className="sr-only">Confirm removing {name}</legend>
          <p className="text-sm leading-6">
            Remove {name} from this device? This only clears it here. You can
            add it again later.
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              data-testid="community-escape-remove-keep"
              onClick={cancelConfirm}
              ref={keepRef}
              type="button"
              variant="secondary"
            >
              Keep it
            </Button>
            <Button
              className="min-w-0 flex-1"
              data-testid="community-escape-remove-confirm"
              onClick={exit.remove}
              type="button"
              variant="destructive"
            >
              <span className="truncate">Remove {name}</span>
            </Button>
          </div>
        </fieldset>
      ) : (
        <Button
          className="h-10 w-full text-destructive hover:text-destructive"
          data-testid="community-escape-remove"
          onClick={() => setIsConfirming(true)}
          ref={triggerRef}
          type="button"
          variant="ghost"
        >
          Remove this community from this device
          <span className="sr-only"> ({name})</span>
        </Button>
      )}
      {exit.actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {exit.actionError}
        </p>
      ) : null}
    </div>
  );
}
