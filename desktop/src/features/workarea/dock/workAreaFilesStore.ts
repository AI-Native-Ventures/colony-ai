import * as React from "react";

import type { WorkspaceFileReference } from "../workspaceFiles";

/**
 * Which file each channel's Files tab is showing. In memory only: a reference
 * carries a relay URL and an agent key and is only meaningful for the
 * community it came from. Community-scoped singleton, reset by
 * `resetWorkAreaStore()` through `resetCommunityState()`.
 */
let references: ReadonlyMap<string, WorkspaceFileReference> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, WorkspaceFileReference>) {
  references = next;
  for (const listener of listeners) listener();
}

export function setWorkAreaFileReference(
  channelId: string,
  reference: WorkspaceFileReference,
) {
  publish(new Map(references).set(channelId, reference));
}

export function resetWorkAreaFileReferences() {
  if (references.size === 0) return;
  publish(new Map());
}

export function useWorkAreaFileReference(
  channelId: string,
): WorkspaceFileReference | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => references.get(channelId) ?? null,
    () => null,
  );
}
