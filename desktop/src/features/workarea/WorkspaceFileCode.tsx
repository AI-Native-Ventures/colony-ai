import * as React from "react";
import { useMarkdownRuntime } from "@/shared/ui/markdown/runtimeContext";
import { useWorkAreaConversationChannelId } from "./dock/workAreaChannelContext";
import { workAreaFileName } from "./dock/workAreaFileTab";
import { useWorkAreaFileShown } from "./dock/useWorkAreaFileShown";
import { WorkspaceFileCard } from "./WorkspaceFileCard";
import {
  isWorkspaceFileReference,
  openWorkspaceFile,
  resolveWorkspaceFile,
} from "./workspaceFiles";

/**
 * Link only an existing file belonging to a locally managed message author. A
 * path that stands alone as its paragraph is a file card; one inside a
 * sentence stays an inline link.
 */
export function WorkspaceFileCode({ value }: { value: string }) {
  const { workspaceAgentPubkey, relayOrigin } = useMarkdownRuntime();
  const channelId = useWorkAreaConversationChannelId();
  const source = `${workspaceAgentPubkey}:${relayOrigin}:${value}`;
  const [resolved, setResolved] = React.useState<{
    source: string;
    path: string;
  } | null>(null);
  const [standsAlone, setStandsAlone] = React.useState(false);
  // The link is a card when nothing else sits beside it in its paragraph.
  // A ref callback runs before paint, so a path on its own line never shows
  // as an inline link first.
  const anchorRef = React.useCallback((node: HTMLAnchorElement | null) => {
    const parent = node?.parentElement;
    if (parent) {
      setStandsAlone(parent.tagName === "P" && parent.childNodes.length === 1);
    }
  }, []);
  const shown = useWorkAreaFileShown(
    channelId,
    resolved && workspaceAgentPubkey
      ? { agentPubkey: workspaceAgentPubkey, path: resolved.path }
      : null,
  );
  React.useEffect(() => {
    let current = true;
    setResolved(null);
    if (
      workspaceAgentPubkey &&
      relayOrigin &&
      isWorkspaceFileReference(value)
    ) {
      void resolveWorkspaceFile({
        agentPubkey: workspaceAgentPubkey,
        expectedRelayUrl: relayOrigin,
        path: value,
      })
        .then((file) => {
          if (current) setResolved(file ? { source, path: file.path } : null);
        })
        .catch(() => {
          if (current) setResolved(null);
        });
    }
    return () => {
      current = false;
    };
  }, [workspaceAgentPubkey, relayOrigin, value, source]);
  if (
    !resolved ||
    resolved.source !== source ||
    !workspaceAgentPubkey ||
    !relayOrigin
  )
    return <span>{value}</span>;
  const open = () =>
    openWorkspaceFile({
      agentPubkey: workspaceAgentPubkey,
      expectedRelayUrl: relayOrigin,
      path: resolved.path,
    });
  if (standsAlone) {
    return (
      <WorkspaceFileCard
        active={shown}
        fileName={workAreaFileName(resolved.path)}
        onOpen={open}
        path={resolved.path}
      />
    );
  }
  return (
    <a
      href={`#work-area-file=${encodeURIComponent(resolved.path)}`}
      className="text-primary underline underline-offset-2 break-words"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open();
      }}
      ref={anchorRef}
    >
      {value}
    </a>
  );
}
