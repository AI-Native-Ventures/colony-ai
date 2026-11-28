import * as React from "react";
import { ExternalLink, UserRound } from "lucide-react";

import { useIdentityQuery } from "@/shared/api/hooks";
import { KIND_WHATSAPP_CONTACT_UPDATE } from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  CALL_BRIEF_MAX_CHARS,
  callAssigneeName,
  callBriefChange,
  callBriefDraftFor,
  callCloserLabel,
  type CallBriefDraft,
  type WhatsAppCallBrief,
  type WhatsAppCallCloser,
} from "./whatsappCallBrief";
import type { WhatsAppContact } from "./whatsappOutreachModels";
import {
  useWhatsAppCallClosersQuery,
  useWhatsAppCommand,
} from "./whatsappOutreachQueries";

export type CallBriefDialogTarget = Readonly<{
  contact: WhatsAppContact;
  /** The business as the screen names it. */
  name: string;
  /** `ready` also moves the lead to Ready to call. `edit` changes the brief only. */
  mode: "ready" | "edit";
}>;

/** The signed-in person's key, for "you" and for the calls that wait for them. */
export function useMyPubkey(): string | null {
  return useIdentityQuery().data?.pubkey?.toLowerCase() ?? null;
}

/**
 * Who has each call, by name. The list of people is only read while a loaded contact names
 * one, so a business that never assigns a call never asks for it.
 */
export function useCallAssigneeNames(contacts: readonly WhatsAppContact[]) {
  const myPubkey = useMyPubkey();
  const anyAssigned = contacts.some(
    (contact) => contact.callBrief?.assigneePubkey,
  );
  const closers = useWhatsAppCallClosersQuery(anyAssigned).data;
  return React.useCallback(
    (brief: WhatsAppCallBrief | null | undefined) =>
      callAssigneeName(brief, closers, myPubkey),
    [closers, myPubkey],
  );
}

function linkLabel(link: string): string {
  return link.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
}

/** The call brief as a person reads it: who has the call, the link and the description. */
export function WhatsAppCallBriefSummary({
  brief,
  assigneeName,
  showUnassigned = false,
}: {
  brief: WhatsAppCallBrief | null;
  assigneeName: string | null;
  /** Say so when nobody has the call. Used where the lead is ready to call. */
  showUnassigned?: boolean;
}) {
  if (!brief && !showUnassigned) return null;
  return (
    <div className="c3wa-call-brief" data-testid="whatsapp-call-brief">
      {assigneeName || showUnassigned ? (
        <p
          className={`c3wa-call-brief-assignee${assigneeName ? "" : " is-open"}`}
        >
          <UserRound aria-hidden="true" size={14} />
          {assigneeName
            ? `Assigned to ${assigneeName}`
            : "Nobody has this call yet"}
        </p>
      ) : null}
      {brief?.link ? (
        <a
          className="c3wa-call-brief-link"
          href={brief.link}
          rel="noreferrer noopener"
          target="_blank"
        >
          <span>{linkLabel(brief.link)}</span>
          <ExternalLink aria-hidden="true" size={12} />
          <span className="c3wa-sr-only">Opens in your browser</span>
        </a>
      ) : null}
      {brief?.note ? (
        <p className="c3wa-call-brief-note">{brief.note}</p>
      ) : null}
    </div>
  );
}

