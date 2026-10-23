import type * as React from "react";

import type { useAgentConfigSurface } from "@/features/agents/hooks";
import { RuntimeIcon } from "@/features/onboarding/ui/RuntimeIcon";
import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";
import {
  authStatusLabel,
  harnessAvailabilityLabel,
  requestedSourceLabel,
  providerName,
} from "./agentPageModel";

type RuntimeConfig = ReturnType<typeof useAgentConfigSurface>["data"];

const CHECK_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="13"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="3"
    viewBox="0 0 24 24"
    width="13"
  >
    <path d="m5 12 5 5 9-10" />
  </svg>
);

function reportedValue(
  config: RuntimeConfig,
  field: "thinkingEffort" | "maxOutputTokens" | "contextLimit",
  isObserved: boolean,
  isLoading: boolean,
): string | null {
  if (isLoading) return "Loading";
  if (!isObserved || !config) return null;
  return config.normalized[field]?.value?.trim() || null;
}

function Row({
  align,
  label,
  children,
  muted = false,
}: {
  align?: "center";
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div data-align={align}>
      <dt>{label}</dt>
      <dd data-muted={muted ? "true" : undefined}>{children}</dd>
    </div>
  );
}

/**
 * The model and runtime part of the single agent page
 * (`AgentRuntime.dc.html`): what the agent asks for, and what actually runs.
 */
export function AgentPageRuntime({
  agent,
  authStatus,
  availability,
  canEdit,
  config,
  configError,
  configLoading,
  onEditConfiguration,
  onManageHarnesses,
  runtime,
}: {
  agent: ManagedAgent;
  authStatus: string;
  availability: Parameters<typeof harnessAvailabilityLabel>[0];
  canEdit: boolean;
  config: RuntimeConfig;
  configError: Error | null;
  configLoading: boolean;
  onEditConfiguration: () => void;
  onManageHarnesses: () => void;
  runtime: AcpRuntimeCatalogEntry | undefined;
}) {
  const name = agent.name || "This agent";
  const local = agent.backend.type === "local";
  const observed = config !== undefined && !config.isPreSpawn;
  const effectiveModel = observed
    ? config?.normalized.model?.value?.trim() || null
    : null;
  const effectiveProvider = observed
    ? config?.normalized.provider?.value?.trim() || null
    : null;
  const availabilityChip = harnessAvailabilityLabel(availability, local);
  const auth = authStatusLabel(authStatus);
  const source = requestedSourceLabel(agent.modelSource);
  const effort = reportedValue(config, "thinkingEffort", observed, configLoading);
  const maxOutput = reportedValue(
    config,
    "maxOutputTokens",
    observed,
    configLoading,
  );
  const contextLimit = reportedValue(
    config,
    "contextLimit",
    observed,
    configLoading,
  );

  return (
    <>
      <div className="agents-c3-sectionhead" id="runtime">
        <h2>Model &amp; runtime</h2>
        <span>
          What {name} asks for, and what actually runs
          {local ? " on this Mac" : " on its host"}.
        </span>
      </div>

      <section
        aria-labelledby="model-selection"
        className="agents-c3-table-card"
        data-testid="agent-model-selection"
      >
        <h3 id="model-selection">Model selection</h3>
        <dl className="agents-c3-dl">
          <Row label="Requested model">{agent.model ?? "Not reported"}</Row>
          <Row label="Requested value source">
            {source}
            {agent.modelSource === "definition" ? (
              <span className="agents-c3-chip" data-tone="note">
                Overrides global defaults
              </span>
            ) : null}
          </Row>
          <Row label="Effective model" muted={!effectiveModel}>
            {configLoading ? "Loading" : (effectiveModel ?? "Not reported")}
          </Row>
          <Row label="Effective provider" muted={!effectiveProvider}>
            {configLoading
              ? "Loading"
              : effectiveProvider
                ? providerName(effectiveProvider)
                : "Not reported"}
          </Row>
        </dl>
        {configError ? (
          <p className="agents-c3-error" role="alert">
            {configError.message}
          </p>
        ) : null}
        {config?.isPreSpawn ? (
          <p className="agents-c3-quiet">
            The agent has not reported an effective model for a running
            session.
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="harness-account"
        className="agents-c3-table-card"
        data-testid="agent-harness-account"
      >
        <div className="agents-c3-card-head">
          <h3 id="harness-account">Harness and account</h3>
          <button
            className="agents-c3-link"
            onClick={onManageHarnesses}
            type="button"
          >
            Harnesses &amp; connections →
          </button>
        </div>
        <dl className="agents-c3-dl">
          <Row align="center" label="Harness">
            {runtime ? (
              <RuntimeIcon
                className="size-[1.0625rem] shrink-0"
                runtime={runtime}
              />
            ) : null}
            {runtime?.label ?? "Not reported"}
          </Row>
          <Row align="center" label="Harness availability">
            <span
              className="agents-c3-chip"
              data-tone={availabilityChip.ok ? "ready" : "offline"}
            >
              <span aria-hidden="true" className="agents-c3-dot" />
              {availabilityChip.label}
            </span>
          </Row>
          <Row align="center" label="Harness authentication">
            <span
              className="agents-c3-chip"
              data-tone={
                auth.tone === "ok"
                  ? "ready"
                  : auth.tone === "bad"
                    ? "needs"
                    : "offline"
              }
            >
              {auth.tone === "ok" ? CHECK_ICON : null}
              {auth.label}
            </span>
          </Row>
          <Row label="Provider route" muted={!agent.provider}>
            {agent.provider
              ? providerName(agent.provider)
              : "Not reported"}
          </Row>
        </dl>
      </section>

      <section
        aria-labelledby="reported-values"
        className="agents-c3-table-card"
        data-testid="agent-reported-values"
      >
        <h3 id="reported-values">Reported runtime values</h3>
        <dl className="agents-c3-tiles" data-roomy="true">
          <div className="agents-c3-tile">
            <dt>Thinking effort</dt>
            <dd data-muted={effort ? undefined : "true"}>
              {effort ?? "Not reported"}
            </dd>
          </div>
          <div className="agents-c3-tile">
            <dt>Maximum output tokens</dt>
            <dd data-muted={maxOutput ? undefined : "true"}>
              {maxOutput ?? "Not reported"}
            </dd>
          </div>
          <div className="agents-c3-tile">
            <dt>Context limit</dt>
            <dd data-muted={contextLimit ? undefined : "true"}>
              {contextLimit ?? "Not reported"}
            </dd>
          </div>
        </dl>
      </section>

      {canEdit ? (
        <div className="agents-c3-note">
          <span>
            Change the model, provider or harness from the agent’s
            configuration. Running work finishes on the current setup.
          </span>
          <button
            className="agents-c3-btn"
            data-size="md"
            data-testid="agent-edit-configuration"
            onClick={onEditConfiguration}
            type="button"
          >
            Edit configuration
          </button>
        </div>
      ) : null}
    </>
  );
}
