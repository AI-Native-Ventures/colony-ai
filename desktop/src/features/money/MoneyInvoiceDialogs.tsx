import * as React from "react";

import {
  BUSINESS_RECORD_SCHEMA_VERSION,
  type EventRecord,
} from "@/features/clients/lib/businessRecords";
import { InvoiceStatusPills } from "@/features/money/MoneyInvoiceList";
import { useSubmitBusinessRecordMutation } from "@/features/clients/useBusinessRecords";
import { KIND_INVOICE_VERSION, KIND_PAYMENT } from "@/shared/constants/kinds";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  type InvoiceLine,
  type MoneyInvoiceHead,
  type MoneyInvoiceVersion as MoneyInvoiceVersionPayload,
  formatMoneyMinor,
  invoiceIssueMissingDetails,
  moneyInvoiceVersionDTag,
  moneyRecordTemplate,
  parseMoneyInput,
  totalInvoiceMinor,
} from "./lib/moneyRecords";
import type { InvoiceLineDraft } from "./moneyUtils";
import {
  currentDate,
  dateInput,
  decimalInput,
  displayError,
  formatDisplayDate,
  invoiceLineDraft,
  invoiceNumber,
  moneyStep,
  parseQuantityInput,
  timestampFromDateInput,
  updateLine,
} from "./moneyUtils";
import "./colony3-money.css";

function dialogWidth(width: number): React.CSSProperties {
  return { maxWidth: `calc(${width} * var(--b3u))` };
}

function Actions({
  cancel = "ghost",
  children,
  onCancel,
}: {
  cancel?: "ghost" | "secondary";
  children: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <div className="b3-dialog-actions">
      <button
        className="b3-btn"
        data-variant={cancel === "ghost" ? "ghost" : undefined}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      {children}
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="b3-dialog-error" role="alert">
      {children}
    </p>
  );
}

function newVersionTemplate(
  invoice: EventRecord<MoneyInvoiceHead>,
  patch: Pick<MoneyInvoiceVersionPayload, "action" | "status" | "voidReason"> &
    Partial<Pick<MoneyInvoiceVersionPayload, "lines" | "totalMinor" | "dueAt">>,
) {
  const current = invoice.value;
  const value: MoneyInvoiceVersionPayload = {
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    clientId: current.clientId,
    invoiceId: current.invoiceId,
    version: current.version + 1,
    previousVersionEventId: current.currentVersionEventId,
    proposalVersionEventId: current.proposalVersionEventId,
    expectedHeadEventId: invoice.event.id,
    currency: current.currency,
    lines: patch.lines ?? current.lines,
    taxLines: current.taxLines,
    sellerTaxNumber: current.sellerTaxNumber,
    customerTaxNumber: current.customerTaxNumber,
    totalMinor: patch.totalMinor ?? current.totalMinor,
    dueAt: patch.dueAt === undefined ? current.dueAt : patch.dueAt,
    action: patch.action,
    status: patch.status,
    voidReason: patch.voidReason,
  };
  return moneyRecordTemplate(
    KIND_INVOICE_VERSION,
    value,
    moneyInvoiceVersionDTag(value.clientId, value.invoiceId, value.version),
  );
}

