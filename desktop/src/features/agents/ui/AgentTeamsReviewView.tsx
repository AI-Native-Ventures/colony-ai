import { ChevronRight, Users } from "lucide-react";

import type { AgentPersona, AgentTeam, ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

export function AgentTeamsReviewView({
  agents,
  error,
  isLoading,
  isPending,
  onEdit,
  onOpenAgent,
  onOpenPersona,
  onReviewDeployment,
  personas,
  teams,
}: {
  agents: readonly ManagedAgent[];
  error: Error | null;
  isLoading: boolean;
  isPending: boolean;
  onEdit: (team: AgentTeam) => void;
  onOpenAgent: (agent: ManagedAgent) => void;
  onOpenPersona: (persona: AgentPersona) => void;
  onReviewDeployment: (team: AgentTeam) => void;
  personas: readonly AgentPersona[];
  teams: readonly AgentTeam[];
}) {
  return (
    <section className="space-y-4" data-testid="agent-team-review">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading teams…</p>
      ) : null}
      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}
      {!isLoading && !error
        ? teams.map((team) => (
            <section
              className="max-w-4xl rounded-lg border border-border/70 bg-background/70 px-4 py-3"
              data-testid={`agent-team-${team.id}`}
              key={team.id}
            >
              <h2 className="text-sm font-semibold">{team.name}</h2>
              <div className="mt-2 divide-y divide-border/55">
                {team.personaIds.map((personaId) => {
                  const persona = personas.find(
                    (candidate) => candidate.id === personaId,
                  );
                  if (!persona) {
                    return (
                      <div
                        className="flex min-h-12 items-center gap-3 py-2"
                        key={personaId}
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                        >
                          <Users className="size-4" />
                        </span>
                        <span className="text-sm text-muted-foreground">
                          Agent definition unavailable
                        </span>
                      </div>
                    );
                  }

                  const managedAgent = agents.find(
                    (candidate) => candidate.personaId === persona.id,
                  );
                  return (
                    <button
                      aria-label={`${persona.displayName}${persona.description ? `, ${persona.description}` : ""}`}
                      className="flex min-h-12 w-full items-center gap-3 py-2 text-left hover:bg-muted/30"
                      key={persona.id}
                      onClick={() =>
                        managedAgent
                          ? onOpenAgent(managedAgent)
                          : onOpenPersona(persona)
                      }
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                      >
                        <Users className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {persona.displayName}
                        </span>
                        {persona.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {persona.description}
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/55 pt-3">
                <Button
                  disabled={isPending}
                  onClick={() => onEdit(team)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Edit team
                </Button>
                <Button
                  disabled={isPending}
                  onClick={() => onReviewDeployment(team)}
                  size="sm"
                  type="button"
                >
                  Review team deployment
                </Button>
              </div>
            </section>
          ))
        : null}
    </section>
  );
}
