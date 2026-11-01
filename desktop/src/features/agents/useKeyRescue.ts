import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { managedAgentsQueryKey } from "@/features/agents/hooks";
import {
  getKeyRescueStatus,
  type KeyRescueStatus,
  rescueLegacyKeys,
} from "@/shared/api/keyRescue";

export const keyRescueQueryKey = ["key-rescue-status"] as const;

/**
 * The one-time Keychain key rescue. Reading the status never touches the
 * Keychain; only `rescue` does, and only when the owner clicks.
 */
export function useKeyRescue() {
  const queryClient = useQueryClient();
  const [justMoved, setJustMoved] = React.useState(false);
  const statusQuery = useQuery({
    queryKey: keyRescueQueryKey,
    queryFn: getKeyRescueStatus,
    // A browser or an old host has no such command: show nothing.
    retry: false,
    staleTime: 30_000,
  });
  const rescueMutation = useMutation({
    mutationFn: rescueLegacyKeys,
    onSuccess: (status: KeyRescueStatus) => {
      queryClient.setQueryData(keyRescueQueryKey, status);
      setJustMoved(true);
      void queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
    },
  });
  return {
    status: statusQuery.data,
    justMoved,
    isMoving: rescueMutation.isPending,
    moveFailed: rescueMutation.isError,
    rescue: rescueMutation.mutate,
  };
}
