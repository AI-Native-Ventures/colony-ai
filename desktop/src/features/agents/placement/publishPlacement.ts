import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

import { fetchPlacements } from "./placementQueries";
import { KIND_AGENT_PLACEMENT_ACTION } from "./placementTypes";
import type { Home, PlacementOp } from "./placementTypes";

export type PlacementRefusalCode =
  | "generation_conflict"
  | "cloud_limit"
  | "not_cloud_ready"
  | "not_allowed"
  | "other";

/** The relay refused a placement command. `code` says why, in words the UI
 * can act on; `message` is the relay's own text. */
export class PlacementRefusal extends Error {
  readonly code: PlacementRefusalCode;
  /** The beta cap, when `code` is `cloud_limit`. */
  readonly limit: number | null;

  constructor(code: PlacementRefusalCode, message: string, limit?: number) {
    super(message);
    this.name = "PlacementRefusal";
    this.code = code;
    this.limit = limit ?? null;
  }
}

/** The JSON content of a placement command (plan, Contracts). */
export function buildPlacementAction(input: {
  agent: string;
  op: PlacementOp;
  expectedGeneration: number;
  home?: Home;
  cloudModel?: string;
}) {
  return {
    schema: 1,
    agent: input.agent.toLowerCase(),
    op: input.op,
    ...(input.home ? { home: input.home } : {}),
    expectedGeneration: input.expectedGeneration,
    cloudModel: input.cloudModel ?? null,
  };
}

/** Reads the relay's refusal text into a code the UI can act on. */
export function classifyPlacementError(error: unknown): PlacementRefusal {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "The relay did not accept this change.";
  const cap = /cloud_limit:(\d+)/.exec(message);
  if (cap) return new PlacementRefusal("cloud_limit", message, Number(cap[1]));
  if (/generation_conflict/.test(message)) {
    return new PlacementRefusal("generation_conflict", message);
  }
  if (/not_cloud_ready/.test(message)) {
    return new PlacementRefusal("not_cloud_ready", message);
  }
  if (/not_allowed|flag_off|forbidden|restricted/.test(message)) {
    return new PlacementRefusal("not_allowed", message);
  }
  return new PlacementRefusal("other", message);
}

export type PlacementPublisherDeps = {
  sign: (input: {
    kind: number;
    content: string;
    tags: string[][];
  }) => Promise<RelayEvent>;
  publish: (event: RelayEvent) => Promise<unknown>;
  refetch: (agents: string[]) => Promise<unknown>;
};

/**
 * Builds the function that sends one owner-signed placement command (kind
 * 47071). One flip is one event: a compare-and-swap on `expectedGeneration`, so
 * two devices flipping at once cannot both win and nothing is silently
 * overwritten. On a conflict the current placement is read again (the screen
 * then shows where the agent really works) and the refusal is thrown for the
 * caller to say so.
 */
export function createPlacementPublisher(deps: PlacementPublisherDeps) {
  return async function publish(
    agent: string,
    op: PlacementOp,
    expectedGeneration: number,
    home?: Home,
    cloudModel?: string,
  ): Promise<void> {
    const action = buildPlacementAction({
      agent,
      op,
      expectedGeneration,
      home,
      cloudModel,
    });
    const event = await deps.sign({
      kind: KIND_AGENT_PLACEMENT_ACTION,
      content: JSON.stringify(action),
      tags: [["d", action.agent]],
    });
    try {
      await deps.publish(event);
    } catch (error) {
      const refusal = classifyPlacementError(error);
      if (refusal.code === "generation_conflict") {
        await deps.refetch([agent]).catch(() => undefined);
      }
      throw refusal;
    }
    // The head follows over the live subscription; read it now so the screen
    // does not wait for it.
    await deps.refetch([agent]).catch(() => undefined);
  };
}

export const publishPlacement = createPlacementPublisher({
  sign: signRelayEvent,
  publish: (event) =>
    relayClient.publishEvent(
      event,
      "Timed out changing where the agent works.",
      "Failed to change where the agent works.",
    ),
  refetch: fetchPlacements,
});
