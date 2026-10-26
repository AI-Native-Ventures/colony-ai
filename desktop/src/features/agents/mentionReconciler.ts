import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { AgentStartRunner } from "./agentStartWatch";
import type { UnansweredMention } from "./unansweredMentions";

/**
 * The safety net under every mention to a local agent.
 *
 * The send flow wakes the agent it believes is not running, and the start
 * watch (`agentStartWatch`) follows that wake. Both rest on what the desktop
 * knew at the moment of the send. GATE-303 (26 Oct, published 3.0.3): a mention
 * sent 3.6 s after launch got no wake and no watch, and nothing else ever
 * looked at it again.
 *
 * This reconciler does not trust the send. It reads the relay: a mention the
 * person sent to a local agent that the agent never touched (no reply, no
 * "seen" reaction) was never picked up, whatever the desktop did or failed to
 * do. It runs
 *
 * - shortly after every send that mentions someone, and again while an
 *   unanswered mention is still waiting, and
 * - once when the community opens, which finds what was sent while the app
 *   was closed or the agent was down.
 *
 * An agent that is not running is started, reaching back to the oldest
 * unanswered mention. An agent that is running but silent gets the stalled
 * note with a way to try again (the start watch). A read that fails is retried
 * with a back-off and then reported; it is never taken for "nothing is
 * waiting".
 *
 * Only an answer ends the wait. GATE-304 (26 Oct, published 3.0.4): Scout was
 * started for a mention, queued it (the harness reacts 👀 when it does) and
 * was stopped 5.5 s after it started. The harness had already written the
 * mention into its wake ledger as handled, so a Scout started again skipped it
 * for good, and a check that counted the 👀 as an answer stopped looking. A
 * mention the agent queued and lost is handed back to the harness before the
 * agent is started again, so it is answered once. A mention whose turn had
 * begun (💬) may already have been acted on: running it again is the person's
 * call, so it is shown as stalled with a way to try again.
 */

/** Delay before the first look after a send, then between looks while an
 * unanswered mention is still waiting. After the quick looks, one a minute
 * until the harness would no longer replay the mention (15 minutes), so an
 * agent that dies late is still found. */
export const SENT_CHECK_DELAYS_MS = [
  6_000,
  20_000,
  50_000,
  ...Array.from({ length: 12 }, () => 60_000),
] as const;
/** Times one trigger starts a dead agent again before saying it keeps
 * stopping. */
export const MAX_AUTOMATIC_RESTARTS = 2;
/** Back-off between retries of a read that failed. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
/** How far back a check right after a send looks. */
export const SENT_LOOKBACK_SECONDS = 15 * 60;
/** How far back the check when the community opens looks. */
export const LAUNCH_LOOKBACK_SECONDS = 24 * 60 * 60;

export type ReconcileReason = "sent" | "launch";

export type TenantScope = {
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
};

export type MentionReconcilerDeps = {
  /** Fresh read of the managed agents. Rejects when the host cannot answer. */
  loadAgents: () => Promise<ManagedAgent[]>;
  /** Unanswered mentions to `agentPubkey` within the look-back. Rejects when
   * the relay cannot be read. */
  findUnanswered: (
    agentPubkey: string,
    lookbackSeconds: number,
  ) => Promise<UnansweredMention[]>;
  /** The tenant scope to start agents under, or `null` while it is unknown. */
  getScope: () => TenantScope | null;
  /** Stops the agent's harness; `reason` is written to the agent's log. */
  stopAgent: (pubkey: string, reason: string) => Promise<unknown>;
  /** Hands mentions the harness queued and lost back to it so the next
   * harness answers them. The agent must be stopped; rejects when it is not. */
  handBack: (pubkey: string, eventIds: string[]) => Promise<unknown>;
  /** Runs `work` with every other start, stop or restart of the agent held
   * back until it finishes. */
  exclusive: <T>(
    pubkey: string,
    label: string,
    work: () => Promise<T>,
  ) => Promise<T>;
  /** Starts the agent under `scope`. */
  startAgent: (
    agent: ManagedAgent,
    attempt: { force: boolean; floorUnix: number },
    scope: TenantScope,
  ) => Promise<unknown>;
  /** Whether a start for this agent is already running (a send-flow wake). */
  isStartInFlight: (agentPubkey: string) => boolean;
  /** Records a wait on the agent so the conversation can say so. */
  watch: (input: {
    pubkey: string;
    channelId: string | null;
    threadHeadId: string | null;
    floorUnix: number;
    quiet: boolean;
    start: AgentStartRunner;
  }) => void;
  /** The agent picked everything up: stop waiting on it. Only waits registered
   * before `registeredBefore` (desktop-clock ms) end: a look cannot have seen
   * a mention sent after it began. */
  resolve: (agentPubkey: string, registeredBefore: number) => void;
  /** Desktop clock, ms. */
  now: () => number;
  /** The agent could not be started: say so now. */
  fail: (agentPubkey: string, reason: string) => void;
  /** The agent started and went away with the mention unanswered, and will not
   * be started again on its own: say so now, in `note`, with Try again. */
  stall: (agentPubkey: string, note: string) => void;
  /** Mentions already used to start an agent at launch (once per mention). */
  caughtUp: { has: (id: string) => boolean; add: (id: string) => void };
  /** Tell the person a read kept failing. Not the place for per-try noise. */
  report: (message: string) => void;
  warn: (message: string, error?: unknown) => void;
  schedule: (run: () => void, delayMs: number) => () => void;
};

