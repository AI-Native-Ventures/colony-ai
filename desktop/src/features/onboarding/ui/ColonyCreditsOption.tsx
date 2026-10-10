import * as React from "react";
import "@/features/credits/colonyCreditsOption.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery } from "@tanstack/react-query";
import type { GlobalAgentConfig } from "@/shared/api/types";
import { CreditCheckout } from "@/features/credits/CreditCheckout";
import {
  connectColonyCredits,
  readCreditsGateway,
} from "@/features/credits/creditsGateway";
import { ColonyCreditsOptionView } from "@/features/credits/ColonyCreditsOptionView";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

/** Relay-gated credits route; purchases use the existing authoritative checkout. */
export function ColonyCreditsOption({
  communityId,
  selected,
  canSelect,
  onSelect,
}: {
  communityId: string;
  selected: boolean;
  canSelect: boolean;
  onSelect: (candidate: GlobalAgentConfig) => Promise<void>;
}) {
  const [checkout, setCheckout] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const mounted = React.useRef(true);
  const inFlight = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ["credits-gateway-option", communityId],
    queryFn: () => readCreditsGateway(),
    retry: false,
  });
  const state = query.isError
    ? "error"
    : query.isPending
      ? "loading"
      : query.data?.configured
        ? "ready"
        : "unconfigured";
  const credits = query.data?.configured ? query.data.credits : undefined;
  async function select() {
    if (inFlight.current || !canSelect) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await connectColonyCredits(onSelect, () => mounted.current);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Colony Agent could not connect. Try again.",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        void query.refetch();
      }
    }
  }
  async function policy(url: string) {
    try {
      await openUrl(url);
    } catch {
      if (mounted.current)
        setError("The policy could not open in your browser. Try again.");
    }
  }
  return (
    <>
      <ColonyCreditsOptionView
        state={state}
        credits={credits}
        busy={busy}
        refreshing={query.isFetching}
        selected={selected}
        canSelect={canSelect}
        error={error}
        onBuy={() => setCheckout(true)}
        onSelect={() => void select()}
        onRefresh={() => {
          setError(undefined);
          void query.refetch();
        }}
        onPolicy={(url) => void policy(url)}
      />
      <Dialog
        open={checkout}
        onOpenChange={(open) => {
          setCheckout(open);
          if (!open) void query.refetch();
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogTitle>Buy Colony credits</DialogTitle>
          <DialogDescription>
            Pay securely in your browser. Credits appear after payment is
            confirmed.
          </DialogDescription>
          {checkout ? <CreditCheckout communityId={communityId} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
