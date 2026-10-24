import * as React from "react";

import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import type { CompanyHireHeadRecord } from "../companyHireModels";
import {
  HireBanner,
  HireButton,
  HirePage,
  HireRecovery,
  HireTitle,
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
    <section className="colony-hire-card colony-hire-handoff-card">
      <h2>Proposed company position</h2>
      <dl>
        <dt>Requested by</dt>
        <dd>{askerLabel}</dd>
        <dt>Proposed name</dt>
        <dd>{proposal.displayName}</dd>
        <dt>Role</dt>
        <dd>{proposal.title}</dd>
        <dt>Allowance</dt>
        <dd>{allowanceLabel(proposal.weeklyAllowance)}</dd>
        <dt>Stage</dt>
        <dd>{stage}</dd>
      </dl>
      {record.head.status === "awaiting_founder" &&
      askRecord.head.resolution?.reason ? (
        <div>
          <h3>Administrative decision</h3>
          <p>{askRecord.head.resolution.reason}</p>
        </div>
      ) : null}
      {record.head.status === "approved" &&
      record.head.founderApprovalReason ? (
        <div>
          <h3>Founder decision</h3>
          <p>{record.head.founderApprovalReason}</p>
        </div>
      ) : null}
      <HireButton onClick={onReadProposal} size="md" variant="outline">
        Read the proposal
      </HireButton>
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
      <HirePage testId="hire-handoff">
        <HireTitle title="Hire proposal" />
        {state === "loading" ? (
          <section className="colony-hire-loading">
            <HireBanner>
              Loading the latest record. Actions become available after the
              shared source responds.
            </HireBanner>
            <div aria-hidden="true" className="colony-hire-skeleton" />
          </section>
        ) : state === "unavailable" ? (
          <HireRecovery
            action={
              <HireButton onClick={onRetry} size="md">
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
              <HireButton onClick={onBack} size="md">
                Back to the record
              </HireButton>
            }
            centered
            title="You do not have permission for this action"
          >
            Your view access is unchanged. An authorized person can review the
            proposal.
          </HireRecovery>
        )}
      </HirePage>
    );
  }

  if (!record || !askRecord) return null;

  if (showReferred) {
    return (
      <HirePage testId="hire-handoff">
        <HireTitle title="Hire proposal" />
        <HireRecovery
          action={
            <HireButton
              onClick={onReadProposal}
              size="md"
              testId="hire-open-founder-review"
            >
              Open founder review
            </HireButton>
          }
          title="Proposal approved for founder review"
        >
          No employee has been hired. The founder must review and sign off.
        </HireRecovery>
      </HirePage>
    );
  }

  if (showSigned) {
    return (
      <HirePage testId="hire-handoff">
        <HireTitle title="Hire proposal" />
        <HireRecovery
          action={
            <HireButton
              onClick={onOpenPosition}
              size="md"
              testId="hire-open-position"
            >
              Open position
            </HireButton>
          }
          title="Founder sign-off recorded"
        >
          The position can now be created through the authorized hiring flow.
          Runtime setup is tracked separately.
        </HireRecovery>
      </HirePage>
    );
  }

  if (showRejected) {
    return (
      <HirePage testId="hire-handoff">
        <HireTitle title="Hire proposal" />
        <div className="colony-hire-handoff" data-columns="2">
          <StageDetails
            askerLabel={askerLabel}
            askRecord={askRecord}
            onReadProposal={onReadProposal}
            record={record}
          />
          <section className="colony-hire-card colony-hire-handoff-card">
            <h2>Request declined</h2>
            <p>
              {record.head.denialReason ?? askRecord.head.resolution?.reason}
            </p>
          </section>
        </div>
      </HirePage>
    );
  }

  if (!mayReview) {
    return (
      <HirePage testId="hire-handoff">
        <HireTitle title="Hire proposal" />
        <HireRecovery
          action={
            <HireButton onClick={onRetry} size="md" variant="outline">
              Refresh record
            </HireButton>
          }
          title="This proposal is not waiting for your decision"
        >
          Refresh the shared record before taking another action.
        </HireRecovery>
      </HirePage>
    );
  }

  const founderReview = showFounderReview;
  const actionLabel = founderReview
    ? "Sign off hire"
    : currentRole === "owner"
      ? "Sign off hire"
      : "Approve and refer to founder";

  return (
    <HirePage testId="hire-handoff">
      <HireTitle title="Hire proposal" />
      <div className="colony-hire-handoff" data-columns="2">
        <StageDetails
          askerLabel={askerLabel}
          askRecord={askRecord}
          onReadProposal={onReadProposal}
          record={record}
        />
        <section className="colony-hire-card colony-hire-handoff-card">
          <h2>{founderReview ? "Founder sign-off" : "Your review"}</h2>
          <HireBanner>
            <strong>
              {founderReview || currentRole === "owner"
                ? "You are the founder"
                : "Approval is a referral"}
            </strong>{" "}
            {founderReview || currentRole === "owner"
              ? "Check the exact role, scope and allowance before signing."
              : "Approving here forwards the proposal to the founder. It does not hire the employee."}
          </HireBanner>
          <form
            className="colony-hire-handoff-card"
            data-testid="hire-handoff-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDecision("approved");
            }}
          >
            <div className="colony-hire-reason">
              <label htmlFor="hire-handoff-reason">Reason</label>
              <textarea
                aria-describedby="hire-handoff-reason-count"
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
              <small id="hire-handoff-reason-count">
                {reason.length} / 1,000 characters · Required
              </small>
            </div>
            {reasonInvalid ? (
              <p className="colony-hire-error" role="alert">
                Enter a reason between 1 and 1,000 characters.
              </p>
            ) : null}
            {failure ? (
              <div
                className="colony-hire-error-box"
                data-testid="hire-handoff-error"
                role="alert"
              >
                <strong>Could not save</strong>
                <p>
                  Your inputs are kept. Review them or retry without starting
                  again.
                </p>
              </div>
            ) : null}
            <div className="colony-hire-handoff-actions">
              <HireButton
                disabled={submitting}
                size="md"
                testId="hire-handoff-approve"
                type="submit"
              >
                {actionLabel}
              </HireButton>
              <HireButton
                disabled={submitting}
                onClick={() => void submitDecision("rejected")}
                size="md"
                testId="hire-handoff-decline"
                variant="outline"
              >
                Decline with a reason
              </HireButton>
            </div>
          </form>
        </section>
      </div>
    </HirePage>
  );
}
