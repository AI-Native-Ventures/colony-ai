import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import type {
  AccountAuthClient,
  AccountAuthRecord,
} from "@/features/onboarding/accountAuthClient";
import { startAccountClaimLookup } from "./accountClaimLookup";
import { AccountAuthFlow } from "@/features/onboarding/ui/AccountAuthFlow";
import { profileQueryKey } from "@/features/profile/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { getIdentity } from "@/shared/api/tauriIdentity";
import { Button } from "@/shared/ui/button";
import { PrivateChannelIcon } from "@/shared/ui/colonyIcons";

type ClaimStatus =
  | "checking"
  | "linked"
  | "eligible"
  | "lookup-error"
  | "closed";

export function AccountClaimPrompt({
  authClient,
}: {
  authClient: AccountAuthClient;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<ClaimStatus>("checking");
  const [isClaimOpen, setIsClaimOpen] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);

  React.useEffect(() => {
    const lookup = startAccountClaimLookup({
      read: () => authClient.getAccount(),
      onAccount: (account) => setStatus(account ? "linked" : "eligible"),
      onFailure: (code, contractFailure) => {
        console.warn("Account lookup failed", code);
        if (contractFailure)
          console.error("Account lookup contract failure", code);
        setStatus("lookup-error");
      },
    });
    const onFocus = () => lookup.retryOnFocus();
    window.addEventListener("focus", onFocus);
    return () => {
      lookup.cancel();
      window.removeEventListener("focus", onFocus);
    };
  }, [authClient]);

  const installAccount = React.useCallback(
    async (account: AccountAuthRecord) => {
      setIsImporting(true);
      try {
        const identity = await getIdentity();
        if (identity.pubkey.toLowerCase() !== account.pubkey.toLowerCase()) {
          throw new Error(
            "The signed-in identity could not be loaded. Try again.",
          );
        }
        relayClient.disconnect();
        queryClient.setQueryData(["identity"], identity);
        queryClient.removeQueries({ queryKey: profileQueryKey });
        setStatus("linked");
        setIsClaimOpen(false);
      } finally {
        setIsImporting(false);
      }
    },
    [queryClient],
  );

  // A passive account read must not cover the composer during an outage.
  // Bounded background retries and focus restore eligibility; settings can retry explicitly.
  if (status !== "eligible") {
    return null;
  }

  return (
    <aside
      aria-label="Account setup"
      className="fixed bottom-4 right-4 z-40 w-[min(21.3125rem,calc(100vw-2rem))] rounded-colony-popover bg-colony-pop p-5 text-colony-fg shadow-[0_0_0_1px_hsl(var(--colony-border)),0_18px_40px_-24px_rgba(40,20,60,0.4)]"
      data-testid="account-claim-prompt"
    >
      {isClaimOpen ? (
        <AccountAuthFlow
          authClient={authClient}
          mode="claim"
          onAuthenticated={installAccount}
          onCancel={() => setIsClaimOpen(false)}
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-colony-control-lg bg-colony-accent-soft text-colony-accent-ink">
              <PrivateChannelIcon size={19} />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-extrabold">Add sign-in details</h2>
              <p
                aria-live="polite"
                className="text-menu font-medium leading-normal text-colony-fg-secondary"
                role="status"
              >
                Add an email and password so you can sign in on another device.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              data-testid="account-claim-later"
              disabled={isImporting}
              onClick={() => setStatus("closed")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Later
            </Button>
            <Button
              data-testid="account-claim-start"
              onClick={() => setIsClaimOpen(true)}
              size="sm"
              type="button"
            >
              Set up account
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
