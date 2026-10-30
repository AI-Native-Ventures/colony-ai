import type { TeamMember } from "@/features/company-team/teamModels";

import type {
  CompanyFunctionHead,
  FunctionId,
  FunctionSlotView,
} from "./cofounderRecords";

export type { FunctionId } from "./cofounderRecords";

export const FUNCTION_ORDER: FunctionId[] = [
  "sales",
  "operations",
  "customer_success",
  "finance",
  "brand",
];

export const FUNCTION_DETAILS: Record<
  FunctionId,
  {
    name: string;
    subFunctions: string[];
    suggestedHire: string;
    hireRoleId?: string;
  }
> = {
  sales: {
    name: "Sales",
    subFunctions: [
      "Lead finding",
      "Outreach",
      "Follow-ups",
      "Calls",
      "Quotes",
      "Closing",
    ],
    suggestedHire: "Business development",
    hireRoleId: "built-in-role-business-development",
  },
  operations: {
    name: "Operations",
    subFunctions: [
      "Client intake",
      "Delivery",
      "Revisions",
      "Launch",
      "Handover",
    ],
    suggestedHire: "Covered by Scout until the playbook phase",
  },
  customer_success: {
    name: "Customer Success",
    subFunctions: [
      "Client chats",
      "Change requests",
      "Renewals",
      "Upsell",
      "Reviews",
    ],
    suggestedHire: "Client Success Manager",
  },
  finance: {
    name: "Finance",
    subFunctions: [
      "Quotes",
      "Invoices",
      "Deposits",
      "Recurring plans",
      "Chasing payments",
      "Costs",
    ],
    suggestedHire: "Bookkeeper",
    hireRoleId: "built-in-role-bookkeeper",
  },
  brand: {
    name: "Brand",
    subFunctions: [
      "Website",
      "Portfolio",
      "Offer and prices",
      "Voice",
      "Marketing",
    ],
    suggestedHire: "Brand and Content Lead",
    hireRoleId: "built-in-role-writer",
  },
};

export const FUNCTION_DESCRIPTIONS: Record<FunctionId, string> = {
  sales:
    "Find small businesses that need a better website, start the conversation and close.",
  operations:
    "Deliver the work your company promises, from the first brief through launch.",
  customer_success:
    "Keep clients close, resolve changes and find the next useful step together.",
  finance: "Quotes, invoices, deposits, recurring plans and costs.",
  brand:
    "Keep your company's offer, voice and work clear wherever people find you.",
};

export function isFunctionId(value: string): value is FunctionId {
  return (FUNCTION_ORDER as string[]).includes(value);
}

function emptySlot(functionId: FunctionId): FunctionSlotView {
  return { functionId, state: "empty", leadPubkey: null };
}

/** Always returns the five canonical slots and clears leads absent from the active team. */
export function buildFunctionSlotViews(
  heads: readonly CompanyFunctionHead[],
  members: readonly TeamMember[],
): FunctionSlotView[] {
  const headByFunction = new Map(
    heads.map((head) => [head.functionId, head] as const),
  );
  const memberByPubkey = new Map(
    members.map((member) => [member.pubkey.toLowerCase(), member] as const),
  );

  return FUNCTION_ORDER.map((functionId) => {
    const head = headByFunction.get(functionId);
    if (head?.state !== "filled" || !head.leadPubkey) {
      return head?.state === "covered_by_scout"
        ? { functionId, state: "covered_by_scout", leadPubkey: null }
        : emptySlot(functionId);
    }
    const member = memberByPubkey.get(head.leadPubkey.toLowerCase());
    const status = member?.position?.head.status;
    if (!member || status === "terminated") {
      return emptySlot(functionId);
    }
    return { functionId, state: "filled", leadPubkey: member.pubkey };
  });
}

export function formatWorkerCost(costUsd: number | null): string {
  return costUsd === null ? "Cost unavailable" : `US$${costUsd.toFixed(2)}`;
}
