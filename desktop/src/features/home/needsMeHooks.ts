import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useChannelsQuery } from "@/features/channels/hooks";
import { useAskHeadsQuery } from "@/features/company-asks/hooks";
import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel } from "@/shared/api/types";
import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";
import { normalizePubkey } from "@/shared/lib/pubkey";

import {
  fetchPendingWorkflowApprovals,
  type PendingWorkflowApproval,
} from "./needsMe";

export type NeedsMeData = {
  asks: AskHeadRecord[];
  workflowApprovals: PendingWorkflowApproval[];
};

export const TODAY_NEEDS_ME_QUERY_KEY = ["today-needs-me"] as const;
export const TODAY_NEEDS_ME_REFETCH_INTERVAL_MS = 30_000;

function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(fallback);
}

function memberChannelIds(channels: readonly Channel[] | undefined) {
  return [
    ...new Set(
      (channels ?? [])
        .filter((channel) => channel.isMember && channel.channelType !== "dm")
        .map((channel) => channel.id),
    ),
  ].sort();
}

export function useNeedsMeQuery() {
  const identityQuery = useIdentityQuery();
  const channelsQuery = useChannelsQuery();
  const currentPubkey = identityQuery.data?.pubkey ?? null;
  const channelIds = React.useMemo(
    () => memberChannelIds(channelsQuery.data),
    [channelsQuery.data],
  );
  const channelIdsKey = channelIds.join(",");
  const askHeads = useAskHeadsQuery(channelIds);
  const refetchInterval = useFocusedRefetchInterval(
    TODAY_NEEDS_ME_REFETCH_INTERVAL_MS,
  );
  const workflowApprovalsQuery = useQuery({
    queryKey: [
      ...TODAY_NEEDS_ME_QUERY_KEY,
      "workflow-approvals",
      currentPubkey,
      channelIdsKey,
    ],
    queryFn: () => {
      if (!currentPubkey) {
        throw new Error("Your identity is unavailable.");
      }
      return fetchPendingWorkflowApprovals(channelIds, currentPubkey);
    },
    enabled: currentPubkey !== null && channelsQuery.data !== undefined,
    refetchInterval,
  });

  const baseError =
    identityQuery.error ??
    channelsQuery.error ??
    (!currentPubkey && identityQuery.isSuccess
      ? new Error("Your identity is unavailable.")
      : null);
  const relaySelfError =
    channelIds.length > 0 && askHeads.relaySelfQuery.isError
      ? asError(
          askHeads.relaySelfQuery.error,
          "The relay identity could not be loaded.",
        )
      : channelIds.length > 0 &&
          askHeads.relaySelfQuery.isSuccess &&
          !askHeads.relaySelfQuery.data
        ? new Error(
            "This relay does not advertise an identity for ask records.",
          )
        : null;
  const asksError =
    baseError ??
    relaySelfError ??
    (askHeads.query.isError
      ? asError(askHeads.query.error, "Ask records could not be loaded.")
      : null);
  const workflowApprovalsError =
    baseError ??
    (workflowApprovalsQuery.isError
      ? asError(
          workflowApprovalsQuery.error,
          "Workflow approvals could not be loaded.",
        )
      : null);

  const asks = React.useMemo(
    () =>
      (askHeads.query.data ?? []).filter(
        (record) =>
          record.head.status === "open" &&
          record.head.ask.addresseePubkey != null &&
          currentPubkey !== null &&
          normalizePubkey(record.head.ask.addresseePubkey) ===
            normalizePubkey(currentPubkey),
      ),
    [askHeads.query.data, currentPubkey],
  );
  const data = React.useMemo<NeedsMeData>(
    () => ({
      asks,
      workflowApprovals: workflowApprovalsQuery.data ?? [],
    }),
    [asks, workflowApprovalsQuery.data],
  );
  const isPending =
    identityQuery.isPending ||
    channelsQuery.isPending ||
    (currentPubkey !== null &&
      channelsQuery.data !== undefined &&
      workflowApprovalsQuery.isPending) ||
    (channelIds.length > 0 &&
      !relaySelfError &&
      (askHeads.relaySelfQuery.isPending || askHeads.query.isPending));

  const refetch = React.useCallback(async () => {
    await Promise.all([
      identityQuery.refetch(),
      channelsQuery.refetch(),
      askHeads.relaySelfQuery.refetch(),
      askHeads.query.refetch(),
      workflowApprovalsQuery.refetch(),
    ]);
  }, [
    askHeads.query,
    askHeads.relaySelfQuery,
    channelsQuery,
    identityQuery,
    workflowApprovalsQuery,
  ]);

  return {
    data,
    isPending,
    asksError,
    workflowApprovalsError,
    refetch,
  };
}
