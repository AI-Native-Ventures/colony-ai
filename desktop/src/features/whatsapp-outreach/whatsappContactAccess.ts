export function canManageWhatsAppContact(input: {
  role: "owner" | "admin" | "member" | "guest" | "bot" | null | undefined;
  isOutreachMember: boolean;
  isManagedAgent: boolean;
  ownerPubkey: string | null | undefined;
}): boolean {
  return Boolean(
    input.role === "owner" ||
      input.role === "admin" ||
      input.isOutreachMember ||
      (input.isManagedAgent && input.ownerPubkey?.trim()),
  );
}

/** Shown beside a batch's Approve and Reject when the person cannot use them. */
export const BATCH_MANAGE_NOTE =
  "Only owners and admins can approve or reject a batch.";
