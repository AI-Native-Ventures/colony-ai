import { loadActiveCommunityId } from "@/features/communities/communityStorage";

import type { DiscoveryCampaignProvider } from "./discoveryProvider";
import {
  browserMultiCityStorage,
  multiCityStorageKey,
} from "./multiCityDiscovery";
import {
  createMultiCityDiscoveryCoordinator,
  type MultiCityDiscoveryCoordinator,
} from "./multiCityDiscoveryQueue";

type ActiveCoordinator = {
  communityId: string;
  provider: DiscoveryCampaignProvider;
  coordinator: MultiCityDiscoveryCoordinator;
};

let active: ActiveCoordinator | null = null;
let pendingGroupViewId: string | null = null;

/** Returns the one local queue that belongs to the current community and provider. */
export function getMultiCityDiscoveryCoordinator(
  provider: DiscoveryCampaignProvider | null,
): MultiCityDiscoveryCoordinator | null {
  if (!provider || typeof window === "undefined") return null;
  const communityId = loadActiveCommunityId() ?? "unscoped";
  if (
    active &&
    active.provider === provider &&
    active.communityId === communityId
  ) {
    return active.coordinator;
  }
  active?.coordinator.dispose();
  active = {
    communityId,
    provider,
    coordinator: createMultiCityDiscoveryCoordinator({
      provider,
      storage: browserMultiCityStorage(),
      storageKey: multiCityStorageKey(communityId),
    }),
  };
  return active.coordinator;
}

/** Holds the group created immediately before the Campaign screen opens. */
export function openMultiCityDiscoveryGroupView(groupId: string): void {
  pendingGroupViewId = groupId;
}

/** A new Campaign screen consumes this one-shot handoff exactly once. */
export function takeOpenedMultiCityDiscoveryGroupView(): string | null {
  const groupId = pendingGroupViewId;
  pendingGroupViewId = null;
  return groupId;
}

/** Community switching owns the lifecycle of this module-level queue. */
export function resetMultiCityDiscoveryRuntime(): void {
  active?.coordinator.dispose();
  active = null;
  pendingGroupViewId = null;
}
