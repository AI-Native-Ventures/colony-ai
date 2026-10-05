import { replaceCommunityDestinationRoute } from "@/app/communityViewTransition";
import {
  loadCommunityDestination,
  markPendingCommunityRestore,
} from "@/features/communities/communityNavigationStorage";

/**
 * Point the router at a community's last destination before leaving a failed
 * community. History is edited directly, without `router.navigate`, because
 * the router is not mounted on the failure screens and a navigation would
 * wait on a route load that nothing is driving.
 */
export function prepareCommunitySwitchFromFailure(
  targetCommunityId: string,
  history: { replace: (href: string) => void },
): void {
  history.replace("/");
  markPendingCommunityRestore(targetCommunityId);
  const destination = loadCommunityDestination(targetCommunityId);
  if (destination?.kind === "channel") {
    replaceCommunityDestinationRoute(destination.channelId, history);
  }
}
