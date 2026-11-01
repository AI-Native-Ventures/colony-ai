import { useState } from "react";
import { Check, Globe2, KeyRound, ShieldCheck } from "lucide-react";

import {
  moneyLabel,
  moneyLinkCanApprove,
  type MoneyLinkCard,
} from "../moneyRails";
import { clearMoneyLinkTaskContext } from "@/features/workarea/browser/agentBrowserAccess";
import { useMoneyRailsActions } from "../moneyRailsBridge";

type EditableFacts = {
  amount: string;
  currency: string;
  purpose: string;
  recipient: string;
  message: string;
};

function editableFacts(card: MoneyLinkCard): EditableFacts {
  return {
    amount: (card.amountMinor / 100).toFixed(2),
    currency: card.currency,
    purpose: card.purpose,
    recipient: card.recipient.address,
    message: card.message,
  };
}

function stateTone(state: MoneyLinkCard["state"]): string {
  switch (state) {
    case "needs_you":
    case "draft":
      return "cf-money-rail-chip-warm";
    case "paid":
      return "cf-money-rail-chip-success";
    case "payment_reported":
      return "cf-money-rail-chip-warn";
    case "failed":
    case "expired":
    case "cancelled":
      return "cf-money-rail-chip-muted";
    default:
      return "cf-money-rail-chip-progress";
  }
}

