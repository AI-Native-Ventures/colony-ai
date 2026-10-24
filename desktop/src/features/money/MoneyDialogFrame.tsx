import type { ReactNode } from "react";

import { CloseIcon } from "@/shared/ui/colonyIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import "./colony3-money.css";

/**
 * The frame the money dialogs share: a 24px title with its close button on one
 * row, then either a short intro line (`intro`) or a subtitle under the title
 * (`subtitle`), then the body. `width` is the design width in px.
 */
export function MoneyDialog({
  children,
  intro,
  onOpenChange,
  open,
  subtitle,
  title,
  width,
}: {
  children: ReactNode;
  intro?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  subtitle?: ReactNode;
  title: ReactNode;
  width: number;
}) {
  const close = (
    <DialogClose asChild>
      <button aria-label="Close" className="b3-dialog-close" type="button">
        <CloseIcon size={15} strokeWidth={2.4} />
      </button>
    </DialogClose>
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="b3-dialog"
        showCloseButton={false}
        style={{ maxWidth: `calc(${width} * var(--b3u))` }}
      >
        {subtitle ? (
          <div className="b3-dialog-head">
            <div className="b3-dialog-head-copy">
              <DialogTitle className="b3-dialog-title">{title}</DialogTitle>
              <DialogDescription className="b3-dialog-subtitle">
                {subtitle}
              </DialogDescription>
            </div>
            {close}
          </div>
        ) : (
          <>
            <div className="b3-dialog-head">
              <DialogTitle className="b3-dialog-title">{title}</DialogTitle>
              {close}
            </div>
            <DialogDescription className="b3-dialog-copy">
              {intro}
            </DialogDescription>
          </>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}
