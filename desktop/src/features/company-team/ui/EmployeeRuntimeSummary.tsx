import {
  useAgentConfigSurface,
  useAcpRuntimesQuery,
} from "@/features/agents/hooks";
import { runtimeForAgent } from "@/features/agents/agentDirectoryModel";
import type { ManagedAgent } from "@/shared/api/types";
import {
  employeeHarnessLabel,
  employeeModelFields,
} from "../employeePresentation";

/** A bounded projection of effective model values, without personal settings. */
export function EmployeeRuntimeSummary({ agent }: { agent: ManagedAgent }) {
  const query = useAgentConfigSurface(agent.pubkey);
  const catalog = useAcpRuntimesQuery({ enabled: true });
  const runtime = runtimeForAgent(agent, catalog.data ?? []);
  const fields = employeeModelFields(query.data);
  return (
    <section data-testid="employee-runtime-summary">
      <dl className="grid grid-cols-2 gap-x-5 text-xs">
        <div className="contents">
          <dt className="border-b border-border py-4 text-muted-foreground">
            Harness
          </dt>
          <dd className="border-b border-border py-4 font-semibold">
            {employeeHarnessLabel(runtime?.label ?? query.data?.runtimeLabel)}
          </dd>
        </div>
        <div className="contents">
          <dt className="border-b border-border py-4 text-muted-foreground">
            Model
          </dt>
          <dd className="border-b border-border py-4 font-semibold">
            {query.isLoading ? "Loading" : fields.model}
          </dd>
        </div>
        <div className="contents">
          <dt className="border-b border-border py-4 text-muted-foreground">
            Thinking effort
          </dt>
          <dd className="border-b border-border py-4 font-semibold">
            {query.isLoading ? "Loading" : fields.effort}
          </dd>
        </div>
      </dl>
      {query.isError || catalog.isError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          Runtime details could not load.
        </p>
      ) : null}
      {fields.outputLimit || fields.contextLimit ? (
        <details
          className="mt-5 text-sm"
          data-testid="employee-runtime-advanced"
        >
          <summary className="cursor-pointer font-medium">Advanced</summary>
          <dl className="mt-3 grid grid-cols-2 gap-x-5 text-xs">
            {fields.outputLimit ? (
              <div className="contents">
                <dt className="border-b border-border py-4 text-muted-foreground">
                  Maximum output tokens
                </dt>
                <dd className="border-b border-border py-4 font-semibold">
                  {fields.outputLimit}
                </dd>
              </div>
            ) : null}
            {fields.contextLimit ? (
              <div className="contents">
                <dt className="border-b border-border py-4 text-muted-foreground">
                  Context limit
                </dt>
                <dd className="border-b border-border py-4 font-semibold">
                  {fields.contextLimit}
                </dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
