import * as React from "react";

import {
  BUSINESS_RECORD_SCHEMA_VERSION,
  type EventRecord,
} from "@/features/clients/lib/businessRecords";
import { useSubmitBusinessRecordMutation } from "@/features/clients/useBusinessRecords";
import { KIND_INVOICE_VERSION, KIND_PAYMENT } from "@/shared/constants/kinds";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { W10Button } from "@/features/discovery/BusinessCommon";
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
  invoiceLineDraft,
  moneyStep,
  parseQuantityInput,
  timestampFromDateInput,
  updateLine,
} from "./moneyUtils";

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
      const value: MoneyInvoiceVersionPayload = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        version: invoice.value.version + 1,
        previousVersionEventId: invoice.value.currentVersionEventId,
        proposalVersionEventId: invoice.value.proposalVersionEventId,
        expectedHeadEventId: invoice.event.id,
        action: "draft_edit",
        currency: invoice.value.currency,
        lines: normalizedLines,
        taxLines: invoice.value.taxLines,
        sellerTaxNumber: invoice.value.sellerTaxNumber,
        customerTaxNumber: invoice.value.customerTaxNumber,
        totalMinor,
        status: "draft",
        dueAt: timestampFromDateInput(dueDate),
        voidReason: null,
      };
      const template = moneyRecordTemplate(
        KIND_INVOICE_VERSION,
        value,
        moneyInvoiceVersionDTag(value.clientId, value.invoiceId, value.version),
      );
      await submit.mutateAsync(template);
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Edit {invoice.value.invoiceId}</DialogTitle>
          <DialogDescription>
            New invoices start as drafts. Review and issue separately.
          </DialogDescription>
        </DialogHeader>
        <form className="money-form" onSubmit={(event) => void save(event)}>
          <div className="money-static-field">
            <span>Client</span>
            <strong>{clientName}</strong>
          </div>
          {lines.map((line, index) => (
            <div className="money-line-editor" key={line.draftKey}>
              <label>
                <span>Service / description</span>
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
              <div className="money-line-amount">
                <label>
                  <span>Quantity</span>
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
                <label>
                  <span>Unit amount · {invoice.value.currency}</span>
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
            </div>
          ))}
          <label>
            <span>Due date</span>
            <input
              onChange={(event) => setDueDate(event.currentTarget.value)}
              type="date"
              value={dueDate}
            />
          </label>
          {error ? (
            <p className="money-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <W10Button onClick={() => onOpenChange(false)} variant="secondary">
              Cancel
            </W10Button>
            <W10Button
              disabled={!canManage || submit.isPending}
              type="submit"
              variant="primary"
            >
              Save invoice
            </W10Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IssueInvoiceDialog({
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
  const [error, setError] = React.useState("");
  const missingDetails = invoiceIssueMissingDetails(invoice.value);
  async function issue() {
    if (missingDetails.length) {
      setError(`Details missing before issue: ${missingDetails.join(", ")}.`);
      return;
    }
    const current = invoice.value;
    const value: MoneyInvoiceVersionPayload = {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: current.clientId,
      invoiceId: current.invoiceId,
      version: current.version + 1,
      previousVersionEventId: current.currentVersionEventId,
      proposalVersionEventId: current.proposalVersionEventId,
      expectedHeadEventId: invoice.event.id,
      action: "issue",
      currency: current.currency,
      lines: current.lines,
      taxLines: current.taxLines,
      sellerTaxNumber: current.sellerTaxNumber,
      customerTaxNumber: current.customerTaxNumber,
      totalMinor: current.totalMinor,
      status: "issued",
      dueAt: current.dueAt,
      voidReason: null,
    };
    try {
      await submit.mutateAsync(
        moneyRecordTemplate(
          KIND_INVOICE_VERSION,
          value,
          moneyInvoiceVersionDTag(
            value.clientId,
            value.invoiceId,
            value.version,
          ),
        ),
      );
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Issue {invoice.value.invoiceId}?</DialogTitle>
          <DialogDescription>
            Confirm the agreed scope and{" "}
            {formatMoneyMinor(invoice.value.totalMinor, invoice.value.currency)}{" "}
            amount. Issuing includes this record in invoiced revenue; it does
            not send an email.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="money-form-error" role="alert">
            {error}
          </p>
        ) : null}
        {missingDetails.length && !error ? (
          <p className="money-form-error" role="alert">
            Details missing before issue: {missingDetails.join(", ")}.
          </p>
        ) : null}
        <DialogFooter>
          <W10Button onClick={() => onOpenChange(false)} variant="secondary">
            Cancel
          </W10Button>
          <W10Button
            disabled={
              !canManage || submit.isPending || missingDetails.length > 0
            }
            onClick={() => void issue()}
            variant="primary"
          >
            Issue invoice
          </W10Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VoidInvoiceDialog({
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
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  async function voidInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    const current = invoice.value;
    const value: MoneyInvoiceVersionPayload = {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: current.clientId,
      invoiceId: current.invoiceId,
      version: current.version + 1,
      previousVersionEventId: current.currentVersionEventId,
      proposalVersionEventId: current.proposalVersionEventId,
      expectedHeadEventId: invoice.event.id,
      action: "void",
      currency: current.currency,
      lines: current.lines,
      taxLines: current.taxLines,
      sellerTaxNumber: current.sellerTaxNumber,
      customerTaxNumber: current.customerTaxNumber,
      totalMinor: current.totalMinor,
      status: "void",
      dueAt: current.dueAt,
      voidReason: trimmed,
    };
    try {
      await submit.mutateAsync(
        moneyRecordTemplate(
          KIND_INVOICE_VERSION,
          value,
          moneyInvoiceVersionDTag(
            value.clientId,
            value.invoiceId,
            value.version,
          ),
        ),
      );
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Void invoice {invoice.value.invoiceId}</DialogTitle>
          <DialogDescription>
            The original record remains visible. Voided invoices are excluded
            from revenue.
          </DialogDescription>
        </DialogHeader>
        <form
          className="money-form"
          onSubmit={(event) => void voidInvoice(event)}
        >
          <label>
            <span>Reason</span>
            <textarea
              onChange={(event) => setReason(event.currentTarget.value)}
              required
              rows={3}
              value={reason}
            />
          </label>
          {error ? (
            <p className="money-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <W10Button onClick={() => onOpenChange(false)} variant="secondary">
              Cancel
            </W10Button>
            <W10Button
              disabled={!canManage || submit.isPending}
              type="submit"
              variant="primary"
            >
              Void invoice
            </W10Button>
          </DialogFooter>
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
  const [provider, setProvider] = React.useState("manual");
  const [providerReference, setProviderReference] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState(currentDate());
  const [evidenceRef, setEvidenceRef] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setAmount(
        decimalInput(invoice.value.outstandingMinor, invoice.value.currency),
      );
      setProvider("manual");
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
      if (provider.trim() !== "manual" && !providerReference.trim()) {
        throw new Error("Enter the provider transaction reference.");
      }
      const paymentId = crypto.randomUUID();
      const expectedInvoiceHeadEventId = invoice.event.id;
      const value = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        paymentId,
        provider: provider.trim(),
        providerReference:
          provider.trim() === "manual" ? null : providerReference.trim(),
        amountMinor,
        currency: invoice.value.currency,
        occurredAt: timestampFromDateInput(occurredAt),
        evidenceRef: evidenceRef.trim(),
        expectedInvoiceHeadEventId,
      };
      const template = moneyRecordTemplate(
        KIND_PAYMENT,
        value,
        `client:${value.clientId}:payment:${paymentId}`,
      );
      await submit.mutateAsync(template);
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>Record payment · {invoice.value.invoiceId}</DialogTitle>
          <DialogDescription>
            Outstanding:{" "}
            {formatMoneyMinor(
              invoice.value.outstandingMinor,
              invoice.value.currency,
            )}
            . Recording payment evidence updates the balance. No money moves in
            Colony.
          </DialogDescription>
        </DialogHeader>
        <form className="money-form" onSubmit={(event) => void record(event)}>
          <label>
            <span>Amount received · {invoice.value.currency}</span>
            <input
              inputMode="decimal"
              onChange={(event) => setAmount(event.currentTarget.value)}
              required
              value={amount}
            />
          </label>
          <label>
            <span>Payment date</span>
            <input
              onChange={(event) => setOccurredAt(event.currentTarget.value)}
              required
              type="date"
              value={occurredAt}
            />
          </label>
          <label>
            <span>Provider</span>
            <input
              onChange={(event) => setProvider(event.currentTarget.value)}
              required
              value={provider}
            />
          </label>
          {provider.trim() !== "manual" ? (
            <label>
              <span>Provider transaction reference</span>
              <input
                onChange={(event) =>
                  setProviderReference(event.currentTarget.value)
                }
                required
                value={providerReference}
              />
            </label>
          ) : null}
          <label>
            <span>Payment reference / evidence</span>
            <input
              onChange={(event) => setEvidenceRef(event.currentTarget.value)}
              required
              value={evidenceRef}
            />
          </label>
          {error ? (
            <p className="money-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <W10Button onClick={() => onOpenChange(false)} variant="secondary">
              Cancel
            </W10Button>
            <W10Button
              disabled={!canManage || submit.isPending}
              type="submit"
              variant="primary"
            >
              Record payment
            </W10Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
