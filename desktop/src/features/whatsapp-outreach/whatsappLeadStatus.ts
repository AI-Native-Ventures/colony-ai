import { useQueries } from "@tanstack/react-query";
import {
  contactWhatsAppStatus,
  type WhatsAppContact,
} from "./whatsappOutreachModels";
import {
  useWhatsAppBatchesQuery,
  useWhatsAppContactsQuery,
  useWhatsAppRelayUrl,
  useWhatsAppStatusQuery,
  whatsappOutreachQueryKeys,
} from "./whatsappOutreachQueries";
import { loadWhatsAppBatch } from "./whatsappOutreachApi";

export function useWhatsAppLeadData() {
  const statusQuery = useWhatsAppStatusQuery();
  const relayUrl = useWhatsAppRelayUrl();
  const connected = statusQuery.data?.connected === true;
  const contactsQuery = useWhatsAppContactsQuery(connected);
  const pendingBatchesQuery = useWhatsAppBatchesQuery("pending", connected);
  const approvedBatchesQuery = useWhatsAppBatchesQuery("approved", connected);
  const batchIds = [
    ...(pendingBatchesQuery.data ?? []),
    ...(approvedBatchesQuery.data ?? []),
  ].map((batch) => batch.batchId);
  const batchDetails = useQueries({
    queries: batchIds.map((batchId) => ({
      enabled: relayUrl !== null,
      queryKey: whatsappOutreachQueryKeys.batch(relayUrl, batchId),
      queryFn: async () => {
        if (!relayUrl)
          throw new Error("The active community relay is missing.");
        return loadWhatsAppBatch(relayUrl, batchId);
      },
      staleTime: 10_000,
    })),
  });
  const batchIdByLeadId = new Map(
    batchDetails.flatMap((query) =>
      (query.data?.rows ?? [])
        .filter((row) => ["ready", "sending", "held"].includes(row.state))
        .flatMap((row) => {
          if (!row.leadId) return [];
          return query.data ? [[row.leadId, query.data.batchId] as const] : [];
        }),
    ),
  );
  const inBatchLeadIds = new Set(batchIdByLeadId.keys());

  return { statusQuery, contactsQuery, inBatchLeadIds, batchIdByLeadId };
}

export function findWhatsAppContactForLead(
  leadId: string,
  contacts: readonly WhatsAppContact[],
): WhatsAppContact | null {
  return contacts.find((contact) => contact.leadId === leadId) ?? null;
}

export function getWhatsAppLeadStatus(
  contact: WhatsAppContact | null,
  inBatch: boolean,
) {
  return contactWhatsAppStatus({
    optedOut: contact?.optedOut ?? false,
    replied: Boolean(contact?.lastInboundAt),
    sent: Boolean(contact),
    inBatch,
  });
}
