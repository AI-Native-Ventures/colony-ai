import { useCallback, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";

import {
  EMPTY_MONEY_RAILS,
  type MoneyLinkCard,
  type MoneyRailConnection,
  type MoneyRailsSnapshot,
} from "./moneyRails";
import {
  executeLiveMoneyRailsAction,
  fetchMoneyRailLinkDetails,
  fetchMoneyRailsSnapshot,
  type LiveMoneyRailsAction,
} from "./moneyRailsApi";

export type MoneyRailsAction = LiveMoneyRailsAction;

export type MoneyRailsMockBridge = {
  getSnapshot: () => MoneyRailsSnapshot;
  getPaymentLinkDetails?: (linkId: string) => MoneyLinkCard | null;
  subscribe: (listener: () => void) => () => void;
  execute: (
    action: MoneyRailsAction,
  ) => Promise<MoneyLinkCard | MoneyRailConnection | undefined>;
};

declare global {
  interface Window {
    __BUZZ_E2E_MONEY_RAILS__?: MoneyRailsMockBridge;
  }
}

function mockBridge(): MoneyRailsMockBridge | null {
  if (import.meta.env.MODE !== "e2e" || typeof window === "undefined")
    return null;
  return window.__BUZZ_E2E_MONEY_RAILS__ ?? null;
}

function getMockSnapshot(): MoneyRailsSnapshot {
  return mockBridge()?.getSnapshot() ?? EMPTY_MONEY_RAILS;
}

function subscribeMock(listener: () => void): () => void {
  return mockBridge()?.subscribe(listener) ?? (() => {});
}

export const moneyRailsQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
  partyId?: string,
) => ["money-rails", communityId, relayUrl, partyId ?? "all"] as const;

export function useMoneyRailsSnapshot(partyId?: string): MoneyRailsSnapshot {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const currentScope = useRef({ communityId, relayUrl });
  currentScope.current = { communityId, relayUrl };
  const mock = mockBridge();
  const mockSnapshot = useSyncExternalStore(
    subscribeMock,
    getMockSnapshot,
    () => EMPTY_MONEY_RAILS,
  );
  const query = useQuery({
    enabled: Boolean(!mock && communityId && relayUrl),
    queryKey: moneyRailsQueryKey(communityId, relayUrl, partyId),
    queryFn: () =>
      fetchMoneyRailsSnapshot(relayUrl ?? "", partyId, () => {
        if (
          currentScope.current.communityId !== communityId ||
          currentScope.current.relayUrl !== relayUrl
        ) {
          throw new Error("The active company changed during this request.");
        }
      }),
    staleTime: 10_000,
    refetchInterval: mock ? false : 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (mock) {
    return partyId
      ? {
          ...mockSnapshot,
          paymentLinks: mockSnapshot.paymentLinks.filter(
            (card) => card.customerPartyId === partyId,
          ),
          availability: mockSnapshot.availability ?? "ready",
          errorMessage: null,
        }
      : {
          ...mockSnapshot,
          availability: mockSnapshot.availability ?? "ready",
          errorMessage: null,
        };
  }
  if (query.data) return query.data;
  if (!communityId || !relayUrl) return EMPTY_MONEY_RAILS;
  if (query.isError) {
    return {
      paymentLinks: [],
      connections: [],
      availability: "error",
      errorMessage:
        "Money connections could not be loaded. Refresh to try again.",
    };
  }
  return EMPTY_MONEY_RAILS;
}

export function useMoneyRailsActions() {
  const { activeCommunity } = useCommunities();
  const queryClient = useQueryClient();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const currentScope = useRef({ communityId, relayUrl });
  currentScope.current = { communityId, relayUrl };
  const snapshot = useMoneyRailsSnapshot();
  const ensureCurrent = useCallback(() => {
    if (
      !communityId ||
      !relayUrl ||
      currentScope.current.communityId !== communityId ||
      currentScope.current.relayUrl !== relayUrl
    ) {
      throw new Error("The active company changed during this request.");
    }
  }, [communityId, relayUrl]);

  const execute = useCallback(
    async (action: MoneyRailsAction) => {
      const mock = mockBridge();
      if (mock) return mock.execute(action);
      ensureCurrent();
      const result = await executeLiveMoneyRailsAction(
        relayUrl ?? "",
        action,
        ensureCurrent,
      );
      ensureCurrent();
      await queryClient.invalidateQueries({
        queryKey: ["money-rails", communityId, relayUrl],
      });
      return result;
    },
    [communityId, ensureCurrent, queryClient, relayUrl],
  );

  const getPaymentLinkDetails = useCallback(
    async (linkId: string) => {
      const mock = mockBridge();
      if (mock) {
        const card = mock.getPaymentLinkDetails?.(linkId);
        if (!card) throw new Error("The payment link details are unavailable.");
        return card;
      }
      ensureCurrent();
      const connections = new Map(
        snapshot.connections.map((connection) => [connection.id, connection]),
      );
      const card = await fetchMoneyRailLinkDetails(
        relayUrl ?? "",
        linkId,
        connections,
        ensureCurrent,
      );
      ensureCurrent();
      return card;
    },
    [ensureCurrent, relayUrl, snapshot.connections],
  );

  return { execute, getPaymentLinkDetails };
}

export function useMoneyRailMessageCard(linkId: string): MoneyLinkCard | null {
  const snapshot = useMoneyRailsSnapshot();
  return snapshot.paymentLinks.find((card) => card.id === linkId) ?? null;
}
