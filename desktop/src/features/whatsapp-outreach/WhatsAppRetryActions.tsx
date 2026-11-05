import * as React from "react";

import {
  KIND_WHATSAPP_CONTACT_UPDATE,
  KIND_WHATSAPP_SETTINGS,
} from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import type { WhatsAppMessage } from "./whatsappOutreachModels";
import { useWhatsAppCommand } from "./whatsappOutreachQueries";

type ActionSize = "sm" | "xs";

/** Owner or admin recovery for all stored failures caused by one Meta account problem. */
export function WhatsAppResumeAndRetryAction({
  count,
  label = "Resume and retry",
  size = "sm",
  testId = "whatsapp-resume-retry-trigger",
}: {
  count: number;
  label?: string;
  size?: ActionSize;
  testId?: string;
}) {
  const command = useWhatsAppCommand();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function resumeAndRetry() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await command(KIND_WHATSAPP_SETTINGS, {
        v: 1,
        resumeAndRetry: true,
      });
      setOpen(false);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Could not requeue the failed WhatsApp messages.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!busy) setOpen(nextOpen);
      }}
      open={open}
    >
      <AlertDialogTrigger asChild>
        <Button
          data-testid={testId}
          size={size}
          type="button"
          variant="secondary"
        >
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="whatsapp-resume-retry-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Retry {count} messages?</AlertDialogTitle>
          <AlertDialogDescription>
            The same message rows and idempotency keys will be used. Normal
            pacing and the daily cap still apply.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p role="alert">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button disabled={busy} size="sm" type="button" variant="outline">
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            disabled={busy}
            onClick={() => void resumeAndRetry()}
            size="sm"
            type="button"
          >
            {busy ? "Requeuing…" : `Retry ${count} messages`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Owner or admin retry for one documented temporary refusal. */
export function WhatsAppSendAgainAction({
  message,
}: {
  message: WhatsAppMessage;
}) {
  const command = useWhatsAppCommand();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function sendAgain() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await command(KIND_WHATSAPP_CONTACT_UPDATE, {
        v: 1,
        waId: message.waId,
        retrySend: message.id,
      });
      setOpen(false);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Could not requeue this WhatsApp message.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!busy) setOpen(nextOpen);
      }}
      open={open}
    >
      <AlertDialogTrigger asChild>
        <Button
          data-testid={`whatsapp-send-again-${message.id}`}
          size="xs"
          type="button"
          variant="secondary"
        >
          Send again
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send this message again?</AlertDialogTitle>
          <AlertDialogDescription>
            It keeps the original message row and idempotency key. Normal pacing
            and the daily cap still apply.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p role="alert">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button disabled={busy} size="sm" type="button" variant="outline">
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            disabled={busy}
            onClick={() => void sendAgain()}
            size="sm"
            type="button"
          >
            {busy ? "Requeuing…" : "Send again"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
