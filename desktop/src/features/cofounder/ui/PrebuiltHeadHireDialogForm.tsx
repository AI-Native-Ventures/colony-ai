import * as React from "react";
import { Link } from "@tanstack/react-router";

import {
  AgentDropdownSelect,
  type AgentDropdownOption,
} from "@/features/agents/ui/agentConfigControls";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { WorkerModelProbe } from "@/features/company-hiring/ui/hireConfigureModels";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

import type { FunctionId } from "../cofounderRecords";
import { FUNCTION_DETAILS } from "../functions";
import { prebuiltAgentAvatarDataUrl } from "../prebuiltAgentAvatar";
import type { PrebuiltAgent } from "../prebuiltAgents";

type Choice = {
  effortLevel: string;
  modelId: string;
  providerId: string;
  runtimeId: string;
};

type PrebuiltHeadHireDialogFormProps = {
  agent: PrebuiltAgent;
  canUndoUnapprovedHire: boolean;
  choice: Choice;
  effortChoiceOptions: readonly AgentDropdownOption[];
  effortRequired: boolean;
  functionId: FunctionId;
  hasModelChoicesForSelectedRuntime: boolean;
  hasSavedChoice: boolean;
  hasValidChannels: boolean;
  inheritedEnvVars: Record<string, string>;
  inheritedProvider: string;
  isOwner: boolean;
  modelRequired: boolean;
  onEffortChange: (effortLevel: string) => void;
  onModelChange: (modelId: string) => void;
  onOpenChange: (open: boolean) => void;
  onOptions: (
    runtimeId: string,
    providerId: string,
    options: readonly { id: string; label: string }[] | null,
  ) => void;
  onRetry: () => void;
  onRuntimeChange: (runtimeId: string) => void;
  onUndoUnapprovedHire: () => void;
  recoveryState: "idle" | "checking" | "ready" | "employee_removed" | "failed";
  requiresEffort: boolean;
  retryingAutoFinish: boolean;
  runtimeOptions: readonly AgentDropdownOption[];
  runtimes: readonly AcpRuntimeCatalogEntry[];
  runtimesQueryIsPending: boolean;
  selectedModelLabel: string | undefined;
  selectedModelOptions: readonly AgentDropdownOption[];
  selectedRuntime: AcpRuntimeCatalogEntry | undefined;
  selectionReady: boolean;
  submitting: boolean;
  failure: string | null;
  hasSelectedModel: boolean;
};

function choiceKey(runtimeId: string, providerId: string) {
  return JSON.stringify([runtimeId, providerId]);
}

function providerForRuntime(
  runtime: AcpRuntimeCatalogEntry,
  inheritedProvider: string,
) {
  return runtime.providerEnvVar ? inheritedProvider : "";
}

function choiceFieldClassName({
  required,
  value,
}: {
  required: boolean;
  value: string;
}) {
  const needsChoice = required && !value;
  return [
    "h-[2.875rem] min-w-0 max-w-full rounded-xl border-2 px-3 text-sm font-medium",
    needsChoice
      ? "border-primary focus-visible:ring-primary/35"
      : "border-input",
  ].join(" ");
}

