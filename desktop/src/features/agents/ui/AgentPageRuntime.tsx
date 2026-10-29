import * as React from "react";

import { useAgentSubscriptionUsage } from "@/features/agents/useAgentSubscriptionUsage";
import type { useAgentConfigSurface } from "@/features/agents/hooks";
import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";
import type {
  AgentSubscriptionUsage,
  SubscriptionUsageWindow,
} from "@/shared/api/tauriArchive";
import {
  authStatusLabel,
  harnessAvailabilityLabel,
  requestedSourceLabel,
  providerName,
} from "./agentPageModel";
import { AgentHarnessGlyph } from "./AgentHarnessGlyph";
import {
  acceptedEffortLabel,
  isClaudeSubscription,
  simpleModelLabel,
  simpleProviderLabel,
} from "./simpleAgentAi";

type RuntimeConfig = ReturnType<typeof useAgentConfigSurface>["data"];

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

function SubscriptionUsageMeters({ usage }: { usage: AgentSubscriptionUsage }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const windows: Array<{ label: string; value: SubscriptionUsageWindow }> = [
    { label: "Session", value: usage.session },
  ];
  if (usage.weekly) windows.push({ label: "Weekly", value: usage.weekly });
  const current = windows.filter(({ value }) => value.resetsAt * 1000 > now);
  if (current.length === 0) return null;

  return (
    <section
      aria-label="Subscription usage"
      className="agents-c3-subscription-usage"
      data-testid="agent-subscription-usage"
    >
      {current.map(({ label, value }) => (
        <div className="agents-c3-subscription-window" key={label}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">{label}</span>
            <span className="text-muted-foreground">
              {Math.round(value.usedFraction * 100)}% used
            </span>
          </div>
          <progress
            aria-label={`${label} plan usage`}
            className="agents-c3-usage-progress"
            max={1}
            value={value.usedFraction}
          />
          <p className="m-0 text-xs text-muted-foreground">
            Resets at{" "}
            {new Intl.DateTimeFormat(undefined, {
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(value.resetsAt * 1000))}
          </p>
        </div>
      ))}
    </section>
  );
}

/** The owner-facing AI summary, with support-only runtime facts kept collapsed. */
export function AgentPageRuntime({
  agent,
  authStatus,
  availability,
  canEdit,
  config,
  configError,
  configLoading,
  inheritedModel,
  inheritedProvider,
  providerEnvVars,
  onEditConfiguration,
  onManageHarnesses,
  onRetryConfiguration,
  runtime,
}: {
  agent: ManagedAgent;
  authStatus: string;
  availability: Parameters<typeof harnessAvailabilityLabel>[0];
  canEdit: boolean;
  config: RuntimeConfig;
  configError: Error | null;
  configLoading: boolean;
  inheritedModel?: string | null;
  inheritedProvider?: string | null;
  providerEnvVars: Readonly<Record<string, string>>;
  onEditConfiguration: () => void;
  onManageHarnesses: () => void;
  onRetryConfiguration: () => void;
  runtime: AcpRuntimeCatalogEntry | undefined;
}) {
  const local = agent.backend.type === "local";
  const expectedRuntimeId = runtime?.id ?? agent.runtime?.trim() ?? null;
  const observed =
    config !== undefined &&
    !config.isPreSpawn &&
    (!expectedRuntimeId || config.runtimeId === expectedRuntimeId);
  const model =
    (observed ? config?.normalized.model?.value : null)?.trim() ||
    agent.model?.trim() ||
    inheritedModel?.trim() ||
    null;
  const provider =
    (observed ? config?.normalized.provider?.value : null)?.trim() ||
    agent.provider?.trim() ||
    inheritedProvider?.trim() ||
    null;
  const providerLabel = simpleProviderLabel({
    runtimeId: runtime?.id,
    provider,
    envVars: providerEnvVars,
  });
  const subscriptionUsageQuery = useAgentSubscriptionUsage(
    agent.pubkey,
    isClaudeSubscription({
      runtimeId: runtime?.id,
      provider,
      envVars: providerEnvVars,
    }),
  );
  const effort = observed
    ? acceptedEffortLabel(
        config?.normalized.thinkingEffort?.value,
        config?.effortOptions,
      )
    : null;
  const availabilityLabel = harnessAvailabilityLabel(availability, local).label;
  const authentication = authStatusLabel(authStatus).label;
  const name = agent.name || "This agent";
  const maxOutput = config?.normalized.maxOutputTokens?.value?.trim();
  const contextLimit = config?.normalized.contextLimit?.value?.trim();

  return (
    <section
      aria-labelledby="agent-ai"
      className="agents-c3-card"
      data-testid="agent-model-selection"
    >
      <div className="agents-c3-card-head">
        <h2 className="agents-c3-eyebrow" id="agent-ai">
          AI
        </h2>
        {canEdit ? (
          <button
            className="agents-c3-btn"
            data-size="sm"
            data-testid="agent-edit-configuration"
            onClick={onEditConfiguration}
            type="button"
          >
            Change
          </button>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Detail
          label="Model"
          value={
            configLoading && !model
              ? "Loading"
              : simpleModelLabel(model, provider)
          }
        />
        <Detail
          label="Harness"
          value={
            configLoading && !runtime
              ? "Loading"
              : (runtime?.label ?? "Not reported")
          }
        />
        {effort ? <Detail label="Effort" value={effort} /> : null}
        {providerLabel ? (
          <Detail label="Provider" value={providerLabel} />
        ) : null}
      </dl>

      {subscriptionUsageQuery.data ? (
        <SubscriptionUsageMeters usage={subscriptionUsageQuery.data} />
      ) : null}

      {configError ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="alert">
          <span className="agents-c3-error">
            AI settings could not be loaded.
          </span>
          <button
            className="agents-c3-link"
            onClick={onRetryConfiguration}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}
      {config?.isPreSpawn ? (
        <p className="agents-c3-quiet mt-3">
          {name} has not reported a running model yet.
        </p>
      ) : null}

      <details
        className="agents-c3-technical-details"
        data-testid="agent-technical-details"
      >
        <summary>
          <span>
            <strong>Technical details</strong>
            <span>For support. You never need these to use {name}.</span>
          </span>
          <span
            aria-hidden="true"
            className="agents-c3-technical-chevron text-2xl"
          >
            ›
          </span>
        </summary>
        <dl className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-2">
          <Detail
            label="Requested model"
            value={agent.model ?? "Not reported"}
          />
          <Detail
            label="Requested value source"
            value={requestedSourceLabel(agent.modelSource)}
          />
          <Detail
            label="Effective provider"
            value={provider ? providerName(provider) : "Not reported"}
          />
          <Detail
            label="Provider route"
            value={
              agent.provider ? providerName(agent.provider) : "Not reported"
            }
          />
          <Detail label="Harness availability" value={availabilityLabel} />
          <Detail label="Harness authentication" value={authentication} />
          <Detail
            label="Maximum output tokens"
            value={maxOutput || "Not reported"}
          />
          <Detail
            label="Context limit"
            value={contextLimit || "Not reported"}
          />
          <Detail
            label="Runtime command"
            value={agent.agentCommand || "Not reported"}
          />
        </dl>
        {configError ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground">
            {configError.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          {runtime ? <AgentHarnessGlyph runtime={runtime} /> : null}
          {runtime?.label ?? "Harness not reported"}
          {canEdit ? (
            <button
              className="agents-c3-link ml-auto"
              onClick={onManageHarnesses}
              type="button"
            >
              Harness settings
            </button>
          ) : null}
        </div>
      </details>
    </section>
  );
}
