import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useAvailableAcpRuntimes,
  usePersonasQuery,
} from "@/features/agents/hooks";
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

export function HireRolesScreen() {
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAvailableAcpRuntimes();
  const { goTeam, goHireConfigure } = useAppNavigation();

  if (personasQuery.isError) throw personasQuery.error;
  if (runtimesQuery.isError) throw runtimesQuery.error;
  if (personasQuery.isPending || runtimesQuery.isPending) return null;

  const options = rolePacks(personasQuery.data ?? []);
  const runtimeLabels = new Map(
    (runtimesQuery.data ?? []).map((runtime) => [runtime.id, runtime.label]),
  );

  return (
    <>
      <HirePageHeader title="Hire an employee" />
      <HirePageContent>
        <HireBackButton onClick={() => void goTeam()} />
        <PageHeader
          className="mb-7"
          description="Choose a role pack, then review exactly who you are hiring."
          title="Hire an employee"
        />
        <div className="grid gap-5">
          {options.map(({ persona, rolePack }) => {
            const workerLabels = rolePack.workerMenu.flatMap((runtimeId) => {
              const label = runtimeLabels.get(runtimeId);
              return label ? [label] : [];
            });
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
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-[5.75rem_minmax(0,1fr)]">
                  <dt className="font-medium text-foreground">Tools</dt>
                  <dd className="text-muted-foreground">
                    {rolePack.tools
                      .map((tool) => `${tool.name} · ${tool.risk}`)
                      .join(" · ")}
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
                      : null}
                  </dd>
                </dl>
                <Button
                  className={`mt-5 ${hirePrimaryButtonClass}`}
                  onClick={() =>
                    void goHireConfigure(persona.id, crypto.randomUUID())
                  }
                  type="button"
                >
                  Configure this role
                </Button>
              </article>
            );
          })}
        </div>
      </HirePageContent>
    </>
  );
}
