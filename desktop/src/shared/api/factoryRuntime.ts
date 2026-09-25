import { Channel } from "@tauri-apps/api/core";
import { invokeTauri } from "@/shared/api/tauri";

const MAX_BUFFERED_FACTORY_EVENTS = 512;

export type FactoryRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "error"
  | "done"
  | "cancelled";

export type FactoryScope = {
  relayUrl: string;
  identityPubkey: string;
  businessCommunityId: string;
  clientChannelId: string | null;
};

export type FactoryRun = {
  id: string;
  scope: FactoryScope;
  projectId: string | null;
  repositoryId: string | null;
  checkoutPath: string;
  agentId: string;
  harnessId: string;
  parentRunId: string | null;
  status: FactoryRunStatus;
  createdAt: string;
  updatedAt: string;
  acpSessionId: string | null;
  error: string | null;
};

export type FactoryRunEvent = {
  sequence: number;
  runId: string;
  createdAt: string;
  kind: string;
  payload: unknown;
  scope: FactoryScope;
};

export type FactoryRunSnapshot = {
  run: FactoryRun;
  events: FactoryRunEvent[];
  draft: string | null;
  hasMore: boolean;
};

export type CreateFactoryRunInput = {
  operationKey: string;
  projectId?: string | null;
  repositoryId?: string | null;
  checkoutPath: string;
  agentId: string;
  parentRunId?: string | null;
  prompt: string;
};

export type FactoryRunDraft = {
  runId: string;
  draft: string;
  updatedAt: string;
};

export type FactoryRunAttachment = {
  snapshot: Promise<FactoryRunSnapshot>;
  detach: () => Promise<void>;
};

export function createFactoryRun(
  input: CreateFactoryRunInput,
): Promise<FactoryRun> {
  return invokeTauri<FactoryRun>("factory_run_create", { input });
}

export function listFactoryRuns(): Promise<FactoryRun[]> {
  return invokeTauri<FactoryRun[]>("factory_run_list");
}

export function getFactoryRunSnapshot(
  runId: string,
  afterSequence = 0,
): Promise<FactoryRunSnapshot> {
  return invokeTauri<FactoryRunSnapshot>("factory_run_snapshot", {
    runId,
    afterSequence,
  });
}

export function reattachFactoryRun(
  runId: string,
  afterSequence: number,
  onEvent: (event: FactoryRunEvent) => void,
  onResyncRequired?: () => void,
): FactoryRunAttachment {
  const subscriptionId = crypto.randomUUID();
  const buffered: FactoryRunEvent[] = [];
  let ready = false;
  let lastSequence = afterSequence;
  let detached = false;
  let closed = false;
  let bufferedOverflowed = false;
  const channel = new Channel<FactoryRunEvent>();

  const deliver = (event: FactoryRunEvent) => {
    if (closed) return;
    if (event.runId !== runId) return;
    if (event.kind === "resync_required") {
      onResyncRequired?.();
      return;
    }
    if (event.sequence <= lastSequence) return;
    lastSequence = event.sequence;
    onEvent(event);
  };

  channel.onmessage = (event) => {
    if (closed) return;
    if (ready) deliver(event);
    else if (buffered.length < MAX_BUFFERED_FACTORY_EVENTS)
      buffered.push(event);
    else bufferedOverflowed = true;
  };

  const snapshot = invokeTauri<FactoryRunSnapshot>("factory_run_reattach", {
    runId,
    afterSequence,
    subscriptionId,
    onEvent: channel,
  }).then((value) => {
    for (const event of value.events) deliver(event);
    ready = true;
    buffered.sort((left, right) => left.sequence - right.sequence);
    for (const event of buffered) deliver(event);
    if (bufferedOverflowed && !closed) onResyncRequired?.();
    return value;
  });

  let detachPromise: Promise<void> | undefined;

  return {
    snapshot,
    detach: () => {
      if (detached) return Promise.resolve();
      closed = true;
      if (!detachPromise) {
        detachPromise = snapshot
          .then(() =>
            invokeTauri<boolean>("factory_run_detach", { subscriptionId }),
          )
          .then(() => {
            detached = true;
            channel.onmessage = () => undefined;
          })
          .catch((error: unknown) => {
            detachPromise = undefined;
            channel.onmessage = () => undefined;
            throw error;
          });
      }
      return detachPromise;
    },
  };
}

export function cancelFactoryRun(runId: string): Promise<FactoryRun> {
  return invokeTauri<FactoryRun>("factory_run_cancel", { runId });
}

export function setFactoryRunDraft(
  runId: string,
  draft: string,
): Promise<FactoryRunDraft> {
  return invokeTauri<FactoryRunDraft>("factory_run_set_draft", {
    input: { runId, draft },
  });
}

export function getFactoryRunDraft(
  runId: string,
): Promise<FactoryRunDraft | null> {
  return invokeTauri<FactoryRunDraft | null>("factory_run_get_draft", {
    runId,
  });
}
