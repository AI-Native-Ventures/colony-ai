import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useChannelsQuery } from "@/features/channels/hooks";
import { useAskHeadsQuery } from "@/features/company-asks/hooks";
import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
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
  const membershipQuery = useMyRelayMembershipQuery();
  const channelsQuery = useChannelsQuery();
  const currentPubkey = identityQuery.data?.pubkey ?? null;
  const channelIds = React.useMemo(
    () => memberChannelIds(channelsQuery.data),
    [channelsQuery.data],
  );
  const channelIdsKey = channelIds.join(",");
  const canResolveToolConsent =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  const askHeads = useAskHeadsQuery(channelIds, canResolveToolConsent);
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
    (channelIds.length > 0 || canResolveToolConsent) &&
    askHeads.relaySelfQuery.isError
      ? asError(
          askHeads.relaySelfQuery.error,
          "The relay identity could not be loaded.",
        )
      : (channelIds.length > 0 || canResolveToolConsent) &&
          askHeads.relaySelfQuery.isSuccess &&
          !askHeads.relaySelfQuery.data
        ? new Error(
            "This relay does not advertise an identity for ask records.",
          )
        : null;
  const asksError =
    baseError ??
    (membershipQuery.error
      ? asError(
          membershipQuery.error,
          "Company permissions could not be loaded.",
        )
      : null) ??
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
      (askHeads.query.data ?? []).filter((record) => {
        if (record.head.status !== "open" || currentPubkey === null) {
          return false;
        }
        if (
          record.head.ask.addresseePubkey != null &&
          normalizePubkey(record.head.ask.addresseePubkey) ===
            normalizePubkey(currentPubkey)
        ) {
          return true;
        }
        return (
          record.head.ask.type === "tool_consent" &&
          (membershipQuery.data?.role === "owner" ||
            membershipQuery.data?.role === "admin")
        );
      }),
    [askHeads.query.data, currentPubkey, membershipQuery.data?.role],
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
    membershipQuery.isPending ||
    ((channelIds.length > 0 || canResolveToolConsent) &&
      !relaySelfError &&
      (askHeads.relaySelfQuery.isPending || askHeads.query.isPending));

  const refetch = React.useCallback(async () => {
    await Promise.all([
      identityQuery.refetch(),
      channelsQuery.refetch(),
      askHeads.relaySelfQuery.refetch(),
      askHeads.query.refetch(),
      membershipQuery.refetch(),
      workflowApprovalsQuery.refetch(),
    ]);
  }, [
    askHeads.query,
    askHeads.relaySelfQuery,
    channelsQuery,
    identityQuery,
    membershipQuery,
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
