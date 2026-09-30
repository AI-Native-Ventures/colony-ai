import * as React from "react";
import { ArrowLeft } from "lucide-react";

import type { TeamMember } from "@/features/company-team/teamModels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

import {
  effectiveAllowanceAt,
  formatUsdCents,
  nanoUsdToCents,
  parseUsdCents,
  summarizeAllowanceUsage,
  type AllowancePeriod,
  type AllowanceValue,
  type EmployeeAllowanceHeadRecord,
} from "./spendModels";
import {
  useAiSpendHeadsQuery,
  useEmployeeAllowanceHeadsQuery,
  useEmployeeAllowanceMutation,
  useSyncAgentTurnSpendRecords,
} from "./spendRelay";

export function EmployeeSalaryPanel({
  employee,
  employees,
  canManage,
  onEdit,
}: {
  employee: TeamMember;
  employees: TeamMember[];
  canManage: boolean;
  onEdit: () => void;
}) {
  const allowancesQuery = useEmployeeAllowanceHeadsQuery();
  const spendQuery = useAiSpendHeadsQuery();
  const sync = useSyncAgentTurnSpendRecords(employees, spendQuery, true);
  const allowance = allowancesQuery.data?.records.find(
    (record) =>
      record.head.employeePubkey.toLowerCase() ===
      employee.pubkey.toLowerCase(),
  );
  const now = new Date();
  const effective = allowance
    ? effectiveAllowanceAt(allowance.head, now)
    : null;
  const usage = effective
    ? summarizeAllowanceUsage(
        spendQuery.data?.records ?? [],
        employee.pubkey,
        effective.allowance.period,
        now,
      )
    : null;
  const limitCents = effective ? BigInt(effective.allowance.amountCents) : null;
  const usedCents = usage ? nanoUsdToCents(usage.totalNanoUsd) : null;
  const hasReportedUsage = usage !== null && usage.pricedTurnCount > 0;
  const overByCents =
    limitCents !== null && usedCents !== null && usedCents > limitCents
      ? usedCents - limitCents
      : null;

  return (
    <section className="space-y-8" data-testid="employee-salary">
      <div className="max-w-2xl rounded-lg border border-border bg-muted/20 p-5">
        <p className="text-sm text-muted-foreground">
          API-equivalent allowance
        </p>
        {effective ? (
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            {formatUsdCents(effective.allowance.amountCents)}
            <span className="ml-2 text-sm font-medium">
              / {effective.allowance.period}
            </span>
          </h2>
        ) : (
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            Not configured
          </h2>
        )}
        {effective?.temporary && allowance?.head.temporaryAllowance ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Temporary allowance ends{" "}
            {formatUtcDate(allowance.head.temporaryAllowance.expiresAt)}.
            Previous allowance:{" "}
            {formatUsdCents(allowance.head.allowance.amountCents)}.
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          {hasReportedUsage
            ? `${formatUsdCents(usedCents ?? 0n)} estimated used this period`
            : usage?.turnCount === 0
              ? "Usage not reported"
              : "Usage unavailable"}
          {limitCents === null ? "" : ` of ${formatUsdCents(limitCents)}`}
          {usage && usage.unpricedTurnCount > 0
            ? ` · ${usage.unpricedTurnCount} turn costs not reported`
            : ""}
        </p>
        {hasReportedUsage ? (
          <>
            {limitCents !== null && limitCents > 0n ? (
              <progress
                aria-label={`${percentage(usedCents ?? 0n, limitCents)} percent used`}
                className="mt-4 h-1.5 w-full overflow-hidden rounded-full accent-primary"
                max={100}
                value={percentage(usedCents ?? 0n, limitCents)}
              />
            ) : null}
            {overByCents !== null ? (
              <p className="mt-3 text-sm" role="status">
                Over allowance by {formatUsdCents(overByCents)}. A runtime
                budget stop is unavailable.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="max-w-3xl">
        <h3 className="text-base font-semibold">Funding order</h3>
        <div className="mt-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
          {allowance?.head.fundingOrder.length
            ? allowance.head.fundingOrder.join(" → ")
            : "Not configured"}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        An allowance is not a cash salary. Provider limits and reset dates come
        from the connected source.
      </p>

      {canManage ? (
        <Button className="w-full" onClick={onEdit} type="button">
          Change allowance or funding
        </Button>
      ) : null}

      {allowancesQuery.isError || spendQuery.isError || sync.error ? (
        <p className="text-sm text-destructive" role="alert">
          {allowancesQuery.error?.message ??
            spendQuery.error?.message ??
            sync.error?.message}
        </p>
      ) : null}
      {allowancesQuery.isLoading || spendQuery.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading allowance and usage records
        </p>
      ) : null}
    </section>
  );
}

export function EmployeeAllowanceEditScreen({
  employee,
  canManage,
  onBack,
}: {
  employee: TeamMember;
  canManage: boolean;
  onBack: () => void;
}) {
  const allowancesQuery = useEmployeeAllowanceHeadsQuery();
  const mutation = useEmployeeAllowanceMutation();
  const existing = allowancesQuery.data?.records.find(
    (record) =>
      record.head.employeePubkey.toLowerCase() ===
      employee.pubkey.toLowerCase(),
  );
  const [amount, setAmount] = React.useState("");
  const [period, setPeriod] = React.useState<AllowancePeriod | "">("");
  const [duration, setDuration] = React.useState<"permanent" | "temporary">(
    "permanent",
  );
  const [fundingOrderText, setFundingOrderText] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const initializedHead = React.useRef<string | null>(null);
  const busy = mutation.isPending;

  React.useEffect(() => {
    if (!allowancesQuery.isSuccess) return;
    const key = existing?.event.id ?? "unconfigured";
    if (initializedHead.current === key) return;
    initializedHead.current = key;
    const temporary = existing?.head.temporaryAllowance;
    const activeTemporary =
      temporary && Date.parse(temporary.expiresAt) > Date.now()
        ? temporary
        : null;
    const currentAllowance = activeTemporary
      ? activeTemporary.allowance
      : existing?.head.allowance;
    setAmount(
      currentAllowance ? centsToInput(currentAllowance.amountCents) : "",
    );
    setPeriod(existing?.head.allowance.period ?? "");
    setDuration(activeTemporary ? "temporary" : "permanent");
    setFundingOrderText(existing?.head.fundingOrder.join(" → ") ?? "");
    setEndDate(activeTemporary ? activeTemporary.expiresAt.slice(0, 10) : "");
  }, [allowancesQuery.isSuccess, existing]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!canManage) {
      setError(
        "Only a company owner or admin can change an allowance directly.",
      );
      return;
    }
    if (!period) {
      setError("Choose an allowance period.");
      return;
    }
    const permanentCents = parseUsdCents(amount);
    if (permanentCents === null) {
      setError("Enter a valid USD allowance with up to two decimal places.");
      return;
    }
    let allowance: AllowanceValue = { amountCents: permanentCents, period };
    let temporaryAllowance: EmployeeAllowanceHeadRecord["head"]["temporaryAllowance"];
    if (duration === "temporary") {
      if (!existing) {
        setError("Set a permanent allowance before a temporary raise.");
        return;
      }
      if (period !== existing.head.allowance.period) {
        setError("A temporary allowance uses the permanent allowance period.");
        return;
      }
      if (
        BigInt(permanentCents) <= BigInt(existing.head.allowance.amountCents)
      ) {
        setError(
          "A temporary allowance must be higher than the permanent allowance.",
        );
        return;
      }
      allowance = existing.head.allowance;
      if (!endDate || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))) {
        setError("Choose the temporary allowance end date.");
        return;
      }
      const expiresAt = new Date(`${endDate}T23:59:59.999Z`);
      if (expiresAt.getTime() <= Date.now()) {
        setError("Choose a future end date.");
        return;
      }
      temporaryAllowance = {
        allowance: { amountCents: permanentCents, period },
        expiresAt: expiresAt.toISOString(),
      };
    }
    const fundingOrder = parseFundingOrder(fundingOrderText);
    if (!fundingOrder) {
      setError("Enter a valid funding order using arrows between sources.");
      return;
    }

    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        employeePubkey: employee.pubkey.toLowerCase(),
        ...(existing ? { expectedHeadEventId: existing.event.id } : {}),
        allowance,
        ...(temporaryAllowance ? { temporaryAllowance } : {}),
        fundingOrder,
      });
      onBack();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The allowance could not be saved.",
      );
    }
  }

  if (allowancesQuery.isLoading) {
    return (
      <p
        className="py-12 text-center text-sm text-muted-foreground"
        role="status"
      >
        Loading allowance
      </p>
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"
      data-testid="employee-allowance-edit"
    >
      <Button onClick={onBack} size="sm" type="button" variant="ghost">
        <ArrowLeft />
        Back
      </Button>
      <PageHeader title="Edit salary" />
      <form className="max-w-3xl" onSubmit={(event) => void save(event)}>
        <div className="grid gap-x-5 sm:grid-cols-2">
          <label
            className="mb-5 flex min-w-0 flex-col gap-2 text-sm font-medium"
            htmlFor="employee-allowance-amount"
          >
            Allowance in USD API-equivalent
            <Input
              id="employee-allowance-amount"
              inputMode="decimal"
              min="0"
              onChange={(event) => setAmount(event.currentTarget.value)}
              placeholder=""
              step="0.01"
              type="number"
              required
              value={amount}
            />
          </label>
          <label
            className="mb-5 flex min-w-0 flex-col gap-2 text-sm font-medium"
            htmlFor="employee-allowance-period"
          >
            Period
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              id="employee-allowance-period"
              required
              onChange={(event) =>
                setPeriod(event.currentTarget.value as AllowancePeriod | "")
              }
              value={period}
            >
              <option value="">Choose a period</option>
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="month">month</option>
            </select>
          </label>
        </div>
        <label
          className="mb-5 flex flex-col gap-2 text-sm font-medium"
          htmlFor="employee-funding-order"
        >
          Funding order
          <Input
            id="employee-funding-order"
            onChange={(event) => setFundingOrderText(event.currentTarget.value)}
            value={fundingOrderText}
          />
        </label>
        <label
          className="mb-5 flex max-w-sm flex-col gap-2 text-sm font-medium"
          htmlFor="employee-allowance-duration"
        >
          Duration
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            id="employee-allowance-duration"
            onChange={(event) => {
              const nextDuration = event.currentTarget.value as
                | "permanent"
                | "temporary";
              setDuration(nextDuration);
              if (
                nextDuration === "permanent" &&
                existing?.head.temporaryAllowance &&
                Date.parse(existing.head.temporaryAllowance.expiresAt) >
                  Date.now()
              ) {
                setAmount(centsToInput(existing.head.allowance.amountCents));
              }
              if (nextDuration === "temporary" && existing) {
                setAmount(centsToInput(existing.head.allowance.amountCents));
                setPeriod(existing.head.allowance.period);
              }
            }}
            value={duration}
          >
            <option value="permanent">Permanent</option>
            <option value="temporary">Temporary</option>
          </select>
        </label>
        <label
          className="mb-3 flex flex-col gap-2 text-sm font-medium"
          htmlFor="employee-temporary-end-date"
        >
          Temporary end date (if applicable)
          <Input
            id="employee-temporary-end-date"
            onChange={(event) => setEndDate(event.currentTarget.value)}
            type="date"
            value={endDate}
          />
        </label>
        <p className="mb-5 text-sm text-muted-foreground">
          Temporary changes revert to the previous allowance at their end date.
        </p>
        {error || allowancesQuery.error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error ?? allowancesQuery.error?.message}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t border-border pt-5">
          <Button disabled={busy || !canManage} type="submit">
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Button onClick={onBack} type="button" variant="outline">
            Cancel
          </Button>
        </div>
      </form>
      {!canManage ? (
        <p className="text-sm text-muted-foreground" role="status">
          Only company owners and admins can change an allowance directly.
        </p>
      ) : null}
    </div>
  );
}

function percentage(used: bigint, limit: bigint) {
  return Number((used * 100n) / limit > 100n ? 100n : (used * 100n) / limit);
}

function centsToInput(value: string) {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
}

function formatUtcDate(value: string | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function parseFundingOrder(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const sources = trimmed.split("→").map((source) => source.trim());
  if (
    sources.some((source) => !source || source.length > 64) ||
    new Set(sources.map((source) => source.toLocaleLowerCase("en-US"))).size !==
      sources.length
  ) {
    return null;
  }
  return sources;
}
