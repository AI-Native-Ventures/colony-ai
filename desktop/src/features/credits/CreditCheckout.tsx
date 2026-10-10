import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { SectionHeader } from "@/shared/ui/PageHeader";
import {
  checkCreditPayment,
  formatCreditMoney,
  PaymentRequestError,
  readCredits,
  startCreditCheckout,
  type Checkout,
} from "./accountPayments";

export function CreditCheckout({ communityId }: { communityId: string }) {
  const client = useQueryClient();
  const [selected, setSelected] = React.useState("");
  const [key, setKey] = React.useState<string>(() => crypto.randomUUID());
  const [checkout, setCheckout] = React.useState<Checkout>();
  const [reference, setReference] = React.useState<string>();
  const [checking, setChecking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const polls = React.useRef(0);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ["account-credits", communityId],
    queryFn: async () => {
      polls.current += 1;
      return readCredits();
    },
    retry: false,
    refetchInterval: (result) => {
      const pending = result.state.data?.intents.some((intent) =>
        ["pending", "delayed", "uncertain"].includes(intent.status),
      );
      return pending && polls.current < 60 ? 5000 : false;
    },
  });
  const snapshot = query.data;
  const open = snapshot?.intents.find((intent) =>
    ["pending", "delayed", "uncertain"].includes(intent.status),
  );
  const intent =
    snapshot?.intents.find((item) => item.reference === reference) ?? open;
  const packId = open?.packId ?? selected ?? "";
  const pack = snapshot?.packs.find((item) => item.id === packId);
  const pending =
    intent && ["pending", "delayed", "uncertain"].includes(intent.status);
  const failure = intent?.status === "failed" || intent?.status === "cancelled";

  async function openPolicy(url: string) {
    try {
      if (new URL(url).protocol !== "https:")
        throw new Error("The policy link is unavailable.");
      await openUrl(url);
    } catch {
      if (mounted.current)
        setError("The policy could not open in your browser. Try again.");
    }
  }

  async function launch(result: Checkout) {
    if (result.authorizationUrl && result.authorizationMethod === "GET") {
      const url = new URL(result.authorizationUrl);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "checkout.stripe.com" ||
        url.username ||
        url.password
      )
        throw new Error("Checkout returned an invalid browser address.");
      await openUrl(result.authorizationUrl);
    } else if (
      result.authorizationUrl &&
      result.authorizationMethod === "POST"
    ) {
      // PayFast retains its signed hosted form contract.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = result.authorizationUrl;
      form.target = "_blank";
      for (const field of result.authorizationFields) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = field.name;
        input.value = field.value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
      form.remove();
    }
  }
  async function buy() {
    if (!pack || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await startCreditCheckout(
        pack.id,
        open?.idempotencyKey ?? key,
      );
      if (!mounted.current) return;
      setCheckout(result);
      setReference(result.reference);
      setKey(result.idempotencyKey);
      polls.current = 0;
      await launch(result);
      if (!mounted.current) return;
      await client.invalidateQueries({
        queryKey: ["account-credits", communityId],
      });
    } catch (cause) {
      if (mounted.current) {
        if (cause instanceof PaymentRequestError && cause.reference)
          setReference(cause.reference);
        setError(
          cause instanceof Error
            ? cause.message
            : "Checkout could not open. Check your payment and try again.",
        );
        void query.refetch();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function check() {
    setChecking(true);
    setError(undefined);
    polls.current = 0;
    try {
      if (intent) await checkCreditPayment(intent.reference);
      if (!mounted.current) return;
      await query.refetch();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Payment could not be checked. Try again.",
        );
    } finally {
      if (mounted.current) setChecking(false);
    }
  }
  function retry() {
    setReference(undefined);
    setCheckout(undefined);
    setKey(crypto.randomUUID());
    setError(undefined);
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-5"
      aria-busy={busy || checking}
    >
      <SectionHeader title="Choose an amount" />
      {snapshot ? (
        <p className="text-sm">
          Available balance: {formatCreditMoney(snapshot.balanceUsdCents)} USD
        </p>
      ) : null}
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading current prices
        </p>
      ) : null}
      {query.error ? (
        <div className="space-y-3">
          <p className="text-sm text-destructive" role="alert">
            {query.error.message}
          </p>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching
              ? "Loading current prices"
              : "Retry loading prices"}
          </Button>
        </div>
      ) : null}
      {snapshot && !snapshot.enabled ? (
        <p className="text-sm text-muted-foreground">
          Credit checkout is unavailable. Your balance has not changed.
        </p>
      ) : null}
      {snapshot?.enabled ? (
        <>
          <fieldset
            className="grid gap-3 sm:grid-cols-2"
            disabled={busy || checking || Boolean(pending)}
          >
            <legend className="sr-only">Credit amount</legend>
            {snapshot.packs.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/70 p-4 text-sm"
              >
                <input
                  type="radio"
                  name="credit-pack"
                  value={item.id}
                  checked={packId === item.id}
                  onChange={() => {
                    setSelected(item.id);
                    if (failure || intent?.status === "paid") retry();
                  }}
                />
                <span>
                  {formatCreditMoney(
                    item.chargeMinorUnits,
                    item.chargeCurrency,
                  )}{" "}
                  {item.chargeCurrency}
                  <span className="block text-xs text-muted-foreground">
                    {formatCreditMoney(item.grantUsdCents)} credits
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            Checkout opens in your browser. Credits become available after
            payment is confirmed.
          </p>
          <p className="text-xs text-muted-foreground">
            By buying credits you agree to the{" "}
            <a
              className="underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              href={snapshot.policyUrls.terms}
              onClick={(event) => {
                event.preventDefault();
                void openPolicy(snapshot.policyUrls.terms);
              }}
            >
              Terms
            </a>{" "}
            and{" "}
            <a
              className="underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              href={snapshot.policyUrls.acceptableUse}
              onClick={(event) => {
                event.preventDefault();
                void openPolicy(snapshot.policyUrls.acceptableUse);
              }}
            >
              Acceptable Use Policy
            </a>
            .
          </p>
          {pending || (checkout && !intent) ? (
            <p className="text-sm text-muted-foreground" role="status">
              Waiting for payment confirmation. Your balance has not been
              credited for this purchase.
            </p>
          ) : null}
          {intent?.status === "uncertain" ? (
            <p className="text-sm" role="status">
              The payment outcome is uncertain. Check this payment before
              starting another.
            </p>
          ) : null}
          {intent?.status === "paid" ? (
            <p className="text-sm" role="status">
              Payment confirmed. Your credits are available.
            </p>
          ) : null}
          {failure ? (
            <p className="text-sm text-destructive" role="alert">
              {intent.status === "failed"
                ? "Payment failed."
                : "Checkout expired or was cancelled."}{" "}
              No credits were added for this purchase.
            </p>
          ) : null}
          {intent ? (
            <p className="break-all text-xs text-muted-foreground">
              Reference: {intent.reference}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => void check()}
              disabled={busy || checking || query.isFetching}
            >
              {checking ? "Checking payment" : "Check payment"}
            </Button>
            {failure ? (
              <Button onClick={retry}>Try again</Button>
            ) : intent?.status !== "paid" ? (
              <Button
                onClick={() => void buy()}
                disabled={
                  !pack ||
                  busy ||
                  checking ||
                  !snapshot.enabled ||
                  (pending && intent.status !== "pending")
                }
              >
                {busy
                  ? "Opening checkout"
                  : pending || checkout
                    ? "Reopen checkout"
                    : "Continue to checkout"}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
