import { Button } from "@/shared/ui/button";
import type { MemberPositionHead } from "../teamModels";

export function CompanyEmployeeProfileActions({
  managerName,
  onEdit,
  onPause,
  onTerminate,
  position,
}: {
  managerName: string | null;
  onEdit: () => void;
  onPause: () => void;
  onTerminate: () => void;
  position: MemberPositionHead | undefined;
}) {
  return (
    <section
      aria-label="Company role and reporting"
      className="mt-8 grid gap-8 border-t border-border/60 pt-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]"
      data-testid="company-employee-manager-actions"
    >
      <div>
        <h2 className="text-sm font-semibold">Role and reporting</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {position?.title || "Title not set"}
          <br />
          {managerName ? `Reports to ${managerName}` : "Company founder"}
        </p>
        <Button
          className="mt-4 w-full"
          onClick={onEdit}
          type="button"
          variant="outline"
        >
          Edit role and reporting
        </Button>
      </div>
      <div>
        <h2 className="text-sm font-semibold">Manager actions</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Assign work, propose hires and raises, pause direct reports. Money and
          sensitive access require an authorized human.
        </p>
        {position?.status !== "terminated" ? (
          <Button
            className="mt-4 w-full"
            onClick={onPause}
            type="button"
            variant="outline"
          >
            Pause employee
          </Button>
        ) : null}
        {position?.status !== "terminated" ? (
          <Button
            className="mt-2 w-full text-destructive"
            onClick={onTerminate}
            type="button"
            variant="ghost"
          >
            Terminate employee
          </Button>
        ) : null}
      </div>
    </section>
  );
}
