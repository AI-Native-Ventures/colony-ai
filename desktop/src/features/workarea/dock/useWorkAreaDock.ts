import * as React from "react";

import { getWorkAreaState, subscribeWorkArea } from "./workAreaStore";
import {
  EMPTY_WORK_AREA_STATE,
  type WorkAreaChannelState,
} from "./workAreaTypes";

/** The dock state for one channel. Stable between unrelated store changes. */
export function useWorkAreaDock(
  channelId: string | null,
): WorkAreaChannelState {
  return React.useSyncExternalStore(
    subscribeWorkArea,
    () => (channelId ? getWorkAreaState(channelId) : EMPTY_WORK_AREA_STATE),
    () => EMPTY_WORK_AREA_STATE,
  );
}
