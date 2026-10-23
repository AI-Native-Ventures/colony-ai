import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useAppShell } from "@/app/AppShellContext";
import { useAcpRuntimesQuery, usePersonasQuery } from "@/features/agents/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import type { AgentPersona } from "@/shared/api/types";
import { companyHireRolePackFromPersona } from "../companyHireModels";
import type { HireProposal } from "@/features/company-asks/askRecords";
import {
  HireButton,
  HirePage,
  HireRecovery,
  HireSteps,
  HireTitle,
} from "./HirePresentation";
import {
  AlertGlyph,
  PlusGlyph,
  RoleIcon,
  ToolChip,
  toolPlainText,
} from "./hireTools";

type RolePack = HireProposal["rolePack"];

function rolePacks(personas: readonly AgentPersona[]) {
  return personas.flatMap((persona) => {
    const rolePack = companyHireRolePackFromPersona(persona);
    return rolePack ? [{ persona, rolePack }] : [];
  });
}

function allowanceText(rolePack: RolePack) {
  return rolePack.defaultAllowance
    ? `USD ${rolePack.defaultAllowance} / week`
    : "No default amount";
}

function ToolRows({ tools }: { tools: RolePack["tools"] }) {
  if (tools.length === 0) return <>None selected</>;
  return (
    <span
      className="colony-hire-tools"
      data-stacked={tools.length > 1 ? "true" : undefined}
    >
      {tools.map((tool) => (
        <span className="colony-hire-tool" key={tool.name}>
          {tool.name}
          <ToolChip tool={tool} />
        </span>
      ))}
    </span>
  );
}

function RoleCard({
  onConfigure,
  onSelect,
  persona,
  rolePack,
  selected,
  workerLabels,
}: {
  onConfigure: () => void;
  onSelect: () => void;
  persona: AgentPersona;
  rolePack: RolePack;
  selected: boolean;
  workerLabels: readonly string[];
}) {
  return (
    <article
      className="colony-hire-role"
      data-selected={selected}
      data-testid={`hire-role-${persona.id}`}
    >
      <div className="colony-hire-role-head">
        <span className="colony-hire-icon-tile" data-active={selected}>
          <RoleIcon job={rolePack.job} title={rolePack.title} />
        </span>
        <div className="colony-hire-role-copy">
          <h2>
            <button
              aria-pressed={selected}
              className="colony-hire-role-title"
              onClick={onSelect}
              type="button"
            >
              {persona.displayName}
            </button>
          </h2>
          <span>
            {rolePack.job}
            {rolePack.skills.length > 0
              ? ` · ${rolePack.skills.join(", ")}`
              : ""}
          </span>
        </div>
      </div>
      <dl className="colony-hire-facts">
        <dt>Tools</dt>
        <dd>
          <ToolRows tools={rolePack.tools} />
        </dd>
        <dt>Worker</dt>
        <dd>{workerLabels.join(" · ")}</dd>
        <dt>Allowance</dt>
        <dd data-muted={rolePack.defaultAllowance ? undefined : "true"}>
          {allowanceText(rolePack)}
        </dd>
      </dl>
      <div className="colony-hire-role-actions">
        <HireButton onClick={onConfigure} size="sm">
          Configure this role
        </HireButton>
      </div>
    </article>
  );
}

