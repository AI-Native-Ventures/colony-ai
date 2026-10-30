import { useState } from "react";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";

import "./cofounderPhase2.css";
import type { GapNeedsYouItem } from "../accessRecords";
import type { AccessRow } from "../accessRecords";

const ACCESS_GLYPHS: Record<string, string> = {
  whatsapp: "◉",
  gmail: "◎",
  pinterest: "◎",
  "google-calendar": "▦",
  esign: "✎",
  discovery: "⌕",
};

function accessGlyph(entryId: string) {
  return ACCESS_GLYPHS[entryId] ?? "◌";
}

function PendingAccessCard({
  item,
  onApprove,
  onDecline,
}: {
  item: GapNeedsYouItem;
  onApprove: (item: GapNeedsYouItem) => void | Promise<void>;
  onDecline: (item: GapNeedsYouItem) => void | Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<
    "approve" | "decline" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: "approve" | "decline") {
    setPendingAction(action);
    setError(null);
    try {
      await (action === "approve" ? onApprove(item) : onDecline(item));
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not update this access request.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      aria-label="Pending access request"
      className="cf2-card cf2-access-request"
      data-testid={`cofounder-access-pending-${item.gapId}`}
    >
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <span className="cf2-chip cf2-chip-warm">Pending</span>
          <small>Asked today</small>
          <strong>Scout asks to {item.title}</strong>
        </span>
      </div>
      <p>{item.detail}</p>
      <p>{item.costText ? `Chosen option: ${item.costText}` : "No cost"}</p>
      <div className="cf2-actions">
        <button
          className="cf2-button cf2-button-primary"
          data-testid={`cofounder-access-approve-${item.gapId}`}
          disabled={pendingAction !== null}
          onClick={() => void runAction("approve")}
          type="button"
        >
          {pendingAction === "approve"
            ? "Approving…"
            : item.pageUrl
              ? "Approve and open browser"
              : "Approve cost"}
        </button>
        <button
          className="cf2-button"
          data-testid={`cofounder-access-decline-${item.gapId}`}
          disabled={pendingAction !== null}
          onClick={() => void runAction("decline")}
          type="button"
        >
          {pendingAction === "decline" ? "Saving…" : "Not now"}
        </button>
      </div>
      {error ? (
        <p className="cf2-error-note" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function CofounderAccessScreen({
  pendingGaps,
  entries,
  onRevoke,
  onApproveGap,
  onDeclineGap,
}: {
  pendingGaps: readonly GapNeedsYouItem[];
  entries: readonly AccessRow[];
  onRevoke: (entry: AccessRow) => void | Promise<void>;
  onApproveGap: (item: GapNeedsYouItem) => void | Promise<void>;
  onDeclineGap: (item: GapNeedsYouItem) => void | Promise<void>;
}) {
  const [pendingAccessId, setPendingAccessId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function revoke(entry: AccessRow) {
    setPendingAccessId(entry.accessId);
    setActionError(null);
    try {
      await onRevoke(entry);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not revoke access.",
      );
    } finally {
      setPendingAccessId(null);
    }
  }

  return (
    <div className="cf2-screen" data-testid="cofounder-access-screen">
      <AppTopChromePortal>
        <nav aria-label="Breadcrumb" className="cf2-breadcrumb">
          <a href="#/company/map">Company</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Access</span>
        </nav>
      </AppTopChromePortal>
      <main className="cf2-page">
        <header className="cf2-page-heading">
          <h1>Access</h1>
          <p>
            Every tool and account Scout and your agents can use. Revoke any of
            them at once.
          </p>
        </header>

        {pendingGaps.map((item) => (
          <PendingAccessCard
            item={item}
            key={item.gapId}
            onApprove={onApproveGap}
            onDecline={onDeclineGap}
          />
        ))}

        <div className="cf2-access-table-wrap">
          <table className="cf2-access-table">
            <thead>
              <tr>
                <th scope="col">Tool or account</th>
                <th scope="col">Used for</th>
                <th scope="col">Who</th>
                <th scope="col">Cost</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr
                  data-testid={`cofounder-access-${row.accessId}`}
                  key={row.accessId}
                >
                  <th scope="row">
                    <span aria-hidden="true" className="cf2-access-glyph">
                      {accessGlyph(row.accessId)}
                    </span>
                    {row.entry.name}
                    {row.state === "revoked" ? <small>Revoked</small> : null}
                  </th>
                  <td>{row.entry.usedFor}</td>
                  <td>
                    {row.entry.agents.length === 0
                      ? "All agents"
                      : `${row.entry.agents.length} selected ${row.entry.agents.length === 1 ? "agent" : "agents"}`}
                  </td>
                  <td>{row.entry.cost}</td>
                  <td>
                    {row.state === "active" ? (
                      <button
                        aria-label={`Revoke access to ${row.entry.name}`}
                        className="cf2-button cf2-button-danger"
                        data-testid={`cofounder-access-revoke-${row.accessId}`}
                        disabled={pendingAccessId === row.accessId}
                        onClick={() => void revoke(row)}
                        type="button"
                      >
                        {pendingAccessId === row.accessId
                          ? "Revoking…"
                          : "Revoke"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <section aria-label="Tools and accounts" className="cf2-access-cards">
            {entries.map((row) => (
              <article
                className="cf2-card cf2-access-row"
                data-testid={`cofounder-access-mobile-${row.accessId}`}
                key={row.accessId}
              >
                <div className="cf2-access-row-heading">
                  <span aria-hidden="true" className="cf2-access-glyph">
                    {accessGlyph(row.accessId)}
                  </span>
                  <strong>{row.entry.name}</strong>
                  {row.state === "revoked" ? <small>Revoked</small> : null}
                </div>
                <dl>
                  <dt>Used for</dt>
                  <dd>{row.entry.usedFor}</dd>
                  <dt>Who</dt>
                  <dd>
                    {row.entry.agents.length === 0
                      ? "All agents"
                      : `${row.entry.agents.length} selected ${row.entry.agents.length === 1 ? "agent" : "agents"}`}
                  </dd>
                  <dt>Cost</dt>
                  <dd>{row.entry.cost}</dd>
                </dl>
                {row.state === "active" ? (
                  <button
                    aria-label={`Revoke access to ${row.entry.name}`}
                    className="cf2-button cf2-button-danger"
                    disabled={pendingAccessId === row.accessId}
                    onClick={() => void revoke(row)}
                    type="button"
                  >
                    {pendingAccessId === row.accessId ? "Revoking…" : "Revoke"}
                  </button>
                ) : null}
              </article>
            ))}
          </section>
        </div>
        {actionError ? (
          <p className="cf2-error-note" role="alert">
            {actionError}
          </p>
        ) : null}
        <p className="cf2-worker-access-note">
          Workers never get tools or accounts. They only produce material for
          the agent that started them.
        </p>
      </main>
    </div>
  );
}
