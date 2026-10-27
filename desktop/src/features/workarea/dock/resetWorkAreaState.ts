import { resetCanvasEdits } from "@/features/channels/ui/canvasEditStore";

import { resetAgentBrowserAccess } from "../browser/agentBrowserAccess";
import { resetAgentBrowserPresentation } from "../browser/agentBrowserPresentation";
import { resetBrowserTabsStore } from "../browser/browserTabsStore";
import { resetWorkAreaFileReferences } from "./workAreaFilesStore";
import { resetWorkAreaStore } from "./workAreaStore";

/**
 * Everything the work area holds for the current community. Wired into
 * `resetCommunityState()`; the next community re-hydrates through
 * `initWorkAreaStore`.
 */
export function resetWorkAreaState() {
  resetAgentBrowserAccess();
  resetAgentBrowserPresentation();
  resetWorkAreaStore();
  resetBrowserTabsStore();
  resetWorkAreaFileReferences();
  resetCanvasEdits();
}
