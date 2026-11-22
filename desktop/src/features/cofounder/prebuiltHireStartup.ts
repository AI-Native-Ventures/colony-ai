import { startManagedAgent } from "@/shared/api/tauriManagedAgents";
import { trackAgentStart } from "@/features/agents/agentLifecycle";

import type { FunctionId } from "./cofounderRecords";
import {
  clearPrebuiltHireStartup,
  writePrebuiltHireStartup,
} from "./prebuiltHireStorage";
import type { PrebuiltHireStartup } from "./prebuiltHireStorage";

type StartPrebuiltHireAgentInput = {
  agentId: string;
  communityId: string;
  employeePubkey: string;
  functionId: FunctionId;
  hireId: string;
  onStatus?: (status: PrebuiltHireStartup | null) => void;
  relayUrl: string;
  signerPubkey: string;
};

/**
 * In-flight detached starts are keyed by the exact scope the backend asserts.
 * They deliberately survive a community switch: an A-to-B-to-A round trip
 * must not let a second request duplicate a provider deploy still running for
 * A. The map only holds settling promises, and callbacks fence map state to
 * their originating community.
 */
const activeStarts = new Map<string, Promise<void>>();
// Different asserted identities can legitimately overlap while a workspace is
// switching. Keep the newest result for each visible map slot authoritative.
const latestAttempts = new Map<string, number>();
let nextAttempt = 0;

function startKey(input: StartPrebuiltHireAgentInput) {
  return `${input.communityId}\u0000${input.relayUrl}\u0000${input.signerPubkey.toLowerCase()}\u0000${input.employeePubkey.toLowerCase()}`;
}

function statusKey(input: StartPrebuiltHireAgentInput) {
  return `${input.communityId}\u0000${input.functionId}`;
}

function failureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Colony could not start this head. Retry start from the company map.";
}

/**
 * Starts a hired head without holding the hire dialog open. The map receives
 * a durable state immediately and keeps the retry action if the host rejects
 * the start later.
 */
export function startPrebuiltHireAgent(
  input: StartPrebuiltHireAgentInput,
): void {
  const key = startKey(input);
  if (activeStarts.has(key)) return;
  const status = statusKey(input);
  const attempt = ++nextAttempt;
  latestAttempts.set(status, attempt);
  const ownsStatus = () => latestAttempts.get(status) === attempt;

  const starting: PrebuiltHireStartup = {
    agentId: input.agentId,
    employeePubkey: input.employeePubkey,
    functionId: input.functionId,
    hireId: input.hireId,
    status: "starting",
  };
  writePrebuiltHireStartup(input.communityId, starting);
  input.onStatus?.(starting);

  const start = Promise.resolve().then(() =>
    startManagedAgent(input.employeePubkey, {
      expectedRelayUrl: input.relayUrl,
      expectedSignerPubkey: input.signerPubkey,
    }),
  );
  const task = start.then(
    () => {
      if (!ownsStatus()) return;
      clearPrebuiltHireStartup(input.communityId, input.functionId);
      input.onStatus?.(null);
    },
    (error: unknown) => {
      if (!ownsStatus()) return;
      const failed: PrebuiltHireStartup = {
        ...starting,
        error: failureMessage(error),
        status: "failed",
      };
      writePrebuiltHireStartup(input.communityId, failed);
      input.onStatus?.(failed);
    },
  );
  activeStarts.set(key, task);
  // A detached start must hold lifecycle operations until it settles, so an
  // automatic stop or restart cannot race the newly hired head's first start.
  trackAgentStart(input.employeePubkey, task);
  void task.then(() => {
    if (activeStarts.get(key) === task) activeStarts.delete(key);
    if (ownsStatus()) latestAttempts.delete(status);
  });
}

/** Test-only isolation seam for held starts. Production keeps this map alive. */
export function __resetPrebuiltHireStartsForTests(): void {
  activeStarts.clear();
  latestAttempts.clear();
  nextAttempt = 0;
}
