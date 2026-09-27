import * as React from "react";

import {
  BUSINESS_RECORD_SCHEMA_VERSION,
  type EventRecord,
} from "@/features/clients/lib/businessRecords";
import { useSubmitBusinessRecordMutation } from "@/features/clients/useBusinessRecords";
import {
  KIND_INVOICE_VERSION,
  KIND_MONEY_ADJUSTMENT,
  KIND_MONEY_FOLLOW_UP,
  KIND_PAYMENT,
} from "@/shared/constants/kinds";
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
  type MoneyAdjustment as MoneyAdjustmentPayload,
  type MoneyFollowUpAction as MoneyFollowUpPayload,
  type MoneyInvoiceHead,
  type MoneyInvoiceVersion as MoneyInvoiceVersionPayload,
  type MoneyWorkspaceRecords,
  formatMoneyMinor,
  moneyAdjustmentDTag,
  moneyFollowUpDTag,
  moneyInvoiceVersionDTag,
  moneyRecordTemplate,
  parseMoneyInput,
} from "./lib/moneyRecords";
import type { InvoiceLineDraft } from "./moneyUtils";
import {
  creditAvailableForRefund,
  currentDate,
  dateInput,
  decimalInput,
  displayError,
  formatTimestamp,
  invoiceLineDraft,
  moneyStep,
  parseQuantityInput,
  timestampFromDateInput,
  totalLinesMinor,
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
      const totalMinor = totalLinesMinor(normalizedLines);
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
  async function issue() {
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
        <DialogFooter>
          <W10Button onClick={() => onOpenChange(false)} variant="secondary">
            Cancel
          </W10Button>
          <W10Button
            disabled={!canManage || submit.isPending}
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

export function MoneyAdjustmentDialog({
  action,
  canManage,
  clientNames,
  invoices,
  onActionChange,
  onOpenChange,
  open,
}: {
  action: "credit_note" | "refund" | null;
  canManage: boolean;
  clientNames: ReadonlyMap<string, string>;
  invoices: EventRecord<MoneyInvoiceHead>[];
  onActionChange: (action: "credit_note" | "refund") => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const eligibleInvoices =
    action === "refund"
      ? invoices.filter(({ value }) => creditAvailableForRefund(value) > 0)
      : invoices;
  const firstInvoiceId = eligibleInvoices[0]?.value.invoiceId ?? "";
  const [invoiceId, setInvoiceId] = React.useState(firstInvoiceId);
  const invoice =
    eligibleInvoices.find(({ value }) => value.invoiceId === invoiceId) ?? null;
  const noRefundableBalance =
    action === "refund" && eligibleInvoices.length === 0;
  const submit = useSubmitBusinessRecordMutation();
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(currentDate());
  const [reason, setReason] = React.useState("");
  const [evidenceRef, setEvidenceRef] = React.useState("");
  const [refundEvidenceConfirmed, setRefundEvidenceConfirmed] =
    React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setInvoiceId(firstInvoiceId);
      setAmount("");
      setDate(currentDate());
      setReason("");
      setEvidenceRef("");
      setRefundEvidenceConfirmed(false);
      setError("");
    }
  }, [firstInvoiceId, open]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !invoice) return;
    try {
      const amountMinor = parseMoneyInput(amount, invoice.value.currency);
      if (
        action === "credit_note" &&
        amountMinor > invoice.value.totalMinor - invoice.value.creditedMinor
      ) {
        throw new Error("The credit exceeds the remaining invoice amount.");
      }
      if (
        action === "refund" &&
        amountMinor > creditAvailableForRefund(invoice.value)
      ) {
        throw new Error(
          "The refund exceeds the available client credit balance.",
        );
      }
      if (action === "refund" && !refundEvidenceConfirmed) {
        throw new Error("Confirm that the refund was paid outside Colony.");
      }
      const occurredAt = timestampFromDateInput(date);
      if (occurredAt === null) throw new Error("Select an adjustment date.");
      const adjustmentId = crypto.randomUUID();
      const value: MoneyAdjustmentPayload = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        adjustmentId,
        adjustmentType: action,
        amountMinor,
        currency: invoice.value.currency,
        reason: reason.trim(),
        evidenceRef: evidenceRef.trim(),
        occurredAt,
        expectedInvoiceHeadEventId: invoice.event.id,
      };
      const template = moneyRecordTemplate(
        KIND_MONEY_ADJUSTMENT,
        value,
        moneyAdjustmentDTag(value.clientId, adjustmentId),
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
          <DialogTitle>
            {noRefundableBalance
              ? "No refundable balance"
              : action === "refund"
                ? "Record a refund already paid"
                : "Create credit note"}
          </DialogTitle>
          <DialogDescription>
            {noRefundableBalance
              ? "Record the credit note or overpayment first. A refund cannot exceed the client credit balance."
              : action === "refund"
                ? "This records evidence for a completed refund. No refund is sent."
                : "A credit note reduces the invoiced amount; it does not return a payment."}
          </DialogDescription>
        </DialogHeader>
        <form className="money-form" onSubmit={(event) => void save(event)}>
          {noRefundableBalance ? (
            <DialogFooter>
              <W10Button
                onClick={() => onOpenChange(false)}
                variant="secondary"
              >
                Close
              </W10Button>
              <W10Button
                onClick={() => onActionChange("credit_note")}
                type="button"
                variant="primary"
              >
                Create credit note
              </W10Button>
            </DialogFooter>
          ) : (
            <>
              <label>
                <span>Invoice</span>
                <select
                  onChange={(event) => {
                    setInvoiceId(event.currentTarget.value);
                    setAmount("");
                    setDate(currentDate());
                    setReason("");
                    setEvidenceRef("");
                    setRefundEvidenceConfirmed(false);
                    setError("");
                  }}
                  required
                  value={invoiceId}
                >
                  {eligibleInvoices.map(({ value }) => (
                    <option key={value.invoiceId} value={value.invoiceId}>
                      {value.invoiceId} ·{" "}
                      {clientNames.get(value.clientId) ?? value.clientId}
                      {action === "refund"
                        ? ` · available ${formatMoneyMinor(creditAvailableForRefund(value), value.currency)}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              {invoice ? (
                <>
                  <label>
                    <span>
                      {action === "refund" ? "Refund amount" : "Credit amount"}{" "}
                      · {invoice.value.currency}
                    </span>
                    <input
                      inputMode="decimal"
                      onChange={(event) => setAmount(event.currentTarget.value)}
                      required
                      value={amount}
                    />
                  </label>
                  <label>
                    <span>
                      {action === "refund" ? "Payment date" : "Credit date"}
                    </span>
                    <input
                      onChange={(event) => setDate(event.currentTarget.value)}
                      required
                      type="date"
                      value={date}
                    />
                  </label>
                  <label>
                    <span>Reason</span>
                    <textarea
                      onChange={(event) => setReason(event.currentTarget.value)}
                      required
                      rows={3}
                      value={reason}
                    />
                  </label>
                  <label>
                    <span>
                      {action === "refund"
                        ? "Payment reference"
                        : "Evidence reference"}
                    </span>
                    <input
                      onChange={(event) =>
                        setEvidenceRef(event.currentTarget.value)
                      }
                      required
                      value={evidenceRef}
                    />
                  </label>
                  {action === "refund" ? (
                    <label className="money-checkbox-field">
                      <input
                        checked={refundEvidenceConfirmed}
                        onChange={(event) =>
                          setRefundEvidenceConfirmed(
                            event.currentTarget.checked,
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        I have evidence that this refund was paid outside
                        Colony.
                      </span>
                    </label>
                  ) : null}
                </>
              ) : null}
              {!canManage ? (
                <p className="money-note">
                  Only client owners and admins can manage money records.
                </p>
              ) : null}
              {error ? (
                <p className="money-form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <W10Button
                  onClick={() => onOpenChange(false)}
                  variant="secondary"
                >
                  Cancel
                </W10Button>
                <W10Button
                  disabled={!canManage || !invoice || submit.isPending}
                  type="submit"
                  variant="primary"
                >
                  {action === "refund" ? "Record refund" : "Create credit note"}
                </W10Button>
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FollowUpDraftDialog({
  canManage,
  invoice,
  records,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  invoice: EventRecord<MoneyInvoiceHead> | null;
  records: MoneyWorkspaceRecords;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const followUp = invoice
    ? (records.followUpHeads.find(
        ({ value }) => value.invoiceId === invoice.value.invoiceId,
      ) ?? null)
    : null;
  const [to, setTo] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const submit = useSubmitBusinessRecordMutation();
  React.useEffect(() => {
    if (open && invoice) {
      setTo("");
      setSubject(`Invoice ${invoice.value.invoiceId} · balance reminder`);
      setMessage(
        `A reminder that ${formatMoneyMinor(invoice.value.outstandingMinor, invoice.value.currency)} remains on invoice ${invoice.value.invoiceId}, due ${formatTimestamp(invoice.value.dueAt)}. Please let us know if you need a copy of the invoice.`,
      );
      setError("");
    }
  }, [invoice, open]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    try {
      const followUpId = crypto.randomUUID();
      const value: MoneyFollowUpPayload = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: invoice.value.clientId,
        invoiceId: invoice.value.invoiceId,
        followUpId,
        action: "draft",
        expectedHeadEventId: null,
        expectedInvoiceHeadEventId: invoice.event.id,
        dueAt: null,
        draftContent: `To: ${to.trim()}\nSubject: ${subject.trim()}\n\n${message.trim()}`,
      };
      const template = moneyRecordTemplate(
        KIND_MONEY_FOLLOW_UP,
        value,
        moneyFollowUpDTag(value.clientId, followUpId),
      );
      await submit.mutateAsync(template);
      onOpenChange(false);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open && invoice !== null}>
      <DialogContent className="money-dialog-content">
        <DialogHeader>
          <DialogTitle>
            {followUp ? "Payment reminder draft" : "Prepare payment reminder"}
          </DialogTitle>
          <DialogDescription>
            {followUp
              ? "Saved draft only. No reminder is sent."
              : "This saves a draft only. No reminder is sent."}
          </DialogDescription>
        </DialogHeader>
        {followUp ? (
          <pre className="money-follow-up-draft">
            {followUp.value.draftContent}
          </pre>
        ) : (
          <form className="money-form" onSubmit={(event) => void save(event)}>
            <label>
              <span>To</span>
              <input
                autoComplete="email"
                onChange={(event) => setTo(event.currentTarget.value)}
                required
                type="email"
                value={to}
              />
            </label>
            <label>
              <span>Subject</span>
              <input
                onChange={(event) => setSubject(event.currentTarget.value)}
                required
                value={subject}
              />
            </label>
            <label>
              <span>Message</span>
              <textarea
                onChange={(event) => setMessage(event.currentTarget.value)}
                required
                rows={5}
                value={message}
              />
            </label>
            {!canManage ? (
              <p className="money-note">
                Only client owners and admins can prepare follow-ups.
              </p>
            ) : null}
            {error ? (
              <p className="money-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <W10Button
                onClick={() => onOpenChange(false)}
                variant="secondary"
              >
                Cancel
              </W10Button>
              <W10Button
                disabled={!canManage || submit.isPending}
                type="submit"
                variant="primary"
              >
                Save reminder draft
              </W10Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
