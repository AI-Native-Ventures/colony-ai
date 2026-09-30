import * as React from "react";
import { ArrowLeft } from "lucide-react";

import type { TeamMember } from "@/features/company-team/teamModels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

import {
  allowancePeriodStart,
  effectiveAllowanceAt,
  formatUsdCents,
  parseUsdCents,
  type AllowancePeriod,
  type AllowanceValue,
  type EmployeeAllowanceHeadRecord,
  type AiSpendRecordHeadRecord,
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
  const overByCents =
    limitCents !== null && usedCents !== null && usedCents > limitCents
      ? usedCents - limitCents
      : null;

  return (
    <section className="max-w-3xl space-y-6" data-testid="employee-salary">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            API-equivalent allowance
          </h2>
          {effective ? (
            <>
              <p className="mt-2 text-2xl font-semibold">
                {formatUsdCents(effective.allowance.amountCents)} /{" "}
                {effective.allowance.period}
              </p>
              {effective.temporary ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Temporary allowance ends{" "}
                  {formatUtcDate(allowance?.head.temporaryAllowance?.expiresAt)}
                  . The permanent allowance resumes automatically.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-2xl font-semibold">No allowance set</p>
          )}
        </div>
        {canManage ? (
          <Button onClick={onEdit} type="button">
            Change allowance or funding
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold">Used this period</h3>
          {usage ? (
            <p className="text-lg font-semibold">
              {formatUsdCents(usedCents ?? 0n)}
              {limitCents === null ? null : (
                <span className="text-sm font-normal text-muted-foreground">
                  {` of ${formatUsdCents(limitCents)}`}
                </span>
              )}
            </p>
          ) : (
            <p className="text-lg font-semibold">Unavailable</p>
          )}
        </div>
        {usage ? (
          <>
            {limitCents !== null && limitCents > 0n ? (
              <progress
                aria-label={`${percentage(usedCents ?? 0n, limitCents)} percent used`}
                className="mt-4 h-1.5 w-full overflow-hidden rounded-full accent-primary"
                max={100}
                value={percentage(usedCents ?? 0n, limitCents)}
              />
            ) : null}
            <p className="mt-3 text-sm text-muted-foreground">
              API-equivalent usage from metered turns. All reported turn costs
              are estimates.
              {usage.unpricedTurnCount > 0
                ? ` ${usage.unpricedTurnCount} ${usage.unpricedTurnCount === 1 ? "turn has" : "turns have"} no reported cost.`
                : ""}
            </p>
            {overByCents !== null ? (
              <p
                className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
                role="status"
              >
                Over allowance by {formatUsdCents(overByCents)}. A runtime
                budget stop is unavailable.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div>
        <h3 className="text-base font-semibold">Funding order</h3>
        <div className="mt-3 rounded-lg border border-border p-4">
          {(allowance?.head.fundingOrder.length ?? 0) > 0 ? (
            <ol className="space-y-2">
              {allowance?.head.fundingOrder.map((source, index) => (
                <li
                  className="flex items-center justify-between gap-3 text-sm"
                  key={source}
                >
                  <span>
                    {index + 1}. {source}
                  </span>
                  <span className="text-muted-foreground">
                    Status unavailable
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Funding source order is unavailable because no source records are
              connected.
            </p>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        An allowance is not a cash salary. Provider limits and reset dates come
        from the connected source.
      </p>

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
  employeeName,
  canManage,
  onBack,
}: {
  employee: TeamMember;
  employeeName: string;
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
  const [temporaryAmount, setTemporaryAmount] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const initializedHead = React.useRef<string | null>(null);
  const busy = mutation.isPending;

  React.useEffect(() => {
    if (!allowancesQuery.isSuccess) return;
    const key = existing?.event.id ?? "unconfigured";
    if (initializedHead.current === key) return;
    initializedHead.current = key;
    setAmount(
      existing ? centsToInput(existing.head.allowance.amountCents) : "",
    );
    setPeriod(existing?.head.allowance.period ?? "");
    setDuration(existing?.head.temporaryAllowance ? "temporary" : "permanent");
    setTemporaryAmount(
      existing?.head.temporaryAllowance
        ? centsToInput(existing.head.temporaryAllowance.allowance.amountCents)
        : "",
    );
    setEndDate(
      existing?.head.temporaryAllowance
        ? existing.head.temporaryAllowance.expiresAt.slice(0, 10)
        : "",
    );
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
    const allowance: AllowanceValue = { amountCents: permanentCents, period };
    let temporaryAllowance: EmployeeAllowanceHeadRecord["head"]["temporaryAllowance"];
    if (duration === "temporary") {
      const temporaryCents = parseUsdCents(temporaryAmount);
      if (temporaryCents === null || !endDate) {
        setError("Enter the temporary USD allowance and its end date.");
        return;
      }
      if (BigInt(temporaryCents) <= BigInt(permanentCents)) {
        setError(
          "A temporary allowance must be higher than the permanent allowance.",
        );
        return;
      }
      temporaryAllowance = {
        allowance: { amountCents: temporaryCents, period },
        expiresAt: new Date(`${endDate}T23:59:59.999Z`).toISOString(),
      };
    }

    try {
      await mutation.mutateAsync({
        schemaVersion: 1,
        employeePubkey: employee.pubkey.toLowerCase(),
        ...(existing ? { expectedHeadEventId: existing.event.id } : {}),
        allowance,
        ...(temporaryAllowance ? { temporaryAllowance } : {}),
        fundingOrder: existing?.head.fundingOrder ?? [],
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
        {employeeName}
      </Button>
      <PageHeader
        description="Set an API-equivalent allowance for this employee."
        title="Adjust allowance"
      />
      <form className="max-w-2xl" onSubmit={(event) => void save(event)}>
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
              onChange={(event) =>
                setPeriod(event.currentTarget.value as AllowancePeriod | "")
              }
              value={period}
            >
              <option value="">Choose a period</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
        </div>
        <label
          className="mb-5 flex max-w-sm flex-col gap-2 text-sm font-medium"
          htmlFor="employee-allowance-duration"
        >
          Duration
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            id="employee-allowance-duration"
            onChange={(event) =>
              setDuration(
                event.currentTarget.value as "permanent" | "temporary",
              )
            }
            value={duration}
          >
            <option value="permanent">Permanent</option>
            <option value="temporary">Temporary</option>
          </select>
        </label>
        {duration === "temporary" ? (
          <div className="grid gap-x-5 sm:grid-cols-2">
            <label
              className="mb-5 flex min-w-0 flex-col gap-2 text-sm font-medium"
              htmlFor="employee-temporary-amount"
            >
              Temporary allowance in USD
              <Input
                id="employee-temporary-amount"
                inputMode="decimal"
                min="0"
                onChange={(event) =>
                  setTemporaryAmount(event.currentTarget.value)
                }
                placeholder=""
                step="0.01"
                type="number"
                value={temporaryAmount}
              />
            </label>
            <label
              className="mb-5 flex min-w-0 flex-col gap-2 text-sm font-medium"
              htmlFor="employee-temporary-end-date"
            >
              Temporary end date
              <Input
                id="employee-temporary-end-date"
                onChange={(event) => setEndDate(event.currentTarget.value)}
                type="date"
                value={endDate}
              />
            </label>
          </div>
        ) : null}
        {duration === "temporary" ? (
          <p className="mb-5 text-sm text-muted-foreground">
            Temporary changes revert to the permanent allowance at the end date.
          </p>
        ) : null}
        <div className="mb-5 rounded-lg border border-border p-4">
          <h2 className="text-base font-semibold">Funding order</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Funding sources and live status are unavailable because no source
            records are connected.
          </p>
        </div>
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

function summarizeAllowanceUsage(
  records: AiSpendRecordHeadRecord[],
  employeePubkey: string,
  period: AllowancePeriod,
  now: Date,
) {
  const start = allowancePeriodStart(period, now).getTime();
  let totalNanoUsd = 0n;
  let unpricedTurnCount = 0;
  const byModel = new Map<string, bigint>();
  for (const record of records) {
    const head = record.head;
    if (
      head.status !== "active" ||
      head.record.recordType !== "agent_turn" ||
      head.record.employeePubkey.toLowerCase() !==
        employeePubkey.toLowerCase() ||
      Date.parse(head.record.reportedAt) < start ||
      Date.parse(head.record.reportedAt) > now.getTime()
    ) {
      continue;
    }
    const amount = head.record.estimatedAmountNanoUsd;
    if (amount === undefined) {
      unpricedTurnCount += 1;
      continue;
    }
    const nanoUsd = BigInt(amount);
    totalNanoUsd += nanoUsd;
    const model = head.record.model ?? "Model not reported";
    byModel.set(model, (byModel.get(model) ?? 0n) + nanoUsd);
  }
  return { totalNanoUsd, unpricedTurnCount, byModel };
}

function nanoUsdToCents(nanoUsd: bigint) {
  return (nanoUsd + 5_000_000n) / 10_000_000n;
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
