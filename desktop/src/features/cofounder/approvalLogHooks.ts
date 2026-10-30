import { useMemo } from "react";

import { useChannelsQuery } from "@/features/channels/hooks";
import { useAskHeadsQuery } from "@/features/company-asks/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";

import { buildApprovalLog } from "./approvalLog";
import { usePlansQuery } from "./planHooks";
import { usePlaybooksQuery } from "./playbookHooks";

/** Who approved what and when, from plan approval records and resolved asks. */
export function useApprovalLogQuery() {
  const channels = useChannelsQuery();
  const membership = useMyRelayMembershipQuery();
  const channelIds = useMemo(
    () =>
      [
        ...new Set(
          (channels.data ?? [])
            .filter(
              (channel) => channel.isMember && channel.channelType !== "dm",
            )
            .map((channel) => channel.id),
        ),
      ].sort(),
    [channels.data],
  );
  const canResolveToolConsent =
    membership.data?.role === "owner" || membership.data?.role === "admin";
  const askHeads = useAskHeadsQuery(channelIds, canResolveToolConsent);
  const plans = usePlansQuery();
  const playbooks = usePlaybooksQuery();
  const entries = useMemo(
    () =>
      buildApprovalLog({
        plans: plans.data ?? [],
        asks: askHeads.query.data ?? [],
        playbooks: playbooks.data?.playbooks ?? [],
        playbookJobs: playbooks.data?.jobs ?? [],
      }),
    [plans.data, askHeads.query.data, playbooks.data],
  );
  return {
    entries,
    isPending:
      plans.isPending || playbooks.isPending || askHeads.query.isPending,
    error: plans.error ?? playbooks.error ?? askHeads.query.error ?? null,
  };
}