export function PrebuiltHeadHireDialogForm({
  agent,
  canUndoUnapprovedHire,
  choice,
  effortChoiceOptions,
  effortRequired,
  failure,
  functionId,
  hasModelChoicesForSelectedRuntime,
  hasSelectedModel,
  hasSavedChoice,
  hasValidChannels,
  inheritedEnvVars,
  inheritedProvider,
  isOwner,
  modelRequired,
  onEffortChange,
  onModelChange,
  onOpenChange,
  onOptions,
  onRetry,
  onRuntimeChange,
  onUndoUnapprovedHire,
  recoveryState,
  requiresEffort,
  retryingAutoFinish,
  runtimeOptions,
  runtimes,
  runtimesQueryIsPending,
  selectedModelLabel,
  selectedModelOptions,
  selectedRuntime,
  selectionReady,
  submitting,
}: PrebuiltHeadHireDialogFormProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        aria-describedby="prebuilt-hire-description"
        className="max-w-[37.5rem]"
        data-testid="prebuilt-head-hire-dialog"
      >
        <div className="pr-8">
          <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            Hire for {FUNCTION_DETAILS[functionId].name}
          </p>
          <DialogTitle className="mt-1">{agent.name}</DialogTitle>
          <DialogDescription id="prebuilt-hire-description">
            Scout hands {FUNCTION_DETAILS[functionId].name} over the moment you
            hire.
          </DialogDescription>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
          <EmployeeAvatar
            className="size-11 rounded-full"
            instance={prebuiltAgentAvatarDataUrl(agent)}
            name={agent.name}
            role={`Head of ${FUNCTION_DETAILS[functionId].name}`}
          />
          <div>
            <p className="text-sm font-extrabold">{agent.name}</p>
            <p className="text-xs text-muted-foreground">Pre-built agent.</p>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-muted/30 p-4">
          <div>
            <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
              What it does
            </p>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
              {agent.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
              What it asks of you
            </p>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
              {agent.asks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        {runtimes.map((runtime) => (
          <WorkerModelProbe
            envVars={inheritedEnvVars}
            key={choiceKey(
              runtime.id,
              providerForRuntime(runtime, inheritedProvider),
            )}
            onOptions={onOptions}
            providerId={providerForRuntime(runtime, inheritedProvider)}
            runtime={runtime}
          />
        ))}

        <div className="grid gap-4 sm:grid-cols-3">
          <label
            className="grid min-w-0 gap-1.5 text-sm font-bold"
            htmlFor="prebuilt-hire-harness"
          >
            Harness
            <AgentDropdownSelect
              className={choiceFieldClassName({
                required: runtimes.length > 0,
                value: choice.runtimeId,
              })}
              disabled={submitting || runtimes.length === 0}
              id="prebuilt-hire-harness"
              onValueChange={onRuntimeChange}
              options={runtimeOptions}
              placeholder="Choose a harness"
              placeholderValue=""
              testId="prebuilt-hire-harness"
              value={choice.runtimeId}
            />
          </label>
          <label
            className="grid min-w-0 gap-1.5 text-sm font-bold"
            htmlFor="prebuilt-hire-model"
          >
            Model
            <AgentDropdownSelect
              className={choiceFieldClassName({
                required: modelRequired,
                value: choice.modelId,
              })}
              disabled={submitting || !selectedRuntime}
              id="prebuilt-hire-model"
              onValueChange={onModelChange}
              options={selectedModelOptions}
              placeholder="Choose a model"
              placeholderValue=""
              selectedLabel={
                selectedModelLabel ? (
                  <span className="block truncate" title={selectedModelLabel}>
                    {selectedModelLabel}
                  </span>
                ) : undefined
              }
              testId="prebuilt-hire-model"
              value={choice.modelId}
            />
          </label>
          <label
            className="grid min-w-0 gap-1.5 text-sm font-bold"
            htmlFor="prebuilt-hire-effort"
          >
            Effort
            <AgentDropdownSelect
              className={choiceFieldClassName({
                required: effortRequired,
                value: choice.effortLevel,
              })}
              disabled={submitting || !hasSelectedModel || !requiresEffort}
              id="prebuilt-hire-effort"
              onValueChange={onEffortChange}
              options={effortChoiceOptions}
              placeholder={
                requiresEffort ? "Choose effort" : "Set by this harness"
              }
              placeholderValue=""
              testId="prebuilt-hire-effort"
              value={choice.effortLevel}
            />
          </label>
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="prebuilt-hire-choice-helper"
        >
          {hasSavedChoice
            ? "Same as your last hire. Change any of them."
            : "This is your first hire, so pick all three. Next time Colony shows what you picked here."}
        </p>
        {runtimesQueryIsPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Checking which AI is ready on this Mac.
          </p>
        ) : null}
        {recoveryState === "checking" ? (
          <p className="text-sm text-muted-foreground" role="status">
            Checking for an unfinished hire before starting a new one.
          </p>
        ) : null}
        {recoveryState === "employee_removed" ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="prebuilt-hire-employee-removed"
            role="status"
          >
            The {agent.name} from your earlier hire was removed from this Mac.
          </p>
        ) : null}
        {!runtimesQueryIsPending && runtimes.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            No AI is ready on this Mac.{" "}
            <Link className="underline" to="/settings">
              Open Settings
            </Link>{" "}
            to connect a harness.
          </p>
        ) : null}
        {selectedRuntime && !hasModelChoicesForSelectedRuntime ? (
          <p className="text-sm text-muted-foreground" role="status">
            This harness has not reported a model yet. Check its sign-in and
            model settings, then choose again.
          </p>
        ) : null}

        {!hasValidChannels ? (
          <p className="text-sm text-muted-foreground">
            There is no company chat to start this hire in. Join one first.
          </p>
        ) : null}

        {failure ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
            role="alert"
          >
            <p>{failure}</p>
            {canUndoUnapprovedHire ? (
              <button
                className="mt-2 font-bold underline"
                disabled={submitting}
                onClick={onUndoUnapprovedHire}
                type="button"
              >
                Undo unapproved hire
              </button>
            ) : null}
          </div>
        ) : null}
        {!isOwner ? (
          <p className="text-sm text-muted-foreground">
            Only the company owner can finish this hire.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {!selectionReady ? (
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              {recoveryState === "checking"
                ? "Checking for an unfinished hire."
                : selectedRuntime && !hasSelectedModel
                  ? "Choose a model before hiring. Colony will not create an agent without one."
                  : "Pick all three to hire."}
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted disabled:opacity-50"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="prebuilt-hire-finish"
              disabled={!selectionReady || !isOwner || submitting}
              onClick={onRetry}
              type="button"
            >
              {submitting
                ? `Hiring ${agent.name}`
                : recoveryState === "employee_removed"
                  ? `Hire ${agent.name} again`
                  : retryingAutoFinish
                    ? `Retry ${agent.name}`
                    : `Hire ${agent.name}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
