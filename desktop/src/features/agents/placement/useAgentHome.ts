import * as React from "react";

import {
  useAcpRuntimesQuery,
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { simpleModelLabel } from "@/features/agents/ui/simpleAgentAi";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { useCloudCapabilities } from "./cloudQueries";
import { capMessage, notCloudReadyMessage, statusLabel } from "./placementCopy";
import { usePlacement } from "./placementQueries";
import { classifyPlacementError, publishPlacement } from "./publishPlacement";
import type { AgentPlacement, Home } from "./placementTypes";

/** What the switch for one agent needs to draw itself and to act. */
export type AgentHomeModel = {
  /** The person owns this agent and the switch applies to it. */
  show: boolean;
  owned: boolean;
  /** This device keeps a copy of the agent. */
  hasLocalRecord: boolean;
  /** The relay says this account may use cloud agents. */
  cloudAvailable: boolean;
  name: string;
  placement: AgentPlacement;
  /** The harness this agent uses on the Mac, e.g. "Claude Code". */
  macLabel: string | null;
  /** What the cloud runs it with, e.g. "Colony credits · DeepSeek V4.1 Flash". */
  cloudLabel: string;
  /** The cloud models the relay offers, and the one in use. */
  cloudModels: { id: string; label: string }[];
  cloudModelId: string | null;
  /** The relay holds no key for this agent: it must be opened on its Mac. */
  notCloudReady: boolean;
  status: string | null;
  pending: boolean;
  /** A plain sentence about the last attempt, or null. */
  message: string | null;
  choose: (home: Home) => Promise<void>;
  chooseModel: (model: string) => Promise<void>;
  retryWake: () => Promise<void>;
};

const CLOUD_PROVIDER_LABEL = "Colony credits";

/**
 * Where one agent works and how to move it (spec 5.5). The agent's owner only:
 * an agent of this Mac, or one the relay lists as owned by this account. The
 * switch is offered while the relay says this account may use cloud agents, and
 * stays for an agent already in the cloud so it can always be moved back.
 */
export function useAgentHome(
  pubkey: string | null | undefined,
): AgentHomeModel {
  const key = pubkey ? normalizePubkey(pubkey) : "";
  const placement = usePlacement(key);
  const { capabilities, available } = useCloudCapabilities();
  const identity = useIdentityQuery().data?.pubkey;
  const managed = useManagedAgentsQuery().data?.find(
    (candidate) => normalizePubkey(candidate.pubkey) === key,
  );
  const relayAgent = useRelayAgentsQuery().data?.find(
    (candidate) => normalizePubkey(candidate.pubkey) === key,
  );
  const runtimes = useAcpRuntimesQuery().data;

  const localHere = managed?.backend.type === "local";
  const me = identity ? normalizePubkey(identity) : null;
  const ownedElsewhere =
    Boolean(me) &&
    relayAgent?.ownerPubkey != null &&
    normalizePubkey(relayAgent.ownerPubkey) === me;
  const owned = Boolean(key) && (localHere || ownedElsewhere);
  const name = managed?.name ?? relayAgent?.name ?? "this agent";

  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  // A message belongs to the agent it was about.
  React.useEffect(() => {
    void key;
    setMessage(null);
  }, [key]);

  const macLabel = React.useMemo(() => {
    if (!managed) return null;
    const runtimeId = managed.runningRuntimeId ?? managed.runtime;
    return runtimes?.find((runtime) => runtime.id === runtimeId)?.label ?? null;
  }, [managed, runtimes]);

  const cloudModelId = placement.cloudModel ?? capabilities.defaultModel;
  const cloudModels = React.useMemo(
    () =>
      capabilities.models.map((id) => ({
        id,
        label: simpleModelLabel(id),
      })),
    [capabilities.models],
  );
  const cloudLabel = cloudModelId
    ? `${CLOUD_PROVIDER_LABEL} · ${simpleModelLabel(cloudModelId)}`
    : CLOUD_PROVIDER_LABEL;
  const notCloudReady =
    placement.status === "notCloudReady" ||
    (!placement.cloudReady && !localHere);

  async function run(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      const refusal = classifyPlacementError(error);
      if (refusal.code === "cloud_limit" && refusal.limit !== null) {
        setMessage(capMessage(refusal.limit));
      } else if (refusal.code === "generation_conflict") {
        setMessage(`${name} was just moved. This is where ${name} works now.`);
      } else if (refusal.code === "not_cloud_ready") {
        setMessage(notCloudReadyMessage(name));
      } else if (refusal.code === "not_allowed") {
        setMessage("Cloud agents are not available for this account.");
      } else {
        setMessage(refusal.message);
      }
    } finally {
      setPending(false);
    }
  }

  return {
    show: owned && (available || placement.home === "cloud"),
    owned,
    hasLocalRecord: localHere,
    cloudAvailable: available,
    name,
    placement,
    macLabel,
    cloudLabel,
    cloudModels,
    cloudModelId,
    notCloudReady,
    status: statusLabel(placement.status),
    pending,
    message,
    choose: (home) =>
      run(async () => {
        if (home === placement.home) return;
        await publishPlacement(key, "setHome", placement.generation, home);
      }),
    chooseModel: (model) =>
      run(async () => {
        await publishPlacement(
          key,
          "setCloudModel",
          placement.generation,
          undefined,
          model,
        );
      }),
    retryWake: () =>
      run(async () => {
        await publishPlacement(key, "retryWake", placement.generation);
      }),
  };
}