export type MentionReconciler = {
  /** The person just sent a message that mentions these pubkeys. */
  noteMentionSent: (mentionedPubkeys: readonly string[]) => void;
  /** The community opened: look for mentions sent while nothing was running. */
  catchUpOnLaunch: () => void;
  /**
   * Before a harness is spawned for the agent: hand back the mentions its last
   * harness queued and lost, and say how far back the oldest unanswered one
   * reaches. Rejects when the relay cannot be read.
   */
  prepareStart: (agentPubkey: string) => Promise<number | undefined>;
  /**
   * The person asked to try again: replace the harness, hand back everything
   * unanswered (the person decides to run it again) and start from the oldest.
   */
  retryAgent: (agentPubkey: string, floorUnix: number) => Promise<void>;
  /** Stop everything (the community is going away). */
  dispose: () => void;
};

type AgentRun = {
  /** Bumped to cancel whatever this agent had in flight. */
  generation: number;
  cancel: (() => void) | null;
  /** Looks made since the last trigger. */
  checks: number;
  /** Failed reads since the last success. */
  retries: number;
  /** Times this trigger started the agent again after its harness was gone. */
  restarts: number;
};

function isLocal(agent: ManagedAgent) {
  return agent.backend.type === "local";
}

function messageOf(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Could not start the agent.";
}

