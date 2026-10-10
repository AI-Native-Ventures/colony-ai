import * as React from "react";
import { useCommunities } from "@/features/communities/useCommunities";
import { SettingsColonyCreditsOption } from "./SettingsColonyCreditsOption";
import { useQuery } from "@tanstack/react-query";
import { OpenRouterConnectionPanel } from "@/shared/ui/OpenRouterConnectionPanel";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import { getOpenRouterConnection } from "@/shared/api/tauriOpenRouter";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { useAcpRuntimesQueryForced } from "@/features/agents/acpRuntimesQuery";
import { AgentDefaultsEditor } from "@/features/agents/ui/AgentDefaultsEditor";
import { agentDefaultsConnection } from "../lib/agentDefaultsConnection";
import { SettingsOptionGroup } from "./SettingsOptionGroup";

export function AgentDefaultsSettingsCard() {
  const { activeCommunity } = useCommunities();
  const [revision, setRevision] = React.useState(0);
  const [openRouterExpanded, setOpenRouterExpanded] = React.useState(false);
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
  const connection = config.data
    ? agentDefaultsConnection(config.data, runtimes.data ?? [], openRouter.data)
    : null;
  const checking =
    config.isPending ||
    runtimes.isFetching ||
    !runtimes.hasForcedCheckStarted ||
    (config.data?.provider === "openrouter" && openRouter.isPending);
  const failed = config.isError || runtimes.isError;
  const showOpenRouter = connection?.kind === "openrouter";
  return (
    <SettingsOptionGroup
      data-testid="settings-global-agent-config"
      description="Defaults for your AI employees. Individual settings take priority."
      title="Agent defaults"
    >
      <div className="px-4 py-4 space-y-4">
        <section
          className="rounded-lg border border-border p-4"
          data-testid="agent-defaults-connection"
          aria-busy={checking}
        >
          <h4 className="text-sm font-semibold">Your connection</h4>
          <p className="mt-2 text-sm font-medium" role="status">
            {checking
              ? "Checking connection"
              : failed
                ? "Could not check your connection"
                : connection?.label}
          </p>
          {!checking && !failed ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {connection?.detail}
            </p>
          ) : null}
          {failed ? (
            <button
              className="mt-2 text-sm underline"
              type="button"
              onClick={() => {
                void config.refetch();
                void runtimes.forceRefresh();
              }}
            >
              Retry
            </button>
          ) : null}
        </section>
        {showOpenRouter ? (
          <OpenRouterConnectionPanel
            onSaved={() => setRevision((value) => value + 1)}
          />
        ) : (
          <details
            data-testid="agent-defaults-openrouter-alternative"
            onToggle={(event) =>
              setOpenRouterExpanded(event.currentTarget.open)
            }
          >
            <summary className="cursor-pointer text-sm font-medium">
              Connect with OpenRouter
            </summary>
            {openRouterExpanded ? (
              <div className="mt-3">
                <OpenRouterConnectionPanel
                  onSaved={() => setRevision((value) => value + 1)}
                />
              </div>
            ) : null}
          </details>
        )}
        <SettingsColonyCreditsOption
          key={activeCommunity?.id ?? ""}
          communityId={activeCommunity?.id ?? ""}
          selected={
            config.data?.provider === "colony-credits" &&
            config.data?.preferred_runtime === "buzz-agent"
          }
          onSaved={() => setRevision((value) => value + 1)}
        />
        {config.data?.provider === "colony-credits" ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Bring your own key
            </summary>
            <div className="mt-3">
              <AgentDefaultsEditor key={revision} layout="flat" />
            </div>
          </details>
        ) : (
          <section aria-label="Bring your own key">
            <h4 className="mb-3 text-sm font-semibold">Bring your own key</h4>
            <AgentDefaultsEditor key={revision} layout="flat" />
          </section>
        )}
      </div>
    </SettingsOptionGroup>
  );
}
