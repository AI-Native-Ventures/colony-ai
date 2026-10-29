import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  loadWhatsAppBatch,
  loadWhatsAppBatches,
  loadWhatsAppContacts,
  loadWhatsAppDrafts,
  loadWhatsAppStatus,
  loadWhatsAppTemplates,
  loadWhatsAppThread,
  publishWhatsAppCommand,
  type WhatsAppCommandKind,
} from "./whatsappOutreachApi";

const ROOT_QUERY_KEY = ["whatsapp-outreach"] as const;
const STATUS_REFETCH_MS = 15_000;
const THREAD_REFETCH_MS = 8_000;

export const whatsappOutreachQueryKeys = {
  all: ROOT_QUERY_KEY,
  status: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "status"] as const,
  templates: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "templates"] as const,
  contacts: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "contacts"] as const,
  batches: (relayUrl: string | null, state?: string) =>
    [...ROOT_QUERY_KEY, relayUrl, "batches", state ?? "all"] as const,
  batch: (relayUrl: string | null, batchId: string) =>
    [...ROOT_QUERY_KEY, relayUrl, "batch", batchId] as const,
  drafts: (relayUrl: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "drafts"] as const,
  thread: (relayUrl: string | null, waId: string | null) =>
    [...ROOT_QUERY_KEY, relayUrl, "thread", waId ?? ""] as const,
};

export function useWhatsAppRelayUrl(): string | null {
  const { activeCommunity } = useCommunities();
  return activeCommunity?.relayUrl ?? null;
}

export function useWhatsAppStatusQuery(enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.status(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppStatus(relayUrl);
    },
    staleTime: 5_000,
    refetchInterval: STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: 1,
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
    retry: 1,
  });
}

export function useWhatsAppContactsQuery(enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.contacts(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppContacts(relayUrl);
    },
    staleTime: 5_000,
    refetchInterval: STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useWhatsAppBatchesQuery(state?: string, enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.batches(relayUrl, state),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppBatches(relayUrl, state);
    },
    staleTime: 5_000,
    refetchInterval: STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useWhatsAppBatchQuery(batchId: string | null) {
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
    staleTime: 3_000,
    refetchInterval: STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useWhatsAppDraftsQuery(enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: whatsappOutreachQueryKeys.drafts(relayUrl),
    queryFn: async () => {
      if (!relayUrl) throw new Error("The active community relay is missing.");
      return loadWhatsAppDrafts(relayUrl);
    },
    staleTime: 3_000,
    refetchInterval: STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useWhatsAppThreadQuery(waId: string | null, enabled = true) {
  const relayUrl = useWhatsAppRelayUrl();
  return useQuery({
    enabled: enabled && relayUrl !== null && waId !== null,
    queryKey: whatsappOutreachQueryKeys.thread(relayUrl, waId),
    queryFn: async () => {
      if (!relayUrl || !waId)
        throw new Error("The WhatsApp contact is missing.");
      return loadWhatsAppThread(relayUrl, waId);
    },
    staleTime: 2_000,
    refetchInterval: THREAD_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: 1,
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
