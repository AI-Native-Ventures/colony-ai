import type {
  ChannelTurnError,
  ChannelWorkingAgent,
} from "@/features/agents/agentWorkingSignal";

/**
 * Logic for the one-line "Scout is working... 0:12" notice above the composer
 * (the channel) and in the open thread panel. It only decides what to show;
 * the data comes from the unified working signal (`agentWorkingSignal`) and
 * the bot typing entries, which carry the thread an agent is replying in.
 */

/** How long "Scout hit a problem" stays visible after the turn stopped. */
export const TURN_ERROR_VISIBLE_MS = 15_000;

export type WorkingIndicatorAgent = {
  pubkey: string;
  name: string;
  /** Desktop-clock ms: turn start while working, error time on an error. */
  anchorAt: number;
};

export type AgentWorkingIndicatorState =
  | { kind: "hidden" }
  | { kind: "working"; agents: WorkingIndicatorAgent[] }
  | { kind: "error"; agents: WorkingIndicatorAgent[] };

export const HIDDEN_WORKING_INDICATOR: AgentWorkingIndicatorState = {
  kind: "hidden",
};

/** The bot typing entries the indicator reads (see `useChannelTyping`). */
export type IndicatorTypingEntry = {
  pubkey: string;
  threadHeadId: string | null;
  firstSeenAt?: number;
};

/** Last scope an agent was seen working in: a thread head id, or `null` = main. */
export type AgentScopes = ReadonlyMap<string, string | null>;

export const NO_AGENT_SCOPES: AgentScopes = new Map();

/** Latest message time per agent (seconds, lowercase pubkey) in one scope. */
export type PostedAt = ReadonlyMap<string, number>;

export const NO_POSTED_AT: PostedAt = new Map();

type SelectInput = {
  botTyping: readonly IndicatorTypingEntry[];
  errors: readonly ChannelTurnError[];
  lastScopes: AgentScopes;
  nameOf: (pubkey: string) => string;
  now: number;
  /** Agents' messages in the scope; a reply posted since the turn began ends the notice. */
  posted?: PostedAt;
  working: readonly ChannelWorkingAgent[];
};

function key(pubkey: string) {
  return pubkey.toLowerCase();
}

/**
 * Latest message time per wanted agent. Message times have whole-second
 * resolution, so a reply counts as posted since the turn began when its second
 * has not ended before the turn's start.
 */
export function latestPostedAt(
  messages: readonly { createdAt: number; pubkey?: string }[],
  agents: ReadonlySet<string>,
): PostedAt {
  if (agents.size === 0) {
    return NO_POSTED_AT;
  }
  const latest = new Map<string, number>();
  for (const message of messages) {
    const pubkey = message.pubkey ? key(message.pubkey) : null;
    if (pubkey && agents.has(pubkey)) {
      latest.set(pubkey, Math.max(latest.get(pubkey) ?? 0, message.createdAt));
    }
  }
  return latest.size === 0 ? NO_POSTED_AT : latest;
}

function hasReplied(
  posted: PostedAt | undefined,
  pubkey: string,
  anchorAt: number,
) {
  const at = posted?.get(key(pubkey));
  return at !== undefined && (at + 1) * 1000 > anchorAt;
}

function freshErrors(errors: readonly ChannelTurnError[], now: number) {
  return errors.filter((error) => now - error.at < TURN_ERROR_VISIBLE_MS);
}

function toState(
  working: WorkingIndicatorAgent[],
  errored: WorkingIndicatorAgent[],
): AgentWorkingIndicatorState {
  if (working.length > 0) {
    return { kind: "working", agents: working };
  }
  if (errored.length > 0) {
    return { kind: "error", agents: errored };
  }
  return HIDDEN_WORKING_INDICATOR;
}

/**
 * Remember the scope each bot was last seen typing in, so an error that
 * arrives after the typing entry lapsed still lands where the reply would have.
 * Returns `previous` itself when nothing changed (no extra render).
 */
export function recordAgentScopes(
  previous: AgentScopes,
  botTyping: readonly IndicatorTypingEntry[],
): AgentScopes {
  // One scope per agent; channel typing outranks thread typing because the
  // channel-level notice is the broader one.
  const current = new Map<string, string | null>();
  for (const entry of botTyping) {
    const pubkey = key(entry.pubkey);
    if (entry.threadHeadId === null || !current.has(pubkey)) {
      current.set(pubkey, entry.threadHeadId);
    }
  }
  let next: Map<string, string | null> | null = null;
  for (const [pubkey, scope] of current) {
    if (previous.has(pubkey) && previous.get(pubkey) === scope) {
      continue;
    }
    next ??= new Map(previous);
    next.set(pubkey, scope);
  }
  return next ?? previous;
}

