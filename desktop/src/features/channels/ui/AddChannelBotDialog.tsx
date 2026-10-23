import { AlertTriangle } from "lucide-react";
import * as React from "react";

import {
  useCreateChannelManagedAgentsMutation,
  usePersonasQuery,
  useTeamsQuery,
  type CreateChannelManagedAgentResult,
} from "@/features/agents/hooks";
import { getActivePersonas } from "@/features/agents/lib/catalog";
import { resolvePersonaRuntime } from "@/features/agents/lib/resolvePersonaRuntime";
import { getUsableTeams } from "@/features/agents/lib/teamPersonas";
import { AddChannelBotPersonasSection } from "@/features/channels/ui/AddChannelBotPersonasSection";
import { AddChannelBotTeamsSection } from "@/features/channels/ui/AddChannelBotTeamsSection";
import { useInChannelPersonaIds } from "@/features/channels/ui/useInChannelPersonaIds";
import type { AcpRuntime } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { SearchGlyph } from "./dialogIcons";
import { usePersonaJobTitles } from "@/features/channels/lib/personaJobTitles";

type AddChannelBotDialogProps = {
  channelId: string | null;
  open: boolean;
  providers: AcpRuntime[];
  providersErrorMessage?: string | null;
  providersLoading?: boolean;
  onAdded?: (result: CreateChannelManagedAgentResult) => void;
  onCreateAgent: () => void;
  onOpenChange: (open: boolean) => void;
};

