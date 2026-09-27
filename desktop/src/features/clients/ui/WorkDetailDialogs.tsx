import type * as React from "react";

import type {
  DeliverablePointer,
  DeliverableVersion,
  EventRecord,
  WorkItemHead,
} from "@/features/clients/lib/businessRecords";
import { RecordMessage } from "@/features/clients/ui/ClientWorkspace";
import { truncateNpub, truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

type VersionDraft = {
  deliverableId: string | null;
  newDeliverableId: string | null;
};

type ApprovalDraft = {
  pointer: DeliverablePointer;
  version: EventRecord<DeliverableVersion>;
  decision: "approved" | "changes_requested";
};

type MemberOption = {
  pubkey: string;
  displayName: string | null;
  role: string;
};

type WorkDetailDialogsProps = {
  approvalDraft: ApprovalDraft | null;
  approvalNote: string;
  clientDisplayName: string;
  clientIsActive: boolean;
  editApprovers: string[];
  editAssignees: string[];
  editOpen: boolean;
  editStatus: string;
  editTitle: string;
  hasSubmitError: boolean;
  isAdmin: boolean;
  isSubmitting: boolean;
  editingDisabled: boolean;
  head: WorkItemHead;
  members: readonly MemberOption[];
  onApprovalDraftChange: React.Dispatch<
    React.SetStateAction<ApprovalDraft | null>
  >;
  onApprovalNoteChange: React.Dispatch<React.SetStateAction<string>>;
  onEditApproversChange: React.Dispatch<React.SetStateAction<string[]>>;
  onEditAssigneesChange: React.Dispatch<React.SetStateAction<string[]>>;
  onEditOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  onEditStatusChange: React.Dispatch<React.SetStateAction<string>>;
  onEditTitleChange: React.Dispatch<React.SetStateAction<string>>;
  onRecordApproval: React.FormEventHandler<HTMLFormElement>;
  onSaveDeliverableVersion: React.FormEventHandler<HTMLFormElement>;
  onSaveWorkDetails: React.FormEventHandler<HTMLFormElement>;
  onVersionContentChange: React.Dispatch<React.SetStateAction<string>>;
  onVersionDraftChange: React.Dispatch<
    React.SetStateAction<VersionDraft | null>
  >;
  onVersionTitleChange: React.Dispatch<React.SetStateAction<string>>;
  versionContent: string;
  versionDraft: VersionDraft | null;
  versionTitle: string;
  versions: readonly EventRecord<DeliverableVersion>[];
};

function jsonBodyParts(body: unknown): { title: string; content: string } {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    return {
      title: typeof record.title === "string" ? record.title : "",
      content:
        typeof record.content === "string"
          ? record.content
          : JSON.stringify(body, null, 2),
    };
  }
  return { title: "", content: JSON.stringify(body, null, 2) };
}

