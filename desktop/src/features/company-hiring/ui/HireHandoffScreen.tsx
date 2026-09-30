import * as React from "react";
import { Diamond } from "lucide-react";

import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import type { CompanyHireHeadRecord } from "../companyHireModels";
import { Button } from "@/shared/ui/button";
import {
  HireBackButton,
  HireFlash,
  HirePageContent,
  HirePageHeader,
  hirePrimaryButtonClass,
} from "./HirePresentation";

function allowanceLabel(value: string | undefined) {
  if (!value) return "Not requested";
  const amount = Number(value);
  return `USD ${Number.isFinite(amount) ? amount.toFixed(2) : value} / week`;
}

function StageDetails({
  record,
  askRecord,
  askerLabel,
  onReadProposal,
}: {
  record: CompanyHireHeadRecord;
  askRecord: AskHeadRecord;
  askerLabel: string;
  onReadProposal: () => void;
}) {
  const { proposal } = record.head;
  const stage =
    record.head.status === "awaiting_founder"
      ? "Founder review required"
      : record.head.status === "approved"
        ? "Founder sign-off recorded"
        : "Administrative review";

  return (
    <section className="grid content-start gap-4 rounded-[10px] border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">
        Proposed company position
      </h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="font-medium text-foreground">Requested by</dt>
        <dd className="text-muted-foreground">{askerLabel}</dd>
        <dt className="font-medium text-foreground">Proposed name</dt>
        <dd className="text-muted-foreground">{proposal.displayName}</dd>
        <dt className="font-medium text-foreground">Role</dt>
        <dd className="text-muted-foreground">{proposal.title}</dd>
        <dt className="font-medium text-foreground">Allowance</dt>
        <dd className="text-muted-foreground">
          {allowanceLabel(proposal.weeklyAllowance)}
        </dd>
        <dt className="font-medium text-foreground">Stage</dt>
        <dd className="text-muted-foreground">{stage}</dd>
      </dl>
      {record.head.status === "awaiting_founder" &&
      askRecord.head.resolution?.reason ? (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-medium text-foreground">
            Administrative decision
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {askRecord.head.resolution.reason}
          </p>
        </div>
      ) : null}
      {record.head.status === "approved" &&
      record.head.founderApprovalReason ? (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-medium text-foreground">
            Founder decision
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {record.head.founderApprovalReason}
          </p>
        </div>
      ) : null}
      <Button onClick={onReadProposal} type="button" variant="outline">
        Read the proposal
      </Button>
    </section>
  );
}

