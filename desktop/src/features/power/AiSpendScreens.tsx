import * as React from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";

import type { TeamMember } from "@/features/company-team/teamModels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

import {
  effectiveAllowanceAt,
  formatUsdCents,
  formatUsdCentsFixed,
  parseUsdCents,
  summarizeAllowanceUsage,
  weeklyAllowanceEquivalentCents,
  type AiSpendRecordHeadRecord,
  type EmployeeAllowanceHeadRecord,
} from "./spendModels";
import { useAiSpendRecordMutation } from "./spendRelay";

export type PowerEmployee = {
  member: TeamMember;
  name: string;
  title: string;
};

export function AiSpendOverview({
  employees,
  allowances,
  records,
  isLoading,
  error,
  onOpenEmployee,
  onOpenCost,
}: {
  employees: PowerEmployee[];
  allowances: EmployeeAllowanceHeadRecord[];
  records: AiSpendRecordHeadRecord[];
  isLoading: boolean;
  error: Error | null;
  onOpenEmployee: (pubkey: string) => void;
  onOpenCost: (recordId: string) => void;
}) {
  const now = new Date();
  const employeeAllowanceByPubkey = new Map(
    allowances.map((item) => [item.head.employeePubkey.toLowerCase(), item]),
  );
  const activeRecords = records.filter((item) => item.head.status === "active");
  let weeklyAllowancesCents = 0n;
  let configuredAllowanceCount = 0;
  for (const item of allowances) {
    const effective = effectiveAllowanceAt(item.head, now);
    weeklyAllowancesCents += weeklyAllowanceEquivalentCents(
      effective.allowance.amountCents,
      effective.allowance.period,
    );
    configuredAllowanceCount += 1;
  }

  const subscriptions = activeRecords.flatMap((item) =>
    item.head.record.recordType === "external_cost" &&
    item.head.record.costType === "subscription"
      ? [item]
      : [],
  );
  const subscriptionCashCents = subscriptions.reduce(
    (total, item) =>
      total +
      BigInt(
        item.head.record.recordType === "external_cost"
          ? item.head.record.actualCashCostCents
          : "0",
      ),
    0n,
  );
  const costs = activeRecords
    .filter((item) => item.head.record.recordType === "external_cost")
    .sort((left, right) =>
      right.head.record.recordType === "external_cost" &&
      left.head.record.recordType === "external_cost"
        ? right.head.record.recordedDate.localeCompare(
            left.head.record.recordedDate,
          )
        : 0,
    );

  return (
    <div className="space-y-6" data-testid="ai-spend-overview">
      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard
          detail="API-equivalent · capacity forecast"
          label="Weekly employee allowances"
          value={
            isLoading
              ? "Loading"
              : configuredAllowanceCount > 0
                ? formatUsdCentsFixed(weeklyAllowancesCents)
                : "Not configured"
          }
        />
        <SummaryCard
          detail="Monthly recorded subscriptions"
          label="Subscription cash cost"
          value={
            isLoading
              ? "Loading"
              : subscriptions.length > 0
                ? formatUsdCentsFixed(subscriptionCashCents)
                : "Not recorded"
          }
        />
      </div>

      <section
        aria-labelledby="capacity-unavailable-title"
        className="space-y-2 border-y border-border/70 py-4"
        data-testid="capacity-unavailable"
      >
        <h2 className="text-sm font-semibold" id="capacity-unavailable-title">
          Capacity estimate unavailable
        </h2>
        <p className="text-sm text-muted-foreground">
          A funding source has not reported its available allowance. Recorded
          costs remain available; do not treat missing capacity as zero.
        </p>
      </section>

      <section aria-labelledby="power-employees-title">
        <h2 className="mb-2 text-base font-semibold" id="power-employees-title">
          By employee
        </h2>
        <div className="divide-y divide-border/70">
          {employees.map(({ member, name, title }) => {
            const allowance = employeeAllowanceByPubkey.get(
              member.pubkey.toLowerCase(),
            );
            const usage = allowance
              ? summarizeAllowanceUsage(
                  activeRecords,
                  member.pubkey,
                  effectiveAllowanceAt(allowance.head, now).allowance.period,
                  now,
                )
              : null;
            const usageLabel =
              !usage || usage.turnCount === 0
                ? "Usage not reported"
                : usage.pricedTurnCount === 0
                  ? "Turn costs not reported"
                  : `${formatUsdCentsFixed(usage.totalNanoUsd / 10_000_000n)} estimated used`;
            const unpricedLabel =
              usage && usage.unpricedTurnCount > 0
                ? ` · ${usage.unpricedTurnCount} turn costs not reported`
                : "";
            return (
              <button
                aria-label={`${name}, ${title}, ${usageLabel}${unpricedLabel}`}
                className="flex w-full items-center justify-between gap-4 py-4 text-left hover:bg-muted/30"
                key={member.pubkey}
                onClick={() => onOpenEmployee(member.pubkey)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {name}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {title}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  <span>
                    {usageLabel}
                    {unpricedLabel}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="external-costs-title">
        <h2 className="mb-2 text-base font-semibold" id="external-costs-title">
          External subscriptions and top-ups
        </h2>
        <div className="divide-y divide-border/70">
          {costs.map((item) => {
            if (item.head.record.recordType !== "external_cost") return null;
            const record = item.head.record;
            const title = `${record.provider} · ${record.description}`;
            return (
              <button
                aria-label={`${title}, ${formatUsdCents(record.actualCashCostCents)}`}
                className="flex w-full items-center justify-between gap-4 py-4 text-left hover:bg-muted/30"
                key={item.head.recordId}
                onClick={() => onOpenCost(item.head.recordId)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {title}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {costTypeLabel(record.costType)} · {record.recordedDate}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  {formatUsdCents(record.actualCashCostCents)}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading AI spend records
        </p>
      ) : null}
    </div>
  );
}

export function AiSpendEmployeeScreen({
  employee,
  allowance,
  records,
  onBack,
}: {
  employee: PowerEmployee;
  allowance?: EmployeeAllowanceHeadRecord;
  records: AiSpendRecordHeadRecord[];
  onBack: () => void;
}) {
  const now = new Date();
  const effective = allowance
    ? effectiveAllowanceAt(allowance.head, now)
    : null;
  const usage = effective
    ? summarizeAllowanceUsage(
        records,
        employee.member.pubkey,
        effective.allowance.period,
        now,
      )
    : null;
  const models = usage
    ? [...usage.byModel.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      )
    : [];

  return (
    <div className="space-y-6" data-testid="power-employee-spend">
      <Button onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeft aria-hidden="true" />
        Back
      </Button>
      <PageHeader title={`${employee.name} · AI usage`} />
      <section aria-labelledby="current-period-title" className="space-y-2">
        <p className="text-sm text-muted-foreground" id="current-period-title">
          Current period
        </p>
        <h2 className="text-3xl font-semibold tracking-tight">
          {usage && usage.pricedTurnCount > 0
            ? formatUsdCentsFixed(usage.totalNanoUsd / 10_000_000n)
            : usage?.turnCount === 0
              ? "Usage not reported"
              : "Unavailable"}
        </h2>
        <p className="text-sm text-muted-foreground">
          API-equivalent usage, estimates
          {effective ? ` · ${effective.allowance.period}` : ""}
        </p>
        {usage && usage.unpricedTurnCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            {usage.unpricedTurnCount} turn costs not reported
          </p>
        ) : null}
      </section>

      <section aria-labelledby="worker-models-title" className="space-y-2">
        <h2 className="text-base font-semibold" id="worker-models-title">
          Worker models
        </h2>
        {models.length > 0 ? (
          <ul className="divide-y divide-border/70">
            {models.map(([model, nanoUsd]) => (
              <li
                className="flex items-center justify-between gap-4 py-3 text-sm"
                key={model}
              >
                <span>{model}</span>
                <span>
                  {formatUsdCentsFixed(nanoUsd / 10_000_000n)} estimated
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No priced turns reported
          </p>
        )}
      </section>

      <section aria-labelledby="funding-sources-title" className="space-y-2">
        <h2 className="text-base font-semibold" id="funding-sources-title">
          Funding sources
        </h2>
        <p className="text-sm text-muted-foreground">
          {allowance?.head.fundingOrder.length
            ? allowance.head.fundingOrder.join(" → ")
            : "Not configured"}
        </p>
      </section>
    </div>
  );
}

export function ExternalAiCostEditor({
  record,
  canManage,
  onBack,
  onSaved,
}: {
  record?: AiSpendRecordHeadRecord;
  canManage: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const mutation = useAiSpendRecordMutation();
  const external =
    record?.head.record.recordType === "external_cost"
      ? record.head.record
      : undefined;
  const [provider, setProvider] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [costType, setCostType] = React.useState<
    "subscription" | "credit_top_up"
  >("subscription");
  const [amount, setAmount] = React.useState("");
  const [recordedDate, setRecordedDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setProvider(external?.provider ?? "");
    setDescription(external?.description ?? "");
    setCostType(external?.costType ?? "subscription");
    setAmount(external ? centsToInput(external.actualCashCostCents) : "");
    setRecordedDate(external?.recordedDate ?? "");
    setError(null);
  }, [external]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!canManage) return;
    const amountCents = parseUsdCents(amount);
    if (!provider.trim() || !description.trim() || amountCents === null) {
      setError("Enter a provider, plan or description, and valid USD cost.");
      return;
    }
    if (!isIsoDate(recordedDate)) {
      setError("Choose the renewal date or purchase date.");
      return;
    }

    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        recordId: record?.head.recordId ?? `cost:${crypto.randomUUID()}`,
        action: "record",
        ...(record ? { expectedHeadEventId: record.event.id } : {}),
        record: {
          recordType: "external_cost",
          provider: provider.trim(),
          description: description.trim(),
          costType,
          actualCashCostCents: amountCents,
          recordedDate,
        },
      });
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The cost record could not be saved.",
      );
    }
  }

  return (
    <div className="space-y-6" data-testid="external-ai-cost-editor">
      <Button onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeft aria-hidden="true" />
        Back
      </Button>
      <PageHeader
        title={external ? "Edit external AI cost" : "Record external AI cost"}
      />
      <form className="max-w-2xl" onSubmit={(event) => void save(event)}>
        <label
          className="mb-5 flex flex-col gap-2 text-sm font-medium"
          htmlFor="external-cost-provider"
        >
          Provider
          <Input
            id="external-cost-provider"
            onChange={(event) => setProvider(event.currentTarget.value)}
            required
            value={provider}
          />
        </label>
        <label
          className="mb-5 flex flex-col gap-2 text-sm font-medium"
          htmlFor="external-cost-description"
        >
          Plan / description
          <Input
            id="external-cost-description"
            onChange={(event) => setDescription(event.currentTarget.value)}
            required
            value={description}
          />
        </label>
        <label
          className="mb-5 flex flex-col gap-2 text-sm font-medium"
          htmlFor="external-cost-type"
        >
          Type
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            id="external-cost-type"
            onChange={(event) =>
              setCostType(
                event.currentTarget.value as "subscription" | "credit_top_up",
              )
            }
            value={costType}
          >
            <option value="subscription">Subscription</option>
            <option value="credit_top_up">Provider credit top-up</option>
          </select>
        </label>
        <label
          className="mb-5 flex flex-col gap-2 text-sm font-medium"
          htmlFor="external-cost-amount"
        >
          Actual cash cost (USD)
          <Input
            id="external-cost-amount"
            inputMode="decimal"
            min="0"
            onChange={(event) => setAmount(event.currentTarget.value)}
            required
            step="0.01"
            type="number"
            value={amount}
          />
        </label>
        <label
          className="mb-5 flex flex-col gap-2 text-sm font-medium"
          htmlFor="external-cost-date"
        >
          Renewal date or purchase date
          <Input
            id="external-cost-date"
            onChange={(event) => setRecordedDate(event.currentTarget.value)}
            required
            type="date"
            value={recordedDate}
          />
        </label>
        <p className="mb-5 text-sm text-muted-foreground">
          This records an existing cost. It does not purchase a subscription or
          top up any provider.
        </p>
        {error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t border-border pt-5">
          <Button disabled={mutation.isPending || !canManage} type="submit">
            {mutation.isPending ? "Saving…" : "Save cost record"}
          </Button>
          <Button onClick={onBack} type="button" variant="outline">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ExternalAiCostDetail({
  record,
  canManage,
  onBack,
  onEdit,
  onRemove,
}: {
  record?: AiSpendRecordHeadRecord;
  canManage: boolean;
  onBack: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const external =
    record?.head.record.recordType === "external_cost"
      ? record.head.record
      : undefined;

  if (!external || !record || record.head.status !== "active") {
    return (
      <div className="space-y-6" data-testid="external-ai-cost-missing">
        <Button onClick={onBack} size="sm" type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <PageHeader title="External AI cost" />
        <p className="text-sm text-muted-foreground">
          This cost record is unavailable.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="external-ai-cost-detail">
      <Button onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeft aria-hidden="true" />
        Back
      </Button>
      <PageHeader title={`${external.provider} · ${external.description}`} />
      <dl className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <DetailField label="Type" value={costTypeLabel(external.costType)} />
        <DetailField
          label="Cash amount"
          value={formatUsdCents(external.actualCashCostCents)}
        />
        <DetailField
          label="Renewal / purchase date"
          value={external.recordedDate}
        />
        <DetailField label="Live capacity" value="Unavailable" />
      </dl>
      <div className="flex flex-wrap gap-2">
        {canManage ? (
          <>
            <Button onClick={onEdit} type="button" variant="outline">
              Edit record
            </Button>
            <Button onClick={onRemove} type="button" variant="destructive">
              Remove cost record
            </Button>
          </>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Removing this record does not cancel the provider subscription.
      </p>
    </div>
  );
}

export function ExternalAiCostRemoveConfirmation({
  record,
  canManage,
  onCancel,
  onRemoved,
}: {
  record?: AiSpendRecordHeadRecord;
  canManage: boolean;
  onCancel: () => void;
  onRemoved: () => void;
}) {
  const mutation = useAiSpendRecordMutation();
  const [error, setError] = React.useState<string | null>(null);
  const external =
    record?.head.record.recordType === "external_cost"
      ? record.head.record
      : undefined;

  async function remove() {
    if (!record || !external || !canManage) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        recordId: record.head.recordId,
        action: "remove",
        expectedHeadEventId: record.event.id,
      });
      onRemoved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The cost record could not be removed.",
      );
    }
  }

  if (!external || !record || record.head.status !== "active") {
    return (
      <div className="space-y-6" data-testid="external-ai-cost-missing">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <PageHeader title="Cost record removed" />
        <Button onClick={onCancel} type="button" variant="outline">
          Back to AI spend
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="external-ai-cost-remove">
      <Button onClick={onCancel} size="sm" type="button" variant="ghost">
        <ArrowLeft aria-hidden="true" />
        Back
      </Button>
      <PageHeader title="Remove cost record?" />
      <section className="max-w-2xl space-y-3 rounded-lg border border-border bg-muted/20 p-5">
        <h2 className="text-base font-semibold">
          {external.provider} · {formatUsdCents(external.actualCashCostCents)}
        </h2>
        <p className="text-sm text-muted-foreground">
          This only removes the local record. It does not cancel or refund the
          provider subscription.
        </p>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            disabled={mutation.isPending || !canManage}
            onClick={() => void remove()}
            type="button"
            variant="destructive"
          >
            {mutation.isPending ? "Removing…" : "Remove record"}
          </Button>
          <Button onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <h2 className="text-3xl font-semibold tracking-tight">{value}</h2>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

function costTypeLabel(costType: "subscription" | "credit_top_up") {
  return costType === "subscription"
    ? "Subscription"
    : "Provider credit top-up";
}

function centsToInput(value: string) {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
