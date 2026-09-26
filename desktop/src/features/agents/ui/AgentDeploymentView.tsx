import { ArrowUpRight, Server } from "lucide-react";

import { useBackendProvidersQuery } from "@/features/agents/hooks";
import type { ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";

export function AgentDeploymentView({
  agents,
  error,
  isLoading,
  onOpenAgent,
}: {
  agents: ManagedAgent[];
  error: Error | null;
  isLoading: boolean;
  onOpenAgent: (agent: ManagedAgent) => void;
}) {
  const providersQuery = useBackendProvidersQuery();
  const remoteAgents = agents.filter(
    (agent) => agent.backend.type === "provider",
  );

  return (
    <div className="space-y-5" data-testid="agent-deployment">
      <PageHeader
        description="Remote agents and the backend providers reported by this desktop."
        title="Agent deployment"
      />
      {error ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Remote agents</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading remote agents…
          </p>
        ) : remoteAgents.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-background/70 px-5 py-8">
            <p className="font-medium">No remote agents deployed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a configured host and review identity, access, and lifetime
              before starting.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted/35 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-3 py-3">Host</th>
                  <th className="px-3 py-3">State</th>
                  <th className="px-4 py-3 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/55">
                {remoteAgents.map((agent) => (
                  <tr key={agent.pubkey}>
                    <td className="px-4 py-3 font-medium">
                      {agent.name || "Unnamed agent"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {agent.backend.type === "provider"
                        ? agent.backend.id
                        : "Not reported"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={
                          agent.status === "running" ||
                          agent.status === "deployed"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {agent.status === "not_deployed"
                          ? "Not deployed"
                          : agent.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        onClick={() => onOpenAgent(agent)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Inspect <ArrowUpRight />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Server aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold tracking-tight">
            Configured hosts
          </h2>
        </div>
        {providersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Checking available hosts…
          </p>
        ) : providersQuery.error ? (
          <p className="text-sm text-destructive" role="alert">
            {providersQuery.error instanceof Error
              ? providersQuery.error.message
              : "Host discovery failed."}
          </p>
        ) : providersQuery.data?.length ? (
          <div className="divide-y divide-border/55 overflow-hidden rounded-xl border border-border/70 bg-background/70">
            {providersQuery.data.map((provider) => (
              <div
                className="flex min-h-12 items-center justify-between gap-4 px-4 py-3"
                key={provider.id}
              >
                <span className="text-sm font-medium">{provider.id}</span>
                <span className="text-sm text-muted-foreground">
                  Available on this desktop
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
            No configured remote host was reported.
          </div>
        )}
      </section>
    </div>
  );
}
