import * as React from "react";

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

/** A reusable explicit-confirmation boundary for irreversible or duplicate-send-prone actions. */
export function WhatsAppConfirmAction({
  confirmLabel,
  description,
  disabled = false,
  onConfirm,
  testId,
  title,
  triggerLabel,
  triggerVariant = "outline",
}: {
  confirmLabel: string;
  description: React.ReactNode;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
  testId: string;
  title: string;
  triggerLabel: string;
  triggerVariant?:
    | "default"
    | "outline"
    | "secondary"
    | "ghost"
    | "destructive";
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The WhatsApp safety action failed.",
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
          disabled={disabled}
          size="xs"
          type="button"
          variant={triggerVariant}
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid={`${testId}-dialog`}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
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
            onClick={() => void confirm()}
            size="sm"
            type="button"
            variant={
              triggerVariant === "destructive" ? "destructive" : "default"
            }
          >
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
