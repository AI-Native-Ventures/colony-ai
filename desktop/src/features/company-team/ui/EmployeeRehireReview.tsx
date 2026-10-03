import { useState } from "react";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { useMemberPositionActionMutation } from "../teamRelay";
import type { MemberPositionHead } from "../teamModels";
import { TeamPage, TeamPageTitle } from "./TeamPage";

/** Review the retained position before authorizing its existing rehire action. */
export function EmployeeRehireReview({
  position,
  managerName,
  headEventId,
  fullName,
  onBack,
}: {
  headEventId: string;
  position: MemberPositionHead;
  managerName: string | null;
  fullName: string;
  onBack: () => void;
}) {
  const mutation = useMemberPositionActionMutation();
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function rehire() {
    setError(null);
    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        pubkey: position.pubkey,
        action: "rehire",
        expectedHeadEventId: headEventId,
      });
      onBack();
    } catch {
      setError("Rehire could not be published. The review is kept. Try again.");
    }
  }
  return (
    <TeamPage title="Review hire" testId="company-rehire-review">
      <button
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground"
        type="button"
        disabled={mutation.isPending}
        onClick={onBack}
      >
        <ChevronLeft aria-hidden="true" className="size-3.5" /> Back
      </button>
      <div className="mb-[1.875rem] mt-2">
        <TeamPageTitle>Review hire</TeamPageTitle>
      </div>
      <section className="max-w-[40.625rem] rounded-company-control border border-border p-6">
        <h2 className="mb-5 text-base font-semibold">
          {fullName} · {position.title}
        </h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
          <dt className="text-muted-foreground">Reports to</dt>
          <dd>{managerName ?? "Reporting line not set"}</dd>
        </dl>
        <p className="my-5 text-xs text-muted-foreground">
          Definition, lessons and history are retained. This restores the
          company position to active. Rehire does not start or restart a
          runtime.
        </p>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />
          I approve rehiring this employee with the retained role and reporting
          line.
        </label>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <Button
            className="h-11 rounded-company-control bg-colony-info text-xs shadow-none"
            disabled={!approved || mutation.isPending}
            onClick={() => void rehire()}
            type="button"
          >
            {mutation.isPending ? "Saving" : "Approve and rehire"}
          </Button>
          <Button
            className="h-11 rounded-company-control text-xs"
            variant="outline"
            disabled={mutation.isPending}
            onClick={onBack}
          >
            Cancel
          </Button>
        </div>
      </section>
    </TeamPage>
  );
}
