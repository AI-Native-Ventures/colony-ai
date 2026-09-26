import { Hash, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  useAvailableAcpRuntimes,
  usePersonasQuery,
  useTeamsQuery,
} from "@/features/agents/hooks";
import {
  useChannelTemplatesQuery,
  useCreateChannelTemplateMutation,
  useUpdateChannelTemplateMutation,
} from "@/features/channel-templates/hooks";
import { AddChannelBotPersonasSection } from "@/features/channels/ui/AddChannelBotPersonasSection";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type {
  AcpRuntime,
  AgentPersona,
  AgentTeam,
  ChannelTemplate,
  CreateChannelTemplateInput,
  UpdateChannelTemplateInput,
} from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

export function ChannelTemplatesSettingsCard() {
  const templatesQuery = useChannelTemplatesQuery();
  const personasQuery = usePersonasQuery();
  const teamsQuery = useTeamsQuery();

  const [editingTemplate, setEditingTemplate] =
    React.useState<ChannelTemplate | null>(null);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);

  if (templatesQuery.isError) throw templatesQuery.error;

  const templates = templatesQuery.data ?? [];
  const personasById = new Map(
    (personasQuery.data ?? []).map((persona) => [
      persona.id,
      persona.displayName,
    ]),
  );
  const teamsById = new Map(
    (teamsQuery.data ?? []).map((team) => [team.id, team.name]),
  );

  return (
    <section className="min-w-0" data-testid="settings-channel-templates">
      <div className="mb-10 flex w-full min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Channel templates
        </h1>
        <p className="text-sm font-normal text-muted-foreground/70">
          Reusable starting points for teams and client work.
        </p>
      </div>

      <div className="w-full max-w-[860px] border-b border-border/60 pb-5">
        <h2 className="mb-4 text-sm font-semibold">Templates</h2>
        <div className="min-w-0">
          {templatesQuery.isSuccess
            ? templates.map((template) => (
                <TemplateRow
                  key={template.id}
                  onEdit={() => setEditingTemplate(template)}
                  suggestedNames={[
                    ...template.agents.personas
                      .map((persona) => personasById.get(persona.personaId))
                      .filter((name): name is string => Boolean(name)),
                    ...template.agents.teams
                      .map((team) => teamsById.get(team.teamId))
                      .filter((name): name is string => Boolean(name)),
                  ]}
                  template={template}
                />
              ))
            : null}
        </div>

        <Button
          className="w20-template-create-button mt-4 h-7 rounded-md px-2.5 text-xs"
          onClick={() => setIsCreateOpen(true)}
          size="sm"
          type="button"
        >
          Create template
        </Button>
      </div>

      <TemplateFormDialog
        onOpenChange={setIsCreateOpen}
        open={isCreateOpen}
        template={null}
      />

      {editingTemplate ? (
        <TemplateFormDialog
          onOpenChange={(open) => {
            if (!open) setEditingTemplate(null);
          }}
          open
          template={editingTemplate}
        />
      ) : null}
    </section>
  );
}

function TemplateRow({
  template,
  onEdit,
  suggestedNames,
}: {
  template: ChannelTemplate;
  onEdit: () => void;
  suggestedNames: string[];
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-5 border-b border-border/60 py-5">
      <div className="min-w-0 max-w-[650px] flex-1">
        <div className="flex min-w-0 items-center">
          <Hash aria-hidden="true" className="size-4 shrink-0" />
          <strong className="ml-2 truncate text-sm font-semibold">
            {template.name}
          </strong>
        </div>
        {template.description ? (
          <p className="my-1.5 truncate text-xs leading-[1.6] text-muted-foreground/70">
            {template.description}
          </p>
        ) : null}
        {suggestedNames.length > 0 ? (
          <p className="text-xs text-muted-foreground/70">
            {suggestedNames.join(", ")}
          </p>
        ) : null}
      </div>
      <Button
        aria-label={`Edit ${template.name}`}
        className="h-7 shrink-0 rounded-md px-3 text-xs"
        onClick={onEdit}
        size="sm"
        type="button"
        variant="outline"
      >
        Edit
      </Button>
    </div>
  );
}

