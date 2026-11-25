import { CircleAlert } from "lucide-react";
import * as React from "react";

import { CreditCheckout } from "@/features/credits/CreditCheckout";
import { useCommunities } from "@/features/communities/useCommunities";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import type { HomeNoticeAction } from "./homeNoticeContent";
import type { HomeNoticeKind } from "./homeNoticeModel";

export { homeNoticeContent } from "./homeNoticeContent";
export type { HomeNoticeAction } from "./homeNoticeContent";

/**
 * One notice card above the composer. Visual language of the existing
 * conversation notices (the start watch's stalled note): an alert icon, one
 * plain sentence, small outline buttons. The sentence is the region's label;
 * each button's name is its own text, so nothing is announced twice.
 */
export function AgentHomeCard({
  actions,
  busy,
  kind,
  message,
}: {
  actions: HomeNoticeAction[];
  busy: boolean;
  kind: HomeNoticeKind;
  message: string;
}) {
  return (
    <div
      aria-live="polite"
      className="mx-5 mb-2 flex flex-wrap items-center gap-2 rounded-[var(--colony-radius-card,0.75rem)] bg-colony-need-bg px-3 py-2 text-sm text-colony-fg"
      data-notice={kind}
      data-testid="agent-home-card"
      role="status"
    >
      <CircleAlert
        aria-hidden="true"
        className="size-4 shrink-0 text-colony-need"
      />
      <span
        className="min-w-[12rem] flex-1"
        data-testid="agent-home-card-message"
      >
        {message}
      </span>
      {actions.map((action) => (
        <Button
          disabled={busy}
          key={action.label}
          onClick={action.onClick}
          size="sm"
          type="button"
          variant={action.primary ? "default" : "outline"}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

/** The existing credit checkout, in a dialog, for the card's Top up. */
export function TopUpDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { activeCommunity } = useCommunities();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent data-testid="agent-home-top-up">
        <DialogHeader>
          <DialogTitle>Top up AI credit</DialogTitle>
          <DialogDescription>
            Your cloud agents use this credit when they reply.
          </DialogDescription>
        </DialogHeader>
        {activeCommunity ? (
          <CreditCheckout communityId={activeCommunity.id} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function useTopUpDialog() {
  const [open, setOpen] = React.useState(false);
  return { open, setOpen };
}
