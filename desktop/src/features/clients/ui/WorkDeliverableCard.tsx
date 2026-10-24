import type {
  DeliverableApproval,
  DeliverablePointer,
  DeliverableVersion,
  EventRecord,
} from "@/features/clients/lib/businessRecords";
import {
  clockTime,
  dayLabel,
  onDayLabel,
  whenLabel,
} from "@/features/clients/lib/formatWhen";
import type { PersonInfo } from "@/features/clients/lib/usePeople";
import { PersonAvatar } from "@/features/clients/ui/BusinessBits";
import { truncatePubkey } from "@/shared/lib/pubkey";

const MAX_DELIVERABLE_PREVIEW_CHARS = 12_000;

export function decisionLabel(decision: string): string {
  switch (decision) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    case "rejected":
      return "Rejected";
    default:
      return decision;
  }
}

export function jsonBodyParts(body: unknown): {
  title: string;
  content: string;
} {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    return {
      title: typeof record.title === "string" ? record.title : "",
      content:
        typeof record.content === "string"
          ? record.content
          : JSON.stringify(body, null, 2),
    };
  }
  return { title: "", content: JSON.stringify(body, null, 2) };
}

function eventTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(createdAt * 1_000));
}

export type WorkDeliverableCardProps = {
  allVersions: EventRecord<DeliverableVersion>[];
  approvals: EventRecord<DeliverableApproval>[];
  canMutateWork: boolean;
  canReview: boolean;
  editingDisabled: boolean;
  onNewVersion: (
    pointer: DeliverablePointer,
    body: { title: string; content: string } | null,
  ) => void;
  onReview: (
    pointer: DeliverablePointer,
    version: EventRecord<DeliverableVersion>,
    decision: "approved" | "changes_requested",
  ) => void;
  person: (pubkey: string) => PersonInfo;
  personName: (pubkey: string) => string;
  pointer: DeliverablePointer;
  versionApprovals: EventRecord<DeliverableApproval>[];
  versionRecord: EventRecord<DeliverableVersion> | null;
};

/**
 * One deliverable of a work item: its current version (text), who shared it,
 * the review actions, and the version history. An approved deliverable folds
 * to a single line.
 */
export function WorkDeliverableCard({
  allVersions,
  approvals,
  canMutateWork,
  canReview,
  editingDisabled,
  onNewVersion,
  onReview,
  person,
  personName,
  pointer,
  versionApprovals,
  versionRecord,
}: WorkDeliverableCardProps) {
  const body = versionRecord ? jsonBodyParts(versionRecord.value.body) : null;
  const currentApproval = versionApprovals[0] ?? null;
  const decision = currentApproval?.value.decision ?? null;
  const title =
    body?.title || `Deliverable ${truncatePubkey(pointer.deliverableId)}`;
  const newVersionButton =
    canMutateWork && versionRecord && !editingDisabled ? (
      <button
        className="b3-link-btn"
        onClick={() => onNewVersion(pointer, body)}
        type="button"
      >
        New version
      </button>
    ) : null;

  const history = (
    <details className="b3-history">
      <summary>Version history</summary>
      <ol>
        {allVersions.map((record) => {
          const versionBody = jsonBodyParts(record.value.body);
          const versionReview = approvals
            .filter(
              (approval) => approval.value.versionEventId === record.event.id,
            )
            .sort(
              (left, right) => right.event.created_at - left.event.created_at,
            )[0];
          return (
            <li key={record.event.id}>
              <span className="b3-history-v">v{record.value.version}</span>
              <span className="b3-history-copy">
                <span className="b3-history-text">
                  {versionBody.title || `Version ${record.value.version}`}
                  {record.event.id === pointer.versionEventId
                    ? " · Current"
                    : ""}
                </span>
                {versionReview?.value.note ? (
                  <span className="b3-history-text">
                    {decisionLabel(versionReview.value.decision)}
                    {" by "}
                    {personName(versionReview.event.pubkey)}:{" "}
                    {versionReview.value.note}
                  </span>
                ) : null}
                <span className="b3-history-meta">
                  {personName(record.event.pubkey)} ·{" "}
                  {whenLabel(record.event.created_at)}
                  {versionReview
                    ? ` · ${decisionLabel(versionReview.value.decision)}`
                    : " · Needs review"}
                </span>
              </span>
            </li>
          );
        })}
        {allVersions.length === 0 ? (
          <li>
            <span className="b3-history-text">
              No version event is available for this pointer.
            </span>
          </li>
        ) : null}
      </ol>
    </details>
  );

  if (decision === "approved" && versionRecord && currentApproval) {
    return (
      <article className="b3-deliverable-card" data-compact="true">
        <div className="b3-deliverable-compact-copy">
          <h3 className="b3-deliverable-name-h">{title}</h3>
          <span className="b3-deliverable-sub">
            Version {versionRecord.value.version} · approved by{" "}
            {personName(currentApproval.event.pubkey)} on{" "}
            {dayLabel(currentApproval.event.created_at)}
          </span>
        </div>
        <span className="b3-pill" data-tone="ok">
          <svg
            aria-hidden="true"
            fill="none"
            height="12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3.2"
            viewBox="0 0 24 24"
            width="12"
          >
            <path d="m5 12 5 5 9-10" />
          </svg>
          Approved
        </span>
        {newVersionButton}
        <div className="b3-fill-row">{history}</div>
      </article>
    );
  }

  return (
    <article className="b3-deliverable-card">
      <div className="b3-deliverable-title-row">
        <h3 className="b3-deliverable-name-h">{title}</h3>
        <span className="b3-pill">
          {versionRecord
            ? `Version ${versionRecord.value.version}`
            : "Current version unavailable"}
        </span>
        <span
          className="b3-pill"
          data-tone={decision === "rejected" ? "bad" : "need"}
        >
          {decision ? decisionLabel(decision) : "Needs review"}
        </span>
        <span className="b3-spacer">{newVersionButton}</span>
      </div>
      {body?.content ? (
        <div className="b3-preview">
          {body.content.slice(0, MAX_DELIVERABLE_PREVIEW_CHARS)}
          {body.content.length > MAX_DELIVERABLE_PREVIEW_CHARS ? (
            <p>
              Preview truncated. Open the exact version in the client channel
              for the complete record.
            </p>
          ) : null}
        </div>
      ) : null}
      {currentApproval?.value.note ? (
        <div className="b3-review-note">
          <small>
            Latest review from {personName(currentApproval.event.pubkey)} ·{" "}
            {eventTime(currentApproval.event.created_at)}
          </small>
          <p>{currentApproval.value.note}</p>
        </div>
      ) : null}
      <div className="b3-share-line">
        {versionRecord ? (
          <span className="b3-share-who">
            <PersonAvatar
              person={person(versionRecord.event.pubkey)}
              size={26}
            />
            {personName(versionRecord.event.pubkey)} shared version{" "}
            {versionRecord.value.version}{" "}
            {onDayLabel(versionRecord.event.created_at)} at{" "}
            {clockTime(versionRecord.event.created_at)}
          </span>
        ) : null}
        <span className="b3-spacer" />
        {canReview && !editingDisabled && versionRecord ? (
          <>
            <button
              className="b3-btn"
              data-size="action"
              onClick={() =>
                onReview(pointer, versionRecord, "changes_requested")
              }
              type="button"
            >
              Request changes
            </button>
            <button
              className="b3-btn"
              data-size="action"
              data-variant="primary"
              onClick={() => onReview(pointer, versionRecord, "approved")}
              type="button"
            >
              Approve version
            </button>
          </>
        ) : null}
      </div>
      {history}
    </article>
  );
}
