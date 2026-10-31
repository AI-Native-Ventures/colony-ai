import * as React from "react";

import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type {
  WhatsAppContact,
  WhatsAppMessage,
} from "./whatsappOutreachModels";
import { sendNowBatchIdForQueuedMessage } from "./whatsappOutreachContactState";
import { canUseWhatsAppSendNow } from "./whatsappSendNowEligibility";
import { useWhatsAppApprovedBatchDetailsQuery } from "./whatsappOutreachQueries";

export function useWhatsAppSendNowAccess(input: {
  role: "owner" | "admin" | "member" | null | undefined;
  pubkey: string | undefined;
  ownerPubkey: string | null | undefined;
}): boolean {
  const profileQuery = useUsersBatchQuery(input.pubkey ? [input.pubkey] : [], {
    enabled: Boolean(input.pubkey),
  });
  const knownAgentPubkeys = useKnownAgentPubkeys();
  const normalizedPubkey = input.pubkey
    ? normalizePubkey(input.pubkey)
    : undefined;
  const profile = normalizedPubkey
    ? profileQuery.data?.profiles[normalizedPubkey]
    : undefined;

  return canUseWhatsAppSendNow({
    role: input.role,
    pubkey: input.pubkey,
    isAgent:
      Boolean(normalizedPubkey && knownAgentPubkeys.has(normalizedPubkey)) ||
      profile?.isAgent === true,
    ownerPubkey: input.ownerPubkey ?? profile?.ownerPubkey,
    knownAgentPubkeys,
  });
}

export function useWhatsAppSendNowBatchIds(
  contact: WhatsAppContact | null,
  connected: boolean,
  messages: readonly WhatsAppMessage[],
): ReadonlyMap<string, string> {
  const hasQueuedOutbound = messages.some(
    (message) => message.direction === "out" && message.state === "queued",
  );
  const approvedBatchesQuery = useWhatsAppApprovedBatchDetailsQuery(
    connected && hasQueuedOutbound,
  );

  return React.useMemo(() => {
    const batchIds = new Map<string, string>();
    if (!contact) return batchIds;

    for (const message of messages) {
      const batchId = sendNowBatchIdForQueuedMessage(
        contact,
        message.text,
        approvedBatchesQuery.data ?? [],
        message.sendsAt,
      );
      if (batchId) batchIds.set(message.id, batchId);
    }
    return batchIds;
  }, [approvedBatchesQuery.data, contact, messages]);
}
