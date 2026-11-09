import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { KIND_WHATSAPP_BATCH } from "@/shared/constants/kinds";
import {
  useWhatsAppCommand,
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
} from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { useWhatsAppLeadData } from "@/features/whatsapp-outreach/whatsappLeadStatus";
import type { WhatsAppTemplate } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { errorMessage } from "./BusinessCommon";
import { MinimumFitControl } from "./OutreachFitScorePanel";
import {
  buildOutreachBatchPlan,
  type OutreachBatchLead,
} from "./outreachBatch";

export function OutreachBatchDialog({
  leads,
  listName,
  defaultTemplate,
  minimumFit,
  onMinimumFitChange,
  onOpenChange,
  open,
}: {
  leads: readonly OutreachBatchLead[];
  listName: string;
  defaultTemplate?: { name: string; language: string } | null;
  minimumFit?: number | null;
  onMinimumFitChange?: (minimumFit: number | null) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const navigate = useNavigate();
  const statusQuery = useWhatsAppStatusQuery();
  const templatesQuery = useWhatsAppTemplatesQuery(
    statusQuery.data?.connected === true,
  );
  const { contactsQuery, inBatchLeadIds } = useWhatsAppLeadData();
  const command = useWhatsAppCommand();
  const [template, setTemplate] = React.useState<WhatsAppTemplate | null>(null);
  const [localMinimumFit, setLocalMinimumFit] = React.useState<number | null>(
    null,
  );
  const userSelectedTemplate = React.useRef(false);
  const wasOpen = React.useRef(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const effectiveMinimumFit =
    minimumFit === undefined ? localMinimumFit : minimumFit;
  const changeMinimumFit = onMinimumFitChange ?? setLocalMinimumFit;
  const hasFitData = leads.some((lead) => lead.fit !== undefined);
  const templates = (
    templatesQuery.data ??
    statusQuery.data?.templates ??
    []
  ).filter((item) => item.status.toLocaleUpperCase() === "APPROVED");
  const batchPlan = template
    ? buildOutreachBatchPlan({
        batchId: "preview",
        listName,
        leads,
        contacts: contactsQuery.data ?? [],
        inBatchLeadIds,
        template,
        minimumFit: effectiveMinimumFit,
      })
    : null;

  React.useEffect(() => {
    const justOpened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!justOpened) return;
    userSelectedTemplate.current = false;
    setTemplate(null);
    setError("");
    if (minimumFit === undefined) setLocalMinimumFit(null);
  }, [minimumFit, open]);

  React.useEffect(() => {
    if (!open || userSelectedTemplate.current || !defaultTemplate) return;
    const preferred = templates.find(
      (item) =>
        item.name === defaultTemplate.name &&
        item.language === defaultTemplate.language,
    );
    if (preferred) setTemplate(preferred);
  }, [defaultTemplate, open, templates]);

  async function prepare() {
    if (!template || !batchPlan || busy) return;
    if (!statusQuery.data?.connected) {
      setError("Connect WhatsApp before preparing a batch.");
      return;
    }
    if (batchPlan.content.rows.length === 0) {
      setError(
        "No selected leads can be added to a batch. Review the skip reasons.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const batchId = crypto.randomUUID();
    try {
      await command(KIND_WHATSAPP_BATCH, {
        ...batchPlan.content,
        batchId,
      });
      onOpenChange(false);
      await navigate({
        to: "/whatsapp/batches/$batchId",
        params: { batchId },
      });
    } catch (prepareError) {
      setError(errorMessage(prepareError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3l-dialog-content"
        data-testid="outreach-batch-dialog"
      >
        <DialogHeader>
          <DialogTitle>Prepare WhatsApp batch</DialogTitle>
          <DialogDescription>
            Choose an approved template for {leads.length} selected leads.
            Sending waits for approval.
          </DialogDescription>
        </DialogHeader>
        {hasFitData ? (
          <section
            aria-label="Outreach fit selection"
            className="c3f-dialog-fit"
          >
            <MinimumFitControl
              minimumFit={effectiveMinimumFit}
              onMinimumFitChange={changeMinimumFit}
            />
          </section>
        ) : null}
        {!statusQuery.data?.connected ? (
          <p className="c3l-outreach-note" role="status">
            WhatsApp is not connected for this business.
          </p>
        ) : templatesQuery.isPending || contactsQuery.isPending ? (
          <p className="c3l-outreach-note" role="status">
            Loading templates and contact status
          </p>
        ) : templatesQuery.isError || contactsQuery.isError ? (
          <p className="c3l-outreach-error" role="alert">
            Template or contact status could not be loaded. Retry after the
            connection is available.
          </p>
        ) : templates.length === 0 ? (
          <p className="c3l-outreach-note" role="status">
            No approved templates are available.
          </p>
        ) : (
          <div className="c3l-outreach-template-list">
            {templates.map((item) => (
              <button
                aria-pressed={
                  template?.name === item.name &&
                  template.language === item.language
                }
                className={
                  template?.name === item.name &&
                  template.language === item.language
                    ? "is-selected"
                    : ""
                }
                key={`${item.name}:${item.language}`}
                onClick={() => {
                  userSelectedTemplate.current = true;
                  setTemplate(item);
                }}
                type="button"
              >
                <strong>{item.name}</strong>
                <span>
                  {item.language} · {item.category.toLocaleLowerCase()}
                </span>
              </button>
            ))}
          </div>
        )}
        {batchPlan ? (
          <div
            className="c3l-outreach-skip-summary"
            data-testid="batch-skip-summary"
          >
            <strong>{batchPlan.content.rows.length} ready for review</strong>
            <span>
              {Object.entries(batchPlan.skipped)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => `${count} ${skipLabel(reason)}`)
                .join(" · ") || "No leads skipped"}
            </span>
          </div>
        ) : null}
        {batchPlan?.notContacted.length ? (
          <ul aria-label="Not contacted" className="c3f-batch-not-contacted">
            {batchPlan.notContacted.map((item) => (
              <li key={item.leadId}>
                <strong>{item.name}</strong>
                <span>{item.reason.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="c3l-outreach-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="c3l-outreach-dialog-actions">
          <button
            className="c3l-btn c3l-btn-outline c3l-btn-small"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="c3l-btn c3l-btn-primary c3l-btn-small"
            disabled={
              busy ||
              !template ||
              !statusQuery.data?.connected ||
              Boolean(batchPlan && batchPlan.content.rows.length === 0)
            }
            onClick={() => void prepare()}
            type="button"
          >
            {busy ? "Preparing…" : "Prepare for approval"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function skipLabel(reason: string): string {
  switch (reason) {
    case "noPhone":
      return "without a phone";
    case "notOnWhatsApp":
      return "not on WhatsApp";
    case "optedOut":
      return "opted out";
    case "paused":
      return "paused";
    case "inBatch":
      return "already in a batch";
    case "alreadyContacted":
      return "waiting for a reply";
    case "invalidPhone":
      return "with an invalid number";
    case "duplicate":
      return "duplicate number";
    default:
      return "skipped";
  }
}
