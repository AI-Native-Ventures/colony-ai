import { CheckCircle2, LoaderCircle, X } from "lucide-react";
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

export type FeedbackCategoryId = "suggestion" | "bug" | "other";

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategoryId, string> = {
  suggestion: "Suggestion",
  bug: "Something is broken",
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
  const [showDiagnostics, setShowDiagnostics] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    if (open || !sent) return;
    setCategory("suggestion");
    setMessage("");
    setIncludeLogs(false);
    setShowDiagnostics(false);
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

  const dialogHeight = sent
    ? "h-[28.3125rem]"
    : isPending
      ? "h-[24.1875rem]"
      : errorMessage
        ? "h-[38.6875rem]"
        : showDiagnostics
          ? "h-[42.1875rem]"
          : "h-[34.0625rem]";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className={`flex max-h-[calc(100vh-2rem)] max-w-[540px] flex-col gap-0 overflow-hidden rounded-[11px] border-border/80 bg-card p-0 dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec] ${dialogHeight}`}
        data-testid="send-feedback-dialog"
        showCloseButton={false}
      >
        <DialogHeader className="h-20 shrink-0 flex-row items-center justify-between gap-4 border-b border-border/70 px-[25px] py-5 dark:border-[#3c3544]">
          <DialogTitle
            className="text-base font-semibold tracking-tight"
            data-testid="send-feedback-title"
          >
            {sent ? "Thank you for the feedback" : "Send feedback"}
          </DialogTitle>
          <DialogClose
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus:outline-hidden focus:ring-1 focus:ring-ring dark:hover:bg-[#3a3243] dark:hover:text-[#e6e1ec]"
            disabled={isPending}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </DialogClose>
        </DialogHeader>

        {sent ? (
          <div
            className="flex min-h-0 flex-1 flex-col justify-between px-6 py-5"
            data-testid="feedback-sent"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">Your feedback was sent</p>
                <p className="text-sm text-muted-foreground">
                  You can keep working. We’ll reply to your account email if
                  more detail is needed.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                className="rounded-md bg-[#285fb5] text-xs text-white hover:bg-[#285fb5] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
                data-testid="feedback-done"
                onClick={() => onOpenChange(false)}
                type="button"
              >
                Done
              </Button>
            </div>
          </div>
        ) : isPending ? (
          <div className="flex min-h-0 flex-1 flex-col px-[25px] py-5">
            <div
              aria-live="polite"
              className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
              data-testid="feedback-sending"
              role="status"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-6 animate-spin dark:text-[#a9bee8]"
              />
              <div className="space-y-1">
                <p className="text-base font-medium">Sending your feedback…</p>
                <p className="text-xs text-muted-foreground">
                  Your message is kept until delivery is confirmed.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-border/70 px-[25px] pt-[18px] dark:border-[#3c3544]">
              <Button
                className="rounded-md bg-card text-xs dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec]"
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="rounded-md bg-[#285fb5] text-xs text-white hover:bg-[#285fb5] disabled:opacity-100 dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
                disabled
                data-testid="feedback-submit"
                type="button"
              >
                Send feedback
              </Button>
            </div>
          </div>
        ) : (
          <form
            className={`flex min-h-0 flex-1 flex-col gap-0 px-[25px] ${errorMessage ? "pt-6" : "pt-[46px]"}`}
            onSubmit={(event) => {
              event.preventDefault();
              void submitFeedback();
            }}
          >
            {errorMessage ? (
              <div
                className="mb-[18px] rounded-[7px] border border-[#edd8dd] bg-[#fcf2f4] px-[18px] py-[15px] text-xs text-[#925369] dark:border-[#63414e] dark:bg-[#402b34] dark:text-[#dcacb8]"
                data-testid="feedback-error"
                role="alert"
              >
                <p className="font-semibold leading-[1.5]">
                  Your feedback wasn’t sent
                </p>
                <p className="mt-[5px] leading-[1.65]">
                  Your message is saved in this window. Try again.
                </p>
              </div>
            ) : null}

            <label
              className="flex flex-col gap-2 text-xs"
              htmlFor="feedback-type"
            >
              <span>Type</span>
              <select
                className="h-[2.6875rem] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec]"
                data-testid="feedback-type"
                disabled={isPending}
                id="feedback-type"
                onChange={(event) =>
                  setCategory(event.target.value as FeedbackCategoryId)
                }
                value={category}
              >
                {Object.entries(FEEDBACK_CATEGORY_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label
              className="mt-[22px] flex flex-col gap-2 text-xs"
              htmlFor="feedback-message"
            >
              <span>What would you like us to know?</span>
              <Textarea
                className="min-h-[7.3125rem] resize-y bg-card text-sm leading-6 dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec]"
                data-testid="feedback-message"
                disabled={isPending}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setErrorMessage(null);
                }}
                value={message}
              />
            </label>

            <div className="mt-[21px] space-y-[1.1875rem]">
              <label
                className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                htmlFor="feedback-include-logs"
              >
                <Checkbox
                  checked={includeLogs}
                  className="border-input data-[state=checked]:bg-[#285fb5] dark:border-[#5a5264] dark:data-[state=checked]:bg-[#a9bee8]"
                  data-testid="feedback-include-logs"
                  disabled={isPending}
                  id="feedback-include-logs"
                  onCheckedChange={(checked) =>
                    setIncludeLogs(checked === true)
                  }
                />
                <span>Include diagnostic information</span>
              </label>
              <Button
                aria-expanded={showDiagnostics}
                className="h-auto px-0 text-xs text-blue-700 hover:text-blue-800 dark:text-[#a9bee8] dark:hover:text-[#a9bee8]"
                data-testid="feedback-diagnostics-toggle"
                onClick={() => setShowDiagnostics((visible) => !visible)}
                type="button"
                variant="link"
              >
                What is included?
              </Button>
              {showDiagnostics ? (
                <p
                  className="rounded-[7px] border border-[#dce5ef] bg-[#f1f6fc] px-[18px] py-[15px] text-xs text-[#48637f] dark:border-[#43516a] dark:bg-[#293445] dark:text-[#b4c6e0]"
                  data-testid="feedback-diagnostics-details"
                >
                  <span className="mb-[5px] block font-semibold leading-[1.5]">
                    Diagnostic information
                  </span>
                  <span className="block leading-[1.65]">
                    {DIAGNOSTICS_DESCRIPTION}
                  </span>
                </p>
              ) : null}
            </div>

            <div
              className={`${showDiagnostics ? "mt-[47px]" : "mt-[26px]"} flex justify-end gap-2 border-t border-border/70 pt-[18px] pb-[18px] dark:border-[#3c3544]`}
            >
              <Button
                className="rounded-md border-input bg-card text-xs dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec]"
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="rounded-md bg-[#285fb5] text-xs text-white hover:bg-[#285fb5] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
                data-testid="feedback-submit"
                disabled={message.trim().length === 0}
                type="submit"
              >
                {isPending ? "Sending" : "Send feedback"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
