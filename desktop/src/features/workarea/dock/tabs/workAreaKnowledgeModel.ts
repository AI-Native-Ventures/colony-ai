import type { EngramEntry } from "@/shared/api/tauriEngrams";

import {
  type GateChannel,
  type QueryProgress,
  resolveChannelGate,
} from "./workAreaChannelGate";

/**
 * What the Knowledge tab shows for one channel.
 *
 * Read model, and why it is this small: the only knowledge a channel has today
 * is what its AI employees remember. Agent memory (NIP-AE engrams) is stored
 * per agent and owner, encrypted to the owner, and is not tagged with a
 * channel. So a channel's memory is the memory of the agents that are members
 * of it and that this person owns (this device manages them). Pins have no
 * data source yet: kind 40004 is reserved in the registry, no client writes it
 * and the relay gives it no meaning. Client knowledge heads (30635, 30636) are
 * reserved and rejected by ingest. The tab says so instead of inventing rows.
 */
export type KnowledgeAgent = { pubkey: string; name: string };

export type KnowledgeDocument = {
  /** Unique across agents: `<agent pubkey>:<slug>`. */
  key: string;
  agentPubkey: string;
  slug: string;
  isCore: boolean;
  title: string;
  /** First non-empty line of the body, bounded. */
  preview: string;
  body: string;
  /** Unix seconds the memory was last written. */
  updatedAt: number;
};

export type KnowledgeGroup = {
  agent: KnowledgeAgent;
  documents: KnowledgeDocument[];
  /** The relay returned its maximum, so the list may be incomplete. */
  truncated: boolean;
};

export type KnowledgeView =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | { state: "denied" }
  /** No AI employee you manage is in this channel. */
  | { state: "no-agents" }
  /** Employees are here but none has written anything down. */
  | { state: "empty" }
  | {
      state: "ready";
      groups: KnowledgeGroup[];
      /** Agents whose memory could not be read this time. */
      unavailable: KnowledgeAgent[];
    };

export type AgentMemoryProgress = QueryProgress & {
  data:
    | {
        core: EngramEntry | null;
        memories: readonly EngramEntry[];
        truncated: boolean;
      }
    | undefined;
};

export type KnowledgeInput = {
  channelId: string;
  channels: QueryProgress & { data: readonly GateChannel[] | undefined };
  members: QueryProgress & { data: readonly { pubkey: string }[] | undefined };
  /** Every agent this device manages, any channel. */
  managedAgents: QueryProgress & {
    data: readonly KnowledgeAgent[] | undefined;
  };
  /** One entry per agent in `agents`, in the same order. */
  memory: readonly AgentMemoryProgress[];
};

const PREVIEW_MAX = 140;

/** The managed agents that are members of this channel, in a stable order. */
export function agentsInChannel(
  managed: readonly KnowledgeAgent[],
  members: readonly { pubkey: string }[],
): KnowledgeAgent[] {
  const memberKeys = new Set(
    members.map((member) => member.pubkey.toLowerCase()),
  );
  return managed
    .filter((agent) => memberKeys.has(agent.pubkey.toLowerCase()))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.pubkey.localeCompare(right.pubkey),
    );
}

function humanize(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words.length === 0
    ? segment
    : words.charAt(0).toUpperCase() + words.slice(1);
}

/** `mem/preferences/ui-density` reads as "Ui density"; `core` as "Core profile". */
export function memoryTitle(slug: string): string {
  if (slug === "core") return "Core profile";
  const last = slug.split("/").filter(Boolean).pop() ?? slug;
  return humanize(last);
}

function previewOf(body: string): string {
  const line =
    body
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate.length > 0) ?? "";
  return line.length > PREVIEW_MAX
    ? `${line.slice(0, PREVIEW_MAX - 1)}…`
    : line;
}

export function toKnowledgeDocument(
  agentPubkey: string,
  entry: EngramEntry,
): KnowledgeDocument {
  return {
    key: `${agentPubkey.toLowerCase()}:${entry.slug}`,
    agentPubkey,
    slug: entry.slug,
    isCore: entry.slug === "core",
    title: memoryTitle(entry.slug),
    preview: previewOf(entry.body),
    body: entry.body,
    updatedAt: entry.createdAt,
  };
}

/** The core profile first, then the most recently written, then by slug. */
export function sortDocuments(
  documents: readonly KnowledgeDocument[],
): KnowledgeDocument[] {
  return [...documents].sort(
    (left, right) =>
      Number(right.isCore) - Number(left.isCore) ||
      right.updatedAt - left.updatedAt ||
      left.slug.localeCompare(right.slug),
  );
}

export function resolveKnowledgeView(input: KnowledgeInput): KnowledgeView {
  const gate = resolveChannelGate(input.channelId, input.channels);
  if (gate.state !== "open") return gate;

  if (input.members.status === "error") {
    return { state: "failed", error: input.members.error };
  }
  if (input.managedAgents.status === "error") {
    return { state: "failed", error: input.managedAgents.error };
  }
  if (
    input.members.status === "pending" ||
    input.managedAgents.status === "pending"
  ) {
    return { state: "loading" };
  }

  const agents = agentsInChannel(
    input.managedAgents.data ?? [],
    input.members.data ?? [],
  );
  if (agents.length === 0) return { state: "no-agents" };

  // `memory[i]` belongs to `agents[i]`. A caller that cannot keep that
  // pairing would show one agent's memory under another's name.
  if (input.memory.length !== agents.length) return { state: "loading" };
  if (input.memory.some((entry) => entry.status === "pending")) {
    return { state: "loading" };
  }
  if (input.memory.every((entry) => entry.status === "error")) {
    return { state: "failed", error: input.memory[0]?.error };
  }

  const groups: KnowledgeGroup[] = [];
  const unavailable: KnowledgeAgent[] = [];
  agents.forEach((agent, index) => {
    const result = input.memory[index];
    if (!result || result.status === "error" || !result.data) {
      unavailable.push(agent);
      return;
    }
    const entries = [
      ...(result.data.core ? [result.data.core] : []),
      ...result.data.memories,
    ];
    if (entries.length === 0) return;
    groups.push({
      agent,
      documents: sortDocuments(
        entries.map((entry) => toKnowledgeDocument(agent.pubkey, entry)),
      ),
      truncated: result.data.truncated,
    });
  });

  if (groups.length === 0 && unavailable.length === 0) {
    return { state: "empty" };
  }
  return { state: "ready", groups, unavailable };
}
