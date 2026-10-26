import type { ComponentProps } from "react";

import { CardMintComposerChip } from "@/features/agents/ui/CardMintComposerChip";
import { useCardMintJobs } from "@/features/agents/cardMintStore";
import type { AgentWorkingIndicatorState } from "@/features/channels/lib/agentWorkingIndicator";
import {
  AgentWorkingAnnouncer,
  AgentWorkingIndicatorRow,
} from "@/features/channels/ui/AgentWorkingIndicator";
import { ComposerActivityAccessory } from "@/features/messages/ui/ComposerActivityAccessory";
import { TypingIndicatorRow } from "@/features/messages/ui/TypingIndicatorRow";

type ChannelComposerActivityAccessoryProps = {
  channel: ComponentProps<typeof TypingIndicatorRow>["channel"];
  currentPubkey: ComponentProps<typeof TypingIndicatorRow>["currentPubkey"];
  profiles: ComponentProps<typeof TypingIndicatorRow>["profiles"];
  typingPubkeys: string[];
  visible: boolean;
  workingIndicator: AgentWorkingIndicatorState;
};

export function ChannelComposerActivityAccessory({
  channel,
  currentPubkey,
  profiles,
  typingPubkeys,
  visible,
  workingIndicator,
}: ChannelComposerActivityAccessoryProps) {
  const cardMintJobs = useCardMintJobs();
  return (
    <>
      <AgentWorkingAnnouncer state={workingIndicator} />
      <ComposerActivityAccessory
        className="px-5"
        testId="channel-composer-activity-row"
        visible={visible}
      >
        <div className="flex w-full items-center gap-2 overflow-visible pl-2">
          {cardMintJobs.length > 0 ? <CardMintComposerChip /> : null}
          {workingIndicator.kind !== "hidden" ? (
            <AgentWorkingIndicatorRow
              className="min-w-0 flex-1 pl-[calc(0.75rem+1px)] sm:pl-[calc(1rem+1px)]"
              profiles={profiles}
              state={workingIndicator}
              testId="channel-agent-working-indicator"
            />
          ) : null}
          {typingPubkeys.length > 0 ? (
            <TypingIndicatorRow
              channel={channel}
              className="min-w-0 flex-1 py-0 pl-[calc(0.75rem+1px)] pr-0 sm:pl-[calc(1rem+1px)]"
              currentPubkey={currentPubkey}
              profiles={profiles}
              typingPubkeys={typingPubkeys}
            />
          ) : null}
        </div>
      </ComposerActivityAccessory>
    </>
  );
}