function toggleValue(values: readonly string[], value: string) {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function formatAgentCountLabel(count: number) {
  return count === 1 ? "agent" : "agents";
}

function formatBatchFailureSummary(
  failures: ReadonlyArray<{ name: string; error: string }>,
) {
  if (failures.length === 1) {
    const [failure] = failures;
    return `Failed to add ${failure.name}: ${failure.error}`;
  }

  return failures
    .map((failure) => `${failure.name}: ${failure.error}`)
    .join("; ");
}

export function AddChannelBotDialog({
  channelId,
  open,
  providers,
  providersErrorMessage,
  providersLoading = false,
  onAdded,
  onCreateAgent,
  onOpenChange,
}: AddChannelBotDialogProps) {
  const personasQuery = usePersonasQuery();
  const teamsQuery = useTeamsQuery();
  const inChannelPersonaIds = useInChannelPersonaIds(
    channelId,
    open && channelId !== null,
  );
  const createBotsMutation = useCreateChannelManagedAgentsMutation(channelId);
  const jobTitleByPersonaId = usePersonaJobTitles(open);
  const [agentQuery, setAgentQuery] = React.useState("");
  const normalizedAgentQuery = agentQuery.trim().toLowerCase();
  const personas = React.useMemo(
    () => getActivePersonas(personasQuery.data ?? []),
    [personasQuery.data],
  );
  const teams = React.useMemo(
    () => getUsableTeams(teamsQuery.data ?? [], personas),
    [personas, teamsQuery.data],
  );
  const [selectedPersonaIds, setSelectedPersonaIds] = React.useState<string[]>(
    [],
  );
  const [submissionNotice, setSubmissionNotice] = React.useState<string | null>(
    null,
  );
  const [submissionError, setSubmissionError] = React.useState<string | null>(
    null,
  );

  const selectedPersonas = React.useMemo(
    () => personas.filter((persona) => selectedPersonaIds.includes(persona.id)),
    [personas, selectedPersonaIds],
  );

  React.useEffect(() => {
    setSelectedPersonaIds((current) =>
      current.filter(
        (id) =>
          personas.some((persona) => persona.id === id) &&
          !inChannelPersonaIds.has(id),
      ),
    );
  }, [inChannelPersonaIds, personas]);

  function reset() {
    setAgentQuery("");
    setSelectedPersonaIds([]);
    setSubmissionNotice(null);
    setSubmissionError(null);
    createBotsMutation.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleCreateAgent() {
    handleOpenChange(false);
    onCreateAgent();
  }

  function handleToggleTeam(personaIds: string[]) {
    const addableIds = personaIds.filter(
      (personaId) => !inChannelPersonaIds.has(personaId),
    );
    setSelectedPersonaIds((current) => {
      const allSelected = addableIds.every((id) => current.includes(id));
      if (allSelected) {
        return current.filter((id) => !addableIds.includes(id));
      }
      return [...new Set([...current, ...addableIds])];
    });
    setSubmissionNotice(null);
    setSubmissionError(null);
  }

  async function handleSubmit() {
    if (providers.length === 0 || selectedPersonas.length === 0) return;

    const inputs = selectedPersonas.map((persona) => {
      const resolved = resolvePersonaRuntime(
        persona.runtime,
        providers,
        providers[0] ?? null,
        false,
      );
      return {
        runtime: resolved.runtime ?? providers[0],
        name: persona.displayName,
        personaId: persona.id,
        harnessOverride: false,
        systemPrompt: persona.systemPrompt,
        avatarUrl: persona.avatarUrl ?? undefined,
        model: persona.model ?? undefined,
        role: "bot" as const,
        backend: { type: "local" as const },
      };
    });

    setSubmissionNotice(null);
    setSubmissionError(null);

    try {
      const result = await createBotsMutation.mutateAsync(inputs);
      if (result.failures.length === 0) {
        if (result.successes[0]) onAdded?.(result.successes[0]);
        handleOpenChange(false);
        return;
      }

      const failedPersonaIds = new Set(
        result.failures
          .map((failure) => failure.personaId)
          .filter((personaId): personaId is string => Boolean(personaId)),
      );
      setSelectedPersonaIds((current) =>
        current.filter((personaId) => failedPersonaIds.has(personaId)),
      );
      if (result.successes.length > 0) {
        setSubmissionNotice(
          `Added ${result.successes.length} ${formatAgentCountLabel(
            result.successes.length,
          )}.`,
        );
      }
      setSubmissionError(formatBatchFailureSummary(result.failures));
    } catch {
      // The mutation error is rendered inline.
    }
  }

  const canSubmit =
    providers.length > 0 &&
    selectedPersonas.length > 0 &&
    !providersLoading &&
    !createBotsMutation.isPending;
  const addButtonLabel = createBotsMutation.isPending
    ? selectedPersonas.length > 1
      ? `Adding ${selectedPersonas.length}…`
      : "Adding…"
    : selectedPersonas.length > 1
      ? `Add ${selectedPersonas.length} agents`
      : "Add agent";

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100vh-2rem)] max-w-[500px] flex-col gap-4 overflow-hidden"
        data-testid="add-channel-bot-dialog"
        showCloseButton={false}
      >
        <div
          className="flex shrink-0 flex-col gap-1.5"
          data-testid="add-channel-bot-dialog-header"
        >
          <DialogTitle className="tracking-[-0.025em] leading-[normal]">
            Add agents
          </DialogTitle>
          <DialogDescription className="text-control font-medium text-colony-fg-secondary">
            Choose from your agents, or create a new one.
          </DialogDescription>
        </div>

        <label
          className="flex h-11.5 shrink-0 cursor-text items-center gap-2.5 rounded-colony-control-lg border border-colony-border-strong bg-colony-pop px-3.5 text-colony-muted transition-colors focus-within:border-colony-accent"
          htmlFor="add-channel-bot-search"
        >
          <SearchGlyph className="shrink-0" size={18} strokeWidth={2.2} />
          <input
            aria-label="Find an agent"
            autoComplete="off"
            className="block h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-colony-fg shadow-none outline-hidden placeholder:text-[#757575]"
            data-testid="add-channel-bot-search"
            id="add-channel-bot-search"
            onChange={(event) => setAgentQuery(event.target.value)}
            placeholder="Find an agent"
            type="search"
            value={agentQuery}
          />
        </label>

        <div
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
          data-testid="add-channel-bot-dialog-scroll-area"
        >
          <AddChannelBotPersonasSection
            canToggleSelections={!createBotsMutation.isPending}
            inChannelPersonaIds={inChannelPersonaIds}
            isLoading={personasQuery.isLoading}
            jobTitleByPersonaId={jobTitleByPersonaId}
            onTogglePersona={(personaId) => {
              setSelectedPersonaIds((current) =>
                toggleValue(current, personaId),
              );
              setSubmissionNotice(null);
              setSubmissionError(null);
            }}
            personas={personas}
            query={normalizedAgentQuery}
            selectedPersonaIds={selectedPersonaIds}
          />

          {teams.length > 0 ? (
            <AddChannelBotTeamsSection
              canToggleSelections={!createBotsMutation.isPending}
              inChannelPersonaIds={inChannelPersonaIds}
              isLoading={teamsQuery.isLoading}
              onToggleTeam={handleToggleTeam}
              personas={personas}
              query={normalizedAgentQuery}
              selectedPersonaIds={selectedPersonaIds}
              teams={teams}
            />
          ) : null}

          {providers.length === 0 && !providersLoading ? (
            <div className="flex gap-3 rounded-colony-chip bg-colony-need-bg px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-colony-need" />
              <p className="text-xs font-semibold text-colony-need">
                Install an agent runtime before adding an agent to this channel.
              </p>
            </div>
          ) : null}

          {[
            providersErrorMessage,
            personasQuery.error instanceof Error
              ? personasQuery.error.message
              : null,
            submissionError,
            createBotsMutation.error instanceof Error
              ? createBotsMutation.error.message
              : null,
          ]
            .filter((message): message is string => Boolean(message))
            .map((message) => (
              <p
                className="rounded-colony-chip bg-colony-danger-bg px-4 py-3 text-xs font-semibold text-colony-danger"
                key={message}
              >
                {message}
              </p>
            ))}
          {submissionNotice ? (
            <p className="rounded-colony-chip bg-colony-track px-4 py-3 text-xs font-semibold text-colony-fg">
              {submissionNotice}
            </p>
          ) : null}
        </div>

        <div
          className="mt-1 flex shrink-0 items-center gap-2.5"
          data-testid="add-channel-bot-dialog-footer"
        >
          <button
            className="text-menu font-bold text-colony-accent-ink underline underline-offset-2 hover:text-colony-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
            data-testid="add-channel-create-agent"
            onClick={handleCreateAgent}
            type="button"
          >
            Create an agent
          </button>
          <span className="flex-1" />
          <Button
            className="h-11.5 px-4.5 text-sm"
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className="h-11.5 px-5 text-sm"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            type="button"
            variant="agent"
          >
            {addButtonLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
