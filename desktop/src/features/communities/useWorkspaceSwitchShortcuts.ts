import { useEffect } from "react";

import type { Community } from "./types";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export function workspaceShortcutIndex(
  event: Pick<
    KeyboardEvent,
    | "altKey"
    | "ctrlKey"
    | "defaultPrevented"
    | "isComposing"
    | "key"
    | "metaKey"
    | "repeat"
    | "shiftKey"
  >,
): number | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.shiftKey ||
    !hasPrimaryShortcutModifier(event) ||
    !/^[1-9]$/.test(event.key)
  ) {
    return null;
  }

  return Number(event.key) - 1;
}

export function useWorkspaceSwitchShortcuts(
  communities: Community[],
  activeCommunityId: string | null,
  onSwitchCommunity: (id: string) => void,
) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const index = workspaceShortcutIndex(event);
      if (index === null) return;

      const targetCommunity = communities[index];
      if (!targetCommunity) return;

      event.preventDefault();
      if (targetCommunity.id !== activeCommunityId) {
        onSwitchCommunity(targetCommunity.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeCommunityId, communities, onSwitchCommunity]);
}
