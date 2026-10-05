import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useChannelMembersQuery } from "@/features/channels/hooks";

export type WorkspaceAgent = { pubkey: string; name: string };

/**
 * The local agent whose workspace the Files tab browses. Agents on this
 * device share one workspace root, so any local agent of this community opens
 * it; one that is a member of the channel is preferred so the label matches
 * the conversation. Remote (provider) agents have no local workspace.
 */
export function useWorkspaceAgent(channelId: string): {
  agent: WorkspaceAgent | null;
  isLoading: boolean;
} {
  const managed = useManagedAgentsQuery();
  const members = useChannelMembersQuery(channelId);
  const memberKeys = new Set(
    (members.data ?? []).map((member) => member.pubkey.toLowerCase()),
  );
  const local = (managed.data ?? []).filter(
    (candidate) => !candidate.backend || candidate.backend.type === "local",
  );
  const chosen =
    local.find((candidate) => memberKeys.has(candidate.pubkey.toLowerCase())) ??
    local[0] ??
    null;
  return {
    agent: chosen ? { pubkey: chosen.pubkey, name: chosen.name } : null,
    isLoading: managed.isLoading,
  };
}
