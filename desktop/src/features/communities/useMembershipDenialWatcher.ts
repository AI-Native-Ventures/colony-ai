import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  currentMembershipDenialGeneration,
  reportMembershipDenial,
} from "./membershipDenialGate";

/**
 * Watches every relay-backed query of the open workspace and raises the
 * membership denial gate when the relay says this person is not a member (for
 * example after being removed). Mount it only where the workspace is open, so
 * onboarding keeps its own membership screens.
 *
 * Query errors are reported after the query's own retry, so one transient
 * refusal does not take the workspace away. The generation is captured on
 * mount: the workspace remounts per community, so a report that outlives its
 * community is fenced out by the gate.
 */
export function useMembershipDenialWatcher(communityId: string | null) {
  const queryClient = useQueryClient();
  const generationRef = React.useRef<number | null>(null);
  if (generationRef.current === null) {
    generationRef.current = currentMembershipDenialGeneration();
  }

  React.useEffect(() => {
    const generation = generationRef.current;
    if (generation === null || communityId === null) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      reportMembershipDenial(generation, communityId, event.query.state.error);
    });
  }, [communityId, queryClient]);
}
