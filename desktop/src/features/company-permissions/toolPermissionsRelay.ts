import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import {
  KIND_TOOL_PERMISSION_ACTION,
  KIND_TOOL_PERMISSION_HEAD,
} from "@/shared/constants/kinds";

import {
  decodeRelayToolPermissionHead,
  TOOL_PERMISSION_HEAD_QUERY_LIMIT,
  toolPermissionDTag,
  type ToolPermissionAction,
  type ToolPermissionHeadRecord,
} from "./toolPermissions";

export const toolPermissionsQueryKey = (relayUrl: string | null) =>
  ["company-tool-permissions", relayUrl] as const;

async function fetchToolPermissions(): Promise<ToolPermissionHeadRecord[]> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_TOOL_PERMISSION_HEAD],
    authors: [relaySelf],
    limit: TOOL_PERMISSION_HEAD_QUERY_LIMIT,
  });
  if (events.length >= TOOL_PERMISSION_HEAD_QUERY_LIMIT) {
    throw new Error("The company permission list exceeds the supported limit.");
  }
  const records = events.map((event) => {
    const record = decodeRelayToolPermissionHead(event, relaySelf);
    if (!record) {
      throw new Error("The relay returned an invalid signed tool permission.");
    }
    return record;
  });
  return records.sort((first, second) =>
    first.head.permission.action.localeCompare(second.head.permission.action),
  );
}

export function useToolPermissionsQuery(agentPubkey?: string) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const query = useQuery({
    enabled: relayUrl !== null,
    queryKey: toolPermissionsQueryKey(relayUrl),
    queryFn: fetchToolPermissions,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  return {
    ...query,
    data: agentPubkey
      ? query.data?.filter(
          (record) =>
            record.head.permission.agentPubkey.toLowerCase() ===
            agentPubkey.toLowerCase(),
        )
      : query.data,
  };
}

export function useToolPermissionActionMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async ({ action }: { action: ToolPermissionAction }) => {
      const event = await signRelayEvent({
        kind: KIND_TOOL_PERMISSION_ACTION,
        content: JSON.stringify(action),
        tags: [["d", toolPermissionDTag(action.permissionId)]],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the standing permission.",
        "The standing permission could not be saved.",
      );
      return event;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: toolPermissionsQueryKey(relayUrl),
      });
    },
  });
}