export function HireHandoffScreen({
  record,
  askRecord,
  currentRole,
  askerLabel,
  loading,
  unavailable,
  onResolve,
  onRetry,
  onBack,
  onOpenPosition,
  onReadProposal,
}: {
  record: CompanyHireHeadRecord | null;
  askRecord: AskHeadRecord | null;
  currentRole: string | null;
  askerLabel: string;
  loading: boolean;
  unavailable: boolean;
  onResolve: (
    outcome: "approved" | "rejected",
    reason: string,
  ) => Promise<void>;
  onRetry: () => void;
  onBack: () => void;
  onOpenPosition: () => void;
  onReadProposal: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [failure, setFailure] = React.useState(false);
  const [reasonInvalid, setReasonInvalid] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);

  const submitDecision = async (outcome: "approved" | "rejected") => {
    if (submittingRef.current) return;
    if (!reason.trim() || reason.length > 1000) {
      setReasonInvalid(true);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(false);
    setReasonInvalid(false);
    try {
      await onResolve(outcome, reason.trim());
    } catch {
      setFailure(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const showAdminReview = Boolean(
    record?.head.status === "proposed" && askRecord?.head.status === "open",
  );
  const showFounderReview = Boolean(
    record?.head.status === "awaiting_founder" &&
      askRecord?.head.status === "resolved" &&
      askRecord.head.resolution?.outcome === "approved",
  );
  const showSigned = Boolean(
    record?.head.status === "approved" &&
      askRecord?.head.status === "resolved" &&
      askRecord.head.resolution?.outcome === "approved",
  );
  const showReferred = Boolean(
    record?.head.status === "awaiting_founder" &&
      askRecord?.head.status === "resolved" &&
      askRecord.head.resolution?.outcome === "approved" &&
      currentRole !== "owner",
  );
  const showRejected = Boolean(
    record?.head.status === "denied" ||
      (askRecord?.head.status === "resolved" &&
        askRecord.head.resolution?.outcome === "rejected"),
  );
  const authorized = currentRole === "owner" || currentRole === "admin";
  const mayReview =
    authorized &&
    ((showAdminReview && currentRole === "admin") ||
      (showAdminReview && currentRole === "owner") ||
      (showFounderReview && currentRole === "owner"));

  let state: "loading" | "unavailable" | "denied" | null = null;
  if (loading) state = "loading";
  else if (unavailable || !record || !askRecord) state = "unavailable";
  else if (!authorized) state = "denied";

  if (state) {
    return (
      <>
        <HirePageHeader title="Hire proposal" />
        <HirePageContent>
          <HireBackButton onClick={onBack} />
          <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
            Hire proposal
          </h1>
          {state === "loading" ? (
            <>
              <HireFlash>
                Loading the latest record. Actions become available after the
                shared source responds.
              </HireFlash>
              <div
                aria-hidden="true"
                className="h-40 max-w-[60rem] animate-pulse rounded-[10px] bg-muted"
              />
            </>
          ) : state === "unavailable" ? (
            <section className="grid max-w-[40rem] gap-3 rounded-[10px] border border-border bg-card p-5">
              <h2 className="text-base font-semibold text-foreground">
                This information could not load
              </h2>
              <p className="text-sm text-muted-foreground">
                A connection failure is not an empty record. Your draft is kept.
              </p>
              <Button
                className={hirePrimaryButtonClass}
                onClick={onRetry}
                type="button"
              >
                Try again
              </Button>
            </section>
          ) : (
            <section className="grid min-h-[31rem] content-center justify-items-center gap-4 px-4 text-center">
              <div
                aria-hidden="true"
                className="grid h-14 w-14 place-items-center rounded-xl bg-secondary text-muted-foreground"
              >
                <Diamond className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                You do not have permission for this action
              </h2>
              <p className="max-w-[32rem] text-sm leading-6 text-muted-foreground">
                Your view access is unchanged. An authorized person can review
                the proposal.
              </p>
              <Button onClick={onBack} type="button">
                Back to the record
              </Button>
            </section>
          )}
        </HirePageContent>
      </>
    );
  }

  if (!record || !askRecord) return null;

  if (showReferred) {
    return (
      <>
        <HirePageHeader title="Hire proposal" />
        <HirePageContent>
          <HireBackButton onClick={onBack} />
          <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
            Hire proposal
          </h1>
          <section className="max-w-[60rem] border-l-2 border-[#6b9685] bg-muted p-[15px]">
            <h2 className="text-sm font-semibold text-foreground">
              Proposal approved for founder review
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No employee has been hired. The founder must review and sign off.
            </p>
          </section>
          <Button
            className="mt-5"
            data-testid="hire-open-founder-review"
            onClick={onReadProposal}
            type="button"
          >
            Open founder review
          </Button>
        </HirePageContent>
      </>
    );
  }

  if (showSigned) {
    return (
      <>
        <HirePageHeader title="Hire proposal" />
        <HirePageContent>
          <HireBackButton onClick={onBack} />
          <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
            Hire proposal
          </h1>
          <section className="max-w-[60rem] border-l-2 border-[#6b9685] bg-muted p-[15px]">
            <h2 className="text-sm font-semibold text-foreground">
              Founder sign-off recorded
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The position can now be created through the authorized hiring
              flow. Runtime setup is tracked separately.
            </p>
          </section>
          <Button
            className="mt-5"
            data-testid="hire-open-position"
            onClick={onOpenPosition}
            type="button"
          >
            Open position
          </Button>
        </HirePageContent>
      </>
    );
  }

  if (showRejected) {
    return (
      <>
        <HirePageHeader title="Hire proposal" />
        <HirePageContent>
          <HireBackButton onClick={onBack} />
          <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
            Hire proposal
          </h1>
          <div className="grid max-w-[60rem] gap-5 lg:grid-cols-2">
            <StageDetails
              askerLabel={askerLabel}
              askRecord={askRecord}
              onReadProposal={onReadProposal}
              record={record}
            />
            <section className="grid content-start gap-3 rounded-[10px] border border-border bg-card p-5">
              <h2 className="text-base font-semibold text-foreground">
                Request declined
              </h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {record.head.denialReason ?? askRecord.head.resolution?.reason}
              </p>
            </section>
          </div>
        </HirePageContent>
      </>
    );
  }

  if (!mayReview) {
    return (
      <>
        <HirePageHeader title="Hire proposal" />
        <HirePageContent>
          <HireBackButton onClick={onBack} />
          <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
            Hire proposal
          </h1>
          <section className="max-w-[40rem] rounded-[10px] border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">
              This proposal is not waiting for your decision
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Refresh the shared record before taking another action.
            </p>
            <Button
              className="mt-4"
              onClick={onRetry}
              type="button"
              variant="outline"
            >
              Refresh record
            </Button>
          </section>
        </HirePageContent>
      </>
    );
  }

  const founderReview = showFounderReview;
  const actionLabel = founderReview
    ? "Sign off hire"
    : currentRole === "owner"
      ? "Sign off hire"
      : "Approve and refer to founder";

  return (
    <>
      <HirePageHeader title="Hire proposal" />
      <HirePageContent>
        <HireBackButton onClick={onBack} />
        <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
          Hire proposal
        </h1>
        <div className="grid max-w-[60rem] gap-5 lg:grid-cols-2">
          <StageDetails
            askerLabel={askerLabel}
            askRecord={askRecord}
            onReadProposal={onReadProposal}
            record={record}
          />
          <section className="grid content-start gap-4 rounded-[10px] border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">
              {founderReview ? "Founder sign-off" : "Your review"}
            </h2>
            <div
              className="rounded-md border border-border bg-muted p-4"
              role="status"
            >
              <strong className="text-sm font-medium text-foreground">
                {founderReview || currentRole === "owner"
                  ? "You are the founder"
                  : "Approval is a referral"}
              </strong>
              <p className="mt-1 text-sm text-muted-foreground">
                {founderReview || currentRole === "owner"
                  ? "Check the exact role, scope and allowance before signing."
                  : "Approving here forwards the proposal to the founder. It does not hire the employee."}
              </p>
            </div>
            <form
              className="grid gap-3"
              data-testid="hire-handoff-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitDecision("approved");
              }}
            >
              <label
                className="grid gap-2 text-sm font-medium text-foreground"
                htmlFor="hire-handoff-reason"
              >
                Reason
                <textarea
                  aria-describedby="hire-handoff-reason-count"
                  className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="hire-handoff-reason"
                  disabled={submitting}
                  id="hire-handoff-reason"
                  maxLength={1000}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonInvalid(false);
                  }}
                  required
                  value={reason}
                />
              </label>
              <p
                className="text-xs text-muted-foreground"
                id="hire-handoff-reason-count"
              >
                {reason.length} / 1,000 characters · Required
              </p>
              {reasonInvalid ? (
                <p className="text-sm text-destructive" role="alert">
                  Enter a reason between 1 and 1,000 characters.
                </p>
              ) : null}
              {failure ? (
                <div
                  className="rounded-md border border-destructive/30 bg-destructive/5 p-3"
                  data-testid="hire-handoff-error"
                  role="alert"
                >
                  <strong className="text-sm font-medium text-destructive">
                    Could not save
                  </strong>
                  <p className="mt-1 text-sm text-destructive">
                    Your inputs are kept. Review them or retry without starting
                    again.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3 border-t border-border pt-4">
                <Button
                  className={hirePrimaryButtonClass}
                  data-testid="hire-handoff-approve"
                  disabled={submitting}
                  type="submit"
                >
                  {actionLabel}
                </Button>
                <Button
                  data-testid="hire-handoff-decline"
                  disabled={submitting}
                  onClick={() => void submitDecision("rejected")}
                  type="button"
                  variant="outline"
                >
                  Decline with a reason
                </Button>
              </div>
            </form>
          </section>
        </div>
      </HirePageContent>
    </>
  );
}
