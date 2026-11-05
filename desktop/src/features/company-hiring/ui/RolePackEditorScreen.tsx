import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useAcpRuntimesQuery,
  useCreatePersonaMutation,
  usePersonasQuery,
  useUpdatePersonaMutation,
} from "@/features/agents/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import type { CompanyRoleMetadata, CompanyRoleTool } from "@/shared/api/types";
import {
  HireButton,
  HirePage,
  HireRecovery,
  HireTitle,
} from "./HirePresentation";
import { InfoGlyph, RoleIcon, ToolChip, ToolGlyph } from "./hireTools";

type RolePackDraft = {
  title: string;
  job: string;
  skills: string;
  tools: string;
  workerMenu: string[];
  allowance: string;
};

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatTools(tools: readonly CompanyRoleTool[]) {
  return tools.map((tool) => `${tool.name} | ${tool.risk}`).join("\n");
}

function parseTools(value: string): CompanyRoleTool[] | null {
  const parsed: CompanyRoleTool[] = [];
  const names = new Set<string>();
  for (const line of lines(value)) {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0]) return null;
    const risk = parts[1];
    if (risk !== "low" && risk !== "medium" && risk !== "high") return null;
    const normalizedName = parts[0].toLocaleLowerCase();
    if (names.has(normalizedName)) return null;
    names.add(normalizedName);
    parsed.push({ name: parts[0], risk });
  }
  return parsed;
}

function draftFor(role: CompanyRoleMetadata | null | undefined): RolePackDraft {
  return {
    title: "",
    job: role?.job ?? "",
    skills: (role?.skills ?? []).join("\n"),
    tools: formatTools(role?.tools ?? []),
    workerMenu: [...(role?.workerMenu ?? [])],
    allowance: role?.defaultAllowance ?? "",
  };
}

function roleSystemPrompt(title: string, job: string) {
  return [
    `You are ${title.trim()}.`,
    job.trim(),
    "Work within the approved role pack. Ask the owner before any external action or decision that needs approval.",
  ].join(" ");
}

function roleInputError(draft: RolePackDraft) {
  const title = draft.title.trim();
  const job = draft.job.trim();
  const skills = lines(draft.skills);
  const tools = parseTools(draft.tools);
  const allowance = draft.allowance.trim();
  if (!title) return "Give this role pack a title.";
  if (!job) return "Describe the work this role will do.";
  if (skills.length > 32 || skills.some((skill) => skill.length > 120)) {
    return "Use up to 32 skills, with no more than 120 characters each.";
  }
  if (tools === null || tools.length > 64) {
    return "Write each tool as name | low, medium, or high, without duplicates.";
  }
  if (draft.workerMenu.length === 0) {
    return "Choose at least one available worker model.";
  }
  if (allowance && !/^\d+(?:\.\d{1,2})?$/.test(allowance)) {
    return "Use a non-negative allowance with no more than two decimal places.";
  }
  return null;
}

function roleMetadata(draft: RolePackDraft): CompanyRoleMetadata | null {
  const tools = parseTools(draft.tools);
  if (tools === null) return null;
  return {
    job: draft.job.trim(),
    skills: lines(draft.skills),
    tools,
    workerMenu: [...draft.workerMenu],
    ...(draft.allowance.trim()
      ? { defaultAllowance: draft.allowance.trim() }
      : {}),
  };
}

