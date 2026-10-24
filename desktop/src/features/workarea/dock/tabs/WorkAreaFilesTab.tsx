import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";

import { useWorkAreaFilesView } from "../workAreaFilesStore";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { WorkspaceFileList } from "./WorkspaceFileList";

/**
 * Files tab: the agent workspace folder list. A file chosen from it opens on
 * its own tab (`WorkAreaFileTab`), as a file linked from a message does.
 */
export function WorkAreaFilesTab({ channelId }: WorkAreaTabPanelProps) {
  const relayOrigin = useRelayOrigin();
  const view = useWorkAreaFilesView(channelId);
  return (
    <WorkspaceFileList
      channelId={channelId}
      directory={view.directory}
      relayOrigin={relayOrigin}
    />
  );
}
