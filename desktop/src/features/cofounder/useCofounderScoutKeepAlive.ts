import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { runAgentLifecycle } from "@/features/agents/agentLifecycle";
import {
  managedAgentsQueryKey,
  useManagedAgentsQuery,
  useStartManagedAgentMutation,
} from "@/features/agents/hooks";
import { createMentionCatchUpStore } from "@/features/agents/mentionCatchUpStorage";
import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { listManagedAgents } from "@/shared/api/tauri";
import { setManagedAgentStartOnAppLaunch } from "@/shared/api/tauriManagedAgents";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { useCofounderSettingsQuery } from "./hooks";
import { useOnboardingQuery } from "./initiativeHooks";
import {
  findCofounderScout,
  findPendingCofounderWake,
  getScoutStartState,
  isScoutUp,
  noteScoutStartFailed,
  noteScoutStarting,
  noteScoutUp,
  planScoutStart,
  setScoutStartState,
  subscribeScoutStartState,
} from "./scoutKeepAlive";
import type { PendingCofounderWake } from "./scoutKeepAlive";

/** How often Scout is looked at while co-founder mode is on. The managed agent
 * list only polls while something runs, so a Scout that never started needs
 * this clock to be noticed. */
const KEEP_ALIVE_CLOCK_MS = 30_000;
/** Seconds of history a start reaches back: the harness replays no further
 * than 15 minutes from a floor, and its ledger skips what it handled. */
const START_REPLAY_SECONDS = 14 * 60;
/** Starts that landed but did not stay up, within the window, before the
 * keep-alive calls it a failure instead of starting Scout again. */
const MAX_QUICK_STARTS = 4;
const QUICK_START_WINDOW_MS = 10 * 60 * 1000;

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Scout did not start on this computer.";
}

/**
 * Starts the owner's Scout by itself whenever co-founder mode needs it.
 *
 * Mounted once for the community on screen. While co-founder mode is on and
 * Scout is a stopped local agent, it starts Scout when onboarding has not begun
 * or a relay wake is waiting for it (found live, or in the direct message
 * history after a launch). It also turns "start with the app" on for Scout so
 * the next launch starts it before anything else runs. The owner never has to
 * message Scout, open a chat or click anything.
 *
 * A start that fails is retried with a capped back-off and then left in the
 * `failed` state the Scout card shows, with Try again as the one recovery. See
 * `scoutKeepAlive` for the decisions and why this exists.
 */