export function RolePackEditorScreen({ personaId }: { personaId?: string }) {
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const createPersona = useCreatePersonaMutation();
  const updatePersona = useUpdatePersonaMutation();
  const { goHireRoles } = useAppNavigation();
  const persona = personasQuery.data?.find(
    (candidate) => candidate.id === personaId,
  );
  const [draft, setDraft] = React.useState<RolePackDraft>(() => draftFor(null));
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const seededKey = React.useRef<string | null>(null);
  const availableRuntimes = (runtimesQuery.data ?? []).filter(
    (runtime) => runtime.availability === "available",
  );
  const authorized =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";

  React.useEffect(() => {
    if (personasQuery.isPending || (personaId && !persona)) return;
    const nextKey = persona?.id ?? "new-role-pack";
    if (seededKey.current === nextKey) return;
    seededKey.current = nextKey;
    setDraft({
      ...draftFor(persona?.companyRole),
      title: persona?.displayName ?? "",
    });
    setSubmitError(null);
  }, [persona, personaId, personasQuery.isPending]);

  React.useEffect(() => {
    if (
      persona ||
      draft.workerMenu.length > 0 ||
      availableRuntimes.length === 0
    ) {
      return;
    }
    setDraft((current) => ({
      ...current,
      workerMenu: [availableRuntimes[0].id],
    }));
  }, [availableRuntimes, draft.workerMenu.length, persona]);

  const change = <K extends keyof RolePackDraft>(
    key: K,
    value: RolePackDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const toggleWorker = (runtimeId: string, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      workerMenu: checked
        ? [...current.workerMenu, runtimeId]
        : current.workerMenu.filter((item) => item !== runtimeId),
    }));
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createPersona.isPending || updatePersona.isPending) return;
    const error = roleInputError(draft);
    const companyRole = roleMetadata(draft);
    if (error || !companyRole) {
      setSubmitError(error ?? "Check the role pack details and try again.");
      return;
    }
    setSubmitError(null);
    try {
      const input = {
        displayName: draft.title.trim(),
        avatarUrl: persona?.avatarUrl ?? undefined,
        description: persona?.description ?? draft.job.trim().slice(0, 280),
        companyRole,
        systemPrompt:
          persona?.systemPrompt ?? roleSystemPrompt(draft.title, draft.job),
        runtime:
          persona?.runtime && companyRole.workerMenu.includes(persona.runtime)
            ? persona.runtime
            : companyRole.workerMenu[0],
        model: persona?.model ?? undefined,
        provider: persona?.provider ?? undefined,
        namePool: persona?.namePool ?? [],
        envVars: persona?.envVars,
      };
      if (persona) {
        await updatePersona.mutateAsync({ ...input, id: persona.id });
      } else {
        await createPersona.mutateAsync(input);
      }
      await goHireRoles();
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : "The role pack could not be saved. Your changes are still here.",
      );
    }
  };

  if (
    personasQuery.isPending ||
    runtimesQuery.isPending ||
    membershipQuery.isPending
  ) {
    return (
      <HirePage testId="hire-role-pack-editor">
        <HireTitle
          subtitle="Define the job, skills, scoped tools and allowed worker menu."
          title={personaId ? "Edit a role pack" : "Create a role pack"}
        />
        <section
          aria-label="Loading role pack editor"
          className="colony-hire-loading"
        >
          <div className="colony-hire-banner" role="status">
            Loading the role pack editor.
          </div>
          <div aria-hidden="true" className="colony-hire-skeleton" />
        </section>
      </HirePage>
    );
  }

  if (
    personasQuery.isError ||
    runtimesQuery.isError ||
    membershipQuery.isError ||
    (personaId && !persona)
  ) {
    const missing = Boolean(personaId && !persona);
    return (
      <HirePage testId="hire-role-pack-editor">
        <HireTitle
          subtitle="Define the job, skills, scoped tools and allowed worker menu."
          title={personaId ? "Edit a role pack" : "Create a role pack"}
        />
        <HireRecovery
          action={
            <div className="colony-hire-state-actions">
              {!missing ? (
                <HireButton
                  onClick={() => {
                    void Promise.all([
                      personasQuery.refetch(),
                      runtimesQuery.refetch(),
                      membershipQuery.refetch(),
                    ]);
                  }}
                  size="md"
                >
                  Try again
                </HireButton>
              ) : null}
              <HireButton
                onClick={() => void goHireRoles()}
                size="md"
                variant="outline"
              >
                Back to role catalog
              </HireButton>
            </div>
          }
          title={
            missing
              ? "This role pack could not be loaded"
              : "This information could not load"
          }
        >
          {missing
            ? "The role pack is no longer in this catalog. Go back and choose another role."
            : "A connection failure is not an empty role pack. Try again before making changes."}
        </HireRecovery>
      </HirePage>
    );
  }

  if (!authorized) {
    return (
      <HirePage testId="hire-role-pack-editor">
        <HireTitle
          subtitle="Define the job, skills, scoped tools and allowed worker menu."
          title={personaId ? "Edit a role pack" : "Create a role pack"}
        />
        <HireRecovery
          action={
            <HireButton
              onClick={() => void goHireRoles()}
              size="md"
              variant="outline"
            >
              Back to role catalog
            </HireButton>
          }
          title="You do not have permission for this action"
        >
          Your view access is unchanged. An owner or admin can create and edit
          role packs.
        </HireRecovery>
      </HirePage>
    );
  }

  const parsedTools = parseTools(draft.tools) ?? [];
  const runtimeChoices = (runtimesQuery.data ?? []).filter(
    (runtime) =>
      runtime.availability === "available" ||
      draft.workerMenu.includes(runtime.id),
  );
  const saving = createPersona.isPending || updatePersona.isPending;
  const isEdit = Boolean(persona);

  return (
    <HirePage testId="hire-role-pack-editor">
      <div className="colony-hire-role-editor-heading">
        <span className="colony-hire-icon-tile" data-active="true">
          <RoleIcon
            job={draft.job || "Role pack"}
            size={24}
            title={draft.title || "Role pack"}
          />
        </span>
        <HireTitle
          subtitle="Define the job, skills, scoped tools and allowed worker menu."
          title={isEdit ? "Edit a role pack" : "Create a role pack"}
        />
      </div>
      <section aria-label="Role pack editor" className="colony-hire-columns">
        <form
          className="colony-hire-card colony-hire-role-editor-form"
          onSubmit={save}
        >
          <label
            className="colony-hire-role-editor-field"
            htmlFor="role-pack-title"
          >
            Role title
            <input
              autoComplete="off"
              className="colony-hire-input"
              data-testid="role-pack-title"
              id="role-pack-title"
              maxLength={180}
              onChange={(event) => change("title", event.target.value)}
              required
              value={draft.title}
            />
          </label>
          <label
            className="colony-hire-role-editor-field"
            htmlFor="role-pack-job"
          >
            Job description
            <textarea
              className="colony-hire-textarea"
              data-testid="role-pack-job"
              id="role-pack-job"
              maxLength={2000}
              onChange={(event) => change("job", event.target.value)}
              required
              rows={3}
              value={draft.job}
            />
          </label>
          <label
            className="colony-hire-role-editor-field"
            htmlFor="role-pack-skills"
          >
            Skills, one per line
            <textarea
              className="colony-hire-textarea"
              data-testid="role-pack-skills"
              id="role-pack-skills"
              maxLength={4000}
              onChange={(event) => change("skills", event.target.value)}
              rows={3}
              value={draft.skills}
            />
          </label>
          <div className="colony-hire-role-editor-grid">
            <label
              className="colony-hire-role-editor-field"
              htmlFor="role-pack-tools"
            >
              Tool scope
              <small>One tool per line: name | low, medium, or high.</small>
              <textarea
                className="colony-hire-textarea"
                data-testid="role-pack-tools"
                id="role-pack-tools"
                maxLength={8000}
                onChange={(event) => change("tools", event.target.value)}
                rows={3}
                value={draft.tools}
              />
            </label>
            <fieldset className="colony-hire-role-editor-field colony-hire-worker-menu">
              <legend>Allowed worker model</legend>
              {runtimeChoices.length > 0 ? (
                <div>
                  {runtimeChoices.map((runtime) => {
                    const checked = draft.workerMenu.includes(runtime.id);
                    const available = runtime.availability === "available";
                    return (
                      <label data-checked={checked} key={runtime.id}>
                        <input
                          checked={checked}
                          data-testid={`role-pack-worker-${runtime.id}`}
                          disabled={!available && !checked}
                          onChange={(event) =>
                            toggleWorker(runtime.id, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>{runtime.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p>
                  No worker model is available. Set up a runtime before saving
                  this role pack.
                </p>
              )}
            </fieldset>
          </div>
          <label
            className="colony-hire-role-editor-field"
            htmlFor="role-pack-allowance"
          >
            Weekly allowance (USD, API-equivalent)
            <div className="colony-hire-prefixed">
              <span>USD</span>
              <input
                aria-label="Weekly allowance in US dollars"
                data-testid="role-pack-allowance"
                id="role-pack-allowance"
                inputMode="decimal"
                maxLength={24}
                onChange={(event) => change("allowance", event.target.value)}
                placeholder="Set per hire"
                value={draft.allowance}
              />
            </div>
          </label>
          <p className="colony-hire-role-editor-note">
            <InfoGlyph size={16} /> Existing role choices are retained.
            Available worker models come from configured runtimes.
          </p>
          {submitError ? (
            <p
              className="colony-hire-error"
              data-testid="role-pack-save-error"
              role="alert"
            >
              {submitError}
            </p>
          ) : null}
          <div className="colony-hire-role-editor-actions">
            <HireButton
              onClick={() => void goHireRoles()}
              size="xl"
              variant="outline"
            >
              Cancel
            </HireButton>
            <HireButton
              disabled={saving}
              size="xl"
              testId="save-role-pack"
              type="submit"
            >
              {saving ? "Saving role pack…" : "Save role pack"}
            </HireButton>
          </div>
        </form>
        <aside
          aria-labelledby="role-pack-risk-title"
          className="colony-hire-role-risk"
        >
          <h2 id="role-pack-risk-title">Review tool risk</h2>
          {parsedTools.length > 0 ? (
            <dl>
              {parsedTools.map((tool) => (
                <div key={`${tool.name}:${tool.risk}`}>
                  <span data-tone={tool.risk}>
                    <ToolGlyph tool={tool} />
                  </span>
                  <div>
                    <dt>
                      {tool.name} <ToolChip detailed={false} tool={tool} />
                    </dt>
                    <dd>
                      {tool.risk === "low"
                        ? "Access only the approved sources."
                        : tool.risk === "medium"
                          ? "Scope the folder and allowed operations."
                          : "Publishing, sending, spending and deleting need recorded consent."}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
          ) : (
            <p>Add each approved tool and its risk level before saving.</p>
          )}
        </aside>
      </section>
    </HirePage>
  );
}
