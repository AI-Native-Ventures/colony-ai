import { Check } from "lucide-react";

import type { AgentPersona, AgentTeam } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { resolveTeamPersonas } from "@/features/agents/lib/teamPersonas";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { ADD_AGENTS_SECTION_LABEL_CLASS } from "./AddChannelBotPersonasSection";

type AddChannelBotTeamsSectionProps = {
  canToggleSelections: boolean;
  inChannelPersonaIds?: ReadonlySet<string>;
  isLoading: boolean;
  onToggleTeam: (personaIds: string[]) => void;
  personas: AgentPersona[];
  /** Lowercased text from the "Find an agent" box. */
  query?: string;
  selectedPersonaIds: readonly string[];
  teams: AgentTeam[];
};

export function AddChannelBotTeamsSection({
  canToggleSelections,
  inChannelPersonaIds,
  isLoading,
  onToggleTeam,
  personas,
  query = "",
  selectedPersonaIds,
  teams,
}: AddChannelBotTeamsSectionProps) {
  const visibleTeams = teams.filter(
    (team) => query.length === 0 || team.name.toLowerCase().includes(query),
  );
  if (isLoading || visibleTeams.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-1.5">
        <div className={ADD_AGENTS_SECTION_LABEL_CLASS}>Teams</div>
        {visibleTeams.map((team) => {
          const resolution = resolveTeamPersonas(team, personas);
          const validIds = resolution.resolvedPersonaIds;
          const allSelected =
            validIds.length > 0 &&
            validIds.every((id) => selectedPersonaIds.includes(id));
          const inChannelCount = inChannelPersonaIds
            ? validIds.filter((id) => inChannelPersonaIds.has(id)).length
            : 0;
          const allInChannel =
            inChannelCount > 0 && inChannelCount === validIds.length;
          const disabled =
            !canToggleSelections || !resolution.isUsable || allInChannel;

          return (
            <Tooltip key={team.id}>
              <TooltipTrigger asChild>
                <button
                  aria-pressed={allSelected}
                  className={cn(
                    "flex min-h-[3.625rem] w-full items-center gap-3 rounded-colony-chip px-3.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40",
                    allSelected
                      ? "bg-colony-accent-soft shadow-[inset_0_0_0_1.5px_#B9A9EE]"
                      : "shadow-[inset_0_0_0_1px_hsl(var(--colony-border))] hover:bg-colony-surface",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                  data-testid={`add-channel-team-${team.id}`}
                  disabled={disabled}
                  onClick={() => onToggleTeam(validIds)}
                  type="button"
                >
                  <input
                    aria-hidden="true"
                    checked={allSelected}
                    className="pointer-events-none m-0 size-[1.125rem] shrink-0 accent-colony-accent"
                    readOnly
                    tabIndex={-1}
                    type="checkbox"
                  />
                  <span className="flex shrink-0 items-center">
                    {resolution.resolvedPersonas
                      .slice(0, 3)
                      .map((persona, index) => (
                        <ProfileAvatar
                          avatarUrl={persona.avatarUrl}
                          className={cn(
                            "size-[1.625rem] text-3xs",
                            index > 0 && "-ml-2",
                          )}
                          key={persona.id}
                          label={persona.displayName}
                          shape="squircle"
                        />
                      ))}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-extrabold text-colony-fg">
                      {team.name}
                    </span>
                    <span className="truncate text-xs font-semibold text-colony-muted">
                      {inChannelCount > 0
                        ? allInChannel
                          ? "All in channel"
                          : `${inChannelCount} in channel`
                        : `team · ${validIds.length} ${validIds.length === 1 ? "agent" : "agents"}`}
                    </span>
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-left">
                <div className="space-y-1.5">
                  <p className="font-medium">{team.name}</p>
                  {team.description ? (
                    <p className="text-2xs text-secondary-foreground/80">
                      {team.description}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    {resolution.resolvedPersonas.map((persona) => {
                      const personaInChannel =
                        inChannelPersonaIds?.has(persona.id) ?? false;
                      return (
                        <div
                          className="flex items-center gap-1 rounded-full bg-secondary-foreground/10 px-1.5 py-0.5"
                          data-testid="team-tooltip-persona-chip"
                          key={persona.id}
                        >
                          <ProfileAvatar
                            avatarUrl={persona.avatarUrl}
                            className="h-4 w-4 text-3xs bg-secondary-foreground/20 text-secondary-foreground"
                            label={persona.displayName}
                            shape="squircle"
                            testId="team-tooltip-persona-avatar"
                          />
                          <span className="text-2xs text-secondary-foreground">
                            {persona.displayName}
                          </span>
                          {personaInChannel ? (
                            <Check className="h-4 w-4 text-emerald-300" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
