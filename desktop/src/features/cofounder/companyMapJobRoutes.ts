import type { FunctionId } from "./cofounderRecords";
import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions";

export type CompanyMapJobRoute =
  | {
      kind: "app";
      to:
        | "/discovery"
        | "/leads"
        | "/clients"
        | "/money/invoices"
        | "/money"
        | "/company/access";
    }
  | { kind: "work" }
  | { kind: "whatsapp"; tab: "chats" | "pipeline" }
  | { kind: "part"; functionId: FunctionId };

const ROUTES: Record<string, CompanyMapJobRoute> = {
  "sales:Lead finding": { kind: "app", to: "/discovery" },
  "sales:Outreach": { kind: "app", to: "/leads" },
  "sales:Follow-ups": { kind: "whatsapp", tab: "chats" },
  "sales:Calls": { kind: "part", functionId: "sales" },
  "sales:Quotes": { kind: "app", to: "/clients" },
  "sales:Closing": { kind: "whatsapp", tab: "pipeline" },
  "operations:Client intake": { kind: "app", to: "/clients" },
  "operations:Delivery": { kind: "part", functionId: "operations" },
  "operations:Revisions": { kind: "work" },
  "operations:Launch": { kind: "part", functionId: "operations" },
  "operations:Handover": { kind: "app", to: "/clients" },
  "customer_success:Client chats": { kind: "whatsapp", tab: "chats" },
  "customer_success:Change requests": { kind: "work" },
  "customer_success:Renewals": {
    kind: "part",
    functionId: "customer_success",
  },
  "customer_success:Upsell": {
    kind: "part",
    functionId: "customer_success",
  },
  "customer_success:Reviews": {
    kind: "part",
    functionId: "customer_success",
  },
  "finance:Quotes": { kind: "app", to: "/clients" },
  "finance:Invoices": { kind: "app", to: "/money/invoices" },
  "finance:Deposits": { kind: "app", to: "/money" },
  "finance:Recurring plans": { kind: "part", functionId: "finance" },
  "finance:Chasing payments": { kind: "app", to: "/money" },
  "finance:Costs": { kind: "app", to: "/company/access" },
  "brand:Website": { kind: "part", functionId: "brand" },
  "brand:Portfolio": { kind: "part", functionId: "brand" },
  "brand:Offer and prices": { kind: "part", functionId: "brand" },
  "brand:Voice": { kind: "part", functionId: "brand" },
  "brand:Marketing": { kind: "part", functionId: "brand" },
};

/** Resolve a job to an existing screen, the WhatsApp desk, or its part page. */
export function getCompanyMapJobRoute(
  functionId: FunctionId,
  jobName: string,
): CompanyMapJobRoute {
  return ROUTES[`${functionId}:${jobName}`] ?? { kind: "part", functionId };
}

/** Proposal jobs whose app screens do not exist in this checkout. */
export const COMPANY_MAP_PROPOSAL_JOBS = [
  "sales:Calls",
  "finance:Recurring plans",
  "customer_success:Renewals",
  "customer_success:Upsell",
  "customer_success:Reviews",
  "brand:Website",
  "brand:Portfolio",
  "brand:Marketing",
] as const;

/** Current app jobs that intentionally fall back to their part page. */
export const COMPANY_MAP_FALLBACK_JOBS = [
  ...COMPANY_MAP_PROPOSAL_JOBS,
  "brand:Offer and prices",
  "brand:Voice",
] as const;

export function companyMapJobKey(
  functionId: FunctionId,
  jobName: string,
): string {
  return `${functionId}:${jobName}`;
}

export function isCompanyMapJobFallback(
  functionId: FunctionId,
  jobName: string,
): boolean {
  return (COMPANY_MAP_FALLBACK_JOBS as readonly string[]).includes(
    companyMapJobKey(functionId, jobName),
  );
}

export function hasRouteForEveryCompanyMapJob(): boolean {
  return FUNCTION_ORDER.every((functionId) =>
    FUNCTION_DETAILS[functionId].subFunctions.every((jobName) =>
      Object.hasOwn(ROUTES, companyMapJobKey(functionId, jobName)),
    ),
  );
}
