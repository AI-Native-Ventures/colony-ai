import * as React from "react";

import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import { CheckIcon, CloseIcon, ConnectingIcon } from "@/shared/ui/colonyIcons";

export type FeedbackCategoryId = "suggestion" | "bug" | "other";

/** Listed in the order the dialog shows them. */
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategoryId, string> = {
  bug: "Something is broken",
  suggestion: "Suggestion",
  other: "Other",
};

export type SendFeedbackInput = {
  category: FeedbackCategoryId;
  includeLogs: boolean;
  message: string;
};

const DIAGNOSTICS_DESCRIPTION =
  "App version, OS version, recent error codes and device capabilities. Excludes messages, files, tokens and credentials. Preview and redact before sending.";

/** Collects private product feedback and optional runtime diagnostics. */
export function SendFeedbackDialog({
  isPending,
  onOpenChange,
  onSubmit,
  open,
}: {
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: SendFeedbackInput) => Promise<void>;
  open: boolean;
}) {
  const [category, setCategory] =
    React.useState<FeedbackCategoryId>("suggestion");
  const [message, setMessage] = React.useState("");
  const [includeLogs, setIncludeLogs] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    if (open || !sent) return;
    setCategory("suggestion");
    setMessage("");
    setIncludeLogs(false);
    setErrorMessage(null);
    setSent(false);
  }, [open, sent]);

  async function submitFeedback() {
    if (isPending || message.trim().length === 0) return;

    setErrorMessage(null);
    try {
      await onSubmit({ category, includeLogs, message: message.trim() });
      setSent(true);
    } catch {
      setErrorMessage(
        "Your feedback wasn’t sent. Your message is saved in this window. Try again.",
      );
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[21.3125rem] gap-4 p-6"
        data-testid="send-feedback-dialog"
        showCloseButton={false}
      >
        {sent ? (
          <div
            className="flex items-center gap-3.5"
            data-testid="feedback-sent"
            role="status"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-colony-success-bg text-colony-success">
              <CheckIcon size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <DialogTitle
                className="text-base font-extrabold tracking-normal"
                data-testid="send-feedback-title"
              >
                Thank you for the feedback
              </DialogTitle>
              <span className="text-sm font-medium text-colony-fg-secondary">
                Your feedback was sent
              </span>
            </span>
            <Button
              data-testid="feedback-done"
              onClick={() => onOpenChange(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader className="flex-row items-center gap-2.5 space-y-0">
              <DialogTitle
                className="flex-1 text-xl font-extrabold tracking-[-0.02em]"
                data-testid="send-feedback-title"
              >
                Send feedback
              </DialogTitle>
              <DialogClose
                aria-label="Close"
                className="grid size-9 shrink-0 place-items-center rounded-colony-menu-item text-colony-fg-secondary transition-colors hover:bg-colony-track focus:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
                disabled={isPending}
              >
                <CloseIcon size={16} strokeWidth={2.4} />
              </DialogClose>
            </DialogHeader>

            {isPending ? (
              <div
                aria-live="polite"
                className="flex flex-col items-center justify-center gap-3 py-10 text-center"
                data-testid="feedback-sending"
                role="status"
              >
                <ConnectingIcon
                  className="text-colony-accent motion-safe:animate-spin"
                  size={24}
                />
                <p className="text-sm font-extrabold">Sending your feedback…</p>
                <p className="text-xs font-medium text-colony-fg-secondary">
                  Your message is kept until delivery is confirmed.
                </p>
              </div>
            ) : (
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitFeedback();
                }}
              >
                {errorMessage ? (
                  <div
                    className="rounded-colony-control-lg bg-colony-danger-bg px-4 py-3 text-xs text-colony-danger"
                    data-testid="feedback-error"
                    role="alert"
                  >
                    <p className="font-extrabold leading-normal">
                      Your feedback wasn’t sent
                    </p>
                    <p className="mt-1 font-medium leading-normal">
                      Your message is saved in this window. Try again.
                    </p>
                  </div>
                ) : null}

                <fieldset
                  className="m-0 flex flex-col gap-2 border-0 p-0"
                  data-testid="feedback-type"
                  disabled={isPending}
                >
                  <legend className="mb-2 text-xs font-bold text-colony-fg-secondary">
                    Type
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      Object.entries(FEEDBACK_CATEGORY_LABELS) as Array<
                        [FeedbackCategoryId, string]
                      >
                    ).map(([value, label]) => (
                      <label
                        className="flex h-9.5 cursor-pointer items-center gap-[7px] rounded-colony-menu-item px-3 text-chip font-semibold shadow-[inset_0_0_0_1px_hsl(var(--colony-border-strong))] has-[:checked]:bg-colony-accent-soft has-[:checked]:font-extrabold has-[:checked]:shadow-[inset_0_0_0_1.5px_#b9a9ee] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-colony-accent"
                        key={value}
                      >
                        <input
                          checked={category === value}
                          className="m-0 accent-colony-accent"
                          name="feedback-type"
                          onChange={() => setCategory(value)}
                          type="radio"
                          value={value}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label
                  className="flex flex-col gap-2 text-xs font-bold text-colony-fg-secondary"
                  htmlFor="feedback-message"
                >
                  <span>What would you like us to know?</span>
                  <Textarea
                    className="min-h-0 resize-none py-3 text-sm font-medium leading-6"
                    data-testid="feedback-message"
                    id="feedback-message"
                    onChange={(event) => {
                      setMessage(event.target.value);
                      setErrorMessage(null);
                    }}
                    rows={4}
                    value={message}
                  />
                </label>

                <label
                  className="flex cursor-pointer items-start gap-2.5"
                  htmlFor="feedback-include-logs"
                >
                  <Checkbox
                    checked={includeLogs}
                    className="mt-0.5"
                    data-testid="feedback-include-logs"
                    id="feedback-include-logs"
                    onCheckedChange={(checked) =>
                      setIncludeLogs(checked === true)
                    }
                  />
                  <span className="flex flex-col gap-[3px]">
                    <span className="text-menu font-bold">
                      Include diagnostic information
                    </span>
                    <span
                      className="text-xs font-medium leading-[1.45] text-colony-muted"
                      data-testid="feedback-diagnostics-details"
                    >
                      {DIAGNOSTICS_DESCRIPTION}
                    </span>
                  </span>
                </label>

                <div className="flex justify-end gap-2.5">
                  <Button
                    onClick={() => onOpenChange(false)}
                    size="dialog"
                    type="button"
                    variant="outline"
                  >
                    Close
                  </Button>
                  <Button
                    data-testid="feedback-submit"
                    disabled={message.trim().length === 0}
                    size="dialog"
                    type="submit"
                  >
                    Send feedback
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
