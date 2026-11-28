import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { isRelayHttpRateLimitError } from "@/shared/api/relayHttpRequestGate";
import {
  loadWhatsAppBatch,
  loadWhatsAppBatches,
  loadWhatsAppApprovedBatchDetails,
  loadWhatsAppCallClosers,
  loadWhatsAppContacts,
  loadWhatsAppDrafts,
  loadWhatsAppPendingBatchDetails,
  loadWhatsAppSafetyLedger,
  loadWhatsAppStageCounts,
  loadWhatsAppStatus,
  loadWhatsAppTemplates,
  loadWhatsAppThread,
  loadWhatsAppUnknownSends,
  publishWhatsAppCommand,
  type WhatsAppCommandKind,
} from "./whatsappOutreachApi";

const ROOT_QUERY_KEY = ["whatsapp-outreach"] as const;
/** Active Outreach reads refresh once per minute. Hidden windows do not poll. */
const OUTREACH_REFETCH_MS = 60_000;
const THREAD_REFETCH_MS = 30_000;
/** Counting reads the whole contact list on the relay, so it polls far less than the list. */
const STAGE_COUNTS_REFETCH_MS = 120_000;

/** A 429 is retried once by the shared gate after its server window clears. */
export function retryWhatsAppQuery(failureCount: number, error: unknown) {
  return !isRelayHttpRateLimitError(error) && failureCount < 1;
}

const PASSIVE_OUTREACH_QUERY = {
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: false,
  retry: retryWhatsAppQuery,
} as const;

/** Only a visible Outreach surface asks the relay for a periodic refresh. */
function outreachPolling(poll = false, interval = OUTREACH_REFETCH_MS) {
  return poll
    ? { ...PASSIVE_OUTREACH_QUERY, refetchInterval: interval }
    : PASSIVE_OUTREACH_QUERY;
}

export const whatsappOutreachQueryKeys = {
  all: ROOT_QUERY_KEY,
  status: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "status"] as const,
  templates: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "templates"] as const,
  contacts: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "contacts"] as const,
  contactCounts: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "contact-counts"] as const,
  batches: (relayUrl: string | null, state?: string) =>
    [...ROOT_QUERY_KEY, relayUrl, "batches", state ?? "all"] as const,
  batch: (relayUrl: string | null, batchId: string) =>
    [...ROOT_QUERY_KEY, relayUrl, "batch", batchId] as const,
  drafts: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "drafts"] as const,
  thread: (relayUrl: string | null, waId: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "thread", waId ?? ""] as const,
  safetyLedger: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "safety-ledger"] as const,
  unknownSends: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "unknown-sends"] as const,
  callClosers: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "call-closers"] as const,
};

export function useWhatsAppRelayUrl(): string | null {
  const { activeCommunity } = useCommunities();
  return activeCommunity?.relayUrl ?? null;
}

export function useWhatsAppStatusQuery(enabled = true, poll = false) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.status(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppStatus(relayUrl);
    },
    staleTime: 45_000,
    ...outreachPolling(poll),
  });
}

export function useWhatsAppTemplatesQuery(enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.templates(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppTemplates(relayUrl);
    },
    staleTime: 30_000,
    ...PASSIVE_OUTREACH_QUERY,
  });
}

export function useWhatsAppContactsQuery(enabled = true, poll = false) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.contacts(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppContacts(relayUrl);
    },
    staleTime: 45_000,
    ...outreachPolling(poll),
  });
}

/**
 * The people a lead can be given to for its call. Who they are changes rarely, so it is read
 * when a surface that names them is open and kept for five minutes.
 */
export function useWhatsAppCallClosersQuery(enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.callClosers(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppCallClosers(relayUrl);
    },
    staleTime: 300_000,
    ...PASSIVE_OUTREACH_QUERY,
  });
}

/** True stage counts over every contact. Data is `null` on a relay that cannot count. */
export function useWhatsAppStageCountsQuery(enabled = true, poll = false) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.contactCounts(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppStageCounts(relayUrl);
    },
    staleTime: 60_000,
    ...outreachPolling(poll, STAGE_COUNTS_REFETCH_MS),
  });
}

export function useWhatsAppBatchesQuery(
  state?: string,
  enabled = true,
  poll = false,
) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.batches(relayUrl, state),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppBatches(relayUrl, state);
    },
    staleTime: 45_000,
    ...outreachPolling(poll),
  });
}

export function useWhatsAppPendingBatchDetailsQuery(
  enabled = true,
  poll = false,
) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: [
      ...whatsappOutreachQueryKeys.batches(relayUrl, "pending"),
      "details",
    ],
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppPendingBatchDetails(relayUrl);
    },
    staleTime: 45_000,
    ...outreachPolling(poll),
  });
}

export function useWhatsAppApprovedBatchDetailsQuery(
  enabled = true,
  poll = false,
) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: [
      ...whatsappOutreachQueryKeys.batches(relayUrl, "approved"),
      "small-details",
    ],
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppApprovedBatchDetails(relayUrl);
    },
    staleTime: 45_000,
    ...outreachPolling(poll),
  });
}

export function useWhatsAppBatchQuery(batchId: string | null, poll = false) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: relayUrl !== null && batchId !== null,
    queryKey: whatsappOutreachQueryKeys.batch(relayUrl, batchId ?? ""),
    queryFn: async () => {
      if (!relayUrl || !batchId) {
        throw new Error("The WhatsApp batch is unavailable.");
      }
      return loadWhatsAppBatch(relayUrl, batchId);
    },
    staleTime: 45_000,
    ...outreachPolling(poll),
  });
}

export function useWhatsAppDraftsQuery(enabled = true, poll = false) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.drafts(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppDrafts(relayUrl);
    },
    staleTime: 45_000,
    ...outreachPolling(poll),
  });
}

export function useWhatsAppThreadQuery(
  waId: string | null,
  enabled = true,
  poll = false,
) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null && waId !== null,
    queryKey: whatsappOutreachQueryKeys.thread(relayUrl, waId),
    queryFn: async () => {
      if (!relayUrl || !waId)
        throw new Error("The WhatsApp contact is missing.");
      return loadWhatsAppThread(relayUrl, waId);
    },
    staleTime: 15_000,
    ...outreachPolling(poll, THREAD_REFETCH_MS),
  });
}

/** Optional owner-only safety endpoint. An older relay reports an error rather than an empty list. */
export function useWhatsAppSafetyLedgerQuery(enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.safetyLedger(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppSafetyLedger(relayUrl);
    },
    staleTime: 60_000,
    ...PASSIVE_OUTREACH_QUERY,
    retry: false,
  });
}

/** Optional owner-only recovery endpoint. It is intentionally not part of normal message state. */
export function useWhatsAppUnknownSendsQuery(enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.unknownSends(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppUnknownSends(relayUrl);
    },
    staleTime: 60_000,
    ...PASSIVE_OUTREACH_QUERY,
    retry: false,
  });
}

export function useWhatsAppCommand() {
  const relayUrl = useWhatsAppRelayUrl();
  const queryClient = useQueryClient();
  return useCallback(
    async (kind: WhatsAppCommandKind, payload: Record<string, unknown>) => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      await publishWhatsAppCommand(kind, payload);
      await queryClient.invalidateQueries({
        queryKey: whatsappOutreachQueryKeys.all,
      });
    },
    [queryClient, relayUrl],
  );
}

export function useInvalidateWhatsAppQueries() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: whatsappOutreachQueryKeys.all,
      }),
    [queryClient],
  );
}
