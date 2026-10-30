type RelayRole = "owner" | "admin" | "member" | null | undefined;

export function canUseWhatsAppSendNow(input: {
  role: RelayRole;
  pubkey: string | undefined;
  isAgent: boolean;
  ownerPubkey: string | null | undefined;
  knownAgentPubkeys: ReadonlySet<string>;
}): boolean {
  const pubkey = input.pubkey?.trim().toLowerCase();
  return Boolean(
    pubkey &&
      (input.role === "owner" || input.role === "admin") &&
      !input.isAgent &&
      !input.ownerPubkey?.trim() &&
      !input.knownAgentPubkeys.has(pubkey),
  );
}
