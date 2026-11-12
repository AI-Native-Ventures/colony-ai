import { useMemo } from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { buildGapNeedsYouItems } from "./accessRecords";
import type { CapabilityGapHead } from "./accessRecords";
import { useCompanyAccessQuery } from "./accessHooks";
import { useMoneyRailsSnapshot } from "./moneyRailsBridge";
import type { MoneyLinkCard } from "./moneyRails";
import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions";
import type { FunctionId } from "./cofounderRecords";
import type { NeedsYouItem, NeedsYouModel } from "./needsYou";
import { useNeedsYouQuery } from "./needsYouHooks";
import type { WhatsAppContact } from "@/features/whatsapp-outreach/whatsappOutreachModels";

export type NeedsYouSummary = {
  total: number;
  byPart: Record<FunctionId, number>;
  /** Keys use `${functionId}:${canonical job name}`. */
  byJob: Record<string, number>;
};

export type NeedsYouSummarySources = {
  model: NeedsYouModel;
  paymentLinks?: readonly MoneyLinkCard[];
  capabilityGaps?: readonly CapabilityGapHead[];
  whatsappContacts?: readonly WhatsAppContact[];
};

function normalizedWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function capabilityGapFunctionId(
  head: CapabilityGapHead,
): FunctionId | null {
  const category = head.gap.access.category;
  if (category === "payment_link") return "finance";
  if (category === "whatsapp" || category === "discovery") return "sales";
  if (category === "calendar") return "sales";
  if (category === "esign") return "operations";

  const text = normalizedWords(
    `${head.gap.title} ${head.gap.need} ${head.gap.access.usedFor}`,
  );
  const hints: Record<FunctionId, string[]> = {
    sales: [
      "sales",
      "lead",
      "outreach",
      "follow up",
      "call",
      "quote",
      "closing",
    ],
    operations: [
      "operations",
      "client intake",
      "delivery",
      "revision",
      "launch",
      "handover",
    ],
    customer_success: [
      "customer success",
      "client chat",
      "change request",
      "renewal",
      "upsell",
      "review",
    ],
    finance: ["finance", "bookkeeper", "payment", "deposit", "invoice", "cost"],
    brand: [
      "brand",
      "website",
      "portfolio",
      "offer and prices",
      "voice",
      "marketing",
    ],
  };
  const matches = FUNCTION_ORDER.filter((functionId) =>
    hints[functionId].some((hint) => hasPhrase(text, hint)),
  );
  return matches.length === 1 ? matches[0] : null;
}

function addItem(
  summary: NeedsYouSummary,
  item: Pick<NeedsYouItem, "functionId" | "jobName">,
  count = 1,
): void {
  summary.total += count;
  if (!item.functionId) return;

  summary.byPart[item.functionId] += count;
  const canonicalJob = FUNCTION_DETAILS[item.functionId].subFunctions.find(
    (name) => name === item.jobName,
  );
  if (!canonicalJob) return;
  const key = `${item.functionId}:${canonicalJob}`;
  summary.byJob[key] = (summary.byJob[key] ?? 0) + count;
}

/** Counts exactly the rows assembled for the Needs you page and its extra lanes. */
export function buildNeedsYouSummary(
  sources: NeedsYouSummarySources,
): NeedsYouSummary {
  const summary: NeedsYouSummary = {
    total: 0,
    byPart: Object.fromEntries(
      FUNCTION_ORDER.map((functionId) => [functionId, 0]),
    ) as Record<FunctionId, number>,
    byJob: {},
  };

  const items = [
    ...sources.model.approve,
    ...sources.model.do,
    ...sources.model.decide,
  ];
  for (const item of items) {
    addItem(
      summary,
      item,
      item.source.kind === "whatsapp_drafts" ? item.details.length : 1,
    );
  }

  for (const card of sources.paymentLinks ?? []) {
    if (card.state === "needs_you") {
      addItem(summary, { functionId: "finance", jobName: "Deposits" });
    }
  }

  const visibleGapIds = new Set(
    buildGapNeedsYouItems(sources.capabilityGaps ?? []).map(
      (item) => item.gapId,
    ),
  );
  for (const gap of sources.capabilityGaps ?? []) {
    if (!visibleGapIds.has(gap.gapId)) continue;
    addItem(summary, {
      functionId: capabilityGapFunctionId(gap),
      jobName: null,
    });
  }

  const callIds = new Set<string>();
  for (const contact of sources.whatsappContacts ?? []) {
    if (contact.stage !== "wants_call" || callIds.has(contact.waId)) continue;
    callIds.add(contact.waId);
    addItem(summary, { functionId: "sales", jobName: "Calls" });
  }

  return summary;
}

/** Shared count for the top bar, map badges and Needs you page. */
export function useNeedsYouSummary(): {
  data: NeedsYouSummary | undefined;
  isPending: boolean;
} {
  const { activeCommunity } = useCommunities();
  const needsYou = useNeedsYouQuery();
  const access = useCompanyAccessQuery(activeCommunity?.id ?? null);
  const moneyRails = useMoneyRailsSnapshot();
  const hasCommunity = Boolean(activeCommunity?.id);
  const isPending =
    needsYou.isPending ||
    needsYou.whatsappSummaryIsPending ||
    (hasCommunity && access.isPending) ||
    (hasCommunity && moneyRails.availability === "loading");
  const data = useMemo(
    () =>
      isPending
        ? undefined
        : buildNeedsYouSummary({
            model: needsYou.model,
            paymentLinks: moneyRails.paymentLinks,
            capabilityGaps: access.data?.gaps ?? [],
            whatsappContacts: needsYou.whatsappContacts,
          }),
    [
      access.data?.gaps,
      isPending,
      moneyRails.paymentLinks,
      needsYou.model,
      needsYou.whatsappContacts,
    ],
  );

  return { data, isPending };
}
