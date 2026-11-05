import type { RelayMember, RelayMemberRole } from "@/shared/api/types";

/**
 * The UI boundary for relay membership changes. The relay remains
 * authoritative, but every access surface must offer the same safe actions.
 */
export function relayMemberPermissions({
  currentPubkey,
  member,
  viewerRole,
}: {
  currentPubkey?: string | null;
  member: Pick<RelayMember, "pubkey" | "role">;
  viewerRole: RelayMemberRole | null | undefined;
}) {
  const isSelf = currentPubkey?.toLowerCase() === member.pubkey.toLowerCase();
  const isOwner = viewerRole === "owner";
  const isAdmin = viewerRole === "admin";

  return {
    canRemove:
      !isSelf &&
      ((isAdmin && member.role === "member") ||
        (isOwner && member.role !== "owner")),
    canChangeRole: !isSelf && isOwner && member.role !== "owner",
  };
}
