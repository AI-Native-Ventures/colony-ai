import { useEmployeeDutiesQuery } from "@/features/company-team/employeeDutiesLessons";
import { Button } from "@/shared/ui/button";

/** Read-only schedule of signed duties; edits remain in Plan. */
export function EmployeeSchedulePanel({
  employeePubkey,
  onOpenPlan,
}: {
  employeePubkey: string;
  onOpenPlan: () => void;
}) {
  const duties = useEmployeeDutiesQuery(employeePubkey);

  return (
    <section
      className="colony-canary-employee-schedule"
      data-testid="employee-schedule"
    >
      <div className="colony-canary-desk-section-heading">
        <h2 className="colony-canary-desk-section-title">Schedule</h2>
        <Button onClick={onOpenPlan} type="button" variant="ghost">
          Open plan
        </Button>
      </div>
      {duties.isPending ? (
        <p role="status">Loading the schedule…</p>
      ) : duties.isError || duties.subscriptionError ? (
        <div role="alert">
          <p>The schedule could not be loaded.</p>
          <Button
            onClick={() => void duties.refetch()}
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : duties.data.filter((record) => record.head.status !== "deleted")
          .length === 0 ? (
        <p role="status">No recurring duties are scheduled yet.</p>
      ) : (
        <ul>
          {duties.data
            .filter((record) => record.head.status !== "deleted")
            .map((record) => (
              <li key={record.head.dutyId}>
                <div>
                  <strong>{record.head.proposal.title}</strong>
                  <span>
                    {record.head.proposal.scheduleText} ·{" "}
                    {record.head.proposal.timeZone}
                  </span>
                </div>
                <span>
                  {record.head.status === "active" ? "Scheduled" : "Paused"}
                </span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
