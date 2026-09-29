import { UserAvatar } from "@/shared/ui/UserAvatar";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCompanyHireHeadQuery } from "../hireRelay";
import { Button } from "@/shared/ui/button";
import {
  HireFlash,
  HirePageContent,
  HirePageHeader,
  hirePrimaryButtonClass,
} from "./HirePresentation";

export function HireSuccessScreen({ hireId }: { hireId: string }) {
  const hireQuery = useCompanyHireHeadQuery(hireId);
  const { goChannel, goTeam, goTeamMember } = useAppNavigation();
  if (hireQuery.isError) throw hireQuery.error;
  const record = hireQuery.data;
  if (record?.head.status !== "hired" || !record.head.employeePubkey)
    return null;

  const proposal = record.head.proposal;
  const name = proposal.displayName;
  const employeePubkey = record.head.employeePubkey;

  return (
    <>
      <HirePageHeader title="Employee hired" />
      <HirePageContent>
        <h1 className="mb-6 mt-8 text-2xl font-semibold tracking-tight text-foreground">
          Employee hired
        </h1>
        <HireFlash>Hire approved.</HireFlash>
        <section
          className="my-5 rounded-[9px] border border-success/25 bg-success/10 p-[18px] text-xs"
          data-testid="hire-success"
        >
          <h2 className="text-base font-semibold text-success">
            {name} joined the team.
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The founder-approved scope and allowance have been recorded.
          </p>
        </section>
        <article className="my-8 flex items-start gap-3">
          <span aria-hidden="true">
            <UserAvatar avatarUrl={null} displayName={name} size="md" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm font-semibold text-foreground">
                {name}
              </strong>
              <span className="text-2xs text-muted-foreground">Employee</span>
              <span className="text-2xs text-muted-foreground">Just now</span>
            </div>
            <p className="mt-1 text-sm leading-[1.8] text-foreground">
              Hello team. I’ll coordinate {proposal.title} and bring decisions
              back to the right people.
            </p>
          </div>
        </article>
        <div className="flex flex-wrap gap-3">
          <Button
            className={hirePrimaryButtonClass}
            data-testid="hire-open-profile"
            onClick={() => void goTeamMember(employeePubkey)}
            type="button"
          >
            Open employee profile
          </Button>
          <Button
            data-testid="hire-view-team"
            onClick={() => void goTeam()}
            type="button"
            variant="outline"
          >
            View team
          </Button>
          <Button
            data-testid="hire-open-introduction"
            onClick={() => void goChannel(proposal.introductionChannelId)}
            type="button"
            variant="outline"
          >
            Open introduction channel
          </Button>
        </div>
      </HirePageContent>
    </>
  );
}
