import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useAcpRuntimesQueryForced } from "@/features/agents/acpRuntimesQuery";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { AgentDefaultsEditor } from "@/features/agents/ui/AgentDefaultsEditor";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import {
  connectOpenRouter,
  getOpenRouterConnection,
} from "@/shared/api/tauriOpenRouter";
import { OpenRouterConnectionPanel } from "@/shared/ui/OpenRouterConnectionPanel";
import { agentDefaultsConnection } from "../lib/agentDefaultsConnection";
import { CheckSmallIcon } from "./settingsIcons";

/** "Scout", "Scout and Aya", "Scout, Aya and Mina". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type SettingsAgentsPageProps = {
  onOpenHarnesses?: () => void;
};

/**
 * Settings > Agents > Defaults: the harness, provider and model new agents
 * start with, and the ways to pay for the AI they use.
 */
export function AgentDefaultsSettingsCard({
  onOpenHarnesses,
}: SettingsAgentsPageProps) {
  const [revision, setRevision] = React.useState(0);
  // Remounting the editor drops its "Saved" message, so only a new
  // connection (which can change the provider under it) does that.
  const [editorKey, setEditorKey] = React.useState(0);
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const config = useQuery({
    queryKey: globalAgentConfigQueryKey,
    queryFn: getGlobalAgentConfig,
  });
  const runtimes = useAcpRuntimesQueryForced();
  const openRouter = useQuery({
    queryKey: ["settings-openrouter-connection", revision],
    queryFn: getOpenRouterConnection,
    enabled: config.data?.provider === "openrouter",
    retry: false,
  });
  const managedAgents = useManagedAgentsQuery();
  const connection = config.data
    ? agentDefaultsConnection(config.data, runtimes.data ?? [], openRouter.data)
    : null;
  const checking =
    config.isPending ||
    runtimes.isFetching ||
    !runtimes.hasForcedCheckStarted ||
    (config.data?.provider === "openrouter" && openRouter.isPending);
  const failed = config.isError || runtimes.isError;
  const connected =
    !checking &&
    !failed &&
    connection !== null &&
    connection.kind !== "unknown" &&
    connection.kind !== "unavailable";
  const usingSubscription = connection?.kind === "subscription";
  const usingOpenRouter = connection?.kind === "openrouter";
  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const result = await connectOpenRouter();
      if (
        result.status === "connected" ||
        result.status === "limit" ||
        result.status === "linked"
      ) {
        // Connecting saves the provider, so read it back before the editor
        // and the "In use" badges are drawn again.
        await config.refetch();
        setRevision((value) => value + 1);
        setEditorKey((value) => value + 1);
      } else if (result.status === "error") {
        setConnectError(result.message);
      }
    } catch {
      setConnectError("OpenRouter sign-in did not finish. Try again.");
    } finally {
      setConnecting(false);
    }
  }
  const agentNames = (managedAgents.data ?? []).map((agent) => agent.name);

  return (
    <div className="cs-stack" data-testid="settings-global-agent-config">
      <section
        aria-labelledby="agent-defaults-title"
        className="cs-card cs-card-body cs-card-body-tight"
        data-testid="agent-defaults-editing"
      >
        <div className="cs-defaults-head">
          <h2 className="cs-card-title" id="agent-defaults-title">
            Agent defaults
          </h2>
          <span
            aria-busy={checking}
            className="cs-badge cs-badge-large"
            data-testid="agent-defaults-connection"
            data-tone={connected ? "ok" : failed ? "bad" : undefined}
            role="status"
          >
            {checking ? (
              "Checking connection"
            ) : failed ? (
              <>
                Could not check your connection{" "}
                <button
                  className="cs-link"
                  onClick={() => {
                    void config.refetch();
                    void runtimes.forceRefresh();
                  }}
                  type="button"
                >
                  Retry
                </button>
              </>
            ) : connected ? (
              <>
                <CheckSmallIcon size={13} strokeWidth={3} />
                Connected
                <span className="sr-only"> · {connection?.label}</span>
              </>
            ) : (
              (connection?.label ?? "Not connected")
            )}
          </span>
        </div>
        <p className="cs-defaults-note">
          New agents start with these settings.
          {agentNames.length > 0
            ? ` ${nameList(agentNames)} ${agentNames.length === 1 ? "uses" : "use"} them today.`
            : ""}
        </p>
        <div className="cs-defaults-editor">
          <AgentDefaultsEditor
            key={editorKey}
            layout="flat"
            onSaveSuccess={() => setRevision((value) => value + 1)}
          />
        </div>
      </section>

      <section aria-labelledby="ways-to-pay-title" className="cs-ways">
        <h2 className="cs-eyebrow" id="ways-to-pay-title">
          Ways to pay for AI
        </h2>
        <div className="cs-ways-grid">
          <div
            className="cs-way"
            data-selected={usingSubscription ? "true" : undefined}
            data-testid="agent-way-subscription"
          >
            <span
              className="cs-badge"
              data-tone={usingSubscription ? "ok" : undefined}
            >
              {usingSubscription ? <i aria-hidden="true" /> : null}
              {usingSubscription ? "In use" : "Not in use"}
            </span>
            <strong>Your AI subscription</strong>
            <span className="cs-way-copy">
              Claude Code or Codex, signed in on this Mac.
            </span>
            <button
              className="cs-link cs-way-link"
              data-testid="agent-way-manage-harnesses"
              onClick={onOpenHarnesses}
              type="button"
            >
              Manage harnesses
            </button>
          </div>
          <div
            className="cs-way"
            data-testid="agent-way-openrouter"
            data-selected={usingOpenRouter ? "true" : undefined}
          >
            <span
              className="cs-badge"
              data-tone={usingOpenRouter ? "ok" : undefined}
            >
              {usingOpenRouter ? <i aria-hidden="true" /> : null}
              {usingOpenRouter ? "In use" : "Not connected"}
            </span>
            <strong>OpenRouter</strong>
            <span className="cs-way-copy">
              Reach many models with one API key.
            </span>
            {usingOpenRouter ? (
              <div className="cs-way-panel">
                <OpenRouterConnectionPanel
                  onSaved={() => setRevision((value) => value + 1)}
                />
              </div>
            ) : (
              <>
                {connectError ? (
                  <span className="cs-way-error" role="alert">
                    {connectError}
                  </span>
                ) : null}
                <button
                  className="cs-button cs-way-button"
                  data-testid="openrouter-connect"
                  disabled={connecting}
                  onClick={() => void connect()}
                  type="button"
                >
                  {connecting ? "Connecting" : "Connect"}
                </button>
              </>
            )}
          </div>
          <div
            className="cs-way"
            data-muted="true"
            data-testid="agent-way-credits"
          >
            <span className="cs-badge">Coming soon</span>
            <strong>Colony credits</strong>
            <span className="cs-way-copy">
              Buy credits once and let any agent draw on them.
            </span>
            <button className="cs-button cs-way-button" disabled type="button">
              Buy credits
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
