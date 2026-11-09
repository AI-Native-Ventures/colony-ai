import * as React from "react";

import { Button } from "@/shared/ui/button";
import { KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY } from "@/shared/constants/kinds";
import type { WhatsAppMessage } from "./whatsappOutreachModels";
import { useWhatsAppCommand } from "./whatsappOutreachQueries";
import { WhatsAppConfirmAction } from "./WhatsAppConfirmAction";

/** Owner recovery for a send whose provider outcome was never durably recorded. */
export function WhatsAppUnknownSendRecoveryCard({
  message,
}: {
  message: WhatsAppMessage;
}) {
  const command = useWhatsAppCommand();
  const [checking, setChecking] = React.useState(false);
  const [checkResult, setCheckResult] = React.useState("");
  const [error, setError] = React.useState("");

  async function checkStatus() {
    if (checking) return;
    setChecking(true);
    setCheckResult("");
    setError("");
    try {
      await command(KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY, {
        v: 1,
        action: "check_status",
        messageId: message.id,
      });
      setCheckResult(
        "The relay checked the provider status. Checking it did not send another message.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not check this unknown send outcome.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <article
      className="c3wa-desk-batch c3wa-unknown-send-card"
      data-testid={`outreach-unknown-send-${message.id}`}
    >
      <div className="c3wa-desk-batch-head">
        <span aria-hidden="true" className="c3wa-desk-batch-avatar">
          !
        </span>
        <div>
          <p className="c3wa-desk-prepared-at">Held for you</p>
          <h2>We cannot confirm this message was delivered</h2>
          <p>
            The relay stopped before it recorded the provider outcome. It will
            not resend this message on its own.
          </p>
        </div>
        <span className="c3wa-desk-batch-kind">Unknown send</span>
      </div>
      <p className="c3wa-unknown-send-copy">{message.text}</p>
      {checkResult ? <p role="status">{checkResult}</p> : null}
      {error ? (
        <p className="c3wa-desk-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="c3wa-desk-actions">
        <Button
          data-testid={`whatsapp-unknown-send-check-${message.id}`}
          disabled={checking}
          onClick={() => void checkStatus()}
          size="sm"
          type="button"
          variant="outline"
        >
          {checking ? "Checking…" : "Check status"}
        </Button>
        <WhatsAppConfirmAction
          confirmLabel="Mark delivered"
          description="Use this only after you have independently confirmed delivery. This changes the durable relay record and does not send another message."
          onConfirm={() =>
            command(KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY, {
              v: 1,
              action: "mark_delivered",
              messageId: message.id,
              confirm: true,
            })
          }
          testId={`whatsapp-unknown-send-delivered-${message.id}`}
          title="Mark this message delivered?"
          triggerLabel="Mark delivered"
        />
        <WhatsAppConfirmAction
          confirmLabel="Resend as new message"
          description="This creates a new message after the relay checks every current safety rule again. It does not retry the original unknown send."
          onConfirm={() =>
            command(KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY, {
              v: 1,
              action: "resend",
              messageId: message.id,
              confirm: true,
            })
          }
          testId={`whatsapp-unknown-send-resend-${message.id}`}
          title="Resend this as a new message?"
          triggerLabel="Resend as new message"
          triggerVariant="secondary"
        />
      </div>
    </article>
  );
}
