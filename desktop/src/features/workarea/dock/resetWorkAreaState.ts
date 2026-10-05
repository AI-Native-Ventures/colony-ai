import { resetWorkAreaFileReferences } from "./workAreaFilesStore";
import { resetWorkAreaStore } from "./workAreaStore";

/**
 * Everything the work area holds for the current community. Wired into
 * `resetCommunityState()`; the next community re-hydrates through
 * `initWorkAreaStore`.
 */
export function resetWorkAreaState() {
  resetWorkAreaStore();
  resetWorkAreaFileReferences();
}