export function MoneyRailPaymentCard({ card }: { card: MoneyLinkCard }) {
  const { execute, getPaymentLinkDetails } = useMoneyRailsActions();
  const [editing, setEditing] = useState(false);
  const [facts, setFacts] = useState(() => editableFacts(card));
  const [dirty, setDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canApprove = moneyLinkCanApprove(card, { editing, dirty });

  function changeFact<K extends keyof EditableFacts>(
    key: K,
    value: EditableFacts[K],
  ) {
    setFacts((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function runAction(action: "approve" | "reject" | "retry") {
    setPendingAction(action);
    setError(null);
    try {
      await execute({
        type: action,
        linkId: card.id,
        headEventId: card.headEventId,
        card,
        ...(action === "reject" ? { reason: "Rejected by the owner." } : {}),
      });
      if (action === "reject") clearMoneyLinkTaskContext(card.id);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not update this payment link. Try again.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function saveEdit() {
    const amount = Number(facts.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !facts.currency.trim()) {
      setError("Enter a valid amount and currency before saving.");
      return;
    }
    setPendingAction("edit");
    setError(null);
    try {
      await execute({
        type: "edit",
        linkId: card.id,
        headEventId: card.headEventId,
        card,
        changes: {
          amountMinor: Math.round(amount * 100),
          currency: facts.currency.trim().toUpperCase(),
          purpose: facts.purpose.trim(),
          recipient: { ...card.recipient, address: facts.recipient.trim() },
          message: facts.message.trim(),
        },
      });
      clearMoneyLinkTaskContext(card.id);
      setEditing(false);
      setDirty(false);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not save these changes. Try again.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function startEdit() {
    setPendingAction("edit");
    setError(null);
    try {
      const details = await getPaymentLinkDetails(card.id);
      setFacts(editableFacts(details));
      setDirty(false);
      setEditing(true);
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : "The payment link details could not be loaded. Try again.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  const providerRoute =
    card.provider.route === "browser"
      ? "made in your browser tab"
      : "through its API";
  const statusText =
    card.state === "payment_reported"
      ? "Payment reported, check"
      : card.state === "paid"
        ? "Paid"
        : card.state === "creating_link"
          ? "Creating link"
          : card.state === "failed"
            ? "Failed"
            : card.state === "cancelled"
              ? "Cancelled"
              : card.state === "expired"
                ? "Expired"
                : card.state === "sent"
                  ? "Sent"
                  : card.state === "draft"
                    ? "Draft"
                    : "Needs you";
  const shortExpiry = card.expiresLabel
    .replace(
      /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/u,
      "",
    )
    .replace(/\bNovember\b/u, "Nov");
  const shortPurpose = card.purpose.split(" · ", 1)[0] ?? card.purpose;

  return (
    <article
      aria-label={`Payment link: ${card.title}`}
      className="cf-money-rail-card"
      data-head-event-id={card.headEventId}
      data-payment-link-id={card.id}
      data-state={card.state}
      data-testid={`money-rail-card-${card.id}`}
    >
      <header className="cf-money-rail-head">
        <div className="cf-money-rail-chips">
          <span className={`cf-money-rail-chip ${stateTone(card.state)}`}>
            {statusText}
          </span>
          <span className="cf-money-rail-chip">Payment link</span>
          <span className="cf-money-rail-context">
            Finance · {card.customerName}
          </span>
        </div>
        <h2>{card.title}</h2>
        {card.state === "needs_you" ? (
          <p className="cf-money-rail-intro">
            Nothing goes to {card.recipient.name} until you approve. Scout makes
            the link, checks the amount, then sends it.
          </p>
        ) : null}
      </header>

      <dl className="cf-money-rail-facts">
        <div>
          <dt>Amount</dt>
          <dd>
            <strong>{moneyLabel(card.amountMinor, card.currency)}</strong>
            <span>
              {card.currency}
              <span className="cf-money-rail-invoice-label-desktop">
                {card.invoiceLabel ? `, ${card.invoiceLabel}` : ""}
              </span>
            </span>
          </dd>
        </div>
        <div>
          <dt>For</dt>
          <dd>
            <span className="cf-money-rail-purpose-desktop">
              {card.purpose || "Payment"}
            </span>
            <span className="cf-money-rail-purpose-mobile">
              {shortPurpose || "Payment"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>
            {card.provider.route === "browser" ? (
              <Globe2 aria-hidden="true" size={16} />
            ) : (
              <KeyRound aria-hidden="true" size={16} />
            )}
            <span>
              {card.provider.name}, {providerRoute}
            </span>
          </dd>
        </div>
        <div>
          <dt>Sent to</dt>
          <dd>
            {card.recipient.name} · {card.recipient.channel}
          </dd>
        </div>
        <div>
          <dt>
            <span className="cf-money-rail-expiry-desktop">Link expires</span>
            <span className="cf-money-rail-expiry-mobile">Expires</span>
          </dt>
          <dd>
            <span className="cf-money-rail-expiry-desktop">
              {card.expiresLabel}
            </span>
            <span className="cf-money-rail-expiry-mobile">{shortExpiry}</span>
          </dd>
        </div>
        <div className="cf-money-rail-paid-status-row">
          <dt>Paid status</dt>
          <dd>
            {card.state === "paid"
              ? `Confirmed by ${card.provider.name}`
              : card.state === "payment_reported"
                ? "Payment reported, check"
                : `${card.provider.name} tells Colony when the customer pays`}
          </dd>
        </div>
      </dl>

      {editing ? (
        <div
          className="cf-money-rail-edit"
          data-testid={`money-rail-edit-${card.id}`}
        >
          <label>
            Amount
            <input
              aria-label="Payment amount"
              inputMode="decimal"
              onChange={(event) =>
                changeFact("amount", event.currentTarget.value)
              }
              value={facts.amount}
            />
          </label>
          <label>
            Currency
            <input
              aria-label="Payment currency"
              maxLength={3}
              onChange={(event) =>
                changeFact("currency", event.currentTarget.value)
              }
              value={facts.currency}
            />
          </label>
          <label>
            What it is for
            <input
              aria-label="Payment purpose"
              onChange={(event) =>
                changeFact("purpose", event.currentTarget.value)
              }
              value={facts.purpose}
            />
          </label>
          <label>
            Recipient address
            <input
              aria-label="Recipient address"
              onChange={(event) =>
                changeFact("recipient", event.currentTarget.value)
              }
              value={facts.recipient}
            />
          </label>
          <label className="cf-money-rail-edit-message">
            Message to {card.recipient.name}
            <textarea
              aria-label={`Message to ${card.recipient.name}`}
              onChange={(event) =>
                changeFact("message", event.currentTarget.value)
              }
              rows={3}
              value={facts.message}
            />
          </label>
          <div className="cf-money-rail-actions">
            <button
              className="cf-money-rail-button cf-money-rail-button-primary"
              data-testid={`money-rail-save-edit-${card.id}`}
              disabled={pendingAction !== null || !dirty}
              onClick={() => void saveEdit()}
              type="button"
            >
              {pendingAction === "edit" ? "Saving changes" : "Save changes"}
            </button>
            <button
              className="cf-money-rail-button"
              disabled={pendingAction !== null}
              onClick={() => {
                setFacts(editableFacts(card));
                setDirty(false);
                setEditing(false);
                setError(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-label={`Approve payment link: ${card.title}`}
              className="cf-money-rail-button cf-money-rail-button-primary"
              data-testid={`money-rail-approve-${card.id}`}
              disabled={!canApprove || pendingAction !== null}
              onClick={() => void runAction("approve")}
              type="button"
            >
              Approve and send
            </button>
          </div>
        </div>
      ) : null}

      {!editing && card.message ? (
        <div className="cf-money-rail-message">
          <strong>
            <span className="cf-money-rail-message-label-desktop">
              Message she gets
            </span>
            <span className="cf-money-rail-message-label-mobile">Message</span>
          </strong>
          <p>{card.message}</p>
        </div>
      ) : null}

      {!editing && card.state === "needs_you" ? (
        <div className="cf-money-rail-actions">
          <button
            aria-label={`Approve payment link: ${card.title}`}
            className="cf-money-rail-button cf-money-rail-button-primary"
            data-testid={`money-rail-approve-${card.id}`}
            disabled={!canApprove || pendingAction !== null}
            onClick={() => void runAction("approve")}
            type="button"
          >
            {pendingAction === "approve" ? "Approving" : "Approve and send"}
          </button>
          <button
            aria-label={`Edit payment link: ${card.title}`}
            className="cf-money-rail-button"
            data-testid={`money-rail-edit-${card.id}`}
            disabled={pendingAction !== null}
            onClick={() => void startEdit()}
            type="button"
          >
            Edit
          </button>
          <button
            aria-label={`Reject payment link: ${card.title}`}
            className="cf-money-rail-button cf-money-rail-button-danger"
            data-testid={`money-rail-reject-${card.id}`}
            disabled={pendingAction !== null}
            onClick={() => void runAction("reject")}
            type="button"
          >
            Reject
          </button>
        </div>
      ) : null}

      {!editing && card.state === "failed" ? (
        <div className="cf-money-rail-actions">
          <button
            className="cf-money-rail-button cf-money-rail-button-primary"
            data-testid={`money-rail-retry-${card.id}`}
            disabled={pendingAction !== null}
            onClick={() => void runAction("retry")}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}

      {card.state === "payment_reported" ? (
        <p className="cf-money-rail-status-note" role="status">
          Payment reported, check. Confirm it with {card.provider.name} before
          marking this invoice paid.
        </p>
      ) : null}
      {card.state === "paid" ? (
        <p
          className="cf-money-rail-status-note cf-money-rail-status-success"
          role="status"
        >
          <Check aria-hidden="true" size={15} />
          Confirmed by {card.provider.name}, not just reported
          {card.providerReference ? ` · ref ${card.providerReference}` : ""}
        </p>
      ) : null}
      {card.statusDetail ? (
        <p className="cf-money-rail-status-note" role="status">
          {card.statusDetail}
        </p>
      ) : null}
      {error ? (
        <p className="cf-money-rail-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="cf-money-rail-safety">
        <ShieldCheck aria-hidden="true" size={15} />
        Scout can only ask for money. It can never send money or refunds.
      </footer>
    </article>
  );
}
