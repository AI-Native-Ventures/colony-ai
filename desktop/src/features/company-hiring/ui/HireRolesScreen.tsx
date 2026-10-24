import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useAppShell } from "@/app/AppShellContext";
import {
  personasQueryKey,
  useAcpRuntimesQuery,
  useCreatePersonaMutation,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { listPersonas } from "@/shared/api/tauriPersonas";
import type { AgentPersona } from "@/shared/api/types";
import type { HireProposal } from "@/features/company-asks/askRecords";
import {
  buildRoleCatalog,
  materializeBuiltInRole,
  type RoleCatalogEntry,
} from "../builtInRoles";
import {
  HireButton,
  HirePage,
  HireRecovery,
  HireSteps,
  HireTitle,
} from "./HirePresentation";
import { AlertGlyph, RoleIcon, ToolChip, toolPlainText } from "./hireTools";

type RolePack = HireProposal["rolePack"];

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
          <ToolChip detailed={tools.length === 1} tool={tool} />
        </span>
      ))}
    </span>
  );
}

function RoleCard({
  busy,
  onConfigure,
  onSelect,
  persona,
  rolePack,
  selected,
  workerLabels,
}: {
  busy: boolean;
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
        <HireButton disabled={busy} onClick={onConfigure} size="sm">
          Configure this role
        </HireButton>
      </div>
    </article>
  );
}

function RolePreview({
  busy,
  onConfigure,
  onPropose,
  rolePack,
  workerLabels,
}: {
  busy: boolean;
  onConfigure: () => void;
  onPropose: () => void;
  rolePack: RolePack;
  workerLabels: readonly string[];
}) {
  return (
    <section className="colony-hire-card colony-hire-panel">
      <h2 className="colony-hire-eyebrow">Role pack preview</h2>
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
        <HireButton block disabled={busy} onClick={onConfigure} size="lg">
          Configure this role
        </HireButton>
        <HireButton
          block
          disabled={busy}
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

export function HireRolesScreen() {
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAcpRuntimesQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const { goHireConfigure, goTeam } = useAppNavigation();
  const navigate = useNavigate();
  const appShell = useAppShell();
  const queryClient = useQueryClient();
  const createPersona = useCreatePersonaMutation();
  const { activeCommunity } = useCommunities();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [addFailed, setAddFailed] = React.useState(false);
  const addingRef = React.useRef(false);

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

  const options = buildRoleCatalog(personasQuery.data ?? []);
  const runtimeLabels = new Map(
    (runtimesQuery.data ?? []).map((runtime) => [runtime.id, runtime.label]),
  );
  const availableRuntimes = new Set(
    (runtimesQuery.data ?? [])
      .filter((runtime) => runtime.availability === "available")
      .map((runtime) => runtime.id),
  );
  // The harnesses a role may run on that this Mac has: the ones installed when
  // there are any, otherwise the ones it knows about.
  const workerLabelsFor = (rolePack: RolePack) => {
    const known = rolePack.workerMenu.filter((id) => runtimeLabels.has(id));
    const installed = known.filter((id) => availableRuntimes.has(id));
    const labels = (installed.length > 0 ? installed : known).map(
      (id) => runtimeLabels.get(id) ?? id,
    );
    return labels.length > 0 ? labels : ["No runtime is available"];
  };
  const selected =
    options.find(({ persona }) => persona.id === selectedId) ?? options[0];
  const hasAvailableRuntime = availableRuntimes.size > 0;

  // A built-in role becomes a real persona the first time it is used; hiring
  // carries on with that persona's id.
  const personaIdFor = (entry: RoleCatalogEntry) =>
    entry.builtIn
      ? materializeBuiltInRole(entry.builtIn, {
          createPersona: createPersona.mutateAsync,
          listPersonas: () =>
            queryClient.fetchQuery({
              queryFn: listPersonas,
              queryKey: personasQueryKey,
              staleTime: 0,
            }),
          scope: activeCommunity?.relayUrl,
        })
      : Promise.resolve(entry.persona.id);
  const addRole = async (
    entry: RoleCatalogEntry,
    next: (personaId: string) => void,
  ) => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setAddFailed(false);
    try {
      next(await personaIdFor(entry));
    } catch {
      setAddFailed(true);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };
  const configure = (entry: RoleCatalogEntry) =>
    void addRole(
      entry,
      (personaId) => void goHireConfigure(personaId, crypto.randomUUID()),
    );
  const propose = (entry: RoleCatalogEntry) =>
    void addRole(
      entry,
      () =>
        void navigate({
          to: "/asks/new",
          search: { channelId: null, threadRootEventId: null, type: "hire" },
        }),
    );

  return (
    <HirePage testId="hire-roles">
      <HireTitle
        subtitle="Choose the role a new AI employee will fill."
        title="Role catalog"
      />
      <HireSteps current={1} />
      <div className="colony-hire-columns">
        <section aria-label="Role packs" className="colony-hire-roles">
          {options.map((entry) => (
            <RoleCard
              busy={adding}
              key={entry.persona.id}
              onConfigure={() => configure(entry)}
              onSelect={() => setSelectedId(entry.persona.id)}
              persona={entry.persona}
              rolePack={entry.rolePack}
              selected={selected?.persona.id === entry.persona.id}
              workerLabels={workerLabelsFor(entry.rolePack)}
            />
          ))}
        </section>
        <aside aria-label="Role pack preview" className="colony-hire-aside">
          {selected ? (
            <RolePreview
              busy={adding}
              onConfigure={() => configure(selected)}
              onPropose={() => propose(selected)}
              rolePack={selected.rolePack}
              workerLabels={workerLabelsFor(selected.rolePack)}
            />
          ) : null}
          {addFailed ? (
            <p
              className="colony-hire-error"
              data-testid="hire-role-add-error"
              role="alert"
            >
              The role could not be added. Try again.
            </p>
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