export function WorkDetailDialogs({
  approvalDraft,
  approvalNote,
  clientDisplayName,
  clientIsActive,
  editApprovers,
  editAssignees,
  editOpen,
  editStatus,
  editTitle,
  hasSubmitError,
  isAdmin,
  isSubmitting,
  editingDisabled,
  head,
  members,
  onApprovalDraftChange,
  onApprovalNoteChange,
  onEditApproversChange,
  onEditAssigneesChange,
  onEditOpenChange,
  onEditStatusChange,
  onEditTitleChange,
  onRecordApproval,
  onSaveDeliverableVersion,
  onSaveWorkDetails,
  onVersionContentChange,
  onVersionDraftChange,
  onVersionTitleChange,
  versionContent,
  versionDraft,
  versionTitle,
  versions,
}: WorkDetailDialogsProps) {
  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (!open && !isSubmitting) onEditOpenChange(false);
        }}
        open={editOpen}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit work</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-5" onSubmit={onSaveWorkDetails}>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="edit-work-title">
                Work title
              </label>
              <Input
                autoFocus
                disabled={!isAdmin || !clientIsActive || editingDisabled}
                id="edit-work-title"
                maxLength={180}
                onChange={(event) => onEditTitleChange(event.target.value)}
                required
                value={editTitle}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="edit-work-status">
                Status
              </label>
              <select
                className="h-9 rounded-lg border border-input/40 bg-background px-3 text-sm"
                disabled={!isAdmin || !clientIsActive || editingDisabled}
                id="edit-work-status"
                onChange={(event) => onEditStatusChange(event.target.value)}
                value={editStatus}
              >
                {[
                  ["active", "In progress"],
                  ["review", "Needs review"],
                  ["blocked", "Blocked"],
                  ["paused", "Paused"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <MemberPicker
              disabled={!isAdmin || !clientIsActive || editingDisabled}
              label="Assigned to"
              members={members}
              onChange={onEditAssigneesChange}
              selected={editAssignees}
            />
            <MemberPicker
              disabled={!isAdmin || !clientIsActive || editingDisabled}
              label="Client reviewers"
              members={members}
              onChange={onEditApproversChange}
              selected={editApprovers}
            />
            <DialogActions
              disabled={isSubmitting}
              onCancel={() => onEditOpenChange(false)}
              submitLabel={hasSubmitError ? "Retry" : "Save changes"}
            />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isSubmitting) onVersionDraftChange(null);
        }}
        open={Boolean(versionDraft)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {versionDraft?.deliverableId
                ? "New deliverable version"
                : "Add deliverable"}
            </DialogTitle>
          </DialogHeader>
          {versionDraft?.deliverableId &&
          !versions.some(
            (record) =>
              record.event.id ===
              head.deliverables.find(
                (pointer) =>
                  pointer.deliverableId === versionDraft.deliverableId,
              )?.versionEventId,
          ) ? (
            <RecordMessage kind="error">
              The current deliverable version is unavailable. Reload the record
              before editing.
            </RecordMessage>
          ) : null}
          <form
            className="flex flex-col gap-5"
            onSubmit={onSaveDeliverableVersion}
          >
            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="deliverable-title"
              >
                Deliverable title
              </label>
              <Input
                autoFocus
                disabled={editingDisabled}
                id="deliverable-title"
                maxLength={180}
                onChange={(event) => onVersionTitleChange(event.target.value)}
                required
                value={versionTitle}
              />
            </div>
            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="deliverable-content"
              >
                Content
              </label>
              <Textarea
                disabled={editingDisabled}
                id="deliverable-content"
                maxLength={120_000}
                onChange={(event) => onVersionContentChange(event.target.value)}
                required
                rows={7}
                value={versionContent}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              This creates an immutable version. Attachments are unavailable for
              this record type.
            </p>
            <DialogActions
              disabled={isSubmitting}
              onCancel={() => onVersionDraftChange(null)}
              submitLabel={hasSubmitError ? "Retry" : "Save version"}
            />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isSubmitting) onApprovalDraftChange(null);
        }}
        open={Boolean(approvalDraft)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {approvalDraft?.decision === "approved"
                ? "Approve this version?"
                : "Request changes"}
            </DialogTitle>
          </DialogHeader>
          {approvalDraft ? (
            <form className="flex flex-col gap-5" onSubmit={onRecordApproval}>
              <p className="text-sm text-muted-foreground">
                {clientDisplayName} ·{" "}
                {jsonBodyParts(approvalDraft.version.value.body).title ||
                  `Deliverable ${truncatePubkey(approvalDraft.pointer.deliverableId)}`}{" "}
                · Version {approvalDraft.version.value.version}
              </p>
              {approvalDraft.decision === "changes_requested" ? (
                <div className="grid gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="deliverable-feedback"
                  >
                    What needs to change?
                  </label>
                  <Textarea
                    autoFocus
                    disabled={editingDisabled}
                    id="deliverable-feedback"
                    maxLength={4_000}
                    onChange={(event) =>
                      onApprovalNoteChange(event.target.value)
                    }
                    required
                    rows={5}
                    value={approvalNote}
                  />
                </div>
              ) : (
                <p className="text-sm">
                  This records approval for the exact current version. A later
                  version needs a new review.
                </p>
              )}
              <DialogActions
                disabled={
                  isSubmitting ||
                  (approvalDraft.decision === "changes_requested" &&
                    !approvalNote.trim())
                }
                onCancel={() => onApprovalDraftChange(null)}
                submitLabel={
                  hasSubmitError
                    ? "Retry"
                    : approvalDraft.decision === "approved"
                      ? `Approve version ${approvalDraft.version.value.version}`
                      : "Request changes"
                }
              />
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MemberPicker({
  disabled,
  label,
  members,
  onChange,
  selected,
}: {
  disabled: boolean;
  label: string;
  members: readonly {
    pubkey: string;
    displayName: string | null;
    role: string;
  }[];
  onChange: (pubkeys: string[]) => void;
  selected: readonly string[];
}) {
  const selectedKeys = new Set(selected.map((pubkey) => pubkey.toLowerCase()));
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{label}</legend>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No channel members are available.
        </p>
      ) : null}
      <div className="max-h-48 overflow-auto rounded-lg border border-border/70 px-3">
        {members.map((member) => {
          const key = member.pubkey.toLowerCase();
          return (
            <label
              className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0"
              key={key}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">
                  {member.displayName || truncateNpub(key)}
                </span>
                <span className="block text-xs capitalize text-muted-foreground">
                  {member.role}
                </span>
              </span>
              <input
                aria-label={`${label}: ${member.displayName || truncateNpub(key)}`}
                checked={selectedKeys.has(key)}
                onChange={(event) => {
                  const next = new Set(selectedKeys);
                  if (event.target.checked) next.add(key);
                  else next.delete(key);
                  onChange([...next].sort());
                }}
                type="checkbox"
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DialogActions({
  disabled,
  onCancel,
  submitLabel,
}: {
  disabled: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button
        disabled={disabled}
        onClick={onCancel}
        type="button"
        variant="outline"
      >
        Cancel
      </Button>
      <Button disabled={disabled} type="submit">
        {submitLabel}
      </Button>
    </div>
  );
}
