import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { errorMessage } from "./BusinessCommon";
import { publishProspectAction } from "./businessRecordMutations";
import { createChanges, type LeadContext } from "./leadShared";

import "./colony3-leads.css";

const DUPLICATE_MESSAGE = "This business already exists in Leads.";
const LOST_REASONS = [
  "Not a fit",
  "Budget",
  "Timing",
  "Chose another provider",
] as const;

type DialogField = {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "url";
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  strong?: boolean;
  children?: React.ReactNode;
};

function DialogInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  invalid = false,
  describedBy,
  strong = false,
  children,
}: DialogField) {
  return (
    <div className="c3l-field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        className={`c3l-input${strong ? " c3l-input-strong" : ""}`}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        required={required}
        type={type}
        value={value}
      />
      {children}
    </div>
  );
}

/** "Add lead": the board's first dialog. */
export function AddLeadDialog({
  context,
  open,
  onOpenChange,
  canWrite,
}: {
  context: LeadContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
}) {
  const navigate = useNavigate();
  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [duplicateId, setDuplicateId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setContact("");
    setEmail("");
    setWebsite("");
    setIndustry("");
    setLocation("");
    setDuplicateId(null);
    setError("");
  }, [open]);

  async function createLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setDuplicateId(null);
    const duplicate = context.records.prospects.find(
      ({ record }) =>
        record.status === "active" &&
        record.prospect.party.displayName.trim().toLocaleLowerCase() ===
          name.trim().toLocaleLowerCase(),
    );
    if (duplicate) {
      setDuplicateId(duplicate.record.prospectId);
      return;
    }
    if (!context.currentPubkey) {
      setError("Identity is unavailable. Retry when the connection is ready.");
      return;
    }
    setSaving(true);
    try {
      const changes = createChanges(name, industry, location);
      changes.contactName = contact || null;
      changes.email = email || null;
      changes.website = website || null;
      const prospectId = changes.prospectId;
      await publishProspectAction({
        channelId: context.channelId,
        communityId: context.communityId,
        current: null,
        changes,
      });
      await context.refresh();
      onOpenChange(false);
      await navigate({ to: "/sales/lead/$prospectId", params: { prospectId } });
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3l-dialog"
        data-testid="w10-add-lead-dialog"
        showCloseButton={false}
      >
        <div className="c3l-dialog-head">
          <DialogTitle className="c3l-dialog-title">Add lead</DialogTitle>
          <DialogDescription className="sr-only">
            Add a business to Leads.
          </DialogDescription>
        </div>
        <form
          className="c3l-dialog-form"
          onSubmit={(event) => void createLead(event)}
        >
          <DialogInput
            describedBy={duplicateId ? "c3l-lead-duplicate" : undefined}
            id="w10-lead-name"
            invalid={Boolean(duplicateId)}
            label="Business name"
            onChange={setName}
            required
            strong
            value={name}
          >
            {duplicateId ? (
              <span
                className="c3l-field-error"
                id="c3l-lead-duplicate"
                role="alert"
              >
                {DUPLICATE_MESSAGE}{" "}
                <a href={`#/sales/lead/${duplicateId}`}>
                  Open the existing record.
                </a>
              </span>
            ) : null}
          </DialogInput>
          <DialogInput
            id="w10-lead-contact"
            label="Contact name"
            onChange={setContact}
            required
            value={contact}
          />
          <DialogInput
            id="w10-lead-email"
            label="Email"
            onChange={setEmail}
            required
            type="email"
            value={email}
          />
          <DialogInput
            id="w10-lead-website"
            label={
              <span>
                Website <span className="c3l-optional">Optional</span>
              </span>
            }
            onChange={setWebsite}
            type="url"
            value={website}
          />
          <div className="c3l-field-pair">
            <DialogInput
              id="w10-lead-industry"
              label="Industry"
              onChange={setIndustry}
              required
              value={industry}
            />
            <DialogInput
              id="w10-lead-location"
              label="Location"
              onChange={setLocation}
              required
              value={location}
            />
          </div>
          {error ? (
            <p className="c3l-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="c3l-dialog-actions">
            <button
              className="c3l-btn c3l-btn-outline c3l-btn-compact"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="c3l-btn c3l-btn-primary c3l-btn-compact"
              disabled={saving || !canWrite}
              type="submit"
            >
              {saving ? "Saving…" : "Add lead"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Close this opportunity": the board's last dialog. */
export function CloseOpportunityDialog({
  open,
  onOpenChange,
  subtitle,
  canWrite,
  saving,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: string;
  canWrite: boolean;
  saving: boolean;
  error: string;
  /** Resolves true when the opportunity was closed. */
  onSubmit: (input: { reason: string; notes: string }) => Promise<boolean>;
}) {
  const [reason, setReason] = React.useState<string>(LOST_REASONS[0]);
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setReason(LOST_REASONS[0]);
    setNotes("");
  }, [open]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3l-dialog c3l-dialog-close"
        data-testid="w10-close-opportunity-dialog"
        showCloseButton={false}
      >
        <div className="c3l-dialog-head">
          <DialogTitle className="c3l-dialog-title">
            Close this opportunity
          </DialogTitle>
          <DialogDescription className="c3l-dialog-sub">
            {subtitle}
          </DialogDescription>
        </div>
        <form
          className="c3l-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({ reason, notes }).then((closed) => {
              if (closed) onOpenChange(false);
            });
          }}
        >
          <div className="c3l-field">
            <label htmlFor="w10-lost-reason">Reason</label>
            <select
              className="c3l-select c3l-select-field"
              id="w10-lost-reason"
              onChange={(event) => setReason(event.currentTarget.value)}
              value={reason}
            >
              {LOST_REASONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="c3l-field">
            <label htmlFor="w10-lost-notes">Notes</label>
            <textarea
              className="c3l-textarea"
              id="w10-lost-notes"
              onChange={(event) => setNotes(event.currentTarget.value)}
              rows={4}
              value={notes}
            />
          </div>
          {error ? (
            <p className="c3l-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="c3l-dialog-actions">
            <button
              className="c3l-btn c3l-btn-outline c3l-btn-compact"
              disabled={saving}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="c3l-btn c3l-btn-danger c3l-btn-compact"
              disabled={!canWrite || saving}
              type="submit"
            >
              Mark as lost
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
