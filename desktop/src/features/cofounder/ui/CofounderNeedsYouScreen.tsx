import { useState } from "react";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useProfileQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import "./cofounderPhase2.css";
import {
  groupNeedsYouRows,
  needsYouRowCopy,
  needsYouRowOpenLabel,
  needsYouRowPreparer,
} from "./needsYou/needsYouRows";
import type { NeedsYouRow } from "./needsYou/needsYouRows";

export type NeedsYouRowDecision = "yes" | "no";

function rowAvatar(
  row: NeedsYouRow,
  className: string,
  selfPubkey: string | null,
  selfProfile: { displayName: string | null; avatarUrl: string | null } | null,
) {
  const pubkey = needsYouRowPreparer(row)?.toLowerCase() ?? null;
  if (pubkey && pubkey === selfPubkey) {
    const name = selfProfile?.displayName?.trim() || "You";
    return (
      <div aria-hidden="true" className="needs-you-avatar-wrap">
        <ProfileAvatar
          avatarUrl={selfProfile?.avatarUrl ?? null}
          className={className}
          label={name}
          pubkey={pubkey}
          shape="circle"
        />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="needs-you-avatar-wrap">
      <EmployeeAvatar
        className={className}
        name={pubkey ? "Company agent" : "Company"}
        pubkey={pubkey}
      />
    </div>
  );
}

function NeedsYouRowCard({
  row,
  selfPubkey,
  selfProfile,
  onAction,
  onOpen,
}: {
  row: NeedsYouRow;
  selfPubkey: string | null;
  selfProfile: { displayName: string | null; avatarUrl: string | null } | null;
  onAction: (
    row: NeedsYouRow,
    decision: NeedsYouRowDecision,
  ) => void | Promise<void>;
  onOpen: (row: NeedsYouRow) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<NeedsYouRowDecision | "open" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const copy = needsYouRowCopy(row);

  async function run(action: NeedsYouRowDecision | "open") {
    setPending(action);
    setError(null);
    try {
      if (action === "open") await onOpen(row);
      else await onAction(row, action);
    } catch {
      setError(
        action === "open"
          ? "Could not open this item. Try again."
          : "Could not save. Try again.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <article
      className={`needs-you-row${error ? " has-error" : ""}`}
      data-row-id={row.id}
      data-source-kind={
        row.kind === "item" || row.kind === "draft"
          ? row.item.source.kind
          : row.kind
      }
      data-testid="needs-you-row"
    >
      <button
        aria-label={needsYouRowOpenLabel(row)}
        className="needs-you-row-main"
        data-testid={`needs-you-open-${row.id}`}
        disabled={pending !== null}
        onClick={() => void run("open")}
        type="button"
      >
        {rowAvatar(row, "needs-you-row-avatar", selfPubkey, selfProfile)}
        <span className="needs-you-row-copy">
          <strong>{copy.title}</strong>
          <small>{copy.subtitle}</small>
        </span>
      </button>
      <fieldset className="needs-you-row-actions">
        <legend className="sr-only">Actions for {copy.title}</legend>
        <button
          aria-label={`${copy.yesLabel}: ${copy.title}`}
          className="needs-you-row-yes"
          data-testid={`needs-you-action-yes-${row.id}`}
          disabled={pending !== null}
          onClick={() => void run("yes")}
          type="button"
        >
          {pending === "yes" ? "Saving…" : copy.yesLabel}
        </button>
        {copy.noLabel ? (
          <button
            aria-label={`${copy.noLabel}: ${copy.title}`}
            className="needs-you-row-no"
            data-testid={`needs-you-action-no-${row.id}`}
            disabled={pending !== null}
            onClick={() => void run("no")}
            type="button"
          >
            {pending === "no" ? "Saving…" : copy.noLabel}
          </button>
        ) : null}
      </fieldset>
      {error ? (
        <p className="needs-you-row-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

export function CofounderNeedsYouScreen({
  rows,
  sharedTotal,
  statusMessage,
  onAction,
  onOpenRow,
}: {
  rows: readonly NeedsYouRow[];
  sharedTotal: number;
  statusMessage: string | null;
  onAction: (
    row: NeedsYouRow,
    decision: NeedsYouRowDecision,
  ) => void | Promise<void>;
  onOpenRow: (row: NeedsYouRow) => void | Promise<void>;
}) {
  const membership = useMyRelayMembershipQuery();
  const profileQuery = useProfileQuery(Boolean(membership.data?.pubkey));
  const selfPubkey = membership.data?.pubkey?.toLowerCase() ?? null;
  const selfProfile = profileQuery.data
    ? {
        displayName: profileQuery.data.displayName,
        avatarUrl: profileQuery.data.avatarUrl,
      }
    : null;
  const groups = groupNeedsYouRows(rows);

  return (
    <div
      className="cf2-screen needs-you-screen"
      data-testid="cofounder-needs-you-screen"
    >
      <AppTopChromePortal>
        <nav aria-label="Breadcrumb" className="cf2-breadcrumb">
          <a href="#/today">Today</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Needs you</span>
        </nav>
      </AppTopChromePortal>
      <main className="needs-you-page">
        <header className="needs-you-heading">
          <h1>Needs you</h1>
          <p
            data-row-count={rows.length}
            data-summary-total={sharedTotal}
            data-testid="needs-you-shared-total"
          >
            {sharedTotal} {sharedTotal === 1 ? "thing" : "things"}. Nothing goes
            out until you say yes.
          </p>
        </header>
        {statusMessage ? (
          <p className="needs-you-status" role="status">
            {statusMessage}
          </p>
        ) : null}
        {groups.length === 0 ? (
          <p className="needs-you-empty" data-testid="needs-you-empty">
            Nothing needs you right now.
          </p>
        ) : (
          <div className="needs-you-groups">
            {groups.map((group) => (
              <section
                aria-label={group.label}
                className="needs-you-group"
                key={group.functionId ?? "company"}
              >
                <h2>
                  {group.label.toLocaleUpperCase()} · {group.rows.length}
                </h2>
                <div className="needs-you-group-rows">
                  {group.rows.map((row) => (
                    <NeedsYouRowCard
                      key={row.id}
                      onAction={onAction}
                      onOpen={onOpenRow}
                      row={row}
                      selfProfile={selfProfile}
                      selfPubkey={selfPubkey}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