export function useCofounderScoutKeepAlive(): void {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const identityQuery = useIdentityQuery();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const enabled = settingsQuery.data?.settings.enabled === true;
  const onboardingQuery = useOnboardingQuery(enabled);
  const agentsQuery = useManagedAgentsQuery({ enabled });
  const startAgent = useStartManagedAgentMutation().mutateAsync;
  const scoutStart = React.useSyncExternalStore(
    subscribeScoutStartState,
    getScoutStartState,
  );

  const relayUrl = activeCommunity?.relayUrl?.trim()
    ? activeCommunity.relayUrl
    : undefined;
  const signer = normalizePubkey(identityQuery.data?.pubkey ?? "") || undefined;

  const [clock, setClock] = React.useState(0);
  const busyRef = React.useRef(false);
  const autoStartMarkedRef = React.useRef<Set<string>>(new Set());
  const quickStartsRef = React.useRef<number[]>([]);
  const wakeLookupRef = React.useRef<{
    at: number;
    pubkey: string;
    wake: PendingCofounderWake | null;
  } | null>(null);
  const caughtUpRef = React.useRef<ReturnType<
    typeof createMentionCatchUpStore
  > | null>(null);
  if (caughtUpRef.current === null) {
    caughtUpRef.current = createMentionCatchUpStore();
  }

  // The clock: look again while co-founder mode is on.
  React.useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(
      () => setClock((n) => n + 1),
      KEEP_ALIVE_CLOCK_MS,
    );
    return () => clearInterval(timer);
  }, [enabled]);

  const head = onboardingQuery.data?.head ?? null;
  const onboardingKnown =
    onboardingQuery.data !== undefined && !onboardingQuery.isError;
  const agents = agentsQuery.data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `clock` and the start state only re-run the look.
  React.useEffect(() => {
    if (!enabled || !relayUrl || !signer || !agents || !onboardingKnown) return;
    const scout = findCofounderScout(agents, {
      leadPubkey: head?.leadPubkey,
      relayUrl,
    });
    if (!scout) return;
    const scoutKey = normalizePubkey(scout.pubkey);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const look = async () => {
      if (isScoutUp(scout)) {
        if (
          !autoStartMarkedRef.current.has(scoutKey) &&
          !scout.startOnAppLaunch
        ) {
          autoStartMarkedRef.current.add(scoutKey);
          await markAutoStart(scout.pubkey);
        }
        const state = getScoutStartState();
        if (state.pubkey === scoutKey && state.phase === "starting") {
          setScoutStartState({ ...state, phase: "idle" });
        }
        if (state.pubkey === scoutKey && state.failures > 0)
          noteScoutUp(scoutKey);
        return;
      }

      // Scout is stopped. Only look at the relay for a waiting wake when
      // onboarding has already begun (otherwise Scout is wanted regardless).
      let wake: PendingCofounderWake | null = null;
      if (head !== null) {
        const cached = wakeLookupRef.current;
        if (
          cached &&
          cached.pubkey === scoutKey &&
          Date.now() - cached.at < KEEP_ALIVE_CLOCK_MS / 2
        ) {
          wake = cached.wake;
        } else {
          try {
            const relaySelf = await getRelaySelf();
            if (relaySelf) {
              wake = await findPendingCofounderWake({
                scoutPubkey: scout.pubkey,
                relaySelf,
                nowSeconds: Math.floor(Date.now() / 1000),
                fetchEvents: (filter) => relayClient.fetchEvents(filter),
              });
            }
          } catch (error) {
            // An unread relay is not "nothing waiting": look again next tick.
            console.warn("[cofounder-scout] could not read the wakes", error);
            return;
          }
          wakeLookupRef.current = { at: Date.now(), pubkey: scoutKey, wake };
        }
        if (cancelled) return;
        // One start per wake and device; the harness ledger replays the rest.
        if (wake && caughtUpRef.current?.has(wake.id)) wake = null;
      }

      const plan = planScoutStart({
        enabled,
        onboardingKnown,
        onboardingStarted: head !== null,
        scout,
        wakeWaiting: wake !== null,
        state: getScoutStartState(),
        now: Date.now(),
      });
      if (plan.markAutoStart && !autoStartMarkedRef.current.has(scoutKey)) {
        autoStartMarkedRef.current.add(scoutKey);
        await markAutoStart(scout.pubkey);
      }
      if (plan.retryAt !== null) {
        retryTimer = setTimeout(
          () => setClock((n) => n + 1),
          Math.max(0, plan.retryAt - Date.now()) + 50,
        );
        return;
      }
      if (!plan.start || busyRef.current || cancelled) return;

      const now = Date.now();
      quickStartsRef.current = quickStartsRef.current.filter(
        (at) => now - at < QUICK_START_WINDOW_MS,
      );
      if (quickStartsRef.current.length >= MAX_QUICK_STARTS) {
        noteScoutStartFailed(
          scout.pubkey,
          "Scout keeps stopping right after it starts.",
          now,
        );
        quickStartsRef.current = [];
        return;
      }
      quickStartsRef.current.push(now);

      busyRef.current = true;
      noteScoutStarting(scout.pubkey);
      const floorUnix =
        plan.reason === "wake-waiting" && wake
          ? wake.createdAt
          : Math.floor(now / 1000) - START_REPLAY_SECONDS;
      if (wake) caughtUpRef.current?.add(wake.id);
      try {
        await runAgentLifecycle(
          scout.pubkey,
          "cofounder keep-alive",
          async () => {
            const fresh = (
              await queryClient.fetchQuery({
                queryKey: managedAgentsQueryKey,
                queryFn: listManagedAgents,
                staleTime: 0,
              })
            ).find((agent) => normalizePubkey(agent.pubkey) === scoutKey);
            if (fresh && isScoutUp(fresh)) return;
            await startAgent({
              pubkey: scout.pubkey,
              expectedRelayUrl: relayUrl,
              expectedSignerPubkey: signer,
              replayFloorUnix: floorUnix,
            });
          },
        );
        const state = getScoutStartState();
        // The start landed. Failures stay counted until Scout is seen staying
        // up, so a harness that dies at once cannot restart in a tight loop.
        setScoutStartState({
          ...state,
          pubkey: scoutKey,
          phase: "idle",
          reason: null,
          nextAttemptAt: Date.now() + 5_000,
        });
      } catch (error) {
        console.warn("[cofounder-scout] could not start Scout", error);
        noteScoutStartFailed(scout.pubkey, messageOf(error), Date.now());
      } finally {
        busyRef.current = false;
        if (!cancelled) setClock((n) => n + 1);
      }
    };

    void look();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };

    async function markAutoStart(pubkey: string) {
      try {
        await setManagedAgentStartOnAppLaunch(pubkey, true);
        await queryClient.invalidateQueries({
          queryKey: managedAgentsQueryKey,
        });
      } catch (error) {
        autoStartMarkedRef.current.delete(normalizePubkey(pubkey));
        console.warn(
          "[cofounder-scout] could not turn on start with the app",
          error,
        );
      }
    }
  }, [
    enabled,
    relayUrl,
    signer,
    agents,
    onboardingKnown,
    head,
    clock,
    scoutStart.pubkey,
    scoutStart.phase,
    scoutStart.failures,
    scoutStart.nextAttemptAt,
    scoutStart.requests,
    queryClient,
    startAgent,
  ]);
}
