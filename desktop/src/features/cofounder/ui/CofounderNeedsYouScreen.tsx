import { useState } from "react";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import "./cofounderPhase2.css";
import type {
  CofounderApprovalItem,
  CofounderDecisionItem,
  CofounderDoItem,
  CofounderNeedsYouModel,
  CofounderPlan,
} from "../cofounderPhase2Model";
import { CofounderPlanCard } from "./CofounderPlanCard";

export type NeedsYouAction =
  | "approve"
  | "reject"
  | "send"
  | "discard"
  | "approve_recommended"
  | "ask_for_changes"
  | "done"
  | "accept"
  | "decline";

function ApprovalCard({
  item,
  onAction,
  onEditDraft,
}: {
  item: CofounderApprovalItem;
  onAction: (itemId: string, action: NeedsYouAction) => void;
  onEditDraft: (draftId: string, message: string) => void;
}) {
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editedMessage, setEditedMessage] = useState("");

  if (item.kind === "reply_drafts") {
    return (
      <article className="cf2-card cf2-needs-card">
        <div className="cf2-card-title-row">
          <span aria-hidden="true" className="cf2-person-tile">
            A
          </span>
          <span>
            <strong>{item.title}</strong>
            <small>{item.summary}</small>
          </span>
        </div>
        <div className="cf2-draft-list">
          {item.drafts.map((draft) => (
            <div
              className="cf2-draft-row"
              data-testid={`cofounder-draft-${draft.id}`}
              key={draft.id}
            >
              <span
                aria-hidden="true"
                className="cf2-person-tile cf2-person-tile-small"
              >
                {draft.recipient.slice(0, 2).toUpperCase()}
              </span>
              <span className="cf2-draft-copy">
                <strong>{draft.recipient}</strong>
                {editingDraftId === draft.id ? (
                  <label className="cf2-draft-edit">
                    Message to {draft.recipient}
                    <textarea
                      aria-label={`Message to ${draft.recipient}`}
                      className="cf2-draft-input"
                      onChange={(event) =>
                        setEditedMessage(event.currentTarget.value)
                      }
                      rows={3}
                      value={editedMessage}
                    />
                  </label>
                ) : (
                  <span>{draft.message}</span>
                )}
              </span>
              <div className="cf2-actions cf2-draft-actions">
                {editingDraftId === draft.id ? (
                  <>
                    <button
                      className="cf2-button cf2-button-primary"
                      data-testid={`cofounder-save-draft-${draft.id}`}
                      disabled={!editedMessage.trim()}
                      onClick={() => {
                        const message = editedMessage.trim();
                        if (!message) return;
                        onEditDraft(draft.id, message);
                        setEditingDraftId(null);
                      }}
                      type="button"
                    >
                      Save changes
                    </button>
                    <button
                      className="cf2-button"
                      onClick={() => setEditingDraftId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      aria-label={`Send draft to ${draft.recipient}`}
                      className="cf2-button cf2-button-primary"
                      data-testid={`cofounder-send-draft-${draft.id}`}
                      onClick={() => onAction(draft.id, "send")}
                      type="button"
                    >
                      Send
                    </button>
                    <button
                      aria-label={`Edit draft to ${draft.recipient}`}
                      className="cf2-button"
                      onClick={() => {
                        setEditedMessage(draft.message);
                        setEditingDraftId(draft.id);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Discard draft to ${draft.recipient}`}
                      className="cf2-button cf2-button-danger"
                      onClick={() => onAction(draft.id, "discard")}
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
      </article>
    );
  }

  if (item.kind === "taste") {
    return (
      <article className="cf2-card cf2-needs-card">
        <div className="cf2-card-title-row">
          <span aria-hidden="true" className="cf2-scout-tile">
            S
          </span>
          <span>
            <strong>{item.title}</strong>
            <small>{item.summary}</small>
          </span>
        </div>
        <fieldset className="cf2-option-list" aria-label="Design options">
          {item.options.map((option) => {
            const selected = item.recommendedOption === option;
            return (
              <button
                aria-label={`Pick option ${option}`}
                aria-pressed={selected}
                className="cf2-option"
                key={option}
                onClick={() => onAction(`${item.id}:${option}`, "approve")}
                type="button"
              >
                <span aria-hidden="true" className="cf2-option-preview" />
                <span>
                  Option {option}
                  {selected ? (
                    <span className="cf2-recommended">Scout’s pick</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </fieldset>
        <div className="cf2-actions">
          <button
            className="cf2-button cf2-button-primary"
            data-testid={`cofounder-approve-option-${item.id}`}
            onClick={() => onAction(item.id, "approve_recommended")}
            type="button"
          >
            Approve {item.recommendedOption}
          </button>
          <button
            className="cf2-button"
            onClick={() => onAction(item.id, "ask_for_changes")}
            type="button"
          >
            Ask for changes
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="cf2-card cf2-needs-card">
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <strong>{item.title}</strong>
          <small>{item.summary}</small>
        </span>
      </div>
      <p className="cf2-card-detail">{item.detail}</p>
      <div className="cf2-actions">
        <button
          className="cf2-button cf2-button-primary"
          data-testid={`cofounder-approve-${item.id}`}
          onClick={() => onAction(item.id, "approve")}
          type="button"
        >
          Review and approve
        </button>
        <button
          className="cf2-button cf2-button-danger"
          data-testid={`cofounder-reject-${item.id}`}
          onClick={() => onAction(item.id, "reject")}
          type="button"
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function DoCard({
  item,
  onOpenBrowser,
  onAction,
}: {
  item: CofounderDoItem;
  onOpenBrowser: (url: string, channelId: string) => void;
  onAction: (itemId: string, action: NeedsYouAction) => void;
}) {
  return (
    <article className="cf2-card cf2-needs-card">
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <strong>{item.title}</strong>
          <small>{item.summary}</small>
        </span>
      </div>
      <div className="cf2-browser-ready">
        <span aria-hidden="true" className="cf2-browser-glyph">
          ◎
        </span>
        <span>
          <strong>Sign-up page is open in the browser</strong>
          <small>
            I prepared the page. Complete the human step, then tell me.
          </small>
        </span>
        <span className="cf2-chip cf2-chip-ok">{item.costLabel}</span>
      </div>
      <div className="cf2-actions">
        <button
          className="cf2-button cf2-button-primary"
          data-testid={`cofounder-open-gap-${item.id}`}
          onClick={() => onOpenBrowser(item.browserUrl, item.browserChannelId)}
          type="button"
        >
          Open browser
        </button>
        <button
          className="cf2-button"
          data-testid={`cofounder-done-${item.id}`}
          onClick={() => onAction(item.id, "done")}
          type="button"
        >
          Done
        </button>
      </div>
    </article>
  );
}

function DecisionCard({
  item,
  onAction,
}: {
  item: CofounderDecisionItem;
  onAction: (itemId: string, action: NeedsYouAction) => void;
}) {
  return (
    <article className="cf2-card cf2-needs-card">
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <strong>{item.title}</strong>
          <small>{item.summary}</small>
        </span>
      </div>
      <div className="cf2-actions">
        <button
          className="cf2-button cf2-button-primary"
          data-testid={`cofounder-decision-accept-${item.id}`}
          onClick={() => onAction(item.id, "accept")}
          type="button"
        >
          {item.acceptLabel}
        </button>
        <button
          className="cf2-button"
          data-testid={`cofounder-decision-decline-${item.id}`}
          onClick={() => onAction(item.id, "decline")}
          type="button"
        >
          {item.declineLabel}
        </button>
      </div>
    </article>
  );
}

export function CofounderNeedsYouScreen({
  model,
  onPlanApprove,
  onPlanEdit,
  onPlanReject,
  onAction,
  onEditDraft,
  onOpenBrowser,
}: {
  model: CofounderNeedsYouModel;
  onPlanApprove: (planId: string) => void;
  onPlanEdit: (planId: string, changes: { title: string }) => void;
  onPlanReject: (planId: string) => void;
  onAction: (itemId: string, action: NeedsYouAction) => void;
  onEditDraft: (draftId: string, message: string) => void;
  onOpenBrowser: (url: string, channelId: string) => void;
}) {
  const total =
    model.plans.length +
    model.approvals.length +
    model.doItems.length +
    model.decisions.length;

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

        <section aria-label="Approve" className="cf2-needs-group">
          <h2>Approve · {model.approvals.length + model.plans.length}</h2>
          {model.approvals.map((item) => (
            <ApprovalCard
              item={item}
              key={item.id}
              onAction={onAction}
              onEditDraft={onEditDraft}
            />
          ))}
          {model.plans.map((plan: CofounderPlan) => (
            <CofounderPlanCard
              key={plan.id}
              onApprove={onPlanApprove}
              onEdit={onPlanEdit}
              onReject={onPlanReject}
              plan={plan}
            />
          ))}
          {model.plans.length + model.approvals.length === 0 ? (
            <p className="cf2-empty-note">Nothing needs approval right now.</p>
          ) : null}
        </section>

        <section aria-label="Do" className="cf2-needs-group">
          <h2>Do · {model.doItems.length}</h2>
          {model.doItems.map((item) => (
            <DoCard
              item={item}
              key={item.id}
              onAction={onAction}
              onOpenBrowser={onOpenBrowser}
            />
          ))}
          {model.doItems.length === 0 ? (
            <p className="cf2-empty-note">No human steps are waiting.</p>
          ) : null}
        </section>

        <section aria-label="Decide" className="cf2-needs-group">
          <h2>Decide · {model.decisions.length}</h2>
          {model.decisions.map((item) => (
            <DecisionCard item={item} key={item.id} onAction={onAction} />
          ))}
          {model.decisions.length === 0 ? (
            <p className="cf2-empty-note">No decisions are waiting.</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
