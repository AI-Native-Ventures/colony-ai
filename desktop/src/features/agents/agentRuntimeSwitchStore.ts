import * as React from "react";

export type AgentRuntimeSwitchStatus = {
  phase: "switching" | "failed";
  targetRuntimeId: string;
  targetLabel: string;
  targetModel: string | null;
  activeTurn: boolean;
  error: string | null;
  generation: number;
};

const states = new Map<string, AgentRuntimeSwitchStatus>();
const listeners = new Set<() => void>();
let nextGeneration = 0;

function publish() {
  for (const listener of listeners) listener();
}

export function beginAgentRuntimeSwitch(
  pubkey: string,
  target: Omit<AgentRuntimeSwitchStatus, "phase" | "error" | "generation">,
): number {
  const key = pubkey.toLowerCase();
  const generation = ++nextGeneration;
  states.set(key, {
    ...target,
    phase: "switching",
    error: null,
    generation,
  });
  publish();
  return generation;
}

export function finishAgentRuntimeSwitch(pubkey: string, generation: number) {
  const key = pubkey.toLowerCase();
  if (states.get(key)?.generation !== generation) return;
  states.delete(key);
  publish();
}

export function failAgentRuntimeSwitch(
  pubkey: string,
  generation: number,
  error: string,
) {
  const key = pubkey.toLowerCase();
  const current = states.get(key);
  if (!current || current.generation !== generation) return;
  states.set(key, { ...current, phase: "failed", error });
  publish();
}

/** Community-switch reset (see resetCommunityState in useCommunityInit). */
export function resetAgentRuntimeSwitchState() {
  states.clear();
  publish();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentRuntimeSwitchStatus(
  pubkey: string | null | undefined,
): AgentRuntimeSwitchStatus | null {
  const key = pubkey?.toLowerCase() ?? "";
  const getSnapshot = React.useCallback(() => states.get(key) ?? null, [key]);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null);
}
