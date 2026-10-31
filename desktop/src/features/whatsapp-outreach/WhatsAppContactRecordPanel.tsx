import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Pencil, UserRound } from "lucide-react";

import { customerActions } from "@/features/cofounder/customerActions";
import { useCustomerRecordAction } from "@/features/cofounder/customerHooks";
import type { CustomerRecordView } from "@/features/cofounder/customerRecords";
import { BusinessLogoMark } from "@/features/discovery/BusinessLogoMark";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { KIND_WHATSAPP_CONTACT_UPDATE } from "@/shared/constants/kinds";
import type { OutreachContactIdentity } from "./outreachDeskUtils";
import type { WhatsAppContact, WhatsAppStage } from "./whatsappOutreachModels";
import { useWhatsAppCommand } from "./whatsappOutreachQueries";
import {
  WHATSAPP_MANUAL_STAGES,
  WHATSAPP_PIPELINE_STAGES,
  WHATSAPP_STAGE_LABELS,
} from "./whatsappOutreachStages";

function formatStamp(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

export function WhatsAppContactRecordPanel({
  canEdit,
  canWriteCustomerRecord,
  customerRecordsLoaded,
  contact,
  identity,
  record,
  onCloseMobile,
  mobileVisible = false,
}: {
  canEdit: boolean;
  canWriteCustomerRecord: boolean;
  customerRecordsLoaded: boolean;
  contact: WhatsAppContact;
  identity: OutreachContactIdentity;
  record: CustomerRecordView | null;
  onCloseMobile: () => void;
  mobileVisible?: boolean;
}) {
  const navigate = useNavigate();
  const command = useWhatsAppCommand();
  const customerAction = useCustomerRecordAction();
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [label, setLabel] = React.useState(contact.label ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => setLabel(contact.label ?? ""), [contact.label]);

  async function updateStage(stage: WhatsAppStage) {
    if (!canEdit || busy) return;
    setBusy(true);
    setError("");
    try {
      if (stage === "call_booked" && !customerRecordsLoaded) {
        throw new Error("Customer records must load before booking this call.");
      }
      if (stage === "call_booked" && record && canWriteCustomerRecord) {
        await customerAction.mutateAsync(
          customerActions.recordMilestone(record, {
            milestoneKind: "call_booked",
            at: Math.floor(Date.now() / 1000),
          }),
        );
      }
      await command(KIND_WHATSAPP_CONTACT_UPDATE, {
        v: 1,
        waId: contact.waId,
        stage,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update this contact.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveLabel() {
    if (!canEdit || busy) return;
    const nextLabel = label.trim();
    setBusy(true);
    setError("");
    try {
      await command(KIND_WHATSAPP_CONTACT_UPDATE, {
        v: 1,
        waId: contact.waId,
        label: nextLabel || null,
      });
      setRenameOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not rename this contact.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearLabel() {
    if (!canEdit || busy) return;
    setBusy(true);
    setError("");
    try {
      await command(KIND_WHATSAPP_CONTACT_UPDATE, {
        v: 1,
        waId: contact.waId,
        label: null,
      });
      setLabel("");
      setRenameOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not clear this label.",
      );
    } finally {
      setBusy(false);
    }
  }

  const currentStageIndex = WHATSAPP_PIPELINE_STAGES.indexOf(
    contact.stage as (typeof WHATSAPP_PIPELINE_STAGES)[number],
  );

  return (
    <aside
      className={`c3wa-record-panel ${mobileVisible ? "is-mobile-visible" : ""}`}
      data-testid="whatsapp-contact-record"
      aria-label="Contact record"
    >
      <header className="c3wa-record-panel-head">
        <Button
          className="c3wa-record-mobile-back"
          onClick={onCloseMobile}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" size={16} /> Back to chat
        </Button>
        <span aria-hidden="true" className="c3wa-record-logo">
          {identity.isLinked ? (
            <BusinessLogoMark
              className="c3wa-desk-logo-mark"
              name={identity.displayName}
              website={identity.website}
            />
          ) : (
            <UserRound size={20} />
          )}
        </span>
        <div className="c3wa-record-title">
          <h2>{identity.displayName}</h2>
          {contact.profileName &&
          contact.profileName !== identity.displayName ? (
            <p>WhatsApp profile: {contact.profileName}</p>
          ) : null}
        </div>
      </header>

      <div className="c3wa-record-panel-scroll">
        {error ? (
          <p className="c3wa-desk-error" role="alert">
            {error}
          </p>
        ) : null}
        <section
          className="c3wa-record-section"
          aria-labelledby="whatsapp-record-stage-heading"
        >
          <div className="c3wa-record-section-head">
            <h3 id="whatsapp-record-stage-heading">Stage</h3>
            {canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-testid="whatsapp-record-move"
                    disabled={busy}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Move to
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  aria-label="Move contact to stage"
                >
                  {WHATSAPP_MANUAL_STAGES.map((stage) => (
                    <DropdownMenuItem
                      disabled={
                        stage === contact.stage ||
                        busy ||
                        (stage === "call_booked" && !customerRecordsLoaded)
                      }
                      key={stage}
                      onSelect={() => void updateStage(stage)}
                    >
                      {WHATSAPP_STAGE_LABELS[stage]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <ol
            className="c3wa-record-stage-track"
            aria-label="Contact stage history"
          >
            {WHATSAPP_PIPELINE_STAGES.map((stage, index) => (
              <li
                className={index <= currentStageIndex ? "is-reached" : ""}
                key={stage}
              >
                <span aria-hidden="true" />
                <span>{WHATSAPP_STAGE_LABELS[stage]}</span>
              </li>
            ))}
          </ol>
          <span className={`c3wa-pipeline-stage-chip is-${contact.stage}`}>
            {WHATSAPP_STAGE_LABELS[contact.stage]}
          </span>
          {contact.stageSetBy ? (
            <p className="c3wa-record-meta">
              {contact.stageSetBy === "auto"
                ? "Updated automatically"
                : "Manually updated"}
            </p>
          ) : null}
        </section>

        <section
          className="c3wa-record-section"
          aria-labelledby="whatsapp-record-activity-heading"
        >
          <h3 id="whatsapp-record-activity-heading">Activity</h3>
          <dl className="c3wa-record-facts">
            <div>
              <dt>Last contacted</dt>
              <dd>{formatStamp(contact.lastContactedAt)}</dd>
            </div>
            <div>
              <dt>Last reply</dt>
              <dd>
                {formatStamp(contact.lastReplyAt ?? contact.lastInboundAt)}
              </dd>
            </div>
          </dl>
        </section>

        <section
          className="c3wa-record-section"
          aria-labelledby="whatsapp-record-contact-heading"
        >
          <h3 id="whatsapp-record-contact-heading">Contact</h3>
          <dl className="c3wa-record-facts">
            {identity.personName ? (
              <div>
                <dt>Person</dt>
                <dd>{identity.personName}</dd>
              </div>
            ) : null}
            <div>
              <dt>Phone</dt>
              <dd>
                <a href={`tel:+${contact.waId.replace(/\D/gu, "")}`}>
                  {identity.phone}
                </a>
              </dd>
            </div>
            {identity.location ? (
              <div>
                <dt>Location</dt>
                <dd>{identity.location}</dd>
              </div>
            ) : null}
            {identity.website ? (
              <div>
                <dt>Website</dt>
                <dd>
                  <a
                    href={identity.website}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {identity.website
                      .replace(/^https?:\/\//u, "")
                      .replace(/\/$/u, "")}{" "}
                    <ExternalLink aria-hidden="true" size={12} />
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      {record?.partyId || canEdit ? (
        <footer className="c3wa-record-panel-actions">
          {record?.partyId ? (
            <Button
              onClick={() =>
                void navigate({
                  to: "/clients/record/$partyId",
                  params: { partyId: record.partyId },
                })
              }
              type="button"
              variant="outline"
            >
              Open record
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              aria-label="Rename contact"
              data-testid="whatsapp-rename-contact"
              onClick={() => setRenameOpen(true)}
              type="button"
              variant="outline"
            >
              <Pencil aria-hidden="true" size={16} />
              Rename contact
            </Button>
          ) : null}
        </footer>
      ) : null}

      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent
          className="max-w-lg"
          data-testid="whatsapp-rename-dialog"
        >
          <DialogHeader>
            <DialogTitle>Rename contact</DialogTitle>
            <DialogDescription>
              The label appears in Chats and Pipeline. The WhatsApp profile name
              stays available here.
            </DialogDescription>
          </DialogHeader>
          <label className="c3wa-rename-field">
            <span>Contact label</span>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => setLabel(event.currentTarget.value)}
              value={label}
            />
          </label>
          {error ? (
            <p className="c3wa-desk-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            {contact.label ? (
              <Button
                disabled={busy}
                onClick={() => void clearLabel()}
                type="button"
                variant="outline"
              >
                Clear label
              </Button>
            ) : null}
            <Button
              disabled={busy || !label.trim()}
              onClick={() => void saveLabel()}
              type="button"
            >
              {busy ? "Saving…" : "Save label"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
