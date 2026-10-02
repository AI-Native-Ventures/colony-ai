import * as React from "react";
import { Diamond } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useAppShell } from "@/app/AppShellContext";
import {
  useAvailableAcpRuntimes,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import type { AgentPersona } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { companyHireRolePackFromPersona } from "../companyHireModels";
import {
  HireBackButton,
  HirePageContent,
  HirePageHeader,
  hirePrimaryButtonClass,
} from "./HirePresentation";

function rolePacks(personas: readonly AgentPersona[]) {
  return personas.flatMap((persona) => {
    const rolePack = companyHireRolePackFromPersona(persona);
    return rolePack ? [{ persona, rolePack }] : [];
  });
}

function RolePackPreview({
  persona,
  saved,
  onBack,
  onEdit,
  onPropose,
  runtimeLabels,
}: {
  persona: AgentPersona;
  saved: boolean;
  onBack: () => void;
  onEdit: () => void;
  onPropose: () => void;
  runtimeLabels: ReadonlyMap<string, string>;
}) {
  const rolePack = companyHireRolePackFromPersona(persona);
  if (!rolePack) return null;
  const workerLabels = rolePack.workerMenu.map(
    (runtimeId) => runtimeLabels.get(runtimeId) ?? "No runtime is available",
  );
  const rows = [
    ["Title", rolePack.title],
    ["Job", rolePack.job],
    [
      "Skills",
      rolePack.skills.length > 0 ? rolePack.skills.join(", ") : "None selected",
    ],
    [
      "Tools",
      rolePack.tools.length > 0
        ? rolePack.tools.map((tool) => `${tool.name} · ${tool.risk}`).join(", ")
        : "None selected",
    ],
    ["Worker menu", workerLabels.join(", ") || "None selected"],
    [
      "Allowance",
      rolePack.defaultAllowance
        ? `USD ${rolePack.defaultAllowance} / week`
        : "No default amount",
    ],
  ];

  return (
    <>
      <HireBackButton onClick={onBack} />
      <PageHeader className="mb-7" title="Role catalog" />
      <section className="grid max-w-[60rem] gap-5 rounded-[10px] border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">
          {saved ? "Role pack saved" : "Role pack preview"}
        </h2>
        <dl className="grid gap-0 text-sm sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1fr)]">
          {rows.map(([label, value]) => (
            <div
              className="contents [&>dt]:border-b [&>dt]:border-border [&>dt]:py-3 [&>dd]:border-b [&>dd]:border-border [&>dd]:py-3"
              key={label}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <div
          className="grid gap-1 rounded-md border border-border bg-muted p-4"
          role="note"
        >
          <strong className="text-sm font-medium text-foreground">
            Used when proposing or configuring a hire
          </strong>
          <p className="text-sm text-muted-foreground">
            A role pack grants no tool, spending or credential authority by
            itself.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onEdit} type="button" variant="outline">
            Edit role pack
          </Button>
          <Button
            className={hirePrimaryButtonClass}
            onClick={onPropose}
            type="button"
          >
            Propose a hire
          </Button>
        </div>
      </section>
    </>
  );
}

function RecoveryState({
  kind,
  onRetry,
  onBack,
}: {
  kind: "loading" | "unavailable" | "denied";
  onRetry: () => void;
  onBack: () => void;
}) {
  if (kind === "loading") {
    return (
      <section
        aria-label="Loading role catalog"
        className="grid max-w-[60rem] gap-4"
      >
        <div
          role="status"
          className="rounded-[7px] border border-border bg-card px-4 py-3 text-sm text-foreground"
        >
          Loading the latest record. Actions become available after the shared
          source responds.
        </div>
        <div
          aria-hidden="true"
          className="h-40 animate-pulse rounded-[10px] bg-muted"
        />
      </section>
    );
  }

  const unavailable = kind === "unavailable";
  return (
    <section className="grid max-w-[40rem] gap-3 rounded-[10px] border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">
        {unavailable
          ? "This information could not load"
          : "You do not have permission for this action"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {unavailable
          ? "A connection failure is not an empty record. Your draft is kept."
          : "Your view access is unchanged. An authorized person can review the proposal."}
      </p>
      <Button
        className={unavailable ? hirePrimaryButtonClass : undefined}
        onClick={unavailable ? onRetry : onBack}
        type="button"
        variant={unavailable ? "default" : "outline"}
      >
        {unavailable ? "Try again" : "Back to the record"}
      </Button>
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
  const runtimesQuery = useAvailableAcpRuntimes();
  const membershipQuery = useMyRelayMembershipQuery();
  const {
    goAgentRolePack,
    goAgentRolePackEdit,
    goHireConfigure,
    goHireRoles,
    goTeam,
  } = useAppNavigation();
  const appShell = useAppShell();
  const [previewPersonaId, setPreviewPersonaId] = React.useState<string | null>(
    savedRolePackId ?? null,
  );
  React.useEffect(() => {
    setPreviewPersonaId(savedRolePackId ?? null);
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
    return (
      <>
        <HirePageHeader title="Role catalog" />
        <HirePageContent>
          <HireBackButton onClick={() => void goTeam()} />
          <PageHeader className="mb-7" title="Role catalog" />
          <RecoveryState
            kind={loading ? "loading" : failed ? "unavailable" : "denied"}
            onBack={() => void goTeam()}
            onRetry={() => {
              void Promise.all([
                personasQuery.refetch(),
                runtimesQuery.refetch(),
                membershipQuery.refetch(),
              ]);
            }}
          />
        </HirePageContent>
      </>
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
      <>
        <HirePageHeader title="Role catalog" />
        <HirePageContent>
          <HireBackButton onClick={() => void goTeam()} />
          <PageHeader className="mb-7" title="Role catalog" />
          <section
            aria-labelledby="hire-role-recovery-title"
            className="grid min-h-[28rem] grid-rows-[auto_auto] pt-16"
            data-testid={`company-role-${kind}-recovery`}
          >
            <div className="grid content-start justify-items-center gap-4 px-4 text-center">
              <div
                aria-hidden="true"
                className="grid h-14 w-14 place-items-center rounded-xl bg-secondary text-muted-foreground"
              >
                <Diamond className="h-5 w-5" />
              </div>
              <h2
                className="text-base font-semibold text-foreground"
                id="hire-role-recovery-title"
              >
                {recoveryCopy.title}
              </h2>
              <p className="max-w-[32rem] text-sm leading-6 text-muted-foreground">
                {recoveryCopy.body}
              </p>
              <Button
                className={hirePrimaryButtonClass}
                onClick={() =>
                  appShell.onOpenSettings?.(
                    kind === "runtime" ? "harnesses" : "agent-defaults",
                  )
                }
                type="button"
              >
                {recoveryCopy.action}
              </Button>
            </div>
            <div className="mt-20 flex justify-start">
              <Button
                onClick={() => {
                  if (rolePersonaId && rolePersonaId !== "new") {
                    void goAgentRolePackEdit(rolePersonaId, true);
                  } else {
                    void goAgentRolePack(true);
                  }
                }}
                type="button"
                variant="outline"
              >
                Keep draft and return
              </Button>
            </div>
          </section>
        </HirePageContent>
      </>
    );
  }

  const options = rolePacks(personasQuery.data ?? []);
  const runtimeLabels = new Map(
    (runtimesQuery.data ?? []).map((runtime) => [runtime.id, runtime.label]),
  );
  const preview = options.find(
    ({ persona }) => persona.id === previewPersonaId,
  );

  if (preview) {
    return (
      <>
        <HirePageHeader title="Role catalog" />
        <HirePageContent>
          <RolePackPreview
            onBack={() => {
              setPreviewPersonaId(null);
              if (savedRolePackId) void goHireRoles();
            }}
            onEdit={() => void goAgentRolePackEdit(preview.persona.id)}
            onPropose={() =>
              void goHireConfigure(preview.persona.id, crypto.randomUUID())
            }
            persona={preview.persona}
            runtimeLabels={runtimeLabels}
            saved={preview.persona.id === savedRolePackId}
          />
        </HirePageContent>
      </>
    );
  }

  return (
    <>
      <HirePageHeader title="Role catalog" />
      <HirePageContent>
        <HireBackButton onClick={() => void goTeam()} />
        <PageHeader className="mb-7" title="Role catalog" />
        {options.length === 0 ? (
          <section className="grid min-h-[20rem] place-content-center justify-items-center gap-3 px-4 text-center">
            <div
              aria-hidden="true"
              className="mb-2 grid h-14 w-14 place-items-center rounded-xl bg-secondary text-muted-foreground"
            >
              <Diamond className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              Your role catalog starts here
            </h2>
            <p className="max-w-[32rem] text-sm text-muted-foreground">
              There are no built-in role packs. Create a pack with a job,
              skills, scoped tools and an allowed worker menu.
            </p>
            <Button
              className={`mt-2 ${hirePrimaryButtonClass}`}
              onClick={() => void goAgentRolePack()}
              type="button"
            >
              Create role pack
            </Button>
          </section>
        ) : (
          <div className="grid gap-5">
            {options.map(({ persona, rolePack }) => {
              const workerLabels = rolePack.workerMenu.map(
                (runtimeId) =>
                  runtimeLabels.get(runtimeId) ?? "No runtime is available",
              );
              return (
                <article
                  className="max-w-[50rem] rounded-[9px] border border-border bg-card p-[25px]"
                  data-testid={`hire-role-${persona.id}`}
                  key={persona.id}
                >
                  <h2 className="text-base font-semibold text-foreground">
                    {persona.displayName}
                  </h2>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {rolePack.job}
                    {rolePack.skills.length > 0
                      ? ` · ${rolePack.skills.join(", ")}`
                      : ""}
                  </p>
                  <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <dt className="font-medium text-foreground">Tools</dt>
                    <dd className="text-muted-foreground">
                      {rolePack.tools.length > 0
                        ? rolePack.tools
                            .map((tool) => `${tool.name} · ${tool.risk}`)
                            .join(" · ")
                        : "None selected"}
                    </dd>
                    <dt className="font-medium text-foreground">Worker menu</dt>
                    <dd className="text-muted-foreground">
                      {workerLabels.join(" · ")}
                    </dd>
                    <dt className="font-medium text-foreground">
                      Default allowance
                    </dt>
                    <dd className="text-muted-foreground">
                      {rolePack.defaultAllowance
                        ? `USD ${rolePack.defaultAllowance} / week`
                        : "No default amount"}
                    </dd>
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      onClick={() => setPreviewPersonaId(persona.id)}
                      type="button"
                      variant="outline"
                    >
                      Open role pack
                    </Button>
                    <Button
                      className={hirePrimaryButtonClass}
                      onClick={() =>
                        void goHireConfigure(persona.id, crypto.randomUUID())
                      }
                      type="button"
                    >
                      Configure this role
                    </Button>
                    <Button
                      onClick={() => void goAgentRolePackEdit(persona.id)}
                      type="button"
                      variant="outline"
                    >
                      Edit pack
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!runtimesQuery.data?.some(
          (runtime) => runtime.availability === "available",
        ) ? (
          <section className="mt-5 grid max-w-[40rem] gap-3 rounded-[10px] border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">
              No runtime is available
            </h2>
            <p className="text-sm text-muted-foreground">
              Connect a supported runtime before creating an agent. The proposed
              position and draft are kept.
            </p>
            <Button
              onClick={() => appShell.onOpenSettings?.("agents")}
              type="button"
              variant="outline"
            >
              Open harness settings
            </Button>
          </section>
        ) : null}
      </HirePageContent>
    </>
  );
}