export function InvoiceEditDialog({
  canManage,
  clientName,
  invoice,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  clientName: string;
  invoice: EventRecord<MoneyInvoiceHead>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [lines, setLines] = React.useState<InvoiceLineDraft[]>(() =>
    invoice.value.lines.map((line) =>
      invoiceLineDraft(line, invoice.value.currency),
    ),
  );
  const [dueDate, setDueDate] = React.useState(dateInput(invoice.value.dueAt));
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setLines(
        invoice.value.lines.map((line) =>
          invoiceLineDraft(line, invoice.value.currency),
        ),
      );
      setDueDate(dateInput(invoice.value.dueAt));
      setError("");
    }
  }, [invoice.value.currency, invoice.value.dueAt, invoice.value.lines, open]);

  const draftTotal = React.useMemo(() => {
    try {
      return totalInvoiceMinor(
        lines.map((line) => ({
          serviceId: line.serviceId,
          description: line.description,
          quantityHundredths: parseQuantityInput(line.quantityInput),
          unitAmountMinor: parseMoneyInput(
            line.amountInput,
            invoice.value.currency,
            true,
          ),
        })),
        invoice.value.taxLines,
      );
    } catch {
      return null;
    }
  }, [invoice.value.currency, invoice.value.taxLines, lines]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const normalizedLines: InvoiceLine[] = lines.map((line) => ({
        serviceId: line.serviceId,
        description: line.description.trim(),
        quantityHundredths: parseQuantityInput(line.quantityInput),
        unitAmountMinor: parseMoneyInput(
          line.amountInput,
          invoice.value.currency,
          true,
        ),
      }));
      const totalMinor = totalInvoiceMinor(
        normalizedLines,
        invoice.value.taxLines,
      );
      if (normalizedLines.some((line) => !line.description)) {
        throw new Error("Each invoice line needs a description.");
      }
      await submit.mutateAsync(
        newVersionTemplate(invoice, {
          action: "draft_edit",
          status: "draft",
          voidReason: null,
          lines: normalizedLines,
          totalMinor,
          dueAt: timestampFromDateInput(dueDate),
        }),
      );
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent style={dialogWidth(430)}>
        <DialogHeader>
          <DialogTitle>
            Edit Invoice {invoiceNumber(invoice.value.invoiceId)}
          </DialogTitle>
          <DialogDescription>
            New invoices start as drafts. Review and issue separately.
          </DialogDescription>
        </DialogHeader>
        <form
          className="b3-dialog-fields"
          onSubmit={(event) => void save(event)}
        >
          <div className="b3-dialog-summary">
            <span className="b3-eyebrow">Client</span>
            <span className="b3-dialog-summary-name">{clientName}</span>
          </div>
          {lines.map((line, index) => (
            <fieldset className="b3-dialog-line" key={line.draftKey}>
              <legend>Line {index + 1}</legend>
              <label className="b3-dialog-field">
                Service / description
                <input
                  autoComplete="off"
                  onChange={(event) =>
                    updateLine(setLines, index, {
                      description: event.currentTarget.value,
                    })
                  }
                  required
                  value={line.description}
                />
              </label>
              <div className="b3-dialog-row">
                <label className="b3-dialog-field">
                  Quantity
                  <input
                    inputMode="decimal"
                    min="0.01"
                    onChange={(event) =>
                      updateLine(setLines, index, {
                        quantityInput: event.currentTarget.value,
                      })
                    }
                    step="0.01"
                    type="number"
                    value={line.quantityInput}
                  />
                </label>
                <label className="b3-dialog-field">
                  Unit amount · {invoice.value.currency}
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) =>
                      updateLine(setLines, index, {
                        amountInput: event.currentTarget.value,
                      })
                    }
                    step={moneyStep(invoice.value.currency)}
                    type="number"
                    value={line.amountInput}
                  />
                </label>
              </div>
            </fieldset>
          ))}
          <label className="b3-dialog-field">
            Due date
            <input
              onChange={(event) => setDueDate(event.currentTarget.value)}
              type="date"
              value={dueDate}
            />
          </label>
          <div className="b3-dialog-total">
            <span>Total</span>
            <span>
              {draftTotal === null
                ? "-"
                : formatMoneyMinor(draftTotal, invoice.value.currency)}
            </span>
          </div>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
          <Actions cancel="secondary" onCancel={() => onOpenChange(false)}>
            <button
              className="b3-btn"
              data-variant="primary"
              disabled={!canManage || submit.isPending}
              type="submit"
            >
              Save invoice
            </button>
          </Actions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IssueInvoiceDialog({
  canManage,
  clientName,
  invoice,
  onEdit,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  clientName: string;
  invoice: EventRecord<MoneyInvoiceHead>;
  onEdit: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [error, setError] = React.useState("");
  const missingDetails = invoiceIssueMissingDetails(invoice.value);
  async function issue() {
    if (missingDetails.length) {
      setError(`Details missing before issue: ${missingDetails.join(", ")}.`);
      return;
    }
    try {
      await submit.mutateAsync(
        newVersionTemplate(invoice, {
          action: "issue",
          status: "issued",
          voidReason: null,
        }),
      );
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  const amount = formatMoneyMinor(
    invoice.value.totalMinor,
    invoice.value.currency,
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent style={dialogWidth(420)}>
        <DialogHeader>
          <DialogTitle>
            Issue Invoice {invoiceNumber(invoice.value.invoiceId)}?
          </DialogTitle>
          <DialogDescription>
            Confirm the agreed scope and <strong>{amount}</strong> amount.
            Issuing includes this record in invoiced revenue; it does not send
            an email.
          </DialogDescription>
        </DialogHeader>
        <div className="b3-dialog-summary">
          <span className="b3-dialog-summary-name">{clientName}</span>
          <span className="b3-dialog-summary-row">
            <span className="b3-dialog-summary-text">
              {invoice.value.lines.map((line) => line.description).join(" · ")}
            </span>
            <span className="b3-dialog-summary-amount">{amount}</span>
          </span>
        </div>
        {missingDetails.length ? (
          <div className="b3-dialog-warning" role="alert">
            <WarningCircle />
            <span>
              <strong>Details missing before issue:</strong>{" "}
              {missingDetails.join(", ")}.
            </span>
          </div>
        ) : null}
        {error && !missingDetails.length ? (
          <ErrorLine>{error}</ErrorLine>
        ) : null}
        <div className="b3-dialog-actions">
          <button
            className="b3-btn"
            disabled={!canManage}
            onClick={() => {
              onOpenChange(false);
              onEdit();
            }}
            type="button"
          >
            Edit invoice
          </button>
          <button
            className="b3-btn"
            data-variant="primary"
            disabled={
              !canManage || submit.isPending || missingDetails.length > 0
            }
            onClick={() => void issue()}
            type="button"
          >
            Issue invoice
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VoidInvoiceDialog({
  canManage,
  clientName,
  invoice,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  clientName: string;
  invoice: EventRecord<MoneyInvoiceHead>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  async function voidInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    try {
      await submit.mutateAsync(
        newVersionTemplate(invoice, {
          action: "void",
          status: "void",
          voidReason: trimmed,
        }),
      );
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  const { value: head } = invoice;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent style={dialogWidth(410)}>
        <DialogHeader>
          <DialogTitle>
            Void invoice {invoiceNumber(head.invoiceId)}
          </DialogTitle>
          <DialogDescription>
            The original record remains visible. Voided invoices are excluded
            from revenue.
          </DialogDescription>
        </DialogHeader>
        <form
          className="b3-dialog-fields"
          onSubmit={(event) => void voidInvoice(event)}
        >
          <div className="b3-dialog-summary">
            <span className="b3-dialog-summary-row">
              <span className="b3-dialog-summary-name">{clientName}</span>
              <InvoiceStatusPills invoice={head} />
            </span>
            <span className="b3-dialog-summary-row">
              <span className="b3-dialog-summary-text">
                {head.lines.map((line) => line.description).join(" · ")}
              </span>
              <span className="b3-dialog-summary-amount">
                {formatMoneyMinor(head.totalMinor, head.currency)}
              </span>
            </span>
            <span className="b3-dialog-summary-meta">
              Issued {formatDisplayDate(head.issuedAt)} · due{" "}
              {formatDisplayDate(head.dueAt)} ·{" "}
              {head.collectedMinor > 0
                ? `${formatMoneyMinor(head.collectedMinor, head.currency)} collected`
                : "no payments recorded"}
            </span>
          </div>
          <label className="b3-dialog-field">
            Reason
            <textarea
              onChange={(event) => setReason(event.currentTarget.value)}
              required
              rows={4}
              value={reason}
            />
          </label>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
          <Actions cancel="secondary" onCancel={() => onOpenChange(false)}>
            <button
              className="b3-btn"
              data-variant="danger"
              disabled={!canManage || submit.isPending}
              type="submit"
            >
              Void invoice
            </button>
          </Actions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecordPaymentDialog({
  canManage,
  invoice,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  invoice: EventRecord<MoneyInvoiceHead>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [amount, setAmount] = React.useState("");
  const [providerKind, setProviderKind] = React.useState<"manual" | "other">(
    "manual",
  );
  const [providerName, setProviderName] = React.useState("");
  const [providerReference, setProviderReference] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState(currentDate());
  const [evidenceRef, setEvidenceRef] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setAmount(
        decimalInput(invoice.value.outstandingMinor, invoice.value.currency),
      );
      setProviderKind("manual");
      setProviderName("");
      setProviderReference("");
      setOccurredAt(currentDate());
      setEvidenceRef("");
      setError("");
    }
  }, [invoice.value.currency, invoice.value.outstandingMinor, open]);
  async function record(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const amountMinor = parseMoneyInput(amount, invoice.value.currency);
      if (amountMinor > invoice.value.outstandingMinor) {
        throw new Error(
          "The amount exceeds this invoice’s outstanding balance.",
        );
      }
      const provider =
        providerKind === "manual" ? "manual" : providerName.trim();
      if (providerKind === "other" && !provider) {
        throw new Error("Enter the provider name.");
      }
      if (providerKind === "other" && !providerReference.trim()) {
        throw new Error("Enter the provider transaction reference.");
      }
      const paymentId = crypto.randomUUID();
      const value = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        paymentId,
        provider,
        providerReference:
          providerKind === "manual" ? null : providerReference.trim(),
        amountMinor,
        currency: invoice.value.currency,
        occurredAt: timestampFromDateInput(occurredAt),
        evidenceRef: evidenceRef.trim(),
        expectedInvoiceHeadEventId: invoice.event.id,
      };
      await submit.mutateAsync(
        moneyRecordTemplate(
          KIND_PAYMENT,
          value,
          `client:${value.clientId}:payment:${paymentId}`,
        ),
      );
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent style={dialogWidth(420)}>
        <DialogHeader>
          <DialogTitle>
            Record payment · Invoice {invoiceNumber(invoice.value.invoiceId)}
          </DialogTitle>
          <DialogDescription>
            Outstanding:{" "}
            <strong>
              {formatMoneyMinor(
                invoice.value.outstandingMinor,
                invoice.value.currency,
              )}
            </strong>
            . Recording payment evidence updates the balance. No money moves in
            Colony.
          </DialogDescription>
        </DialogHeader>
        <form
          className="b3-dialog-fields"
          onSubmit={(event) => void record(event)}
        >
          <div className="b3-dialog-row">
            <label className="b3-dialog-field">
              Amount received · {invoice.value.currency}
              <input
                inputMode="decimal"
                onChange={(event) => setAmount(event.currentTarget.value)}
                required
                value={amount}
              />
            </label>
            <label className="b3-dialog-field">
              Payment date
              <input
                onChange={(event) => setOccurredAt(event.currentTarget.value)}
                required
                type="date"
                value={occurredAt}
              />
            </label>
          </div>
          <label className="b3-dialog-field">
            Provider
            <select
              onChange={(event) =>
                setProviderKind(event.currentTarget.value as "manual" | "other")
              }
              value={providerKind}
            >
              <option value="manual">Manual</option>
              <option value="other">Other provider</option>
            </select>
          </label>
          {providerKind === "other" ? (
            <>
              <label className="b3-dialog-field">
                Provider name
                <input
                  onChange={(event) =>
                    setProviderName(event.currentTarget.value)
                  }
                  required
                  value={providerName}
                />
              </label>
              <label className="b3-dialog-field">
                Provider transaction reference
                <input
                  onChange={(event) =>
                    setProviderReference(event.currentTarget.value)
                  }
                  required
                  value={providerReference}
                />
              </label>
            </>
          ) : null}
          <label className="b3-dialog-field">
            Payment reference / evidence
            <input
              onChange={(event) => setEvidenceRef(event.currentTarget.value)}
              placeholder="Receipt number or remittance reference"
              required
              value={evidenceRef}
            />
          </label>
          <p className="b3-dialog-help">
            A provider transaction reference is asked for when the provider
            isn’t manual.
          </p>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
          <Actions onCancel={() => onOpenChange(false)}>
            <button
              className="b3-btn"
              data-variant="primary"
              disabled={!canManage || submit.isPending}
              type="submit"
            >
              Record payment
            </button>
          </Actions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WarningCircle() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
      width="18"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 16.5v.2" />
    </svg>
  );
}
