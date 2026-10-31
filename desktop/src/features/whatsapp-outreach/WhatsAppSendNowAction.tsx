import * as React from "react";

import { KIND_WHATSAPP_BATCH_DECISION } from "@/shared/constants/kinds";
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
import { useWhatsAppCommand } from "./whatsappOutreachQueries";

export function WhatsAppSendNowAction({
  batchId,
  size = "sm",
}: {
  batchId: string;
  size?: "sm" | "xs";
}) {
  const command = useWhatsAppCommand();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function sendNow() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        batchId,
        decision: "send_now",
      });
      setOpen(false);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send this test batch now.",
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
          data-testid="whatsapp-send-now-trigger"
          size={size}
          type="button"
          variant="secondary"
        >
          Send now (test)
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="whatsapp-send-now-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Send now, outside 08:00 to 18:00?</AlertDialogTitle>
          <AlertDialogDescription>
            Use this for tests to your own number.
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
            onClick={() => void sendNow()}
            size="sm"
            type="button"
          >
            {busy ? "Sending…" : "Send now"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
