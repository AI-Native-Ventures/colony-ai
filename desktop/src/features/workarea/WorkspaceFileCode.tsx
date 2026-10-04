import * as React from "react";
import { useMarkdownRuntime } from "@/shared/ui/markdown/runtimeContext";
import {
  isWorkspaceFileReference,
  openWorkspaceFile,
  resolveWorkspaceFile,
} from "./workspaceFiles";

/** Link only an existing file belonging to a locally managed message author. */
export function WorkspaceFileCode({ value }: { value: string }) {
  const { workspaceAgentPubkey, relayOrigin } = useMarkdownRuntime();
  const source = `${workspaceAgentPubkey}:${relayOrigin}:${value}`;
  const [resolved, setResolved] = React.useState<{
    source: string;
    path: string;
  } | null>(null);
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
  return (
    <a
      href={`#work-area-file=${encodeURIComponent(resolved.path)}`}
      className="text-primary underline underline-offset-2 break-words"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openWorkspaceFile({
          agentPubkey: workspaceAgentPubkey,
          expectedRelayUrl: relayOrigin,
          path: resolved.path,
        });
      }}
    >
      {value}
    </a>
  );
}
