import * as React from "react";

/**
 * Which folder each channel's Files tab is showing. In memory only. A file
 * opens on its own dock tab (see `workAreaStore.openWorkAreaFile`), so this
 * holds the list's folder and nothing about any file. Community-scoped module
 * singleton, reset by `resetWorkAreaStore()` through `resetCommunityState()`.
 */
export type WorkAreaFilesView = {
  /** The folder the list shows, relative to the workspace root. */
  directory: string;
};

const ROOT_VIEW: WorkAreaFilesView = Object.freeze({
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

/** Show the folder list, optionally at a folder. */
export function showWorkAreaFileList(channelId: string, directory?: string) {
  const current = views.get(channelId) ?? ROOT_VIEW;
  publish(
    new Map(views).set(channelId, {
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
