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
 */

/** Delay before the first look after a send, then between looks while an
 * unanswered mention is still waiting. */
export const SENT_CHECK_DELAYS_MS = [6_000, 20_000, 50_000] as const;
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
  /** The agent picked everything up: stop waiting on it. */
  resolve: (agentPubkey: string) => void;
  /** The agent could not be started: say so now. */
  fail: (agentPubkey: string, reason: string) => void;
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
      run = { generation: 0, cancel: null, checks: 0, retries: 0 };
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

  async function reconcile(
    pubkey: string,
    run: AgentRun,
    lookbackSeconds: number,
    reason: ReconcileReason,
  ) {
    const generation = run.generation;
    const stale = () => disposed || run.generation !== generation;

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
      deps.resolve(pubkey);
      return;
    }

    const running = agent.status === "running";
    const floorUnix = waiting[0].createdAt;
    const start: AgentStartRunner = (attempt) => {
      const scope = deps.getScope();
      if (!scope) {
        return Promise.reject(
          new Error("Colony is still connecting to this community."),
        );
      }
      return deps.startAgent(agent, attempt, scope);
    };
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
        for (const mention of waiting) deps.caughtUp.add(mention.id);
        try {
          await deps.startAgent(agent, { force: false, floorUnix }, scope);
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
