import * as React from "react";

import { BUSINESS_RECORD_SCHEMA_VERSION } from "@/features/clients/lib/businessRecords";
import { useSubmitBusinessRecordMutation } from "@/features/clients/useBusinessRecords";
import { KIND_INVOICE_VERSION } from "@/shared/constants/kinds";
import { MoneyDialog } from "./MoneyDialogFrame";
import {
  type InvoiceLine,
  type MoneyInvoiceVersion,
  formatMoneyMinor,
  moneyInvoiceVersionDTag,
  moneyRecordTemplate,
  parseMoneyInput,
  totalInvoiceMinor,
} from "./lib/moneyRecords";
import {
  displayError,
  moneyStep,
  parseQuantityInput,
  timestampFromDateInput,
} from "./moneyUtils";
import "./colony3-money.css";

/** Invoices are in rand unless the business records say otherwise. */
export const DEFAULT_INVOICE_CURRENCY = "ZAR";

export type InvoiceClientChoice = { clientId: string; displayName: string };

/**
 * New invoice: a draft for one client, saved as the first invoice version.
 * Issuing stays a separate step on the invoice page.
 */
export function InvoiceCreateDialog({
  canManage,
  clients,
  currency = DEFAULT_INVOICE_CURRENCY,
  initialClientId,
  onCreated,
  onOpenChange,
  open,
}: {
  canManage: boolean;
  clients: readonly InvoiceClientChoice[];
  currency?: string;
  initialClientId?: string;
  onCreated: (invoiceId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const submit = useSubmitBusinessRecordMutation();
  const [clientId, setClientId] = React.useState(initialClientId ?? "");
  const [description, setDescription] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [amount, setAmount] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [error, setError] = React.useState("");
  const lockedClient = Boolean(initialClientId);
  const clientsRef = React.useRef(clients);
  clientsRef.current = clients;
  // Reset only when the dialog opens, not when the client list is rebuilt.
  React.useEffect(() => {
    if (!open) return;
    const choices = clientsRef.current;
    setClientId(
      initialClientId ?? (choices.length === 1 ? choices[0].clientId : ""),
    );
    setDescription("");
    setQuantity("1");
    setAmount("");
    setDueDate("");
    setError("");
  }, [initialClientId, open]);

  const total = React.useMemo(() => {
    try {
      return totalInvoiceMinor(
        [
          {
            serviceId: null,
            description,
            quantityHundredths: parseQuantityInput(quantity),
            unitAmountMinor: parseMoneyInput(amount, currency),
          },
        ],
        [],
      );
    } catch {
      return null;
    }
  }, [amount, currency, description, quantity]);
  const clientName =
    clients.find((client) => client.clientId === clientId)?.displayName ?? "";

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!clientId) throw new Error("Choose the client this invoice is for.");
      const line: InvoiceLine = {
        serviceId: null,
        description: description.trim(),
        quantityHundredths: parseQuantityInput(quantity),
        unitAmountMinor: parseMoneyInput(amount, currency),
      };
      if (!line.description) {
        throw new Error("Describe the service this invoice is for.");
      }
      const invoiceId = crypto.randomUUID();
      const value: MoneyInvoiceVersion = {
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId,
        invoiceId,
        version: 1,
        previousVersionEventId: null,
        proposalVersionEventId: null,
        expectedHeadEventId: null,
        action: "create",
        currency,
        lines: [line],
        taxLines: [],
        sellerTaxNumber: null,
        customerTaxNumber: null,
        totalMinor: totalInvoiceMinor([line], []),
        status: "draft",
        dueAt: timestampFromDateInput(dueDate),
        voidReason: null,
      };
      await submit.mutateAsync(
        moneyRecordTemplate(
          KIND_INVOICE_VERSION,
          value,
          moneyInvoiceVersionDTag(clientId, invoiceId, 1),
        ),
      );
      onOpenChange(false);
      onCreated(invoiceId);
    } catch (saveError) {
      setError(displayError(saveError));
    }
  }

  return (
    <MoneyDialog
      onOpenChange={onOpenChange}
      open={open}
      subtitle="New invoices start as drafts. Review and issue separately."
      title="New invoice"
      width={430}
    >
      <form
        className="b3-dialog-fields"
        onSubmit={(event) => void create(event)}
      >
        {lockedClient ? (
          <div className="b3-dialog-summary" data-kind="client">
            <span className="b3-eyebrow">Client</span>
            <span className="b3-dialog-summary-name">{clientName}</span>
          </div>
        ) : (
          <label className="b3-dialog-field">
            Client
            <select
              onChange={(event) => setClientId(event.currentTarget.value)}
              required
              value={clientId}
            >
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.clientId} value={client.clientId}>
                  {client.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="b3-dialog-line">
          <legend>Line 1</legend>
          <label className="b3-dialog-field">
            Service / description
            <input
              autoComplete="off"
              onChange={(event) => setDescription(event.currentTarget.value)}
              placeholder="First monthly retainer"
              required
              value={description}
            />
          </label>
          <div className="b3-dialog-row" data-split="line">
            <label className="b3-dialog-field">
              Quantity
              <input
                inputMode="decimal"
                min="0.01"
                onChange={(event) => setQuantity(event.currentTarget.value)}
                step="0.01"
                type="number"
                value={quantity}
              />
            </label>
            <label className="b3-dialog-field">
              Unit amount · {currency}
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => setAmount(event.currentTarget.value)}
                required
                step={moneyStep(currency)}
                type="number"
                value={amount}
              />
            </label>
          </div>
        </fieldset>
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
            {total === null ? "-" : formatMoneyMinor(total, currency)}
          </span>
        </div>
        {error ? (
          <p className="b3-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="b3-dialog-actions">
          <button
            className="b3-btn"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="b3-btn"
            data-variant="primary"
            disabled={!canManage || submit.isPending}
            type="submit"
          >
            Create invoice
          </button>
        </div>
      </form>
    </MoneyDialog>
  );
}
