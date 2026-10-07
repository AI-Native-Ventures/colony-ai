import * as React from "react";

import type { WorkspaceFileReference } from "../workspaceFiles";

/**
 * What each channel's Files tab is showing: a file (reader) or a folder
 * (list). In memory only: a reference carries a relay URL and an agent key and
 * is only meaningful for the community it came from. Community-scoped module
 * singleton, reset by `resetWorkAreaStore()` through `resetCommunityState()`.
 */
export type WorkAreaFilesView = {
  /** The open file, or null while the folder list is showing. */
  reference: WorkspaceFileReference | null;
  /** The folder the list shows, relative to the workspace root. */
  directory: string;
};

const ROOT_VIEW: WorkAreaFilesView = Object.freeze({
  reference: null,
  directory: "",
});

let views: ReadonlyMap<string, WorkAreaFilesView> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, WorkAreaFilesView>) {
  views = next;
  for (const listener of listeners) listener();
}

export function parentDirectory(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** Show a file. Its folder becomes the folder the list returns to. */
export function setWorkAreaFileReference(
  channelId: string,
  reference: WorkspaceFileReference,
) {
  publish(
    new Map(views).set(channelId, {
      reference,
      directory: parentDirectory(reference.path),
    }),
  );
}

/** Show the folder list, optionally at a folder. */
export function showWorkAreaFileList(channelId: string, directory?: string) {
  const current = views.get(channelId) ?? ROOT_VIEW;
  publish(
    new Map(views).set(channelId, {
      reference: null,
      directory: directory ?? current.directory,
    }),
  );
}

export function resetWorkAreaFileReferences() {
  if (views.size === 0) return;
  publish(new Map());
}

export function useWorkAreaFilesView(channelId: string): WorkAreaFilesView {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => views.get(channelId) ?? ROOT_VIEW,
    () => ROOT_VIEW,
  );
}
