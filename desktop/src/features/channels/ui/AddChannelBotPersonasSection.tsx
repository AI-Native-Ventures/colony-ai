import { Check } from "lucide-react";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { AgentPersona } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

/** Section label above a list: 13px, uppercase, tracked, muted. */
export const ADD_AGENTS_SECTION_LABEL_CLASS =
  "text-2xs font-extrabold uppercase tracking-[0.09em] text-colony-muted";

function AgentRow({
  persona,
  jobTitle,
  selected,
  disabled,
  inChannel,
  onToggle,
}: {
  persona: AgentPersona;
  jobTitle?: string;
  selected: boolean;
  disabled: boolean;
  inChannel: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={inChannel ? undefined : selected}
      className={cn(
        "flex min-h-[3.625rem] w-full items-center gap-3 rounded-colony-chip px-3.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40",
        inChannel
          ? "cursor-default shadow-[inset_0_0_0_1px_hsl(var(--colony-border))]"
          : selected
            ? "bg-colony-accent-soft shadow-[inset_0_0_0_1.5px_#B9A9EE]"
            : "shadow-[inset_0_0_0_1px_hsl(var(--colony-border))] hover:bg-colony-surface",
        disabled && !inChannel && "cursor-not-allowed opacity-50",
      )}
      data-testid={`add-channel-agent-${persona.id}`}
      disabled={disabled || inChannel}
      onClick={onToggle}
      type="button"
    >
      {inChannel ? (
        <span className="flex size-[1.125rem] shrink-0 items-center justify-center text-colony-success">
          <Check className="size-4" strokeWidth={2.4} />
        </span>
      ) : (
        <input
          aria-hidden="true"
          checked={selected}
          className="pointer-events-none m-0 size-[1.125rem] shrink-0 accent-colony-accent"
          readOnly
          tabIndex={-1}
          type="checkbox"
        />
      )}
      <ProfileAvatar
        avatarUrl={persona.avatarUrl}
        className="size-9 shrink-0 text-xs"
        iconClassName="h-5 w-5"
        label={persona.displayName}
        shape="squircle"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-extrabold text-colony-fg">
          {persona.displayName}
        </span>
        <span
          className={cn(
            "truncate text-xs font-semibold",
            selected ? "text-colony-fg-secondary" : "text-colony-muted",
          )}
        >
          {inChannel
            ? "In channel"
            : (jobTitle ?? "Template · not yet running")}
        </span>
      </span>
    </button>
  );
}

type AddChannelBotPersonasSectionProps = {
  canToggleSelections: boolean;
  inChannelPersonaIds?: ReadonlySet<string>;
  isLoading: boolean;
  /** Job title by persona id, from the running agents' team positions. */
  jobTitleByPersonaId?: ReadonlyMap<string, string>;
  onTogglePersona: (personaId: string) => void;
  personas: AgentPersona[];
  /** Lowercased text from the "Find an agent" box. */
  query?: string;
  selectedPersonaIds: readonly string[];
  // Legacy no-op props retained for the channel-template selector. Generic
  // remains supported there but is no longer exposed by channel add flows.
  includeGeneric?: boolean;
  onCreateAgent?: () => void;
  onToggleGeneric?: () => void;
  showGeneric?: boolean;
};

export function AddChannelBotPersonasSection({
  canToggleSelections,
  inChannelPersonaIds,
  isLoading,
  jobTitleByPersonaId,
  onTogglePersona,
  personas,
  query = "",
  selectedPersonaIds,
}: AddChannelBotPersonasSectionProps) {
  const matches = (persona: AgentPersona) =>
    query.length === 0 ||
    persona.displayName.toLowerCase().includes(query) ||
    (jobTitleByPersonaId?.get(persona.id) ?? "").toLowerCase().includes(query);
  const available = personas.filter(
    (persona) => !inChannelPersonaIds?.has(persona.id) && matches(persona),
  );
  const inChannel = personas.filter(
    (persona) => inChannelPersonaIds?.has(persona.id) && matches(persona),
  );
  const hasAnyAvailable = personas.some(
    (persona) => !inChannelPersonaIds?.has(persona.id),
  );

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <p className="text-xs font-medium text-colony-muted">
          Loading your agents…
        </p>
      ) : null}

      {!isLoading && personas.length === 0 ? (
        <p className="text-xs font-medium text-colony-muted">
          You have no agents yet. Create one to add it to this channel.
        </p>
      ) : null}

      {!isLoading && available.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className={ADD_AGENTS_SECTION_LABEL_CLASS}>Your agents</div>
          {available.map((persona) => (
            <AgentRow
              disabled={!canToggleSelections}
              inChannel={false}
              jobTitle={jobTitleByPersonaId?.get(persona.id)}
              key={persona.id}
              onToggle={() => onTogglePersona(persona.id)}
              persona={persona}
              selected={selectedPersonaIds.includes(persona.id)}
            />
          ))}
        </div>
      ) : null}

      {!isLoading &&
      personas.length > 0 &&
      !hasAnyAvailable &&
      inChannel.length > 0 ? (
        <p className="text-xs font-medium text-colony-muted">
          All of your agents are already in this channel.
        </p>
      ) : null}

      {!isLoading &&
      query.length > 0 &&
      available.length === 0 &&
      inChannel.length === 0 &&
      personas.length > 0 ? (
        <p className="text-xs font-medium text-colony-muted">
          No agents match your search.
        </p>
      ) : null}

      {!isLoading && inChannel.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className={ADD_AGENTS_SECTION_LABEL_CLASS}>In this channel</div>
          {inChannel.map((persona) => (
            <AgentRow
              disabled
              inChannel
              jobTitle={jobTitleByPersonaId?.get(persona.id)}
              key={persona.id}
              onToggle={() => undefined}
              persona={persona}
              selected={false}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
