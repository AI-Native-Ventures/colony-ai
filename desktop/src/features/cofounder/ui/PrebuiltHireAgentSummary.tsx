import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { DialogDescription, DialogTitle } from "@/shared/ui/dialog";

import type { FunctionId } from "../cofounderRecords";
import { FUNCTION_DETAILS } from "../functions";
import { prebuiltAgentAvatarDataUrl } from "../prebuiltAgentAvatar";
import type { PrebuiltAgent } from "../prebuiltAgents";

export function PrebuiltHireAgentSummary({
  agent,
  functionId,
  managerCopy,
}: {
  agent: PrebuiltAgent;
  functionId: FunctionId;
  managerCopy: string;
}) {
  return (
    <>
      <div className="pr-8">
        <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
          Hire for {FUNCTION_DETAILS[functionId].name}
        </p>
        <DialogTitle className="mt-1">{agent.name}</DialogTitle>
        <DialogDescription id="prebuilt-hire-description">
          {managerCopy}
        </DialogDescription>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <EmployeeAvatar
          className="size-11 rounded-full"
          instance={prebuiltAgentAvatarDataUrl(agent)}
          name={agent.name}
          role={agent.job ?? `Head of ${FUNCTION_DETAILS[functionId].name}`}
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
    </>
  );
}
