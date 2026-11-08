import * as React from "react";

import { Button } from "@/shared/ui/button";
import { KIND_WHATSAPP_SAFETY_ACTION } from "@/shared/constants/kinds";
import {
  formatWhatsAppNumber,
  type WhatsAppSafetyLedger,
} from "./whatsappOutreachModels";
import { useWhatsAppCommand } from "./whatsappOutreachQueries";
import { WhatsAppConfirmAction } from "./WhatsAppConfirmAction";

function safetyPhoneLabel(value: string) {
  return /^\d+$/u.test(value) ? formatWhatsAppNumber(value) : value;
}

/** Settings subpanel for relay-backed opt-out and never-contact safety. */
export function WhatsAppSafetySettings({
  canManage,
  ledger,
  loading,
  unavailable,
}: {
  canManage: boolean;
  ledger: WhatsAppSafetyLedger | undefined;
  loading: boolean;
  unavailable: boolean;
}) {
  const command = useWhatsAppCommand();
  const [expanded, setExpanded] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const suppressions = ledger?.suppressions ?? [];
  const neverContact = suppressions.filter(
    (suppression) => suppression.scope === "never_contact",
  );
  const optOuts = suppressions.filter(
    (suppression) => suppression.scope === "opt_out",
  );

  async function addNeverContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const waId = phone.trim();
    const nextReason = reason.trim();
    if (!waId || !nextReason || busy) return;
    setBusy(true);
    setError("");
    try {
      await command(KIND_WHATSAPP_SAFETY_ACTION, {
        v: 1,
        action: "never_contact_add",
        waId,
        reason: nextReason,
      });
      setPhone("");
      setReason("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not add this number to the never-contact list.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="c3wa-safety-settings" id="wa-safety">
      <header className="c3wa-section-head">
        <h2>Safety</h2>
        <span className="c3wa-always-on">Always on</span>
      </header>
      <div className="c3wa-safety-rule">
        <strong>What counts as an opt-out?</strong>
        <span>
          A reply such as stop, unsubscribe, or no thanks stops future WhatsApp
          outreach for that phone number. The relay also keeps the matched rule
          and reason with the decision.
        </span>
      </div>
      {!canManage ? (
        <p className="c3wa-safety-unavailable" role="note">
          Only the owner or an admin can view or change the safety ledger.
        </p>
      ) : unavailable ? (
        <p className="c3wa-safety-unavailable" role="status">
          Safety details need a current relay. Existing sending controls remain
          available.
        </p>
      ) : loading ? (
        <p className="c3wa-safety-unavailable" role="status">
          Loading safety details…
        </p>
      ) : (
        <>
          <div className="c3wa-safety-list-head">
            <div>
              <strong>Never-contact list</strong>
              <span>
                {neverContact.length} active{" "}
                {neverContact.length === 1 ? "entry" : "entries"}
              </span>
            </div>
            <Button
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              size="sm"
              type="button"
              variant="outline"
            >
              {expanded ? "Close list" : "Manage list"}
            </Button>
          </div>
          {expanded ? (
            <div className="c3wa-safety-list-body">
              <form
                className="c3wa-safety-add"
                onSubmit={(event) => void addNeverContact(event)}
              >
                <label>
                  <span>Phone number</span>
                  <input
                    aria-label="Never-contact phone number"
                    autoComplete="off"
                    onChange={(event) => setPhone(event.currentTarget.value)}
                    placeholder="+27 82 123 4567"
                    value={phone}
                  />
                </label>
                <label>
                  <span>Reason</span>
                  <input
                    aria-label="Never-contact reason"
                    maxLength={200}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    placeholder="Owner requested no contact"
                    value={reason}
                  />
                </label>
                <Button
                  disabled={busy || !phone.trim() || !reason.trim()}
                  size="sm"
                  type="submit"
                >
                  {busy ? "Adding…" : "Add to list"}
                </Button>
              </form>
              {error ? <p role="alert">{error}</p> : null}
              <ul
                aria-label="Never-contact entries"
                className="c3wa-safety-ledger-list"
              >
                {neverContact.map((suppression) => (
                  <li key={suppression.id}>
                    <span>
                      <strong>
                        {safetyPhoneLabel(suppression.identityValue)}
                      </strong>
                      <small>{suppression.reason}</small>
                    </span>
                    <WhatsAppConfirmAction
                      confirmLabel="Undo never-contact"
                      description="This removes the active never-contact decision. The decision remains in the audit history."
                      onConfirm={() =>
                        command(KIND_WHATSAPP_SAFETY_ACTION, {
                          v: 1,
                          action: "never_contact_undo",
                          waId: suppression.identityValue,
                        })
                      }
                      testId={`whatsapp-never-contact-undo-${suppression.id}`}
                      title="Undo this never-contact entry?"
                      triggerLabel="Undo"
                    />
                  </li>
                ))}
                {neverContact.length === 0 ? (
                  <li className="c3wa-safety-empty">
                    No active never-contact entries.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
          <div className="c3wa-safety-rule">
            <strong>Whole-business stop</strong>
            <span>
              When a linked contact replies with an opt-out, automatic outreach
              stays stopped for everyone at that business.{" "}
              {ledger?.businessStops.length ?? 0} active{" "}
              {ledger?.businessStops.length === 1 ? "hold" : "holds"}.
            </span>
          </div>
          <div className="c3wa-safety-rule">
            <strong>Auto-stop</strong>
            <span>
              Relay-reported account pauses stop new sends. Unknown outcomes
              never resend automatically and are held for an owner decision.
            </span>
          </div>
          <p className="c3wa-safety-summary">
            {optOuts.length} active{" "}
            {optOuts.length === 1 ? "opt-out" : "opt-outs"} are protected by the
            relay.
          </p>
        </>
      )}
    </section>
  );
}
