import { ArrowLeft } from "lucide-react";

import type { TeamMember } from "@/features/company-team/teamModels";

import { ChevronGlyph, EmployeeAvatar } from "./PowerParts";
import {
  effectiveAllowanceAt,
  formatUsdCents,
  formatUsdCentsFixed,
  summarizeAllowanceUsage,
  weeklyAllowanceEquivalentCents,
  type AiSpendRecordHeadRecord,
  type EmployeeAllowanceHeadRecord,
} from "./spendModels";

export type PowerEmployee = {
  member: TeamMember;
  name: string;
  title: string;
  avatarUrl?: string | null;
};

function costTypeLabel(costType: "subscription" | "credit_top_up") {
  return costType === "subscription"
    ? "Subscription"
    : "Provider credit top-up";
}

/** "30 Oct 2026" for a recorded `YYYY-MM-DD` date. */
function formatRecordedDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(parsed);
}

function SummaryCard({
  detail,
  label,
  muted = false,
  value,
}: {
  detail: string;
  label: string;
  muted?: boolean;
  value: string;
}) {
  return (
    <section className="pw-summary" data-muted={muted ? "true" : undefined}>
      <h2>{label}</h2>
      <span className="pw-summary-value">{value}</span>
      <span className="pw-summary-detail">{detail}</span>
    </section>
  );
}

/** Whether the employee has used their whole allowance for the period. */
function reachedAllowance(
  allowance: EmployeeAllowanceHeadRecord | undefined,
  usageNanoUsd: bigint,
  now: Date,
) {
  if (!allowance) return false;
  const effective = effectiveAllowanceAt(allowance.head, now).allowance;
  const limitNano = BigInt(effective.amountCents) * 10_000_000n;
  return limitNano > 0n && usageNanoUsd >= limitNano;
}