function RolePreview({
  onConfigure,
  onPropose,
  rolePack,
  saved,
  workerLabels,
}: {
  onConfigure: () => void;
  onPropose: () => void;
  rolePack: RolePack;
  saved: boolean;
  workerLabels: readonly string[];
}) {
  return (
    <section className="colony-hire-card colony-hire-panel">
      <h2 className="colony-hire-eyebrow">
        {saved ? "Role pack saved" : "Role pack preview"}
      </h2>
      <h3 className="colony-hire-panel-title">{rolePack.title}</h3>
      <dl className="colony-hire-detail">
        <div>
          <dt>Title</dt>
          <dd>{rolePack.title}</dd>
        </div>
        <div>
          <dt>Job</dt>
          <dd>{rolePack.job}</dd>
        </div>
        <div data-chips="true">
          <dt>Skills</dt>
          <dd data-chips="true">
            {rolePack.skills.length > 0
              ? rolePack.skills.map((skill) => (
                  <span className="colony-hire-skill" key={skill}>
                    {skill}
                  </span>
                ))
              : "None selected"}
          </dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>
            {rolePack.tools.length > 0
              ? rolePack.tools.map(toolPlainText).join(" · ")
              : "None selected"}
          </dd>
        </div>
        <div>
          <dt>Worker menu</dt>
          <dd>{workerLabels.join(", ") || "None selected"}</dd>
        </div>
        <div>
          <dt>Allowance</dt>
          <dd>{allowanceText(rolePack)}</dd>
        </div>
      </dl>
      <div className="colony-hire-panel-actions">
        <HireButton block onClick={onConfigure} size="lg">
          Configure this role
        </HireButton>
        <HireButton
          block
          onClick={onPropose}
          size="md"
          testId="hire-propose"
          variant="outline"
        >
          Propose a hire
        </HireButton>
      </div>
    </section>
  );
}

function NoRuntimeNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <section
      aria-label="No runtime is available"
      className="colony-hire-notice"
      role="note"
    >
      <strong>
        <AlertGlyph size={18} stroke="#8a5300" />
        No runtime is available
      </strong>
      <p>
        A new employee needs a harness to run in. Add one, then come back to
        finish the hire.
      </p>
      <HireButton onClick={onOpenSettings} variant="outline">
        Open harness settings
      </HireButton>
    </section>
  );
}

