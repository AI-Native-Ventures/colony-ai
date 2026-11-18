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

/** Community switching owns the lifecycle of this module-level queue. */
export function resetMultiCityDiscoveryRuntime(): void {
  active?.coordinator.dispose();
  active = null;
}
