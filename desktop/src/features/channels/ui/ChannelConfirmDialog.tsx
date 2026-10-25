import type * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { buttonVariants } from "@/shared/ui/button";

/**
 * The Colony 3.0 channel confirmation (Leave channel, Delete channel): a 400px
 * card on the warm surface with a rose icon tile, a 22px title, the question
 * and a Cancel / destructive pair. One markup for both, so the two boards stay
 * identical.
 */
export function ChannelConfirmDialog({
  cancelTestId,
  confirmDisabled = false,
  confirmLabel,
  confirmTestId,
  contentTestId,
  description,
  error,
  icon,
  keepOpenOnConfirm = false,
  onConfirm,
  onOpenChange,
  open,
  title,
  trigger,
}: {
  cancelTestId?: string;
  confirmDisabled?: boolean;
  confirmLabel: string;
  confirmTestId?: string;
  contentTestId?: string;
  description: React.ReactNode;
  error?: unknown;
  icon: React.ReactNode;
  /** Keep the dialog open after Confirm (the caller closes it when done). */
  keepOpenOnConfirm?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  trigger?: React.ReactNode;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}
      <AlertDialogContent
        className="max-w-[400px] gap-3.5 bg-colony-surface p-6"
        data-testid={contentTestId}
        style={{
          boxShadow:
            "0 30px 80px -30px rgba(30, 15, 50, 0.55), 0 0 0 1px rgba(37, 34, 44, 0.06)",
        }}
      >
        <span className="flex size-[2.875rem] items-center justify-center rounded-[0.875rem] bg-colony-danger-bg text-colony-danger">
          {icon}
        </span>
        <AlertDialogTitle className="text-xl leading-[normal]">
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-sm leading-[1.55]">
          {description}
        </AlertDialogDescription>
        {error instanceof Error ? (
          <p className="text-xs font-semibold text-colony-danger" role="alert">
            {error.message}
          </p>
        ) : null}
        <div className="mt-1.5 flex justify-end gap-2.5">
          <AlertDialogCancel
            className="border-0 px-4.5 font-bold shadow-[0_0_0_1px_hsl(var(--colony-border-strong))]"
            data-testid={cancelTestId}
            disabled={confirmDisabled}
            type="button"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({
              className: "px-4.5 font-bold",
              size: "dialog",
              variant: "destructive",
            })}
            data-testid={confirmTestId}
            disabled={confirmDisabled}
            onClick={(event) => {
              if (keepOpenOnConfirm) event.preventDefault();
              onConfirm();
            }}
            type="button"
          >
            {confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
