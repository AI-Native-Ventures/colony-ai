import * as React from "react";

import { useChannelsQuery } from "@/features/channels/hooks";
import { PinnedMessagesList } from "@/features/pins/ui/PinnedMessagesList";
import { plainRelayErrorMessage } from "@/shared/lib/relayError";

import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { KnowledgeChannelNotes } from "./KnowledgeChannelNotes";
import { WorkAreaTabNotice } from "./WorkAreaTabNotice";
import { resolveChannelGate } from "./workAreaChannelGate";

const TEST_ID = "work-area-knowledge";

/**
 * Knowledge tab: the channel's notes (topic, purpose, canvas) and its pinned
 * messages. Real data only; see `features/pins/pinModels.ts` for the pin
 * contract.
 */
export function WorkAreaKnowledgeTab({ channelId }: WorkAreaTabPanelProps) {
  const channelsQuery = useChannelsQuery();
  const gate = resolveChannelGate(channelId, {
    status: channelsQuery.status,
    error: channelsQuery.error,
    data: channelsQuery.data,
  });

  const failedError = gate.state === "failed" ? gate.error : null;
  React.useEffect(() => {
    // The raw text belongs in the log, never on screen.
    if (failedError !== null) {
      console.warn(
        "[work-area] knowledge could not be loaded",
        failedError instanceof Error
          ? failedError.message
          : String(failedError),
      );
    }
  }, [failedError]);

  const retry = React.useCallback(() => {
    void channelsQuery.refetch();
  }, [channelsQuery]);

  switch (gate.state) {
    case "loading":
      return (
        <WorkAreaTabNotice
          state="loading"
          testId={`${TEST_ID}-state`}
          title="Loading knowledge"
        />
      );
    case "failed":
      return (
        <WorkAreaTabNotice
          body={plainRelayErrorMessage(gate.error)}
          onRetry={retry}
          state="failed"
          testId={`${TEST_ID}-state`}
          title="Knowledge could not be loaded"
        />
      );
    case "denied":
      return (
        <WorkAreaTabNotice
          body="Knowledge is shown for the channels you belong to. Join this channel to see it."
          onRetry={retry}
          state="denied"
          testId={`${TEST_ID}-state`}
          title="You are not in this channel"
        />
      );
    case "open": {
      const channel = (channelsQuery.data ?? []).find(
        (candidate) => candidate.id.toLowerCase() === channelId.toLowerCase(),
      );
      return (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-auto"
          data-testid={TEST_ID}
        >
          <KnowledgeChannelNotes
            channelId={channelId}
            purpose={channel?.purpose ?? null}
            topic={channel?.topic ?? null}
          />
          <section
            aria-labelledby={`${TEST_ID}-pins-title`}
            className="shrink-0 border-b border-border"
            data-testid={`${TEST_ID}-pins`}
          >
            <h2
              className="px-3 pt-3 text-xs font-semibold text-foreground"
              id={`${TEST_ID}-pins-title`}
            >
              Pinned
            </h2>
            <PinnedMessagesList channelId={channelId} />
          </section>
        </div>
      );
    }
  }
}
