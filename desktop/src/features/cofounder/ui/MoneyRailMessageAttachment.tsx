import { useEffect } from "react";

import { browserTaskScope } from "@/features/workarea/browser/browserTaskScope";
import { useWorkAreaChannel } from "@/features/workarea/dock/workAreaChannelContext";
import {
  clearMoneyLinkTaskContext,
  rememberMoneyLinkTaskContext,
} from "@/features/workarea/browser/agentBrowserAccess";

import { useMoneyRailMessageCard } from "../moneyRailsBridge";
import { MoneyRailPaymentCard } from "./MoneyRailPaymentCard";

export function MoneyRailMessageAttachment({
  channelId,
  linkId,
}: {
  channelId: string | null | undefined;
  linkId: string;
}) {
  const card = useMoneyRailMessageCard(linkId);
  const workAreaChannel = useWorkAreaChannel();
  const taskId =
    channelId && workAreaChannel?.channelId === channelId
      ? browserTaskScope(
          workAreaChannel.channelId,
          workAreaChannel.channelType,
          workAreaChannel.threadRootId,
        )
      : null;

  useEffect(() => {
    if (
      card &&
      taskId &&
      (card.state === "needs_you" || card.state === "creating_link")
    ) {
      rememberMoneyLinkTaskContext(linkId, taskId);
    } else {
      clearMoneyLinkTaskContext(linkId);
    }
  }, [card, linkId, taskId]);

  if (!card) return null;
  return (
    <div className="cf-money-rail-message-attachment">
      <MoneyRailPaymentCard card={card} />
    </div>
  );
}
