import * as React from "react";
import { toast } from "sonner";

import { useSubmitReportMutation } from "@/features/moderation/hooks";
import type { ReportType } from "@/features/moderation/hooks";
import { FlagGlyph } from "@/features/channels/ui/dialogIcons";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { CheckIcon, CloseIcon } from "@/shared/ui/colonyIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";

/** NIP-56 report categories, in the order shown to the reporter. `other` is
 *  last so it reads as the fallback rather than a first-class choice. */
const REPORT_CATEGORIES: { value: ReportType; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "profanity", label: "Profanity or hate speech" },
  { value: "nudity", label: "Nudity or sexual content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "malware", label: "Malware or scam" },
  { value: "illegal", label: "Illegal content" },
  { value: "other", label: "Other" },
];

export function ReportMessageDialog({
  open,
  onOpenChange,
  authorPubkey,
  eventId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display author of the reported message (the `p` tag target). */
  authorPubkey: string;
  /** Reported message event id (the `e` tag target). */
  eventId: string;
}) {
  const submitReport = useSubmitReportMutation();
  const [category, setCategory] = React.useState<ReportType | null>(null);
  const [note, setNote] = React.useState("");

  // Reset the form each time the dialog opens so a prior report's selection
  // never leaks into the next one.
  React.useEffect(() => {
    if (open) {
      setCategory(null);
      setNote("");
    }
  }, [open]);

  const submit = () => {
    if (!category || submitReport.isPending) return;
    submitReport.mutate(
      {
        authorPubkey,
        eventId,
        reportType: category,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Report submitted to community moderators");
          onOpenChange(false);
        },
        onError: () => toast.error("Failed to submit report"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]" showCloseButton={false}>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-colony-control-lg bg-colony-danger-bg text-colony-danger">
            <FlagGlyph size={19} />
          </span>
          <div className="flex flex-1 flex-col gap-1.5">
            <DialogTitle className="leading-[normal]">
              Report message
            </DialogTitle>
            <DialogDescription className="leading-normal">
              Reports go to this community’s moderators for review. The author
              is not notified of who reported them.
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-colony-menu-item text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
          >
            <CloseIcon size={16} strokeWidth={2.4} />
          </DialogClose>
        </div>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Reason</legend>
          {REPORT_CATEGORIES.map((item) => {
            const selected = category === item.value;
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "flex h-11 items-center justify-between rounded-colony-control-lg px-4 text-left text-control transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40 disabled:opacity-50",
                  selected
                    ? "bg-colony-fg font-bold text-colony-surface"
                    : "border border-colony-border-strong bg-colony-pop font-semibold text-colony-fg hover:bg-colony-track",
                )}
                disabled={submitReport.isPending}
                key={item.value}
                onClick={() => setCategory(item.value)}
                type="button"
              >
                {item.label}
                {selected ? <CheckIcon size={16} strokeWidth={2.4} /> : null}
              </button>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label
            className="text-xs font-bold text-colony-fg-secondary"
            htmlFor="report-note"
          >
            Additional context (optional)
          </label>
          <Textarea
            className="min-h-0 resize-none leading-normal"
            id="report-note"
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add anything that helps moderators..."
            rows={3}
            value={note}
          />
        </div>

        <DialogFooter>
          <Button
            disabled={submitReport.isPending}
            onClick={() => onOpenChange(false)}
            size="dialog"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!category || submitReport.isPending}
            onClick={submit}
            size="dialog"
            type="button"
            variant="default"
          >
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