export function HireRolesScreen({
  savedRolePackId,
  roleRecovery,
  rolePersonaId,
}: {
  savedRolePackId?: string;
  roleRecovery?: "runtime-empty" | "provider-empty" | "model-empty";
  rolePersonaId?: string;
}) {
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const { goAgentRolePack, goAgentRolePackEdit, goHireConfigure, goTeam } =
    useAppNavigation();
  const navigate = useNavigate();
  const appShell = useAppShell();
  const [selectedId, setSelectedId] = React.useState<string | null>(
    savedRolePackId ?? null,
  );
  React.useEffect(() => {
    if (savedRolePackId) setSelectedId(savedRolePackId);
  }, [savedRolePackId]);

  const authorized =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  const failed =
    personasQuery.isError || runtimesQuery.isError || membershipQuery.isError;
  const loading =
    personasQuery.isPending ||
    runtimesQuery.isPending ||
    membershipQuery.isPending;

  if (loading || failed || !authorized) {
    const retry = () => {
      void Promise.all([
        personasQuery.refetch(),
        runtimesQuery.refetch(),
        membershipQuery.refetch(),
      ]);
    };
    return (
      <HirePage testId="hire-roles">
        <HireTitle
          subtitle="Choose the role a new AI employee will fill."
          title="Role catalog"
        />
        {loading ? (
          <section
            aria-label="Loading role catalog"
            className="colony-hire-loading"
          >
            <div className="colony-hire-banner" role="status">
              Loading the latest record. Actions become available after the
              shared source responds.
            </div>
            <div aria-hidden="true" className="colony-hire-skeleton" />
          </section>
        ) : failed ? (
          <HireRecovery
            action={
              <HireButton onClick={retry} size="md">
                Try again
              </HireButton>
            }
            title="This information could not load"
          >
            A connection failure is not an empty record. Your draft is kept.
          </HireRecovery>
        ) : (
          <HireRecovery
            action={
              <HireButton
                onClick={() => void goTeam()}
                size="md"
                variant="outline"
              >
                Back to the record
              </HireButton>
            }
            title="You do not have permission for this action"
          >
            Your view access is unchanged. An authorized person can review the
            proposal.
          </HireRecovery>
        )}
      </HirePage>
    );
  }

  if (roleRecovery) {
    const kind = roleRecovery.replace("-empty", "") as
      | "runtime"
      | "provider"
      | "model";
    const recoveryCopy = {
      runtime: {
        title: "No runtime is available",
        body: "Connect a supported runtime before creating an agent. The proposed position and draft are kept.",
        action: "Open harness settings",
      },
      provider: {
        title: "No provider is available",
        body: "The chosen runtime has no connected provider. Connect one, then return.",
        action: "Open AI connections",
      },
      model: {
        title: "No model is available",
        body: "This provider returned no eligible models. Refresh its model list or choose another configured provider.",
        action: "Open AI connections",
      },
    }[kind];
    return (
      <HirePage testId={`company-role-${kind}-recovery`}>
        <HireTitle
          subtitle="Choose the role a new AI employee will fill."
          title="Role catalog"
        />
        <section
          aria-labelledby="hire-role-recovery-title"
          className="colony-hire-card colony-hire-recovery"
          data-centered="true"
        >
          <h2 id="hire-role-recovery-title">{recoveryCopy.title}</h2>
          <p>{recoveryCopy.body}</p>
          <HireButton
            onClick={() =>
              appShell.onOpenSettings?.(
                kind === "runtime" ? "harnesses" : "agent-defaults",
              )
            }
            size="md"
          >
            {recoveryCopy.action}
          </HireButton>
          <HireButton
            onClick={() => {
              if (rolePersonaId && rolePersonaId !== "new") {
                void goAgentRolePackEdit(rolePersonaId, true);
              } else {
                void goAgentRolePack(true);
              }
            }}
            size="md"
            variant="outline"
          >
            Keep draft and return
          </HireButton>
        </section>
      </HirePage>
    );
  }

  const options = rolePacks(personasQuery.data ?? []);
  const runtimeLabels = new Map(
    (runtimesQuery.data ?? []).map((runtime) => [runtime.id, runtime.label]),
  );
  const workerLabelsFor = (rolePack: RolePack) =>
    rolePack.workerMenu.map(
      (runtimeId) => runtimeLabels.get(runtimeId) ?? "No runtime is available",
    );
  const selected =
    options.find(({ persona }) => persona.id === selectedId) ?? options[0];
  const hasAvailableRuntime = (runtimesQuery.data ?? []).some(
    (runtime) => runtime.availability === "available",
  );
  const configure = (personaId: string) =>
    void goHireConfigure(personaId, crypto.randomUUID());

  return (
    <HirePage testId="hire-roles">
      <HireTitle
        subtitle="Choose the role a new AI employee will fill."
        title="Role catalog"
      />
      <HireSteps current={1} />
      <div className="colony-hire-columns">
        <section aria-label="Role packs" className="colony-hire-roles">
          {options.map(({ persona, rolePack }) => (
            <RoleCard
              key={persona.id}
              onConfigure={() => configure(persona.id)}
              onSelect={() => setSelectedId(persona.id)}
              persona={persona}
              rolePack={rolePack}
              selected={selected?.persona.id === persona.id}
              workerLabels={workerLabelsFor(rolePack)}
            />
          ))}
          {options.length === 0 ? (
            <article className="colony-hire-role-empty">
              <span className="colony-hire-icon-tile">
                <PlusGlyph size={20} />
              </span>
              <h2>Your role catalog starts here</h2>
              <p>
                There are no built-in role packs. Create a pack with a job,
                skills, scoped tools and an allowed worker menu.
              </p>
              <HireButton
                onClick={() => void goAgentRolePack()}
                size="sm"
                variant="outline"
              >
                Create role pack
              </HireButton>
            </article>
          ) : null}
        </section>
        <aside aria-label="Role pack preview" className="colony-hire-aside">
          {selected ? (
            <RolePreview
              onConfigure={() => configure(selected.persona.id)}
              onPropose={() =>
                void navigate({
                  to: "/asks/new",
                  search: {
                    channelId: null,
                    threadRootEventId: null,
                    type: "hire",
                  },
                })
              }
              rolePack={selected.rolePack}
              saved={selected.persona.id === savedRolePackId}
              workerLabels={workerLabelsFor(selected.rolePack)}
            />
          ) : null}
          {hasAvailableRuntime ? null : (
            <NoRuntimeNotice
              onOpenSettings={() => appShell.onOpenSettings?.("agents")}
            />
          )}
        </aside>
      </div>
    </HirePage>
  );
}
