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

/** A screen-backed job that can open in the persistent map canvas window. */
export type CompanyMapWindowJob = {
  functionId: Extract<
    FunctionId,
    "sales" | "finance" | "operations" | "customer_success"
  >;
  jobName: string;
};

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

const MAP_WINDOW_JOBS: readonly CompanyMapWindowJob[] = [
  { functionId: "sales", jobName: "Lead finding" },
  { functionId: "sales", jobName: "Outreach" },
  { functionId: "sales", jobName: "Follow-ups" },
  { functionId: "sales", jobName: "Quotes" },
  { functionId: "sales", jobName: "Closing" },
  { functionId: "finance", jobName: "Quotes" },
  { functionId: "finance", jobName: "Invoices" },
  { functionId: "finance", jobName: "Deposits" },
  { functionId: "finance", jobName: "Chasing payments" },
  { functionId: "finance", jobName: "Costs" },
  { functionId: "operations", jobName: "Client intake" },
  { functionId: "operations", jobName: "Revisions" },
  { functionId: "operations", jobName: "Handover" },
  { functionId: "customer_success", jobName: "Client chats" },
  { functionId: "customer_success", jobName: "Change requests" },
];

/** Resolve a job to an existing screen, the WhatsApp desk, or its part page. */
export function getCompanyMapJobRoute(
  functionId: FunctionId,
  jobName: string,
): CompanyMapJobRoute {
  return ROUTES[`${functionId}:${jobName}`] ?? { kind: "part", functionId };
}

/** Jobs whose dedicated app screens do not exist in this checkout. */
export const COMPANY_MAP_NO_SCREEN_JOBS = [
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
  ...COMPANY_MAP_NO_SCREEN_JOBS,
  "brand:Offer and prices",
  "brand:Voice",
] as const;

export function companyMapJobKey(
  functionId: FunctionId,
  jobName: string,
): string {
  return `${functionId}:${jobName}`;
}

/**
 * A map-origin marker disambiguates shared routes and preserves the intent of
 * jobs that must stay on their current full-page surface. Unmarked deep links
 * still resolve to the documented default map job for that route.
 */
export function companyMapWindowSearch(
  functionId: FunctionId,
  jobName: string,
): { mapJob: string } | undefined {
  const key = companyMapJobKey(functionId, jobName);
  return Object.hasOwn(ROUTES, key) ? { mapJob: key } : undefined;
}

function windowJobFromKey(value: unknown): CompanyMapWindowJob | null {
  if (typeof value !== "string") return null;
  return (
    MAP_WINDOW_JOBS.find(
      (job) => companyMapJobKey(job.functionId, job.jobName) === value,
    ) ?? null
  );
}

/** Confirms a persisted trail root is one of the screen-backed map jobs. */
export function isCompanyMapWindowJob(
  value: unknown,
): value is CompanyMapWindowJob {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { functionId?: unknown; jobName?: unknown };
  return MAP_WINDOW_JOBS.some(
    (job) =>
      job.functionId === candidate.functionId &&
      job.jobName === candidate.jobName,
  );
}

function windowJobMatchesRoute(
  job: CompanyMapWindowJob,
  pathname: string,
  search: Record<string, unknown>,
): boolean {
  const route = getCompanyMapJobRoute(job.functionId, job.jobName);
  if (route.kind === "app") return pathname === route.to;
  if (route.kind === "work") return pathname === "/work";
  return (
    route.kind === "whatsapp" &&
    pathname.startsWith("/channels/") &&
    search.whatsappDeskTab === route.tab
  );
}

function defaultWindowJobForRoute(
  pathname: string,
  search: Record<string, unknown>,
): CompanyMapWindowJob | null {
  if (pathname === "/discovery") {
    return { functionId: "sales", jobName: "Lead finding" };
  }
  if (pathname === "/leads") {
    return { functionId: "sales", jobName: "Outreach" };
  }
  if (pathname === "/clients") {
    return { functionId: "sales", jobName: "Quotes" };
  }
  if (pathname === "/money/invoices") {
    return { functionId: "finance", jobName: "Invoices" };
  }
  if (pathname === "/money") {
    return { functionId: "finance", jobName: "Chasing payments" };
  }
  if (pathname === "/company/access") {
    return { functionId: "finance", jobName: "Costs" };
  }
  if (pathname.startsWith("/channels/") && search.whatsappDeskTab === "chats") {
    return { functionId: "sales", jobName: "Follow-ups" };
  }
  if (
    pathname.startsWith("/channels/") &&
    search.whatsappDeskTab === "pipeline"
  ) {
    return { functionId: "sales", jobName: "Closing" };
  }
  return null;
}

/** Resolve a supported map-window job from a real route and its search state. */
export function companyMapWindowJobForRoute(
  pathname: string,
  search: Record<string, unknown> = {},
): CompanyMapWindowJob | null {
  if (typeof search.mapJob === "string") {
    const markedJob = windowJobFromKey(search.mapJob);
    return markedJob && windowJobMatchesRoute(markedJob, pathname, search)
      ? markedJob
      : null;
  }
  return defaultWindowJobForRoute(pathname, search);
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
