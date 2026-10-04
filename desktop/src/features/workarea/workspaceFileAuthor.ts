/** Raw signer only. A relay-delegated display author cannot grant local file access. */
export function getWorkspaceFileAuthorPubkey(
  message: { signerPubkey?: string | null },
  isKnownAgentPubkey: (pubkey: string) => boolean,
): string | undefined {
  const signer = message.signerPubkey;
  return signer && isKnownAgentPubkey(signer) ? signer : undefined;
}
