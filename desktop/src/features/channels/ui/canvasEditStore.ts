import * as React from "react";

/**
 * Canvas edits that outlive the component showing them, so closing the work
 * area dock mid-edit does not throw the text away. In memory, keyed by channel;
 * a community-scoped module singleton, reset through `resetWorkAreaState()`.
 */
export type CanvasEditState = { isEditing: boolean; draft: string };

export const IDLE_CANVAS_EDIT: CanvasEditState = Object.freeze({
  isEditing: false,
  draft: "",
});

let edits: ReadonlyMap<string, CanvasEditState> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, CanvasEditState>) {
  edits = next;
  for (const listener of listeners) listener();
}

export function setCanvasEdit(key: string, state: CanvasEditState) {
  const next = new Map(edits);
  if (state.isEditing) next.set(key, state);
  else next.delete(key);
  publish(next);
}

export function getCanvasEdit(key: string): CanvasEditState {
  return edits.get(key) ?? IDLE_CANVAS_EDIT;
}

export function resetCanvasEdits() {
  if (edits.size === 0) return;
  publish(new Map());
}

/**
 * Edit state for a canvas. With a key it lives in the module store and
 * survives unmounting; without one it is plain component state.
 */
export function useCanvasEditState(
  key: string | null,
): [CanvasEditState, (next: CanvasEditState) => void] {
  const [local, setLocal] = React.useState<CanvasEditState>(IDLE_CANVAS_EDIT);
  const stored = React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (key ? getCanvasEdit(key) : IDLE_CANVAS_EDIT),
    () => IDLE_CANVAS_EDIT,
  );
  const set = React.useCallback(
    (next: CanvasEditState) => {
      if (key) setCanvasEdit(key, next);
      else setLocal(next);
    },
    [key],
  );
  return [key ? stored : local, set];
}
