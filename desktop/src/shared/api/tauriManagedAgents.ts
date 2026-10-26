import {
  fromRawManagedAgent,
  invokeTauri,
  type RawManagedAgent,
} from "@/shared/api/tauri";
import type {
  ManagedAgent,
  ManagedAgentRuntimeStatus,
} from "@/shared/api/types";

export async function startManagedAgent(
  pubkey: string,
  options?: {
    /** Tenant scope captured by the caller before its first await; the
     * backend fails closed before any spawn/deploy side effect when the
     * active community no longer matches. */
    expectedRelayUrl?: string;
    /** Signer identity captured with the relay scope; the backend fails
     * closed when the active workspace identity no longer matches. */
    expectedSignerPubkey?: string;
    /** Unix-seconds replay floor for a publish-first mention send: the
     * spawned harness's first REQ replays at least back to this moment, so
     * the already-published triggering message lands in its window however
     * long the spawn takes. Local spawns receive it as process env; provider
     * deploys carry it in the payload's launch.policy_env. */
    replayFloorUnix?: number;
    /** Replace the agent's harness even if one is running. Only for a person
     * asking to try again after the agent never picked a mention up: the
     * running harness is stuck, and a plain start would reuse it. */
    forceRestart?: boolean;
  },
): Promise<ManagedAgent> {
  const response = await invokeTauri<RawManagedAgent>("start_managed_agent", {
    pubkey,
    expectedRelayUrl: options?.expectedRelayUrl ?? null,
    expectedSignerPubkey: options?.expectedSignerPubkey ?? null,
    replayFloorUnix: options?.replayFloorUnix ?? null,
    forceRestart: options?.forceRestart ?? null,
  });
  return fromRawManagedAgent(response);
}

/**
 * Stops the agent's harness. `reason` is written to the agent's log and the
 * host's stderr before the harness is signalled, so a stop is never anonymous
 * (GATE-304: Scout was stopped 5.5 s after it started and nothing named who).
 */
export async function stopManagedAgent(
  pubkey: string,
  reason?: string,
): Promise<ManagedAgent> {
  const response = await invokeTauri<RawManagedAgent>("stop_managed_agent", {
    pubkey,
    reason: reason ?? null,
  });
  return fromRawManagedAgent(response);
}

/**
 * Hands mentions the agent's last harness queued and lost back to its wake
 * ledger, so the next harness answers them once. The agent must be stopped;
 * rejects when it is running. Resolves to how many of `eventIds` the ledger
 * held as handled.
 */
export async function releaseWakeEvents(
  pubkey: string,
  eventIds: readonly string[],
): Promise<number> {
  return invokeTauri<number>("release_wake_events", {
    pubkey,
    eventIds: [...eventIds],
  });
}

export async function setManagedAgentStartOnAppLaunch(
  pubkey: string,
  startOnAppLaunch: boolean,
): Promise<ManagedAgent> {
  const response = await invokeTauri<RawManagedAgent>(
    "set_managed_agent_start_on_app_launch",
    {
      pubkey,
      startOnAppLaunch,
    },
  );
  return fromRawManagedAgent(response);
}

export async function setManagedAgentAutoRestart(
  pubkey: string,
  autoRestartOnConfigChange: boolean,
): Promise<ManagedAgent> {
  const response = await invokeTauri<RawManagedAgent>(
    "set_managed_agent_auto_restart",
    {
      pubkey,
      autoRestartOnConfigChange,
    },
  );
  return fromRawManagedAgent(response);
}

export async function listManagedAgentRuntimes(): Promise<
  ManagedAgentRuntimeStatus[]
> {
  return invokeTauri<ManagedAgentRuntimeStatus[]>(
    "list_managed_agent_runtimes",
  );
}

export async function startManagedAgentRuntime(
  pubkey: string,
  relayUrl: string,
): Promise<ManagedAgentRuntimeStatus> {
  return invokeTauri("start_managed_agent_runtime", { pubkey, relayUrl });
}

export async function stopManagedAgentRuntime(
  pubkey: string,
  relayUrl: string,
  reason?: string,
): Promise<ManagedAgentRuntimeStatus> {
  return invokeTauri("stop_managed_agent_runtime", {
    pubkey,
    relayUrl,
    reason: reason ?? null,
  });
}

export async function restartManagedAgentRuntime(
  pubkey: string,
  relayUrl: string,
): Promise<ManagedAgentRuntimeStatus> {
  return invokeTauri("restart_managed_agent_runtime", { pubkey, relayUrl });
}

export async function putManagedAgentRuntimeLifecycle(
  outerPubkey: string,
  payload: unknown,
): Promise<ManagedAgentRuntimeStatus> {
  return invokeTauri("put_managed_agent_runtime_lifecycle", {
    outerPubkey,
    payload,
  });
}

export async function reconcileManagedAgentRuntimes(
  communities: readonly { relayUrl: string }[],
): Promise<ManagedAgentRuntimeStatus[]> {
  return invokeTauri("reconcile_managed_agent_runtimes", { communities });
}
