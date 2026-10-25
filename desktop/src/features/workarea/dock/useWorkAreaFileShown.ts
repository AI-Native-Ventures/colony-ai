import * as React from "react";

import { workAreaFileTabId } from "./workAreaFileTab";
import { getWorkAreaState, subscribeWorkArea } from "./workAreaStore";
import type { WorkAreaFileRef } from "./workAreaTypes";

/**
 * True while this file is the one on screen in the channel's dock: the dock is
 * open and the file's tab is the active one. Message file cards use it to stay
 * highlighted for as long as their file is open.
 */
export function useWorkAreaFileShown(
  channelId: string | null,
  file: WorkAreaFileRef | null,
): boolean {
  const tabId = file ? workAreaFileTabId(file) : null;
  return React.useSyncExternalStore(
    subscribeWorkArea,
    () => {
      if (!channelId || !tabId) return false;
      const state = getWorkAreaState(channelId);
      return state.open && state.activeTabId === tabId;
    },
    () => false,
  );
}
