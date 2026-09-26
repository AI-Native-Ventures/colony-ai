import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  cancelFactoryRun,
  getFactoryRunSnapshot,
  listFactoryRuns,
  reattachFactoryRun,
  type FactoryRun,
  type FactoryRunEvent,
  type FactoryRunSnapshot,
  type FactoryScope,
} from "@/shared/api/factoryRuntime";

const FACTORY_RUN_POLL_MS = 5_000;

export type FactoryRunsResult = {
  runs: FactoryRun[];
  snapshots: ReadonlyMap<string, FactoryRunSnapshot>;
  reattachErrors: ReadonlySet<string>;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
};

function mergeFactorySnapshot(
  current: FactoryRunSnapshot | undefined,
  incoming: FactoryRunSnapshot,
): FactoryRunSnapshot {
  if (!current) return incoming;
  const events = new Map<number, FactoryRunEvent>();
  for (const event of current.events) events.set(event.sequence, event);
  for (const event of incoming.events) events.set(event.sequence, event);
  return {
    ...current,
    ...incoming,
    events: [...events.values()].sort((left, right) => left.sequence - right.sequence),
  };
}

export function useFactoryRuns(scope: FactoryScope): FactoryRunsResult {
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(
    () => [
      "factory-runs",
      scope.relayUrl,
      scope.identityPubkey,
      scope.businessCommunityId,
      scope.clientChannelId ?? "",
    ] as const,
    [scope.relayUrl, scope.identityPubkey, scope.businessCommunityId, scope.clientChannelId],
  );
  const scopeKey = queryKey.join("\u0000");
  const [snapshots, setSnapshots] = React.useState<
    ReadonlyMap<string, FactoryRunSnapshot>
  >(() => new Map());
  const [reattachErrors, setReattachErrors] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [attachmentGeneration, setAttachmentGeneration] = React.useState(0);
  const runsQuery = useQuery({
    queryKey,
    queryFn: listFactoryRuns,
    staleTime: FACTORY_RUN_POLL_MS,
    refetchInterval: FACTORY_RUN_POLL_MS,
  });
  const runs = runsQuery.data ?? [];
  const runsById = React.useRef(new Map<string, FactoryRun>());
  runsById.current = new Map(runs.map((run) => [run.id, run]));
  const activeRunIds = runs
    .filter((run) => ["queued", "running", "waiting"].includes(run.status))
    .map((run) => run.id)
    .sort()
    .join("\n");
  const terminalRunIds = runs
    .filter((run) => !["queued", "running", "waiting"].includes(run.status))
    .map((run) => run.id)
    .sort()
    .join("\n");

  const refresh = React.useCallback(async () => {
    setAttachmentGeneration((generation) => generation + 1);
    await runsQuery.refetch();
  }, [runsQuery.refetch]);

  React.useEffect(() => {
    setSnapshots(new Map());
    setReattachErrors(new Set());
  }, [scopeKey]);

  React.useEffect(() => {
    if (!terminalRunIds) return;
    let active = true;
    for (const runId of terminalRunIds.split("\n")) {
      const run = runsById.current.get(runId);
      if (!run) continue;
      void getFactoryRunSnapshot(runId).then(
        (snapshot) => {
          if (!active) return;
          setSnapshots((current) => {
            const next = new Map(current);
            next.set(runId, mergeFactorySnapshot(current.get(runId), snapshot));
            return next;
          });
          setReattachErrors((current) => {
            if (!current.has(runId)) return current;
            const next = new Set(current);
            next.delete(runId);
            return next;
          });
        },
        () => {
          if (active) setReattachErrors((current) => new Set(current).add(runId));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [terminalRunIds, scopeKey]);

  React.useEffect(() => {
    if (!activeRunIds) return;
    let active = true;
    const attachments = activeRunIds.split("\n").flatMap((runId) => {
      const run = runsById.current.get(runId);
      if (!run) return [];
      const attachment = reattachFactoryRun(
        runId,
        0,
        (event) => {
          if (!active) return;
          setReattachErrors((current) => {
            if (!current.has(runId)) return current;
            const next = new Set(current);
            next.delete(runId);
            return next;
          });
          setSnapshots((current) => {
            const existing = current.get(runId);
            if (existing?.events.some((item) => item.sequence === event.sequence)) {
              return current;
            }
            const next = new Map(current);
            next.set(runId, {
              run: existing?.run ?? run,
              events: [...(existing?.events ?? []), event].sort(
                (left, right) => left.sequence - right.sequence,
              ),
              draft: existing?.draft ?? null,
              hasMore: existing?.hasMore ?? false,
            });
            return next;
          });
          void getFactoryRunSnapshot(runId, event.sequence).then(
            (snapshot) => {
              if (!active) return;
              setSnapshots((current) => {
                const next = new Map(current);
                next.set(runId, mergeFactorySnapshot(current.get(runId), snapshot));
                return next;
              });
            },
            () => {
              if (active) setReattachErrors((current) => new Set(current).add(runId));
            },
          );
          void queryClient.invalidateQueries({ queryKey });
        },
        () => {
          void getFactoryRunSnapshot(runId).then(
            (snapshot) => {
              if (!active) return;
              setSnapshots((current) => {
                const next = new Map(current);
                next.set(runId, mergeFactorySnapshot(current.get(runId), snapshot));
                return next;
              });
            },
            () => {
              if (active) setReattachErrors((current) => new Set(current).add(runId));
            },
          );
        },
      );
      void attachment.snapshot.then(
        (snapshot) => {
          if (!active) return;
          setReattachErrors((current) => {
            if (!current.has(runId)) return current;
            const next = new Set(current);
            next.delete(runId);
            return next;
          });
          setSnapshots((current) => {
            const next = new Map(current);
            next.set(runId, mergeFactorySnapshot(current.get(runId), snapshot));
            return next;
          });
        },
        () => {
          if (active) setReattachErrors((current) => new Set(current).add(runId));
        },
      );
      return [attachment];
    });

    return () => {
      active = false;
      for (const attachment of attachments) {
        void attachment.detach().catch((error: unknown) => {
          console.error("Failed to detach Factory run listener", error);
        });
      }
    };
  }, [activeRunIds, attachmentGeneration, queryClient, queryKey]);

  const cancelRun = React.useCallback(
    async (runId: string) => {
      await cancelFactoryRun(runId);
      await refresh();
    },
    [refresh],
  );

  return {
    runs,
    snapshots,
    reattachErrors,
    loading: runsQuery.isPending,
    error: runsQuery.error instanceof Error ? runsQuery.error : null,
    refresh,
    cancelRun,
  };
}