/**
 * The notice for the main conversation. An agent that is replying inside a
 * thread (thread typing, no channel typing) is left to the thread panel.
 */
export function selectChannelWorkingIndicator({
  botTyping,
  errors,
  lastScopes,
  nameOf,
  now,
  posted,
  working,
}: SelectInput): AgentWorkingIndicatorState {
  const channelTyping = new Set<string>();
  const threadTyping = new Set<string>();
  for (const entry of botTyping) {
    (entry.threadHeadId === null ? channelTyping : threadTyping).add(
      key(entry.pubkey),
    );
  }
  const threadOnly = new Set(
    [...threadTyping].filter((pubkey) => !channelTyping.has(pubkey)),
  );

  const errored = freshErrors(errors, now)
    .filter((error) => {
      const scope = lastScopes.get(key(error.pubkey));
      return scope === undefined || scope === null;
    })
    .map((error) => ({
      pubkey: error.pubkey,
      name: nameOf(error.pubkey),
      anchorAt: error.at,
    }));
  const erroredKeys = new Set(errored.map((agent) => key(agent.pubkey)));

  const busy = working
    .filter(
      (agent) =>
        !threadOnly.has(key(agent.pubkey)) &&
        !erroredKeys.has(key(agent.pubkey)) &&
        !hasReplied(posted, agent.pubkey, agent.anchorAt),
    )
    .map((agent) => ({
      pubkey: agent.pubkey,
      name: nameOf(agent.pubkey),
      anchorAt: agent.anchorAt,
    }));

  return toState(busy, errored);
}

/** The notice for the open thread: bots typing in that thread, or one that
 * stopped with an error after it was last seen working there. */
export function selectThreadWorkingIndicator({
  botTyping,
  errors,
  lastScopes,
  nameOf,
  now,
  posted,
  threadHeadId,
  working,
}: SelectInput & { threadHeadId: string | null }): AgentWorkingIndicatorState {
  if (!threadHeadId) {
    return HIDDEN_WORKING_INDICATOR;
  }

  const errored = freshErrors(errors, now)
    .filter((error) => lastScopes.get(key(error.pubkey)) === threadHeadId)
    .map((error) => ({
      pubkey: error.pubkey,
      name: nameOf(error.pubkey),
      anchorAt: error.at,
    }));
  const erroredKeys = new Set(errored.map((agent) => key(agent.pubkey)));

  const anchorByAgent = new Map(
    working.map((agent) => [key(agent.pubkey), agent.anchorAt]),
  );
  const busy: WorkingIndicatorAgent[] = [];
  const seen = new Set<string>();
  for (const entry of botTyping) {
    const pubkey = key(entry.pubkey);
    if (
      entry.threadHeadId !== threadHeadId ||
      seen.has(pubkey) ||
      erroredKeys.has(pubkey)
    ) {
      continue;
    }
    seen.add(pubkey);
    const anchorAt = anchorByAgent.get(pubkey) ?? entry.firstSeenAt ?? now;
    if (hasReplied(posted, pubkey, anchorAt)) {
      continue;
    }
    busy.push({ pubkey, name: nameOf(pubkey), anchorAt });
  }

  return toState(busy, errored);
}

function joinNames(names: readonly string[]) {
  if (names.length <= 2) {
    return names.join(" and ");
  }
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Plain one-line text, no timer: what the screen reader announces once. */
export function formatWorkingIndicatorLabel(
  state: AgentWorkingIndicatorState,
): string {
  if (state.kind === "hidden") {
    return "";
  }
  const names = state.agents.map((agent) => agent.name);
  if (state.kind === "error") {
    return `${joinNames(names)} hit a problem and stopped.`;
  }
  return `${joinNames(names)} ${names.length === 1 ? "is" : "are"} working…`;
}

/** The earliest anchor, for the shared elapsed timer. */
export function workingIndicatorAnchor(
  state: AgentWorkingIndicatorState,
): number | null {
  if (state.kind !== "working") {
    return null;
  }
  return Math.min(...state.agents.map((agent) => agent.anchorAt));
}
