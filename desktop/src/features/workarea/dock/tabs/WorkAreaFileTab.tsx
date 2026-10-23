import * as React from "react";

import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";

import type { WorkspaceFileReference } from "../../workspaceFiles";
import { useWorkAreaDock } from "../useWorkAreaDock";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { WorkspaceFileReader } from "./WorkspaceFileReader";

/**
 * One file's tab: the read-only reader for the file this tab was opened on.
 * The tab remembers whose workspace and which path; the relay it is read
 * against is always the current community's own.
 */
export function WorkAreaFileTab({ channelId, tabId }: WorkAreaTabPanelProps) {
  const relayOrigin = useRelayOrigin();
  const dock = useWorkAreaDock(channelId);
  const file = dock.tabs.find((tab) => tab.id === tabId)?.file;
  const agentPubkey = file?.agentPubkey;
  const path = file?.path;
  const reference = React.useMemo<WorkspaceFileReference | null>(
    () =>
      agentPubkey && path && relayOrigin
        ? { agentPubkey, expectedRelayUrl: relayOrigin, path }
        : null,
    [agentPubkey, path, relayOrigin],
  );
  return reference ? (
    <WorkspaceFileReader channelId={channelId} reference={reference} />
  ) : (
    <p className="colony-doc-status" role="status">
      Opening file...
    </p>
  );
}
