import * as React from "react";
import type { ReactNode } from "react";

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
  "h-[42px] w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CompanyRoleFields({
  disabled,
  draft,
  displayName,
  footer,
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
  footer?: ReactNode;
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
  const preserveSavedWorkerMenu =
    draft.workerMenu.length > 1 ||
    (draft.workerMenu.length === 1 &&
      !availableRuntimes.some((runtime) => runtime.id === draft.workerMenu[0]));
  const savedWorkerMenuValue = "__saved_worker_menu__";
  const workerMenuValue =
    draft.workerMenu.length === 0
      ? ""
      : preserveSavedWorkerMenu
        ? savedWorkerMenuValue
        : draft.workerMenu[0];
  const savedWorkerMenuLabel = draft.workerMenu
    .map(
      (runtimeId) =>
        runtimes.find((runtime) => runtime.id === runtimeId)?.label ??
        runtimeId,
    )
    .join(", ");
  const savedToolScopeValue = "__saved_tool_scope__";
  const savedToolScopeLabel = draft.tools
    .map((tool) => `${tool.name} (${tool.risk})`)
    .join(", ");
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

  return (
    <section
      aria-label="Role pack editor"
      className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,1fr)]"
      data-testid="company-role-editor"
    >
      <div className="grid content-start gap-5 rounded-lg border border-border bg-card p-6">
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
            className="h-[42px]"
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
            className="min-h-[104px]"
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
            className="min-h-[104px]"
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

        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-role-tool-scope"
        >
          Tool scope
          <select
            className={CONTROL_CLASS}
            disabled
            id="company-role-tool-scope"
            value={draft.tools.length > 0 ? savedToolScopeValue : ""}
          >
            <option value="">Choose tool scope</option>
            {draft.tools.length > 0 ? (
              <option value={savedToolScopeValue}>
                Saved scope: {savedToolScopeLabel}
              </option>
            ) : null}
          </select>
        </label>

        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-role-worker-model"
        >
          Allowed worker model
          <select
            className={CONTROL_CLASS}
            disabled={disabled || availableRuntimes.length === 0}
            id="company-role-worker-model"
            onChange={(event) =>
              onDraftChange({
                ...draft,
                workerMenu: event.target.value ? [event.target.value] : [],
              })
            }
            value={workerMenuValue}
          >
            <option value="">Choose worker model</option>
            {preserveSavedWorkerMenu ? (
              <option disabled value={savedWorkerMenuValue}>
                Saved choices: {savedWorkerMenuLabel}
              </option>
            ) : null}
            {availableRuntimes.map((runtime) => (
              <option key={runtime.id} value={runtime.id}>
                {runtime.label}
              </option>
            ))}
          </select>
        </label>
        <p className="pt-3 text-xs text-muted-foreground">
          {draft.tools.length === 0 && draft.workerMenu.length === 0
            ? "No model, tool or allowance is preselected. The real picker is populated by configured runtimes."
            : "Existing role choices are retained. Available worker models come from configured runtimes."}
        </p>
        {footer ? (
          <div className="border-t border-border pt-4">{footer}</div>
        ) : null}
      </div>

      <aside className="grid content-start gap-4 self-start rounded-lg border border-border bg-card p-6">
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
            className="px-2 text-xs"
            disabled={disabled}
            onClick={onOpenRuntimeSettings}
            type="button"
            variant="outline"
          >
            Set up a runtime
          </Button>
          <Button
            className="px-2 text-xs"
            disabled={disabled}
            onClick={onOpenConnections}
            type="button"
            variant="outline"
          >
            Connect a provider
          </Button>
          <Button
            className="px-2 text-xs"
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