export function AiSpendOverview({
  employees,
  allowances,
  records,
  isLoading,
  error,
  onOpenEmployee,
}: {
  employees: PowerEmployee[];
  allowances: EmployeeAllowanceHeadRecord[];
  records: AiSpendRecordHeadRecord[];
  isLoading: boolean;
  error: Error | null;
  onOpenEmployee: (pubkey: string) => void;
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
      ? [item.head.record]
      : [],
  );
  const subscriptionCashCents = subscriptions.reduce(
    (total, record) => total + BigInt(record.actualCashCostCents),
    0n,
  );
  const subscriptionDetail =
    subscriptions.length === 1
      ? `${subscriptions[0].provider} · ${subscriptions[0].description}`
      : `${subscriptions.length} subscriptions`;
  const costs = activeRecords.flatMap((item) =>
    item.head.record.recordType === "external_cost"
      ? [{ id: item.head.recordId, record: item.head.record }]
      : [],
  );
  costs.sort((left, right) =>
    right.record.recordedDate.localeCompare(left.record.recordedDate),
  );

  return (
    <div className="pw-stack" data-testid="ai-spend-overview">
      <div className="pw-summaries">
        <SummaryCard
          detail={
            configuredAllowanceCount > 0
              ? `Across ${configuredAllowanceCount} AI ${configuredAllowanceCount === 1 ? "employee" : "employees"} · API-equivalent`
              : "API-equivalent · capacity forecast"
          }
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
          detail={
            subscriptions.length > 0
              ? subscriptionDetail
              : "Monthly recorded subscriptions"
          }
          label="Subscription cash cost"
          value={
            isLoading
              ? "Loading"
              : subscriptions.length > 0
                ? formatUsdCentsFixed(subscriptionCashCents)
                : "Not recorded"
          }
        />
        <section
          aria-labelledby="capacity-unavailable-title"
          className="pw-summary"
          data-muted="true"
          data-testid="capacity-unavailable"
        >
          <h2 id="capacity-unavailable-title">Capacity estimate</h2>
          <span className="pw-summary-value">Unavailable</span>
          <span className="pw-summary-detail">
            Not reported by your providers.
          </span>
        </section>
      </div>

      <div className="pw-columns">
        <section
          aria-labelledby="power-employees-title"
          className="pw-employees"
        >
          <h2 id="power-employees-title">By employee</h2>
          <ul className="pw-list">
            {employees.map(({ avatarUrl, member, name, title }) => {
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
              const reported = Boolean(usage && usage.pricedTurnCount > 0);
              const usageLabel =
                !usage || usage.turnCount === 0
                  ? "Usage not reported"
                  : usage.pricedTurnCount === 0
                    ? "Turn costs not reported"
                    : `${formatUsdCentsFixed(usage.totalNanoUsd / 10_000_000n).replace("USD ", "$")} estimated used`;
              const unpricedLabel =
                usage &&
                usage.unpricedTurnCount > 0 &&
                usage.pricedTurnCount > 0
                  ? ` · ${usage.unpricedTurnCount} turn costs not reported`
                  : "";
              const atAllowance = reachedAllowance(
                allowance,
                usage?.totalNanoUsd ?? 0n,
                now,
              );
              const paused = member.position?.head.status === "paused";
              const standing = atAllowance
                ? paused
                  ? "At allowance · work paused"
                  : "At allowance"
                : paused
                  ? "Work paused"
                  : null;
              return (
                <li key={member.pubkey}>
                  <button
                    aria-label={`${name}, ${title}, ${usageLabel}${unpricedLabel}${standing ? `, ${standing}` : ""}`}
                    className="pw-employee"
                    data-testid={`power-employee-${member.pubkey}`}
                    onClick={() => onOpenEmployee(member.pubkey)}
                    type="button"
                  >
                    <EmployeeAvatar
                      avatarUrl={avatarUrl}
                      className="pw-avatar"
                      label={name}
                    />
                    <span className="pw-employee-copy">
                      <strong>{name}</strong>
                      <span>{title}</span>
                    </span>
                    <span className="pw-employee-usage">
                      <span data-reported={reported ? "true" : undefined}>
                        {usageLabel}
                        {unpricedLabel}
                      </span>
                      {standing ? (
                        <span className="pw-badge" data-tone="need">
                          {standing}
                        </span>
                      ) : null}
                    </span>
                    <ChevronGlyph />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="external-costs-title" className="pw-external">
          <h2 id="external-costs-title">External subscriptions and top-ups</h2>
          <ul className="pw-list">
            {costs.map(({ id, record }) => (
              <li
                aria-label={`${record.provider} · ${record.description}, ${formatUsdCents(record.actualCashCostCents)}`}
                className="pw-cost"
                key={id}
              >
                <span className="pw-cost-copy">
                  <strong>
                    {record.provider} · {record.description}
                  </strong>
                  <span>
                    {costTypeLabel(record.costType)}
                    {record.costType === "subscription" ? " · renews " : " · "}
                    {formatRecordedDate(record.recordedDate)}
                  </span>
                </span>
                <strong>{formatUsdCents(record.actualCashCostCents)}</strong>
              </li>
            ))}
            {costs.length === 0 && !isLoading ? (
              <li className="pw-cost pw-cost-empty">
                No external costs recorded.
              </li>
            ) : null}
          </ul>
          <p className="pw-note">
            These are costs you record yourself. Colony doesn’t move money for
            them.
          </p>
        </section>
      </div>

      {error ? (
        <p className="pw-alert" role="alert">
          {error.message}
        </p>
      ) : null}
      {isLoading ? (
        <p className="pw-note" role="status">
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
    <div className="pw-stack" data-testid="power-employee-spend">
      <button className="pw-back" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back
      </button>
      <div className="pw-heading">
        <div className="pw-heading-title">
          <h1>{employee.name} · AI usage</h1>
          <span>{employee.title}</span>
        </div>
      </div>
      <section aria-labelledby="current-period-title" className="pw-panel">
        <p className="pw-note" id="current-period-title">
          Current period
        </p>
        <h2 className="pw-big">
          {usage && usage.pricedTurnCount > 0
            ? formatUsdCentsFixed(usage.totalNanoUsd / 10_000_000n)
            : usage?.turnCount === 0
              ? "Usage not reported"
              : "Unavailable"}
        </h2>
        <p className="pw-note">
          API-equivalent usage, estimates
          {effective ? ` · ${effective.allowance.period}` : ""}
        </p>
        {usage && usage.unpricedTurnCount > 0 ? (
          <p className="pw-note">
            {usage.unpricedTurnCount} turn costs not reported
          </p>
        ) : null}
      </section>

      <section aria-labelledby="worker-models-title" className="pw-panel">
        <h2 className="pw-panel-title" id="worker-models-title">
          Worker models
        </h2>
        {models.length > 0 ? (
          <ul className="pw-rows">
            {models.map(([model, nanoUsd]) => (
              <li className="pw-row-item" key={model}>
                <span>{model}</span>
                <span>
                  {formatUsdCentsFixed(nanoUsd / 10_000_000n)} estimated
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pw-note">No priced turns reported</p>
        )}
      </section>

      <section aria-labelledby="funding-sources-title" className="pw-panel">
        <h2 className="pw-panel-title" id="funding-sources-title">
          Funding sources
        </h2>
        <p className="pw-note">
          {allowance?.head.fundingOrder.length
            ? allowance.head.fundingOrder.join(" → ")
            : "Not configured"}
        </p>
      </section>
    </div>
  );
}
