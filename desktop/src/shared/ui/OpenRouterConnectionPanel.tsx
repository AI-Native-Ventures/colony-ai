import { ArrowRight } from "lucide-react";
import openRouterLogoUrl from "@/features/onboarding/assets/harness-logos/openrouter.svg?url";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import {
  cancelOpenRouter,
  connectOpenRouter,
  getOpenRouterConnection,
  selectOpenRouterModel,
  testOpenRouterConnection,
  type OpenRouterConnection,
  type OpenRouterOutcome,
} from "@/shared/api/tauriOpenRouter";

/** Shared OAuth connection UI. The native layer owns credentials and persistence. */
export function OpenRouterConnectionPanel({
  onboarding = false,
  onSaved,
}: {
  onboarding?: boolean;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [account, setAccount] = React.useState<OpenRouterConnection | null>(
    null,
  );
  const [connectionState, setConnectionState] = React.useState("unknown");
  const [draftModel, setDraftModel] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<
    "load" | "connect" | "save" | "test" | null
  >("load");
  const [mode, setMode] = React.useState<"free" | "paid">("free");
  const generation = React.useRef(0);
  const id = React.useId();
  const onSavedRef = React.useRef(onSaved);
  onSavedRef.current = onSaved;
  const apply = React.useCallback(
    async (result: OpenRouterOutcome) => {
      if (
        result.status === "connected" ||
        result.status === "limit" ||
        result.status === "linked"
      ) {
        setAccount(result);
        setConnectionState("linked");
        setDraftModel(result.model);
        setMode(
          (result.models.find((model) => model.id === result.model)?.free ??
            result.model.endsWith(":free"))
            ? "free"
            : "paid",
        );
        setMessage(
          result.failedRestarts > 0
            ? "Connection saved. Some AI employees could not restart. Check Agents in Settings."
            : (result.metadataWarning ??
                (result.testResult === "connected"
                  ? "Connection works."
                  : result.testResult
                    ? "The model could not complete the test. Refresh or choose another model, then try again."
                    : null)),
        );
        await queryClient.invalidateQueries({
          queryKey: globalAgentConfigQueryKey,
        });
      } else if (result.status === "error") setMessage(result.message);
      else if (result.status === "reauth" || result.status === "unmanaged") {
        setAccount(null);
        setConnectionState(result.status);
        setMessage(result.message);
      } else if (result.status === "unlinked") {
        setAccount(null);
        setConnectionState("unlinked");
      }
    },
    [queryClient],
  );
  React.useEffect(() => {
    const current = ++generation.current;
    getOpenRouterConnection()
      .then(async (result) => {
        if (current === generation.current) await apply(result);
      })
      .catch(() => {
        if (current === generation.current)
          setMessage("Could not read your OpenRouter connection. Try again.");
      })
      .finally(() => {
        if (current === generation.current) setPending(null);
      });
    return () => {
      generation.current++;
      void cancelOpenRouter().catch(() => {});
    };
  }, [apply]);
  async function act(
    kind: "load" | "connect" | "save" | "test",
    action: () => Promise<OpenRouterOutcome>,
  ) {
    const current = ++generation.current;
    setPending(kind);
    setMessage(null);
    try {
      const result = await action();
      if (current === generation.current) {
        await apply(result);
        if (
          (kind === "connect" || kind === "save") &&
          (result.status === "connected" ||
            result.status === "limit" ||
            result.status === "linked")
        )
          onSavedRef.current?.();
      }
    } catch {
      if (current === generation.current)
        setMessage(
          kind === "test"
            ? "Could not test OpenRouter. Try again."
            : kind === "save"
              ? "Could not save the model. Try again."
              : kind === "load"
                ? "Could not refresh OpenRouter. Try again."
                : "OpenRouter sign-in did not finish. Try again.",
        );
    } finally {
      if (current === generation.current) setPending(null);
    }
  }
  const paidAvailable =
    account && account.freeTier === false && account.limitRemaining !== 0;
  const models =
    account?.models.filter((model) => model.free === (mode === "free")) ?? [];
  const exhausted = account?.status === "limit";
  const amount = account?.balance ?? account?.usage ?? null;
  const button = (primary = false) =>
    onboarding
      ? `${primary ? "primary" : "secondary"} full`
      : `${primary ? "bg-primary text-primary-foreground" : "border border-border"} rounded-md px-3 py-2 text-sm`;
  const openManage = () => {
    void openUrl("https://openrouter.ai/credits").catch(() =>
      setMessage("Could not open OpenRouter. Try again."),
    );
  };
  return (
    <section
      data-testid="openrouter-connection"
      aria-busy={pending !== null}
      className={onboarding ? undefined : "space-y-4 text-sm"}
    >
      <div className="route-intro flex items-center gap-3">
        <img
          className="h-8 w-8"
          src={openRouterLogoUrl}
          alt=""
          aria-hidden="true"
        />
        <div>
          <h3 className="font-semibold">Your OpenRouter account</h3>
          <p className="text-muted-foreground">
            One connection, a choice of models.
          </p>
        </div>
        {account ? (
          <span className="connected-pill ml-auto text-xs">
            {account.status === "linked" ? "Saved" : "Connected"}
          </span>
        ) : null}
      </div>
      {message ? (
        <div
          className={
            message === "Connection works."
              ? "power-notice"
              : "power-notice is-error"
          }
          role={message === "Connection works." ? "status" : "alert"}
        >
          <p>{message}</p>
        </div>
      ) : null}
      {!account ? (
        <>
          <div className="openrouter-intro">
            <p>Connect in your browser, then choose a free or paid model.</p>
            <ul className="list-disc">
              <li>Keep your existing OpenRouter account.</li>
              <li>Review its key usage and limits here.</li>
              <li>OpenRouter billing stays separate from Colony credits.</li>
            </ul>
          </div>
          <button
            className={button(true)}
            type="button"
            disabled={pending !== null}
            onClick={() =>
              void act(
                connectionState === "unknown" || connectionState === "unmanaged"
                  ? "load"
                  : "connect",
                connectionState === "unknown" || connectionState === "unmanaged"
                  ? getOpenRouterConnection
                  : connectOpenRouter,
              )
            }
          >
            {pending === "connect"
              ? "Waiting for OpenRouter"
              : pending === "load"
                ? "Checking connection"
                : connectionState === "unknown" ||
                    connectionState === "unmanaged"
                  ? "Refresh connection"
                  : connectionState === "reauth"
                    ? "Sign in again"
                    : "Connect OpenRouter"}
            <ArrowRight className="icon" aria-hidden="true" />
          </button>
          {pending === "connect" ? (
            <button
              className={button()}
              type="button"
              onClick={() => {
                void cancelOpenRouter().catch(() =>
                  setMessage("Could not cancel. Wait for sign-in to finish."),
                );
              }}
            >
              Cancel sign-in
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="openrouter-balance flex items-center justify-between">
            <span>
              {account.balance === null
                ? "Spent so far on this key"
                : "OpenRouter balance"}
              <strong className="block font-semibold">
                {amount === null
                  ? "Usage unavailable"
                  : new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                    }).format(amount)}
              </strong>
            </span>
            <button
              className="link inline-flex items-center gap-2 text-sm"
              onClick={openManage}
              type="button"
            >
              Add credits on OpenRouter{" "}
              <ArrowRight className="icon" aria-hidden="true" />
            </button>
          </div>
          {account.limit !== null ? (
            <p className="power-caption">
              Key limit: ${account.limit.toFixed(2)}. Remaining:{" "}
              {account.limitRemaining === null
                ? "Unavailable"
                : `$${account.limitRemaining.toFixed(2)}`}
              .
            </p>
          ) : null}
          <fieldset className="model-modes flex gap-2">
            <legend className="sr-only">OpenRouter model type</legend>
            <button
              className={onboarding ? undefined : button()}
              aria-pressed={mode === "free"}
              disabled={pending !== null}
              onClick={() => setMode("free")}
              type="button"
            >
              Free models
            </button>
            <button
              className={onboarding ? undefined : button()}
              aria-pressed={mode === "paid"}
              disabled={pending !== null || !paidAvailable}
              onClick={() => setMode("paid")}
              type="button"
            >
              Paid models
            </button>
          </fieldset>
          <div className="openrouter-model">
            <div className="field">
              <label htmlFor={id}>Model</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                id={id}
                value={
                  models.some((model) => model.id === draftModel)
                    ? draftModel
                    : ""
                }
                disabled={pending !== null || !models.length}
                onChange={(event) => setDraftModel(event.target.value)}
              >
                <option value="" disabled>
                  Choose a {mode} model
                </option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                    {model.free ? " (free)" : ""}
                  </option>
                ))}
              </select>
              <button
                className={button()}
                type="button"
                disabled={
                  pending !== null ||
                  !draftModel ||
                  draftModel === account.model ||
                  !models.some((model) => model.id === draftModel)
                }
                onClick={() =>
                  void act("save", () => selectOpenRouterModel(draftModel))
                }
              >
                Use this model
              </button>
              {!models.length && account.model ? (
                <p className="power-caption">Saved model: {account.model}</p>
              ) : null}
            </div>
            {account.freeTier === true ? (
              <>
                <div className="quota-line flex justify-between">
                  <span>Daily free allowance</span>
                  <strong>
                    {account.freeRemaining === null ||
                    account.freeLimit === null
                      ? "Allowance unavailable"
                      : `${account.freeRemaining} / ${account.freeLimit} requests left`}
                  </strong>
                </div>
                {account.freeRemaining !== null &&
                account.freeLimit !== null ? (
                  <progress
                    aria-label="OpenRouter daily free requests remaining"
                    max={account.freeLimit || 1}
                    value={account.freeRemaining}
                  />
                ) : null}
                <p className="power-caption">
                  {account.freeUsed !== null
                    ? `${account.freeUsed} requests used today. `
                    : ""}
                  Limits are shared across OpenRouter usage.
                </p>
              </>
            ) : null}
          </div>
          {exhausted ? (
            <div className="power-notice is-error" role="alert">
              <p>
                The selected model's allowance is used up. Wait for the reset or
                choose another available model.
              </p>
            </div>
          ) : null}
          <div
            className="power-cta"
            style={onboarding ? { position: "static" } : undefined}
          >
            <button
              className={button(true)}
              type="button"
              disabled={
                pending !== null || exhausted || account.status === "linked"
              }
              onClick={() => void act("test", testOpenRouterConnection)}
            >
              {pending === "test" ? "Testing connection" : "Test connection"}
            </button>
            <p>Uses the selected OpenRouter model.</p>
          </div>
          <button
            className="link text-sm"
            type="button"
            disabled={pending !== null}
            onClick={() => void act("load", getOpenRouterConnection)}
          >
            Refresh connection
          </button>
        </>
      )}
    </section>
  );
}
