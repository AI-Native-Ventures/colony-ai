import { FileText, Folder, RefreshCw } from "lucide-react";
import * as React from "react";

import { Button } from "@/shared/ui/button";

import {
  listWorkspaceDirectory,
  type WorkspaceEntry,
  type WorkspaceListing,
} from "../../workspaceFiles";
import {
  setWorkAreaFileReference,
  showWorkAreaFileList,
} from "../workAreaFilesStore";
import { useWorkspaceAgent } from "./useWorkspaceAgent";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ListState =
  | { key: string; status: "ready"; listing: WorkspaceListing }
  | { key: string; status: "error" };

/**
 * Read-only folder list of the agent workspace on this device. Names and sizes
 * only: the trusted native host decides what is listable, and every file still
 * opens through the same checked reader.
 */
export function WorkspaceFileList({
  channelId,
  directory,
  relayOrigin,
}: {
  channelId: string;
  directory: string;
  relayOrigin: string | null;
}) {
  const { agent, isLoading } = useWorkspaceAgent(channelId);
  const [reloads, setReloads] = React.useState(0);
  const [state, setState] = React.useState<ListState | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const focusAfterLoad = React.useRef(false);
  const agentPubkey = agent?.pubkey ?? null;
  const key = `${agentPubkey}:${relayOrigin}:${directory}:${reloads}`;

  React.useEffect(() => {
    if (!agentPubkey || !relayOrigin) return;
    let current = true;
    setState(null);
    void listWorkspaceDirectory({
      agentPubkey,
      expectedRelayUrl: relayOrigin,
      path: directory,
    })
      .then((listing) => {
        if (current) setState({ key, status: "ready", listing });
      })
      .catch(() => {
        if (current) setState({ key, status: "error" });
      });
    return () => {
      current = false;
    };
  }, [agentPubkey, relayOrigin, directory, key]);

  const settled = state?.key === key ? state : null;
  React.useEffect(() => {
    if (settled && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [settled]);

  const goTo = (next: string) => {
    focusAfterLoad.current = true;
    showWorkAreaFileList(channelId, next);
  };
  const open = (entry: WorkspaceEntry) => {
    if (entry.kind === "dir") {
      goTo(entry.path);
      return;
    }
    if (agentPubkey && relayOrigin) {
      setWorkAreaFileReference(channelId, {
        agentPubkey,
        expectedRelayUrl: relayOrigin,
        path: entry.path,
      });
    }
  };

  const segments = directory ? directory.split("/") : [];

  if (!agentPubkey && !isLoading) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
        data-testid="work-area-files-no-agent"
      >
        <p className="text-sm font-medium">No agent workspace here yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Files an agent writes on this device appear here. You can also choose
          a file link in an agent's message to read it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="work-area-files">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <nav aria-label="Folder path" className="min-w-0 flex-1 text-sm">
          <ol className="flex flex-wrap items-center gap-x-1">
            {["Workspace", ...segments].map((label, index) => {
              const last = index === segments.length;
              const target = segments.slice(0, index).join("/");
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                <li className="flex items-center gap-1" key={index}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      /
                    </span>
                  ) : null}
                  {last ? (
                    <span aria-current="page" className="font-medium">
                      {label}
                    </span>
                  ) : (
                    <button
                      className="rounded text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => goTo(target)}
                      type="button"
                    >
                      {label}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <Button
          aria-label="Refresh files"
          data-testid="work-area-files-refresh"
          onClick={() => setReloads((count) => count + 1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto p-2 focus:outline-none"
        ref={listRef}
        tabIndex={-1}
      >
        {!settled ? (
          <p role="status" className="p-2 text-sm text-muted-foreground">
            Opening folder...
          </p>
        ) : null}
        {settled?.status === "error" ? (
          <div role="alert" className="space-y-3 p-2 text-sm">
            <p>This folder is no longer available in the agent's workspace.</p>
            <div className="flex gap-2">
              <Button
                onClick={() => setReloads((count) => count + 1)}
                type="button"
                variant="outline"
              >
                Try again
              </Button>
              {directory ? (
                <Button onClick={() => goTo("")} type="button" variant="ghost">
                  Back to workspace
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {settled?.status === "ready" ? (
          settled.listing.entries.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              Nothing to read in this folder yet.
            </p>
          ) : (
            <>
              <ul className="space-y-0.5" data-testid="work-area-files-list">
                {settled.listing.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      data-kind={entry.kind}
                      onClick={() => open(entry)}
                      type="button"
                    >
                      {entry.kind === "dir" ? (
                        <Folder
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <FileText
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {entry.name}
                      </span>
                      <span className="sr-only">
                        {entry.kind === "dir" ? "folder" : "file"}
                      </span>
                      {entry.kind === "file" && entry.size !== undefined ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatSize(entry.size)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              {settled.listing.truncated ? (
                <p className="p-2 text-xs text-muted-foreground">
                  Showing the first {settled.listing.entries.length} items.
                </p>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
