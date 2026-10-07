import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { channelsQueryKey } from "@/features/channels/hooks";
import { Button } from "@/shared/ui/button";

/** Re-runs the channel read that failed, which is what the notice reports. */
export function RelayErrorRetryButton({ testId }: { testId: string }) {
  const queryClient = useQueryClient();
  const retry = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: channelsQueryKey });
  }, [queryClient]);

  return (
    <Button
      data-testid={testId}
      onClick={retry}
      size="sm"
      type="button"
      variant="secondary"
    >
      Retry
    </Button>
  );
}

/**
 * Plain-language relay failure in the sidebar. The caller passes a sentence
 * written for people, never the relay's raw text.
 */
export function SidebarRelayErrorNotice({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-start gap-2 px-3 py-2 text-sm text-destructive"
      data-testid="sidebar-relay-error"
    >
      <span>{message}</span>
      <RelayErrorRetryButton testId="sidebar-relay-error-retry" />
    </div>
  );
}
