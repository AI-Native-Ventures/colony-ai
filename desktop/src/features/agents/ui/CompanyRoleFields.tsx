import * as React from "react";

import type {
  AcpRuntimeCatalogEntry,
  CompanyRoleMetadata,
  CompanyRoleTool,
} from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

export type CompanyRoleToolDraft = {
  id: string;
  name: string;
  risk: CompanyRoleTool["risk"] | "";
};

export type CompanyRoleDraft = {
  job: string;
  skills: string;
  tools: CompanyRoleToolDraft[];
  workerMenu: string[];
};

export function companyRoleDraftFromMetadata(
  metadata: CompanyRoleMetadata | null | undefined,
): CompanyRoleDraft {
  return {
    job: metadata?.job ?? "",
    skills: metadata?.skills.join("\n") ?? "",
    tools: (metadata?.tools ?? []).map((tool) => ({
      id: crypto.randomUUID(),
      name: tool.name,
      risk: tool.risk,
    })),
    workerMenu: [...(metadata?.workerMenu ?? [])],
  };
}

export function companyRoleDraftIsValid(draft: CompanyRoleDraft) {
  const skills = draft.skills
    .split("\n")
    .map((skill) => skill.trim())
    .filter(Boolean);
  const toolNames = draft.tools.map((tool) => tool.name.trim().toLowerCase());
  const workerMenu = [...new Set(draft.workerMenu)];
  return (
    draft.job.trim().length > 0 &&
    draft.job.trim().length <= 2_000 &&
    skills.length > 0 &&
    skills.length <= 32 &&
    skills.every((skill) => skill.length <= 120) &&
    draft.tools.length <= 64 &&
    draft.tools.every(
      (tool) =>
        tool.name.trim().length > 0 &&
        tool.name.trim().length <= 120 &&
        tool.risk !== "",
    ) &&
    new Set(toolNames).size === toolNames.length &&
    workerMenu.length > 0 &&
    workerMenu.length <= 32 &&
    workerMenu.every(
      (runtimeId) =>
        runtimeId.trim().length > 0 && runtimeId.trim().length <= 120,
    )
  );
}

export function companyRoleMetadataFromDraft(
  draft: CompanyRoleDraft,
  defaultAllowance: string | null | undefined,
): CompanyRoleMetadata {
  return {
    job: draft.job.trim(),
    skills: draft.skills
      .split("\n")
      .map((skill) => skill.trim())
      .filter(Boolean),
    tools: draft.tools.map((tool) => ({
      name: tool.name.trim(),
      risk: tool.risk as CompanyRoleTool["risk"],
    })),
    workerMenu: [...new Set(draft.workerMenu)],
    defaultAllowance: defaultAllowance ?? null,
  };
}