export function TemplateFormDialog({
  template,
  open,
  onOpenChange,
  onCreated,
}: {
  template: ChannelTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (template: ChannelTemplate) => void;
}) {
  const isEditing = template !== null;
  const createMutation = useCreateChannelTemplateMutation();
  const updateMutation = useUpdateChannelTemplateMutation();
  const personasQuery = usePersonasQuery();
  const teamsQuery = useTeamsQuery();
  const providersQuery = useAvailableAcpRuntimes();
  const runtimes = providersQuery.data ?? [];

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [canvasTemplate, setCanvasTemplate] = React.useState("");
  const [selectedPersonaIds, setSelectedPersonaIds] = React.useState<string[]>(
    [],
  );
  const [selectedTeamIds, setSelectedTeamIds] = React.useState<string[]>([]);
  const [personaRuntimes, setPersonaRuntimes] = React.useState<
    Record<string, string>
  >({});
  const [teamRuntimes, setTeamRuntimes] = React.useState<
    Record<string, string>
  >({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  React.useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setDescription(template.description ?? "");
      setCanvasTemplate(template.canvasTemplate ?? "");
      setSelectedPersonaIds(template.agents.personas.map((p) => p.personaId));
      setSelectedTeamIds(template.agents.teams.map((t) => t.teamId));
      const pRuntimes: Record<string, string> = {};
      for (const p of template.agents.personas) {
        if (p.runtime) pRuntimes[p.personaId] = p.runtime;
      }
      setPersonaRuntimes(pRuntimes);
      const tRuntimes: Record<string, string> = {};
      for (const t of template.agents.teams) {
        if (t.runtime) tRuntimes[t.teamId] = t.runtime;
      }
      setTeamRuntimes(tRuntimes);
    } else {
      setName("");
      setDescription("");
      setCanvasTemplate("");
      setSelectedPersonaIds([]);
      setSelectedTeamIds([]);
      setPersonaRuntimes({});
      setTeamRuntimes({});
    }
  }, [open, template]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const agents = {
      personas: selectedPersonaIds.map((personaId) => ({
        personaId,
        runtime: personaRuntimes[personaId] || null,
        model: null,
        role: null,
        backend: null,
      })),
      teams: selectedTeamIds.map((teamId) => ({
        teamId,
        runtime: teamRuntimes[teamId] || null,
        model: null,
        backend: null,
      })),
    };

    if (isEditing) {
      const input: UpdateChannelTemplateInput = {
        id: template.id,
        name: trimmedName,
        description: description.trim() || undefined,
        canvasTemplate: canvasTemplate.trim() || undefined,
        agents,
      };

      updateMutation.mutate(input, {
        onSuccess: () => {
          toast.success(`Updated "${trimmedName}"`);
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to update",
          );
        },
      });
    } else {
      const input: CreateChannelTemplateInput = {
        name: trimmedName,
        description: description.trim() || undefined,
        canvasTemplate: canvasTemplate.trim() || undefined,
        agents,
      };

      createMutation.mutate(input, {
        onSuccess: (created) => {
          toast.success(`Created "${trimmedName}"`);
          onCreated?.(created);
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to create",
          );
        },
      });
    }
  }

  function handleTogglePersona(personaId: string) {
    setSelectedPersonaIds((prev) => {
      if (prev.includes(personaId)) {
        setPersonaRuntimes((pp) => {
          const next = { ...pp };
          delete next[personaId];
          return next;
        });
        return prev.filter((id) => id !== personaId);
      }
      return [...prev, personaId];
    });
  }

  function handleToggleTeam(teamId: string) {
    setSelectedTeamIds((prev) => {
      if (prev.includes(teamId)) {
        setTeamRuntimes((tp) => {
          const next = { ...tp };
          delete next[teamId];
          return next;
        });
        return prev.filter((id) => id !== teamId);
      }
      return [...prev, teamId];
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <ChooserDialogContent
        className="max-w-lg"
        title={isEditing ? "Edit template" : "Create template"}
        description={
          isEditing
            ? "Update this channel template configuration."
            : "Save a reusable channel configuration."
        }
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={isPending || name.trim().length === 0}
              form="template-form"
              type="submit"
            >
              {isPending
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                  ? "Save"
                  : "Create"}
            </Button>
          </div>
        }
      >
        <form className="space-y-5" id="template-form" onSubmit={handleSubmit}>
          {/* Name */}
          <div className="space-y-1.5">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="template-name"
            >
              Name
            </label>
            <Input
              autoComplete="off"
              disabled={isPending}
              id="template-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint Planning"
              value={name}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="template-description"
            >
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Textarea
              className="min-h-16 resize-none"
              disabled={isPending}
              id="template-description"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this template is for"
              rows={2}
              value={description}
            />
          </div>

          {/* Canvas Template */}
          <div className="space-y-1.5">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="template-canvas"
            >
              Canvas template{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Textarea
              className="min-h-20 resize-none font-mono text-xs"
              disabled={isPending}
              id="template-canvas"
              onChange={(e) => setCanvasTemplate(e.target.value)}
              placeholder="Canvas content here..."
              rows={4}
              value={canvasTemplate}
            />
            <p
              className="text-xs text-muted-foreground/70"
              data-settings-subcopy
            >
              Use {"{channel.name}"} and {"{template.name}"} as placeholders.
            </p>
          </div>

          {/* Agent Personas */}
          <AddChannelBotPersonasSection
            canToggleSelections={!isPending}
            includeGeneric={false}
            isLoading={personasQuery.isLoading}
            onToggleGeneric={() => {}}
            onTogglePersona={handleTogglePersona}
            personas={personasQuery.data ?? []}
            selectedPersonaIds={selectedPersonaIds}
            showGeneric={false}
          />

          {/* Agent Teams */}
          <TemplateTeamSelector
            isPending={isPending}
            onToggleTeam={handleToggleTeam}
            selectedTeamIds={selectedTeamIds}
            teams={teamsQuery.data ?? []}
            isLoading={teamsQuery.isLoading}
          />

          {/* Runtime assignments */}
          <RuntimeAssignments
            isPending={isPending}
            personas={personasQuery.data ?? []}
            personaRuntimes={personaRuntimes}
            providers={runtimes}
            providersLoading={providersQuery.isLoading}
            selectedPersonaIds={selectedPersonaIds}
            selectedTeamIds={selectedTeamIds}
            teamRuntimes={teamRuntimes}
            teams={teamsQuery.data ?? []}
            onPersonaRuntimeChange={(personaId, runtimeId) =>
              setPersonaRuntimes((prev) => ({
                ...prev,
                [personaId]: runtimeId,
              }))
            }
            onTeamRuntimeChange={(teamId, runtimeId) =>
              setTeamRuntimes((prev) => ({ ...prev, [teamId]: runtimeId }))
            }
          />
        </form>
      </ChooserDialogContent>
    </Dialog>
  );
}

function TemplateTeamSelector({
  isPending,
  isLoading,
  onToggleTeam,
  selectedTeamIds,
  teams,
}: {
  isPending: boolean;
  isLoading: boolean;
  onToggleTeam: (teamId: string) => void;
  selectedTeamIds: readonly string[];
  teams: readonly { id: string; name: string }[];
}) {
  if (isLoading || teams.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">Teams</div>
        <p
          className="text-sm font-normal text-muted-foreground/70"
          data-settings-subcopy
        >
          Select teams to include in this template.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {teams.map((team) => {
          const isSelected = selectedTeamIds.includes(team.id);
          return (
            <button
              key={team.id}
              type="button"
              aria-pressed={isSelected}
              className={cn(
                "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/80 bg-background/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                isPending && "cursor-not-allowed opacity-50",
              )}
              disabled={isPending}
              onClick={() => onToggleTeam(team.id)}
            >
              <Users
                className={cn(
                  "h-4 w-4",
                  isSelected ? "text-primary" : "text-current",
                )}
              />
              {team.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeAssignments({
  isPending,
  onPersonaRuntimeChange,
  onTeamRuntimeChange,
  personas,
  personaRuntimes,
  providers,
  providersLoading,
  selectedPersonaIds,
  selectedTeamIds,
  teamRuntimes,
  teams,
}: {
  isPending: boolean;
  onPersonaRuntimeChange: (personaId: string, runtimeId: string) => void;
  onTeamRuntimeChange: (teamId: string, runtimeId: string) => void;
  personas: AgentPersona[];
  personaRuntimes: Record<string, string>;
  providers: AcpRuntime[];
  providersLoading: boolean;
  selectedPersonaIds: readonly string[];
  selectedTeamIds: readonly string[];
  teamRuntimes: Record<string, string>;
  teams: readonly AgentTeam[];
}) {
  const hasSelections =
    selectedPersonaIds.length > 0 || selectedTeamIds.length > 0;
  if (!hasSelections) return null;

  const selectedPersonas = personas.filter((p) =>
    selectedPersonaIds.includes(p.id),
  );
  const selectedTeams = teams.filter((t) => selectedTeamIds.includes(t.id));

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">Runtimes</div>
        <p
          className="text-sm font-normal text-muted-foreground/70"
          data-settings-subcopy
        >
          Choose which runtime to use for each agent.
        </p>
      </div>

      {providersLoading ? (
        <p className="text-xs text-muted-foreground">Discovering runtimes...</p>
      ) : providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No ACP runtimes detected. Install one to assign runtimes.
        </p>
      ) : (
        <div className="space-y-2">
          {selectedPersonas.map((persona) => (
            <RuntimeRow
              key={persona.id}
              avatarUrl={persona.avatarUrl}
              disabled={isPending}
              label={persona.displayName}
              onChange={(runtimeId) =>
                onPersonaRuntimeChange(persona.id, runtimeId)
              }
              providers={providers}
              value={personaRuntimes[persona.id] ?? ""}
            />
          ))}
          {selectedTeams.map((team) => (
            <RuntimeRow
              key={team.id}
              disabled={isPending}
              icon="team"
              label={team.name}
              onChange={(runtimeId) => onTeamRuntimeChange(team.id, runtimeId)}
              providers={providers}
              value={teamRuntimes[team.id] ?? ""}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RuntimeRow({
  avatarUrl,
  disabled,
  icon,
  label,
  onChange,
  providers,
  value,
}: {
  avatarUrl?: string | null | undefined;
  disabled: boolean;
  icon?: "team";
  label: string;
  onChange: (runtimeId: string) => void;
  providers: AcpRuntime[];
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon === "team" ? (
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ProfileAvatar
            avatarUrl={avatarUrl ?? null}
            className="h-5 w-5 shrink-0 text-3xs bg-muted text-muted-foreground ring-1 ring-border/50"
            label={label}
          />
        )}
        <span className="truncate text-sm">{label}</span>
      </div>
      <select
        className="h-7 rounded-md border border-input bg-background px-2 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        value={value}
      >
        <option value="">Default</option>
        {providers.map((runtime) => (
          <option key={runtime.id} value={runtime.id}>
            {runtime.label}
          </option>
        ))}
      </select>
    </div>
  );
}
