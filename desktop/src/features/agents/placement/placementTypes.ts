import {
  hasOnlyKeys,
  isObject,
  isValidRelayHead,
  oneTagValue,
  parseJson,
  pick,
  readNumber,
} from "@/features/cofounder/cofounderRecords";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_AGENT_PLACEMENT_HEAD } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";

export {
  KIND_AGENT_PLACEMENT_ACTION,
  KIND_AGENT_PLACEMENT_HEAD,
} from "@/shared/constants/kinds";

/** Where an agent works. */
export type Home = "mac" | "cloud";

/** The relay's word for what a cloud agent is doing. `null` on the Mac. */
export type PlacementStatus =
  | "asleep"
  | "waking"
  | "working"
  | "failed"
  | "outOfCredit"
  | "notCloudReady";

/** The commands an owner can send for an agent. */
export type PlacementOp = "setHome" | "retryWake" | "setCloudModel";

export type AgentPlacement = {
  home: Home;
  /** Compare-and-swap counter. Absence of a head is generation 0. */
  generation: number;
  status: PlacementStatus | null;
  /** The relay holds this agent's key and config, so it can run in the cloud. */
  cloudReady: boolean;
  cloudModel: string | null;
  /** Config snapshot version the relay holds. 0 when none. */
  configVersion: number;
};

/** An agent no placement head exists for: it works on the Mac. */
export const MAC_PLACEMENT: AgentPlacement = Object.freeze({
  home: "mac",
  generation: 0,
  status: null,
  cloudReady: false,
  cloudModel: null,
  configVersion: 0,
});

export type ParsedPlacementHead = {
  agent: string;
  owner: string;
  placement: AgentPlacement;
};

const STATUSES = new Set<PlacementStatus>([
  "asleep",
  "waking",
  "working",
  "failed",
  "outOfCredit",
  "notCloudReady",
]);
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;
const HEAD_KEYS = [
  "schema",
  "agent",
  "owner",
  "home",
  "generation",
  "cloudReady",
  "configVersion",
  "cloudModel",
  "status",
  "updatedAt",
] as const;

/** The `d` tag of an agent's placement head: its pubkey, lowercased. */
export function placementDTag(agentPubkey: string): string {
  return normalizePubkey(agentPubkey);
}

/**
 * Reads one relay-signed placement head (kind 30682). Anything that is not
 * exactly the contract, or not signed by the relay, is ignored: a head the
 * desktop cannot vouch for must never move an agent between homes.
 */
export function parsePlacementHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): ParsedPlacementHead | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_AGENT_PLACEMENT_HEAD)) {
    return null;
  }
  const content = parseJson(event.content);
  if (!isObject(content) || !hasOnlyKeys(content, HEAD_KEYS)) return null;

  const agent = pick(content, "agent");
  const owner = pick(content, "owner");
  const home = pick(content, "home");
  const generation = readNumber(content, "generation");
  const configVersion = readNumber(content, "configVersion");
  const updatedAt = readNumber(content, "updatedAt");
  const cloudReady = pick(content, "cloudReady");
  const cloudModel = pick(content, "cloudModel") ?? null;
  const status = pick(content, "status") ?? null;
  if (
    pick(content, "schema") !== 1 ||
    typeof agent !== "string" ||
    !PUBKEY_PATTERN.test(agent) ||
    typeof owner !== "string" ||
    !PUBKEY_PATTERN.test(owner) ||
    (home !== "mac" && home !== "cloud") ||
    generation === null ||
    configVersion === null ||
    updatedAt === null ||
    typeof cloudReady !== "boolean" ||
    (cloudModel !== null && typeof cloudModel !== "string") ||
    (status !== null &&
      (typeof status !== "string" || !STATUSES.has(status as PlacementStatus)))
  ) {
    return null;
  }
  if (oneTagValue(event, "d") !== placementDTag(agent)) return null;
  return {
    agent: normalizePubkey(agent),
    owner: normalizePubkey(owner),
    placement: {
      home,
      generation,
      status: status as PlacementStatus | null,
      cloudReady,
      cloudModel,
      configVersion,
    },
  };
}

/**
 * The newest placement per agent among `events`. Newest means the highest
 * generation, never the latest `created_at`: the relay orders placements by
 * generation, and two heads written in one second must not be told apart by
 * the clock.
 */
export function pickNewestPlacements(
  events: readonly RelayEvent[],
  relaySelfPubkey: string,
): Map<string, AgentPlacement> {
  const newest = new Map<string, AgentPlacement>();
  for (const event of events) {
    const parsed = parsePlacementHead(event, relaySelfPubkey);
    if (!parsed) continue;
    const known = newest.get(parsed.agent);
    if (!known || parsed.placement.generation >= known.generation) {
      newest.set(parsed.agent, parsed.placement);
    }
  }
  return newest;
}