const CONTROL_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CompanyRoleFields({
  disabled,
  draft,
  displayName,
  saveError = false,
  onDisplayNameChange,
  onDraftChange,
  onOpenRuntimeSettings,
  onOpenConnections,
  onOpenRecovery,
  suppressRecovery = false,
  onRefreshModels,
  runtimes,
  currentRuntimeId,
  providerMissing,
  modelStatus,
  modelDiscoverySuccessfulEmpty,
}: {
  disabled: boolean;
  draft: CompanyRoleDraft;
  displayName: string;
  saveError?: boolean;
  onDisplayNameChange: (value: string) => void;
  onDraftChange: (next: CompanyRoleDraft) => void;
  onOpenRuntimeSettings: () => void;
  onOpenConnections: () => void;
  onOpenRecovery: (kind: "runtime" | "provider" | "model") => void;
  suppressRecovery?: boolean;
  onRefreshModels: () => void;
  runtimes: readonly AcpRuntimeCatalogEntry[];
  currentRuntimeId: string;
  providerMissing: boolean;
  modelStatus: string | null;
  modelDiscoverySuccessfulEmpty: boolean;
}) {
  const availableRuntimes = runtimes.filter(
    (runtime) => runtime.availability === "available",
  );
  const unavailableSelections = draft.workerMenu.filter(
    (runtimeId) =>
      !availableRuntimes.some((runtime) => runtime.id === runtimeId),
  );
  const recoveryKind =
    availableRuntimes.length === 0
      ? "runtime"
      : providerMissing && draft.workerMenu.includes(currentRuntimeId)
        ? "provider"
        : modelDiscoverySuccessfulEmpty &&
            draft.workerMenu.includes(currentRuntimeId)
          ? "model"
          : null;
  React.useEffect(() => {
    if (recoveryKind && !suppressRecovery) onOpenRecovery(recoveryKind);
  }, [onOpenRecovery, recoveryKind, suppressRecovery]);

  if (recoveryKind && !suppressRecovery) return null;

  const toggleRuntime = (runtimeId: string, checked: boolean) => {
    const workerMenu = checked
      ? [...new Set([...draft.workerMenu, runtimeId])]
      : draft.workerMenu.filter((selected) => selected !== runtimeId);
    onDraftChange({ ...draft, workerMenu });
  };

  return (
    <section
      aria-label="Role pack editor"
      className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)]"
      data-testid="company-role-editor"
    >
      <div className="grid content-start gap-5 rounded-lg border border-border bg-card p-5">
        {saveError ? (
          <div
            className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3"
            data-testid="company-role-save-error"
            role="alert"
          >
            <strong className="text-sm font-medium text-destructive">
              Could not save
            </strong>
            <p className="text-sm text-destructive">
              Your inputs are kept. Review them or retry without starting again.
            </p>
          </div>
        ) : null}
        <h2 className="text-base font-semibold text-foreground">
          Edit a role pack
        </h2>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-role-title"
        >
          Role title
          <Input
            disabled={disabled}
            id="company-role-title"
            maxLength={180}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            required
            value={displayName}
          />
        </label>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-role-job"
        >
          Job description
          <Textarea
            disabled={disabled}
            id="company-role-job"
            maxLength={2000}
            onChange={(event) =>
              onDraftChange({ ...draft, job: event.target.value })
            }
            required
            rows={3}
            value={draft.job}
          />
        </label>

        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-role-skills"
        >
          Skills, one per line
          <Textarea
            disabled={disabled}
            id="company-role-skills"
            maxLength={4000}
            onChange={(event) =>
              onDraftChange({ ...draft, skills: event.target.value })
            }
            required
            rows={3}
            value={draft.skills}
          />
        </label>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium text-foreground">
            Tool scope
          </legend>
          {draft.tools.map((tool, index) => (
            <div
              className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
              key={tool.id}
            >
              <label
                className="grid gap-1.5 text-sm"
                htmlFor={`company-role-tool-${index}`}
              >
                Tool name
                <Input
                  disabled={disabled}
                  id={`company-role-tool-${index}`}
                  maxLength={120}
                  onChange={(event) => {
                    const tools = draft.tools.map((current, itemIndex) =>
                      itemIndex === index
                        ? { ...current, name: event.target.value }
                        : current,
                    );
                    onDraftChange({ ...draft, tools });
                  }}
                  value={tool.name}
                />
              </label>
              <label
                className="grid gap-1.5 text-sm"
                htmlFor={`company-role-risk-${index}`}
              >
                Risk label
                <select
                  className={CONTROL_CLASS}
                  disabled={disabled}
                  id={`company-role-risk-${index}`}
                  onChange={(event) => {
                    const risk = event.target
                      .value as CompanyRoleToolDraft["risk"];
                    const tools = draft.tools.map((current, itemIndex) =>
                      itemIndex === index ? { ...current, risk } : current,
                    );
                    onDraftChange({ ...draft, tools });
                  }}
                  required
                  value={tool.risk}
                >
                  <option value="">Choose risk</option>
                  <option value="low">Read</option>
                  <option value="medium">Changes data</option>
                  <option value="high">External action</option>
                </select>
              </label>
              <Button
                aria-label={`Remove tool ${index + 1}`}
                className="self-end"
                disabled={disabled}
                onClick={() =>
                  onDraftChange({
                    ...draft,
                    tools: draft.tools.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
                type="button"
                variant="outline"
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            className="w-fit"
            disabled={disabled || draft.tools.length >= 64}
            onClick={() =>
              onDraftChange({
                ...draft,
                tools: [
                  ...draft.tools,
                  { id: crypto.randomUUID(), name: "", risk: "" },
                ],
              })
            }
            type="button"
            variant="outline"
          >
            Add tool
          </Button>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium text-foreground">
            Allowed worker model
          </legend>
          <div className="grid gap-2">
            {unavailableSelections.map((runtimeId) => (
              <label
                className="flex items-center gap-2 text-sm text-muted-foreground"
                key={runtimeId}
              >
                <input
                  checked
                  disabled={disabled}
                  onChange={(event) =>
                    toggleRuntime(runtimeId, event.target.checked)
                  }
                  type="checkbox"
                />
                {runtimes.find((runtime) => runtime.id === runtimeId)?.label ??
                  "Unavailable configured runtime"}
              </label>
            ))}
            {availableRuntimes.map((runtime) => (
              <label
                className="flex items-center gap-2 text-sm text-foreground"
                key={runtime.id}
              >
                <input
                  checked={draft.workerMenu.includes(runtime.id)}
                  disabled={disabled}
                  onChange={(event) =>
                    toggleRuntime(runtime.id, event.target.checked)
                  }
                  type="checkbox"
                />
                {runtime.label}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          No model, tool or allowance is preselected. The real picker is
          populated by configured runtimes.
        </p>
      </div>

      <aside className="grid content-start gap-4 rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">
          Review tool risk
        </h2>
        <dl className="grid gap-3 text-sm">
          <div className="border-b border-border pb-3">
            <dt className="font-medium text-foreground">Read</dt>
            <dd className="mt-1 text-muted-foreground">
              Access only the approved sources.
            </dd>
          </div>
          <div className="border-b border-border pb-3">
            <dt className="font-medium text-foreground">Changes data</dt>
            <dd className="mt-1 text-muted-foreground">
              Scope the folder and allowed operations.
            </dd>
          </div>
          <div className="border-b border-border pb-3">
            <dt className="font-medium text-foreground">External action</dt>
            <dd className="mt-1 text-muted-foreground">
              Publishing, sending, spending and deleting need recorded consent.
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            disabled={disabled}
            onClick={onOpenRuntimeSettings}
            type="button"
            variant="outline"
          >
            Set up a runtime
          </Button>
          <Button
            disabled={disabled}
            onClick={onOpenConnections}
            type="button"
            variant="outline"
          >
            Connect a provider
          </Button>
          <Button
            disabled={disabled}
            onClick={onRefreshModels}
            type="button"
            variant="outline"
          >
            Refresh model list
          </Button>
        </div>
        {modelStatus && !modelDiscoverySuccessfulEmpty ? (
          <p className="text-sm text-muted-foreground" role="status">
            {modelStatus}
          </p>
        ) : null}
      </aside>
    </section>
  );
}
