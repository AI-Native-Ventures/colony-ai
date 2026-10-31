export function canManageWhatsAppContact(input: {
  role: "owner" | "admin" | "member" | "guest" | "bot" | null | undefined;
  isOutreachMember: boolean;
  isManagedAgent: boolean;
  ownerPubkey: string | null | undefined;
}): boolean {
  return Boolean(
    input.role === "owner" ||
      input.role === "admin" ||
      input.role === "member" ||
      input.isOutreachMember ||
      (input.isManagedAgent && input.ownerPubkey?.trim()),
  );
}