function CallBriefForm({
  target,
  onClose,
}: {
  target: CallBriefDialogTarget;
  onClose: () => void;
}) {
  const command = useWhatsAppCommand();
  const closersQuery = useWhatsAppCallClosersQuery(true);
  const myPubkey = useMyPubkey();
  const stored = target.contact.callBrief;
  const [draft, setDraft] = React.useState<CallBriefDraft>(() =>
    callBriefDraftFor(stored),
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const fieldId = React.useId();
  const ready = target.mode === "ready";
  const closers: readonly WhatsAppCallCloser[] = closersQuery.data ?? [];
  // The person who has the call stays selectable even when the list does not name them
  // (still loading, failed, or they left Outreach), so saving never drops them by accident.
  const storedAssignee = stored?.assigneePubkey ?? null;
  const storedIsListed =
    storedAssignee !== null &&
    closers.some((closer) => closer.pubkey === storedAssignee);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = callBriefChange(stored, draft);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    if (!ready && !result.change) {
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await command(KIND_WHATSAPP_CONTACT_UPDATE, {
        v: 1,
        waId: target.contact.waId,
        ...(ready ? { stage: "ready_to_call" } : {}),
        ...(result.change ? { callBrief: result.change } : {}),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this call.",
      );
      setBusy(false);
      return;
    }
    onClose();
  }

  return (
    <form
      className="c3wa-root c3wa-call-brief-form"
      data-testid="whatsapp-call-brief-form"
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <DialogHeader>
        <DialogTitle>{ready ? "Ready to call" : "Call brief"}</DialogTitle>
        <DialogDescription>
          {ready
            ? `Add what the person who calls ${target.name} needs. Everything here is optional.`
            : `What the person who calls ${target.name} needs.`}
        </DialogDescription>
      </DialogHeader>
      <div className="c3wa-call-brief-field">
        <label htmlFor={`${fieldId}-link`}>Link</label>
        <input
          aria-describedby={`${fieldId}-link-hint`}
          autoCapitalize="none"
          autoCorrect="off"
          data-testid="whatsapp-call-brief-link"
          id={`${fieldId}-link`}
          inputMode="url"
          maxLength={CALL_BRIEF_MAX_CHARS}
          onChange={(event) => {
            const link = event.currentTarget.value;
            setDraft((current) => ({ ...current, link }));
            setError("");
          }}
          placeholder="https://"
          spellCheck={false}
          type="text"
          value={draft.link}
        />
        <p id={`${fieldId}-link-hint`}>
          The preview, quote or folder you prepared.
        </p>
      </div>
      <div className="c3wa-call-brief-field">
        <label htmlFor={`${fieldId}-note`}>Description</label>
        <textarea
          data-testid="whatsapp-call-brief-note"
          id={`${fieldId}-note`}
          maxLength={CALL_BRIEF_MAX_CHARS}
          onChange={(event) => {
            const note = event.currentTarget.value;
            setDraft((current) => ({ ...current, note }));
            setError("");
          }}
          placeholder="What should they know before the call?"
          rows={4}
          value={draft.note}
        />
      </div>
      <div className="c3wa-call-brief-field">
        <label htmlFor={`${fieldId}-assignee`}>Assign to</label>
        <select
          aria-describedby={
            closersQuery.isError ? `${fieldId}-assignee-hint` : undefined
          }
          data-testid="whatsapp-call-brief-assignee"
          id={`${fieldId}-assignee`}
          onChange={(event) => {
            const assigneePubkey = event.currentTarget.value;
            setDraft((current) => ({ ...current, assigneePubkey }));
            setError("");
          }}
          value={draft.assigneePubkey}
        >
          <option value="">Nobody yet</option>
          {storedAssignee && !storedIsListed ? (
            <option value={storedAssignee}>
              {storedAssignee === myPubkey ? "You" : "The person who has it"}
            </option>
          ) : null}
          {closers.map((closer) => (
            <option key={closer.pubkey} value={closer.pubkey}>
              {callCloserLabel(closer)}
              {closer.pubkey === myPubkey ? " (you)" : ""}
            </option>
          ))}
        </select>
        {closersQuery.isPending ? (
          <p role="status">Loading your team…</p>
        ) : null}
        {closersQuery.isError ? (
          <p id={`${fieldId}-assignee-hint`}>
            Your team could not be loaded. You can still save the link and the
            description.{" "}
            <button
              className="c3wa-call-brief-retry"
              onClick={() => void closersQuery.refetch()}
              type="button"
            >
              Try again
            </button>
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="c3wa-desk-error" role="alert">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          disabled={busy}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          data-testid="whatsapp-call-brief-save"
          disabled={busy}
          type="submit"
        >
          {busy ? "Saving…" : ready ? "Mark ready to call" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The form a person fills when a lead is ready for its call, and later to change the brief.
 * The stage and the brief are sent as one request, so the lead never moves without them.
 */
export function WhatsAppCallBriefDialog({
  target,
  onClose,
}: {
  target: CallBriefDialogTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={target !== null}
    >
      <DialogContent
        className="max-w-lg"
        data-testid="whatsapp-call-brief-dialog"
      >
        {target ? (
          <CallBriefForm
            key={`${target.contact.waId}:${target.mode}`}
            onClose={onClose}
            target={target}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
