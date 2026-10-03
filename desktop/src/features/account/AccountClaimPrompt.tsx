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
      className="fixed bottom-4 right-4 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-background p-5 text-foreground shadow-lg"
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
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-medium">Add sign-in details</h2>
          <p
            aria-live="polite"
            className="text-sm leading-5 text-muted-foreground"
            role="status"
          >
            Add an email and password so you can sign in on another device.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="account-claim-start"
              onClick={() => setIsClaimOpen(true)}
              type="button"
            >
              Set up account
            </Button>
            <Button
              data-testid="account-claim-later"
              disabled={isImporting}
              onClick={() => setStatus("closed")}
              type="button"
              variant="ghost"
            >
              Later
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
