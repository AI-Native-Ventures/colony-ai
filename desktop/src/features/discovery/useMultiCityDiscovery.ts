import * as React from "react";

import type { DiscoveryCampaignProvider } from "./discoveryProvider";
import type { MultiCityDiscoverySnapshot } from "./multiCityDiscoveryQueue";
import { getMultiCityDiscoveryCoordinator } from "./multiCityDiscoveryRuntime";

const EMPTY_SNAPSHOT: MultiCityDiscoverySnapshot = {
  groups: [],
  campaigns: [],
};

/** React bridge for the device-local multi-city queue. */
export function useMultiCityDiscovery(
  provider: DiscoveryCampaignProvider | null,
) {
  const coordinator = getMultiCityDiscoveryCoordinator(provider);
  const [snapshot, setSnapshot] = React.useState<MultiCityDiscoverySnapshot>(
    () => coordinator?.getSnapshot() ?? EMPTY_SNAPSHOT,
  );

  React.useEffect(() => {
    if (!coordinator) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }
    return coordinator.subscribe(setSnapshot);
  }, [coordinator]);

  return { coordinator, ...snapshot };
}