export function createMentionReconciler(
  deps: MentionReconcilerDeps,
): MentionReconciler {
  const runs = new Map<string, AgentRun>();
  const cancels = new Set<() => void>();
  let disposed = false;

  function later(run: () => void, delayMs: number) {
    const cancel = deps.schedule(() => {
      cancels.delete(cancel);
      if (!disposed) run();
    }, delayMs);
    cancels.add(cancel);
    return () => {
      cancels.delete(cancel);
      cancel();
    };
  }

  function runFor(pubkey: string): AgentRun {
    let run = runs.get(pubkey);
    if (!run) {
      run = { generation: 0, cancel: null, checks: 0, retries: 0, restarts: 0 };
      runs.set(pubkey, run);
    }
    return run;
  }

  /** Look at one agent now, or after `delayMs`, replacing anything pending. */
  function trigger(
    pubkey: string,
    delayMs: number,
    lookbackSeconds: number,
    reason: ReconcileReason,
  ) {
    const run = runFor(pubkey);
    run.generation += 1;
    run.cancel?.();
    run.checks = 0;
    run.retries = 0;
    run.restarts = 0;
    run.cancel = later(
      () => void reconcile(pubkey, run, lookbackSeconds, reason),
      delayMs,
    );
  }

  function again(
    pubkey: string,
    run: AgentRun,
    delayMs: number,
    lookbackSeconds: number,
    reason: ReconcileReason,
  ) {
    const generation = run.generation;
    run.cancel = later(() => {
      if (run.generation !== generation) return;
      void reconcile(pubkey, run, lookbackSeconds, reason);
    }, delayMs);
  }

  /** Mentions the harness queued (👀) and lost go back to the ledger so the
   * next harness answers them once. Never throws: a ledger that cannot be
   * edited costs the replay of those mentions, not the start. */
  async function handBackQueued(
    pubkey: string,
    mentions: readonly UnansweredMention[],
    everything = false,
  ) {
    const ids = mentions
      .filter((mention) => everything || mention.progress === "seen")
      .filter((mention) => mention.progress !== "none")
      .map((mention) => mention.id);
    if (ids.length === 0) return;
    try {
      await deps.handBack(pubkey, ids);
    } catch (error) {
      deps.warn(
        `[mentionReconciler] could not hand ${ids.length} mention(s) back to ${pubkey}`,
        error,
      );
    }
  }

  /** The watch's own restart: a harness that is gone is replaced, one that is
   * running is left alone. */
  async function restartForMentions(pubkey: string, floorUnix: number) {
    const scope = deps.getScope();
    if (!scope) {
      throw new Error("Colony is still connecting to this community.");
    }
    await deps.exclusive(pubkey, "mention restart", async () => {
      const agents = await deps.loadAgents();
      const agent = agents.find(
        (candidate) => normalizePubkey(candidate.pubkey) === pubkey,
      );
      if (!agent || !isLocal(agent) || agent.status === "running") return;
      const found = await deps.findUnanswered(pubkey, SENT_LOOKBACK_SECONDS);
      await handBackQueued(pubkey, found);
      await deps.startAgent(
        agent,
        {
          force: false,
          floorUnix: Math.min(floorUnix, found[0]?.createdAt ?? floorUnix),
        },
        scope,
      );
    });
  }

  async function retryAgent(pubkey: string, floorUnix: number) {
    const scope = deps.getScope();
    if (!scope) {
      throw new Error("Colony is still connecting to this community.");
    }
    await deps.exclusive(pubkey, "try again", async () => {
      const agents = await deps.loadAgents();
      const agent = agents.find(
        (candidate) => normalizePubkey(candidate.pubkey) === pubkey,
      );
      if (!agent || !isLocal(agent)) {
        throw new Error("This agent is not one of your local agents.");
      }
      let found: UnansweredMention[] = [];
      try {
        found = await deps.findUnanswered(pubkey, SENT_LOOKBACK_SECONDS);
      } catch (error) {
        deps.warn(
          `[mentionReconciler] retrying ${pubkey} without the relay's view`,
          error,
        );
      }
      if (agent.status === "running") {
        await deps.stopAgent(pubkey, "the person asked to try again");
      }
      // The person asked: run what the agent began and lost as well.
      await handBackQueued(pubkey, found, true);
      await deps.startAgent(
        agent,
        {
          force: false,
          floorUnix: Math.min(floorUnix, found[0]?.createdAt ?? floorUnix),
        },
        scope,
      );
    });
  }

  async function reconcile(
    pubkey: string,
    run: AgentRun,
    lookbackSeconds: number,
    reason: ReconcileReason,
  ) {
    const generation = run.generation;
    const stale = () => disposed || run.generation !== generation;
    // Nothing sent after this moment can be in what the relay answers.
    const lookBeganAt = deps.now();

    let agent: ManagedAgent | undefined;
    let found: UnansweredMention[];
    try {
      const agents = await deps.loadAgents();
      agent = agents.find(
        (candidate) => normalizePubkey(candidate.pubkey) === pubkey,
      );
      if (stale()) return;
      // Not one of this person's local agents: nothing here to wake.
      if (!agent || !isLocal(agent)) return;
      found = await deps.findUnanswered(pubkey, lookbackSeconds);
    } catch (error) {
      if (stale()) return;
      deps.warn(`[mentionReconciler] could not check ${pubkey}`, error);
      if (run.retries >= RETRY_DELAYS_MS.length) {
        deps.report(
          "Colony could not confirm that your agent got your message. Check your connection, then mention it again.",
        );
        return;
      }
      const delay = RETRY_DELAYS_MS[run.retries];
      run.retries += 1;
      again(pubkey, run, delay, lookbackSeconds, reason);
      return;
    }
    if (stale()) return;
    run.retries = 0;

    // A launch pass starts an agent for a given mention once; a mention it
    // already acted on is the harness's to handle (its ledger replays it).
    const waiting =
      reason === "launch"
        ? found.filter((mention) => !deps.caughtUp.has(mention.id))
        : found;
    if (waiting.length === 0) {
      deps.resolve(pubkey, lookBeganAt);
      return;
    }

    const running = agent.status === "running";
    const start: AgentStartRunner = (attempt) =>
      attempt.force
        ? retryAgent(pubkey, attempt.floorUnix)
        : restartForMentions(pubkey, attempt.floorUnix);
    for (const mention of waiting) {
      deps.watch({
        pubkey,
        channelId: mention.channelId,
        threadHeadId: mention.threadHeadId,
        floorUnix: mention.createdAt,
        quiet: running,
        start,
      });
    }

    if (!running && !deps.isStartInFlight(pubkey)) {
      const scope = deps.getScope();
      if (scope) {
        const replayable = waiting.filter(
          (mention) => mention.progress !== "working",
        );
        if (replayable.length === 0) {
          // Every waiting mention had a turn begin and then end with no
          // answer. The model may have acted on them: say so, and let the
          // person decide to run them again.
          deps.stall(pubkey, `${agent.name} stopped while working on this.`);
          return;
        }
        if (run.restarts >= MAX_AUTOMATIC_RESTARTS) {
          deps.stall(pubkey, `${agent.name} keeps stopping before it answers.`);
          return;
        }
        run.restarts += 1;
        for (const mention of waiting) deps.caughtUp.add(mention.id);
        try {
          await deps.exclusive(pubkey, "mention reconcile", async () => {
            await handBackQueued(pubkey, replayable);
            await deps.startAgent(
              agent,
              { force: false, floorUnix: replayable[0].createdAt },
              scope,
            );
          });
        } catch (error) {
          if (stale()) return;
          deps.warn(`[mentionReconciler] could not start ${pubkey}`, error);
          deps.fail(pubkey, messageOf(error));
          return;
        }
        if (stale()) return;
      }
      // No scope yet: the look below comes round again once it is known.
    }

    // Someone is still owed an answer: look again soon, a bounded number of
    // times. After that the start watch's stalled note is what the person sees.
    const delay = SENT_CHECK_DELAYS_MS[run.checks];
    run.checks += 1;
    if (delay !== undefined) {
      again(pubkey, run, delay, lookbackSeconds, reason);
    }
  }

  /** Find the local agents among `pubkeys` (or every local agent when null)
   * and look at each. A list that cannot be read is retried, then reported. */
  function forLocalAgents(
    pubkeys: readonly string[] | null,
    delayMs: number,
    lookbackSeconds: number,
    reason: ReconcileReason,
    attempt = 0,
  ) {
    later(() => {
      void (async () => {
        let agents: ManagedAgent[];
        try {
          agents = await deps.loadAgents();
        } catch (error) {
          if (disposed) return;
          deps.warn("[mentionReconciler] could not list agents", error);
          if (attempt >= RETRY_DELAYS_MS.length) {
            deps.report(
              "Colony could not check your agents. Restart Colony if your agent does not answer.",
            );
            return;
          }
          forLocalAgents(
            pubkeys,
            RETRY_DELAYS_MS[attempt],
            lookbackSeconds,
            reason,
            attempt + 1,
          );
          return;
        }
        if (disposed) return;
        const wanted = pubkeys ? new Set(pubkeys) : null;
        for (const agent of agents) {
          const pubkey = normalizePubkey(agent.pubkey);
          if (!isLocal(agent) || (wanted && !wanted.has(pubkey))) continue;
          trigger(pubkey, 0, lookbackSeconds, reason);
        }
      })();
    }, delayMs);
  }

  return {
    noteMentionSent(mentionedPubkeys) {
      if (disposed || mentionedPubkeys.length === 0) return;
      forLocalAgents(
        [...new Set(mentionedPubkeys.map(normalizePubkey))],
        SENT_CHECK_DELAYS_MS[0],
        SENT_LOOKBACK_SECONDS,
        "sent",
      );
    },
    catchUpOnLaunch() {
      if (disposed) return;
      forLocalAgents(null, 0, LAUNCH_LOOKBACK_SECONDS, "launch");
    },
    async prepareStart(agentPubkey) {
      const pubkey = normalizePubkey(agentPubkey);
      const found = await deps.findUnanswered(pubkey, SENT_LOOKBACK_SECONDS);
      await handBackQueued(pubkey, found);
      return found[0]?.createdAt;
    },
    retryAgent(agentPubkey, floorUnix) {
      return retryAgent(normalizePubkey(agentPubkey), floorUnix);
    },
    dispose() {
      disposed = true;
      for (const run of runs.values()) {
        run.generation += 1;
        run.cancel?.();
        run.cancel = null;
      }
      runs.clear();
      for (const cancel of [...cancels]) cancel();
      cancels.clear();
    },
  };
}
