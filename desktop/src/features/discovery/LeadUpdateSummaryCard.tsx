import { Check, List } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import type { TimelineMessage } from "@/features/messages/types";

type LeadUpdateSummary = {
  schemaVersion: 1;
  listId: string;
  listName: string;
  updatedCount: number;
  updatedFields: string;
  missingWebsite: string[];
  source: string;
};

function parseLeadUpdateSummary(
  message: TimelineMessage,
): LeadUpdateSummary | null {
  const encoded = message.tags?.find(
    ([name]) => name === "lead-update-summary",
  )?.[1];
  if (!encoded) return null;

  try {
    const value = JSON.parse(encoded) as Partial<LeadUpdateSummary>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.listId !== "string" ||
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        value.listId,
      ) ||
      typeof value.listName !== "string" ||
      value.listName.trim().length < 1 ||
      value.listName.length > 80 ||
      !Number.isInteger(value.updatedCount) ||
      (value.updatedCount ?? -1) < 0 ||
      (value.updatedCount ?? 501) > 500 ||
      typeof value.updatedFields !== "string" ||
      value.updatedFields.length > 120 ||
      !Array.isArray(value.missingWebsite) ||
      value.missingWebsite.length > 20 ||
      !value.missingWebsite.every(
        (name) => typeof name === "string" && name.length <= 120,
      ) ||
      typeof value.source !== "string" ||
      value.source.length > 160
    ) {
      return null;
    }
    return value as LeadUpdateSummary;
  } catch {
    return null;
  }
}

export function LeadUpdateSummaryCard({
  message,
}: {
  message: TimelineMessage;
}) {
  const summary = parseLeadUpdateSummary(message);
  const navigate = useNavigate();
  if (!summary) return null;

  const updatedLabel = `${summary.updatedCount} ${summary.updatedCount === 1 ? "record" : "records"}: ${summary.updatedFields}`;

  return (
    <section
      aria-label="Lead update summary"
      className="ml-12 w-[min(52rem,calc(100%-3rem))] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm"
      data-testid="lead-update-summary"
    >
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
          role="status"
        >
          <Check aria-hidden="true" className="size-3.5" />
          Done
        </span>
        <span className="inline-flex max-w-full items-center gap-2 rounded-lg bg-colony-accent-soft px-3 py-1.5 text-sm font-semibold text-colony-accent-ink">
          <List aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{summary.listName}</span>
        </span>
      </div>

      <dl className="mx-5 mt-3 divide-y divide-border/70 border-y border-border/70 text-sm">
        <div className="grid gap-1 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-medium text-muted-foreground">Updated</dt>
          <dd className="font-semibold text-foreground">{updatedLabel}</dd>
        </div>
        {summary.missingWebsite.length > 0 ? (
          <div className="grid gap-1 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="font-medium text-muted-foreground">
              No website found
            </dt>
            <dd className="font-semibold text-foreground">
              {summary.missingWebsite.join(", ")}
            </dd>
          </div>
        ) : null}
        <div className="grid gap-1 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-medium text-muted-foreground">Source</dt>
          <dd className="font-semibold text-foreground">{summary.source}</dd>
        </div>
      </dl>

      <div className="px-5 py-3">
        <button
          className="font-semibold text-colony-accent underline underline-offset-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent"
          onClick={() =>
            void navigate({
              to: "/lists/$listId",
              params: { listId: summary.listId },
            })
          }
          type="button"
        >
          Open the list
        </button>
      </div>
    </section>
  );
}
