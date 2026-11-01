import { useState } from "react";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import "./cofounderPhase2.css";
import type { GapNeedsYouItem } from "../accessRecords";
import type {
  NeedsYouActionId,
  NeedsYouItem,
  NeedsYouModel,
} from "../needsYou";
import type { PlanView } from "../planRecords";
import { CofounderRelayPlanCard } from "./CofounderRelayPlanCard";
import { MoneyRailPaymentCard } from "./MoneyRailPaymentCard";
import { useMoneyRailsSnapshot } from "../moneyRailsBridge";

function PlanStepNeedsYouCard({
  item,
  onAction,
}: {
  item: NeedsYouItem;
  onAction: (
    item: NeedsYouItem,
    action: NeedsYouActionId,
  ) => void | Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<NeedsYouActionId | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  if (item.source.kind !== "plan" || !item.source.stepId) return null;
  const source = item.source;

  async function runAction(action: NeedsYouActionId) {
    setPendingAction(action);
    setError(null);
    try {
      await onAction(item, action);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not update this plan step.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <article
      className="cf2-card cf2-needs-card"
      data-testid={`cofounder-plan-step-item-${source.planId}-${source.stepId}`}
    >
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <strong>{item.title}</strong>
          {item.subtitle ? <small>{item.subtitle}</small> : null}
        </span>
      </div>
      <div className="cf2-actions">
        {item.actions.map((action) => (
          <button
            aria-label={`${action.label}: ${item.title}`}
            className={`cf2-button${
              action.tone === "primary"
                ? " cf2-button-primary"
                : action.tone === "danger"
                  ? " cf2-button-danger"
                  : ""
            }`}
            data-testid={`cofounder-plan-step-action-${action.id}-${source.planId}-${source.stepId}`}
            disabled={pendingAction !== null}
            key={action.id}
            onClick={() => void runAction(action.id)}
            type="button"
          >
            {pendingAction === action.id ? `${action.label}…` : action.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="cf2-error-note" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function LiveNeedsYouItemCard({
  item,
  onOpen,
}: {
  item: NeedsYouItem;
  onOpen: (item: NeedsYouItem) => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label =
    item.source.kind === "whatsapp_batch"
      ? "Review batch"
      : item.section === "approve"
        ? "Review ask"
        : item.section === "do"
          ? "Open task"
          : "Answer";
  return (
    <article
      className="cf2-card cf2-needs-card"
      data-testid={`cofounder-live-needs-you-${item.id}`}
    >
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <strong>{item.title}</strong>
          {item.subtitle ? <small>{item.subtitle}</small> : null}
        </span>
      </div>
      <div className="cf2-actions">
        <button
          aria-label={`${label}: ${item.title}`}
          className="cf2-button cf2-button-primary"
          data-testid={`cofounder-open-live-needs-you-${item.id}`}
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            void Promise.resolve(onOpen(item))
              .catch((actionError: unknown) =>
                setError(
                  actionError instanceof Error
                    ? actionError.message
                    : "Could not open this item.",
                ),
              )
              .finally(() => setPending(false));
          }}
          type="button"
        >
          {pending ? "Opening…" : label}
        </button>
      </div>
      {error ? (
        <p className="cf2-error-note" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function WhatsAppDraftNeedsYouCard({
  item,
  onAction,
}: {
  item: NeedsYouItem;
  onAction: (
    draftId: string,
    decision: "approve" | "reject",
    text?: string,
  ) => void | Promise<void>;
}) {
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editedMessage, setEditedMessage] = useState("");
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    draftId: string,
    decision: "approve" | "reject",
    text?: string,
  ) {
    setPendingDraftId(draftId);
    setError(null);
    try {
      await onAction(draftId, decision, text);
      if (editingDraftId === draftId) setEditingDraftId(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not update this reply draft.",
      );
    } finally {
      setPendingDraftId(null);
    }
  }

  return (
    <article
      className="cf2-card cf2-needs-card"
      data-testid={`cofounder-live-needs-you-${item.id}`}
    >
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <strong>{item.title}</strong>
          {item.subtitle ? <small>{item.subtitle}</small> : null}
        </span>
      </div>
      <div className="cf2-draft-list">
        {item.details.map((draft) => (
          <div
            className="cf2-draft-row"
            data-testid={`cofounder-draft-${draft.id}`}
            key={draft.id}
          >
            <span
              aria-hidden="true"
              className="cf2-person-tile cf2-person-tile-small"
            >
              {draft.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="cf2-draft-copy">
              <strong>{draft.label}</strong>
              {editingDraftId === draft.id ? (
                <label className="cf2-draft-edit">
                  Message to {draft.label}
                  <textarea
                    aria-label={`Message to ${draft.label}`}
                    className="cf2-draft-input"
                    onChange={(event) =>
                      setEditedMessage(event.currentTarget.value)
                    }
                    rows={3}
                    value={editedMessage}
                  />
                </label>
              ) : (
                <span>{draft.text}</span>
              )}
            </span>
            <div className="cf2-actions cf2-draft-actions">
              {editingDraftId === draft.id ? (
                <>
                  <button
                    className="cf2-button cf2-button-primary"
                    data-testid={`cofounder-save-draft-${draft.id}`}
                    disabled={!editedMessage.trim() || pendingDraftId !== null}
                    onClick={() =>
                      void decide(draft.id, "approve", editedMessage.trim())
                    }
                    type="button"
                  >
                    {pendingDraftId === draft.id ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    className="cf2-button"
                    disabled={pendingDraftId !== null}
                    onClick={() => setEditingDraftId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    aria-label={`Send draft to ${draft.label}`}
                    className="cf2-button cf2-button-primary"
                    data-testid={`cofounder-send-draft-${draft.id}`}
                    disabled={pendingDraftId !== null}
                    onClick={() => void decide(draft.id, "approve")}
                    type="button"
                  >
                    {pendingDraftId === draft.id ? "Sending…" : "Send"}
                  </button>
                  <button
                    aria-label={`Edit draft to ${draft.label}`}
                    className="cf2-button"
                    disabled={pendingDraftId !== null}
                    onClick={() => {
                      setEditedMessage(draft.text);
                      setEditingDraftId(draft.id);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    aria-label={`Discard draft to ${draft.label}`}
                    className="cf2-button cf2-button-danger"
                    data-testid={`cofounder-discard-draft-${draft.id}`}
                    disabled={pendingDraftId !== null}
                    onClick={() => void decide(draft.id, "reject")}
                    type="button"
                  >
                    Discard
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {error ? (
        <p className="cf2-error-note" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function CapabilityGapCard({
  item,
  onAction,
  onOpenBrowser,
}: {
  item: GapNeedsYouItem;
  onAction: (
    item: GapNeedsYouItem,
    action: "gap_approve" | "gap_decline" | "gap_done",
  ) => void | Promise<void>;
  onOpenBrowser: (url: string) => void | Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: "gap_approve" | "gap_decline" | "gap_done") {
    setPendingAction(action);
    setError(null);
    try {
      await onAction(item, action);
      if (action === "gap_approve" && item.pageUrl) {
        await onOpenBrowser(item.pageUrl);
      }
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not update this capability gap.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function openBrowser() {
    if (!item.pageUrl) return;
    setPendingAction("open-browser");
    setError(null);
    try {
      await onOpenBrowser(item.pageUrl);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not open the browser page.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <article
      className="cf2-card cf2-needs-card"
      data-testid={`cofounder-capability-gap-${item.gapId}`}
    >
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <strong>{item.title}</strong>
          <small>{item.detail}</small>
        </span>
      </div>
      {item.group === "approve" ? (
        <>
          <p>{item.costText ? `Chosen option: ${item.costText}` : "No cost"}</p>
          <div className="cf2-actions">
            <button
              aria-label={`Approve ${item.title} for ${item.costText || "no cost"}`}
              className="cf2-button cf2-button-primary"
              data-testid={`cofounder-gap-approve-${item.gapId}`}
              disabled={pendingAction !== null}
              onClick={() => void runAction("gap_approve")}
              type="button"
            >
              {pendingAction === "gap_approve"
                ? "Approving…"
                : item.pageUrl
                  ? "Approve and open browser"
                  : "Approve cost"}
            </button>
            <button
              aria-label={`Decline ${item.title}`}
              className="cf2-button"
              data-testid={`cofounder-gap-decline-${item.gapId}`}
              disabled={pendingAction !== null}
              onClick={() => void runAction("gap_decline")}
              type="button"
            >
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="cf2-browser-ready">
            <span aria-hidden="true" className="cf2-browser-glyph">
              ◎
            </span>
            <span>
              <strong>{item.humanStep}</strong>
              <small>
                {item.costText
                  ? `Approved cost: ${item.costText}`
                  : "Approved with no cost"}
              </small>
            </span>
          </div>
          <div className="cf2-actions">
            {item.pageUrl ? (
              <button
                aria-label={`Open browser for ${item.title}`}
                className="cf2-button cf2-button-primary"
                data-testid={`cofounder-gap-open-browser-${item.gapId}`}
                disabled={pendingAction !== null}
                onClick={() => void openBrowser()}
                type="button"
              >
                {pendingAction === "open-browser" ? "Opening…" : "Open browser"}
              </button>
            ) : null}
            <button
              aria-label={`Done: ${item.humanStep}`}
              className="cf2-button"
              data-testid={`cofounder-gap-done-${item.gapId}`}
              disabled={pendingAction !== null}
              onClick={() => void runAction("gap_done")}
              type="button"
            >
              {pendingAction === "gap_done" ? "Saving…" : "Done"}
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className="cf2-error-note" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

export function CofounderNeedsYouScreen({
  liveNeedsYou,
  livePlans,
  liveCapabilityGaps,
  whatsappError,
  onPlanStepAction,
  onCapabilityGapAction,
  onOpenItem,
  onWhatsAppDraftAction,
  onOpenCapabilityGapBrowser,
}: {
  liveNeedsYou: NeedsYouModel;
  livePlans: readonly PlanView[];
  liveCapabilityGaps: readonly GapNeedsYouItem[];
  whatsappError: Error | null;
  onPlanStepAction: (
    item: NeedsYouItem,
    action: NeedsYouActionId,
  ) => void | Promise<void>;
  onCapabilityGapAction: (
    item: GapNeedsYouItem,
    action: "gap_approve" | "gap_decline" | "gap_done",
  ) => void | Promise<void>;
  onOpenItem: (item: NeedsYouItem) => void | Promise<void>;
  onWhatsAppDraftAction: (
    draftId: string,
    decision: "approve" | "reject",
    text?: string,
  ) => void | Promise<void>;
  onOpenCapabilityGapBrowser: (url: string) => void | Promise<void>;
}) {
  const moneyRails = useMoneyRailsSnapshot();
  const moneyApprovals = moneyRails.paymentLinks.filter(
    (card) => card.state === "needs_you",
  );
  const liveCapabilityGapApprovals = liveCapabilityGaps.filter(
    (item) => item.group === "approve",
  );
  const liveCapabilityGapDoItems = liveCapabilityGaps.filter(
    (item) => item.group === "do",
  );
  const approvalCount =
    liveNeedsYou.approve.length +
    liveCapabilityGapApprovals.length +
    moneyApprovals.length;
  const doCount = liveNeedsYou.do.length + liveCapabilityGapDoItems.length;
  const decideCount = liveNeedsYou.decide.length;
  const total = approvalCount + doCount + decideCount;

  return (
    <div className="cf2-screen" data-testid="cofounder-needs-you-screen">
      <AppTopChromePortal>
        <nav aria-label="Breadcrumb" className="cf2-breadcrumb">
          <a href="#/today">Today</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Needs you</span>
        </nav>
      </AppTopChromePortal>
      <main className="cf2-page">
        <header className="cf2-page-heading">
          <h1>Needs you</h1>
          <p>{total} things, each one step. Scout prepared everything else.</p>
        </header>
        {whatsappError ? (
          <p className="cf2-error-note" role="status">
            Some WhatsApp items could not be loaded. Refresh to try again.
          </p>
        ) : null}

        <section aria-label="Approve" className="cf2-needs-group">
          <h2>Approve · {approvalCount}</h2>
          {moneyRails.availability === "loading" ? (
            <p className="cf2-error-note" role="status">
              Loading payment approvals…
            </p>
          ) : moneyRails.availability === "not_ready" ? (
            <p className="cf2-error-note" role="status">
              Money connections are not enabled on this relay yet.
            </p>
          ) : moneyRails.availability === "error" ? (
            <p className="cf2-error-note" role="alert">
              Payment approvals could not be loaded. Refresh to try again.
            </p>
          ) : null}
          {moneyApprovals.map((card) => (
            <MoneyRailPaymentCard card={card} key={card.id} />
          ))}
          {liveNeedsYou.approve.map((item) => {
            if (item.source.kind === "plan") {
              if (item.source.stepId !== null) {
                return (
                  <PlanStepNeedsYouCard
                    item={item}
                    key={item.id}
                    onAction={onPlanStepAction}
                  />
                );
              }
              const planId = item.source.planId;
              const plan = livePlans.find(
                (candidate) => candidate.planId === planId,
              );
              return plan ? (
                <CofounderRelayPlanCard key={plan.planId} plan={plan} />
              ) : null;
            }
            if (item.source.kind === "whatsapp_drafts") {
              return (
                <WhatsAppDraftNeedsYouCard
                  item={item}
                  key={item.id}
                  onAction={onWhatsAppDraftAction}
                />
              );
            }
            return (
              <LiveNeedsYouItemCard
                item={item}
                key={item.id}
                onOpen={onOpenItem}
              />
            );
          })}
          {liveCapabilityGapApprovals.map((item) => (
            <CapabilityGapCard
              item={item}
              key={item.gapId}
              onAction={onCapabilityGapAction}
              onOpenBrowser={onOpenCapabilityGapBrowser}
            />
          ))}
          {approvalCount === 0 ? (
            <p className="cf2-empty-note">Nothing needs approval right now.</p>
          ) : null}
        </section>

        <section aria-label="Do" className="cf2-needs-group">
          <h2>Do · {doCount}</h2>
          {liveNeedsYou.do.map((item) =>
            item.source.kind === "plan" ? (
              <PlanStepNeedsYouCard
                item={item}
                key={item.id}
                onAction={onPlanStepAction}
              />
            ) : (
              <LiveNeedsYouItemCard
                item={item}
                key={item.id}
                onOpen={onOpenItem}
              />
            ),
          )}
          {liveCapabilityGapDoItems.map((item) => (
            <CapabilityGapCard
              item={item}
              key={item.gapId}
              onAction={onCapabilityGapAction}
              onOpenBrowser={onOpenCapabilityGapBrowser}
            />
          ))}
          {doCount === 0 ? (
            <p className="cf2-empty-note">No human steps are waiting.</p>
          ) : null}
        </section>

        <section aria-label="Decide" className="cf2-needs-group">
          <h2>Decide · {decideCount}</h2>
          {liveNeedsYou.decide.map((item) => (
            <LiveNeedsYouItemCard
              item={item}
              key={item.id}
              onOpen={onOpenItem}
            />
          ))}
          {decideCount === 0 ? (
            <p className="cf2-empty-note">No decisions are waiting.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
