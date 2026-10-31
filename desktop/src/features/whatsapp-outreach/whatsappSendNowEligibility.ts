type RelayRole = "owner" | "admin" | "member" | null | undefined;

type SendNowBatch =
  | {
      status: string;
      rows: readonly { state: string }[];
    }
  | null
  | undefined;

export function canSendNowWhatsAppBatch(
  batch: SendNowBatch,
  canUseSendNow: boolean,
): boolean {
  return Boolean(
    canUseSendNow &&
      batch?.status === "approved" &&
      batch.rows.length <= 3 &&
      batch.rows.some((row) => row.state === "ready"),
  );
}

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
