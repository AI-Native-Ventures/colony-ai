import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";

import { useWorkAreaFilesView } from "../workAreaFilesStore";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { WorkspaceFileList } from "./WorkspaceFileList";
import { WorkspaceFileReader } from "./WorkspaceFileReader";

/**
 * Files tab: the agent workspace folder list, and the read-only reader for the
 * file chosen from it or from a link in a message.
 */
export function WorkAreaFilesTab({ channelId }: WorkAreaTabPanelProps) {
  const relayOrigin = useRelayOrigin();
  const view = useWorkAreaFilesView(channelId);
  // A reference only counts for the relay it was resolved against.
  const reference =
    view.reference && view.reference.expectedRelayUrl === relayOrigin
      ? view.reference
      : null;
  return reference ? (
    <WorkspaceFileReader channelId={channelId} reference={reference} />
  ) : (
    <WorkspaceFileList
      channelId={channelId}
      directory={view.directory}
      relayOrigin={relayOrigin}
    />
  );
}
