import * as React from "react";
import { Bot, Plus, Sparkles } from "lucide-react";

import {
  getChannelIntroDescription,
  getChannelIntroKind,
} from "@/features/channels/ui/ChannelPane.helpers";
import {
  isWelcomeChannel,
  isWelcomeExperienceChannel,
} from "@/features/onboarding/welcome";
import type { Channel } from "@/shared/api/types";
import { HashSearch } from "@/shared/ui/icons";

type ChannelIntroAction = {
  description?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
};

/**
 * Builds the empty-channel intro block (heading, description, action cards)
 * for the channel timeline. The Welcome channel gets its onboarding trio
 * (browse / create channel / create agent); other channels get contextual
 * member actions.
 */
export function useChannelIntro({
  activeChannel,
  currentPubkey,
  onBrowseChannels,
  onCreateChannel,
  onWelcomeAddAgent,
}: {
  activeChannel: Channel | null;
  currentPubkey?: string;
  onAddAgent?: (options?: { beforeSend?: () => void }) => void;
  onAddFiles?: () => void;
  onBrowseChannels?: () => void;
  onCreateChannel?: () => void;
  onOpenMembers?: () => void;
  onWelcomeAddAgent?: () => void;
}) {
  return React.useMemo(() => {
    if (!activeChannel || activeChannel.channelType === "dm") {
      return null;
    }

    const actions: ChannelIntroAction[] = [];
    if (isWelcomeExperienceChannel(activeChannel)) {
      if (onBrowseChannels) {
        actions.push({
          icon: <HashSearch aria-hidden className="h-6 w-6" />,
          label: "Browse channels",
          onClick: onBrowseChannels,
          testId: "welcome-intro-action-browse-channels",
        });
      }

      if (onCreateChannel) {
        actions.push({
          icon: <Plus aria-hidden className="h-6 w-6" />,
          label: "Create a channel",
          onClick: onCreateChannel,
          testId: "welcome-intro-action-create-channel",
        });
      }

      if (onWelcomeAddAgent) {
        actions.push({
          icon: <Bot aria-hidden className="h-6 w-6" />,
          label: "Create an agent",
          onClick: onWelcomeAddAgent,
          testId: "welcome-intro-action-create-agent",
        });
      }

      return {
        actions,
        channelId: activeChannel.id,
        currentPubkey,
        visibility: activeChannel.visibility,
        channelKindLabel: isWelcomeChannel(activeChannel)
          ? "private welcome channel"
          : getChannelIntroKind(activeChannel),
        channelName: activeChannel.name,
        description: isWelcomeChannel(activeChannel)
          ? null
          : getChannelIntroDescription(activeChannel),
        icon: <Sparkles aria-hidden className="h-7 w-7" />,
      };
    }

    return {
      actions,
      channelId: activeChannel.id,
      currentPubkey,
      channelKindLabel: getChannelIntroKind(activeChannel),
      channelName: activeChannel.name,
      description: getChannelIntroDescription(activeChannel),
      visibility: activeChannel.visibility,
    };
  }, [
    activeChannel,
    currentPubkey,
    onBrowseChannels,
    onCreateChannel,
    onWelcomeAddAgent,
  ]);
}
