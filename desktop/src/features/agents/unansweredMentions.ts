import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_REACTION,
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * Mentions to a local agent that the agent never answered.
 *
 * GATE-303 (26 Oct, published 3.0.3): a mention sent 3.6 s after launch was
 * lost for good. Every earlier fix looked at what the desktop attempted (the
 * wake, the replay floor, the wake ledger), so a mention the desktop never
 * attempted left no trace anywhere. The relay is the one record that cannot
 * miss it: the mention is stored there, and a harness that queued it reacts to
 * it (the "seen" reaction) or answers it.
 *
 * Only an answer ends the wait. The harness reacts 👀 the moment it queues a
 * mention and 💬 when the turn begins, and removes both when the turn ends.
 * GATE-304 (26 Oct, published 3.0.4): the first harness queued the mention,
 * reacted, and was stopped before it answered; a check that took the reaction
 * for an answer dropped the wait and nothing ever looked at the mention again.
 * A reaction left behind is progress, reported as such, so the caller can tell
 * a mention nobody saw from one that was queued or begun and then lost.
 */

/** Furthest back a mention can still be unanswered: the harness never replays
 * further than its wake ledger's look-back, seven days. */
export const UNANSWERED_MENTION_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
/** Most mentions looked at per agent in one pass. Newest win. */
export const UNANSWERED_MENTION_LIMIT = 50;
/** Longest the relay gets to answer one of the two reads. */
export const UNANSWERED_MENTION_READ_TIMEOUT_MS = 6_000;

const MESSAGE_KINDS = [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2];
/** The harness reacts with this when a turn for the mention begins. */
const WORKING_REACTION = "💬";
/** What an agent sends about a mention: a reply, or a progress reaction. */
const ANSWER_KINDS = [
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_REACTION,
];

/**
 * How far the agent got with a mention it never answered.
 * - `none`: nothing from the agent points at it.
 * - `seen`: the harness queued it (👀) and nothing more. Its turn never began,
 *   so the harness can be asked to take the mention again without a turn ever
 *   having acted on it.
 * - `working`: a turn began (💬) and then ended without an answer. The model
 *   may have acted on it, so only the person decides whether to run it again.
 */
export type MentionProgress = "none" | "seen" | "working";

export type UnansweredMention = {
  id: string;
  /** Unix seconds the person sent it. */
  createdAt: number;
  channelId: string | null;
  /** The thread it was sent in, or `null` for the main conversation. */
  threadHeadId: string | null;
  progress: MentionProgress;
};

export type FetchRelayEvents = (
  filter: RelaySubscriptionFilter,
) => Promise<RelayEvent[]>;

function tagValue(event: RelayEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

/** The thread head a message was sent in: its NIP-10 root, else its parent. */
export function threadHeadOf(event: RelayEvent): string | null {
  const eTags = event.tags.filter((tag) => tag[0] === "e" && tag[1]);
  const root = eTags.find((tag) => tag[3] === "root");
  if (root) return root[1] ?? null;
  const reply = eTags.find((tag) => tag[3] === "reply");
  if (reply) return reply[1] ?? null;
  return eTags[0]?.[1] ?? null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The mentions `senderPubkey` sent to `agentPubkey` that the agent never
 * answered, oldest first, each with how far the agent got. Throws when the
 * relay cannot be read: the caller must retry or say so, because an empty
 * answer here means "nothing was lost".
 */
export async function findUnansweredMentions({
  agentPubkey,
  senderPubkey,
  nowSeconds,
  fetchEvents,
  lookbackSeconds = UNANSWERED_MENTION_LOOKBACK_SECONDS,
  readTimeoutMs = UNANSWERED_MENTION_READ_TIMEOUT_MS,
}: {
  agentPubkey: string;
  senderPubkey: string;
  nowSeconds: number;
  fetchEvents: FetchRelayEvents;
  lookbackSeconds?: number;
  readTimeoutMs?: number;
}): Promise<UnansweredMention[]> {
  const agent = normalizePubkey(agentPubkey);
  const sender = normalizePubkey(senderPubkey);
  const mentions = await withTimeout(
    fetchEvents({
      kinds: MESSAGE_KINDS,
      "#p": [agent],
      authors: [sender],
      since: nowSeconds - lookbackSeconds,
      limit: UNANSWERED_MENTION_LIMIT,
    }),
    readTimeoutMs,
    "reading mentions",
  );
  const sent = mentions.filter(
    (event) =>
      normalizePubkey(event.pubkey) === sender &&
      event.tags.some(
        (tag) => tag[0] === "p" && normalizePubkey(tag[1] ?? "") === agent,
      ),
  );
  if (sent.length === 0) return [];

  // A reply points at the mention it answers, or at the thread it was sent in.
  const threadHeads = sent
    .map((event) => threadHeadOf(event))
    .filter((id): id is string => id !== null);
  const answers = await withTimeout(
    fetchEvents({
      kinds: ANSWER_KINDS,
      authors: [agent],
      "#e": [...new Set([...sent.map((event) => event.id), ...threadHeads])],
      since: Math.min(...sent.map((event) => event.created_at)) - 1,
      limit: UNANSWERED_MENTION_LIMIT * 4,
    }),
    readTimeoutMs,
    "reading the agent's answers",
  );
  const answersFromAgent = answers.filter(
    (answer) => normalizePubkey(answer.pubkey) === agent,
  );
  const isReaction = (answer: RelayEvent) => answer.kind === KIND_REACTION;
  // A reaction says how far the harness got; only a message answers.
  const replies = answersFromAgent.filter((answer) => !isReaction(answer));
  const answered = new Set<string>();
  const seen = new Set<string>();
  const working = new Set<string>();
  for (const answer of answersFromAgent) {
    for (const tag of answer.tags) {
      if (tag[0] !== "e" || !tag[1]) continue;
      if (!isReaction(answer)) answered.add(tag[1]);
      else if (answer.content === WORKING_REACTION) working.add(tag[1]);
      else seen.add(tag[1]);
    }
  }
  const answeredInThread = (event: RelayEvent) => {
    const head = threadHeadOf(event);
    return (
      head !== null &&
      replies.some(
        (answer) =>
          answer.created_at >= event.created_at &&
          answer.tags.some((tag) => tag[0] === "e" && tag[1] === head),
      )
    );
  };
  const progressOf = (id: string): MentionProgress =>
    working.has(id) ? "working" : seen.has(id) ? "seen" : "none";

  const listed = new Set<string>();
  return sent
    .filter((event) => {
      if (answered.has(event.id) || answeredInThread(event)) return false;
      if (listed.has(event.id)) return false;
      listed.add(event.id);
      return true;
    })
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .map((event) => ({
      id: event.id,
      createdAt: event.created_at,
      channelId: tagValue(event, "h"),
      threadHeadId: threadHeadOf(event),
      progress: progressOf(event.id),
    }));
}
