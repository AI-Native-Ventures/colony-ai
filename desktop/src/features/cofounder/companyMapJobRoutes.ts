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
  | { kind: "whatsapp"; tab: CompanyMapWhatsAppTab }
  | { kind: "part"; functionId: FunctionId };

export type CompanyMapWhatsAppTab = "needs-you" | "chats" | "pipeline";

/** A screen-backed job that can open in the persistent map canvas window. */
export type CompanyMapStaticWindowJob = {
  functionId: Extract<
    FunctionId,
    "sales" | "finance" | "operations" | "customer_success"
  >;
  jobName: string;
};

/** A validated map root for a job whose app screen has not been built yet. */
export type CompanyMapNoScreenWindowJob = {
  functionId: FunctionId;
  jobName: string;
  noScreen: true;
};

/** The real route category that a data-backed Operations map node can use. */
export type CompanyMapOperationsWindowTarget =
  | "channel"
  | "needs-you"
  | "operations"
  | "work";

/** A persisted workflow or workflow-step map root. */
export type CompanyMapOperationsWindowJob = {
  functionId: "operations";
  jobName: "Operations";
  kind: "add-step" | "add-workflow" | "step" | "workflow";
  playbookId: string | null;
  stepId: string | null;
  target: CompanyMapOperationsWindowTarget;
};

export type CompanyMapOperationsWindowSearchInput =
  | {
      kind: "add-step" | "workflow";
      playbookId: string;
      target: "operations";
    }
  | {
      kind: "add-workflow";
      target: "channel" | "operations";
    }
  | {
      kind: "step";
      playbookId: string;
      stepId: string;
      target: CompanyMapOperationsWindowTarget;
    };

/** A static job, no-screen card, or real Operations workflow map root. */
export type CompanyMapWindowJob =
  | CompanyMapOperationsWindowJob
  | CompanyMapNoScreenWindowJob
  | CompanyMapStaticWindowJob;

const ROUTES: Record<string, CompanyMapJobRoute> = {
  "sales:Lead finding": { kind: "app", to: "/discovery" },
  "sales:Outreach": { kind: "whatsapp", tab: "needs-you" },
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
  "customer_success:Upsell": {
    kind: "part",
    functionId: "customer_success",
  },
  "customer_success:Reviews": {
    kind: "part",
    functionId: "customer_success",
  },
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

const MAP_WINDOW_JOBS: readonly CompanyMapStaticWindowJob[] = [
  { functionId: "sales", jobName: "Lead finding" },
  { functionId: "sales", jobName: "Outreach" },
  { functionId: "sales", jobName: "Follow-ups" },
  { functionId: "sales", jobName: "Quotes" },
  { functionId: "sales", jobName: "Closing" },
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

const NO_SCREEN_MAP_WINDOW_JOBS: readonly CompanyMapNoScreenWindowJob[] = [
  { functionId: "sales", jobName: "Calls", noScreen: true },
  { functionId: "finance", jobName: "Recurring plans", noScreen: true },
  { functionId: "customer_success", jobName: "Upsell", noScreen: true },
  { functionId: "customer_success", jobName: "Reviews", noScreen: true },
  { functionId: "brand", jobName: "Website", noScreen: true },
  { functionId: "brand", jobName: "Portfolio", noScreen: true },
  { functionId: "brand", jobName: "Marketing", noScreen: true },
  { functionId: "brand", jobName: "Offer and prices", noScreen: true },
  { functionId: "brand", jobName: "Voice", noScreen: true },
];

/** Jobs whose dedicated app screens do not exist in this checkout. */
export const COMPANY_MAP_NO_SCREEN_JOBS = NO_SCREEN_MAP_WINDOW_JOBS.map((job) =>
  companyMapJobKey(job.functionId, job.jobName),
);

/** Current app jobs that intentionally fall back to their part page. */
export const COMPANY_MAP_FALLBACK_JOBS = COMPANY_MAP_NO_SCREEN_JOBS;

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

/**
 * Stores a data-backed Operations workflow node as a bounded map-window root.
 * The node's screen target remains separate from its label, so a renamed
 * playbook cannot turn a saved URL into a new route.
 */
export function companyMapOperationsWindowSearch(
  input: CompanyMapOperationsWindowSearchInput,
): { mapJob: string } {
  switch (input.kind) {
    case "add-workflow":
      return { mapJob: `operations:add-workflow:${input.target}` };
    case "add-step":
    case "workflow":
      return {
        mapJob: `operations:${input.kind}:${input.playbookId}:${input.target}`,
      };
    case "step":
      return {
        mapJob: `operations:step:${input.playbookId}:${input.stepId}:${input.target}`,
      };
  }
}

/** Builds the map-job trail search for a channel desk or its setup fallback. */
export function companyMapWhatsAppSearch(
  mapJob: string | undefined,
  tab: CompanyMapWhatsAppTab,
  target: "channel",
): { mapJob: string | undefined; whatsappDeskTab: CompanyMapWhatsAppTab };
export function companyMapWhatsAppSearch(
  mapJob: string | undefined,
  tab: CompanyMapWhatsAppTab,
  target: "setup",
): { mapJob: string | undefined; outreachDeskTab: CompanyMapWhatsAppTab };
export function companyMapWhatsAppSearch(
  mapJob: string | undefined,
  tab: CompanyMapWhatsAppTab,
  target: "channel" | "setup",
) {
  return target === "channel"
    ? { mapJob, whatsappDeskTab: tab }
    : { mapJob, outreachDeskTab: tab };
}

function windowJobFromKey(value: unknown): CompanyMapWindowJob | null {
  if (typeof value !== "string") return null;
  const staticJob = MAP_WINDOW_JOBS.find(
    (job) => companyMapJobKey(job.functionId, job.jobName) === value,
  );
  const noScreenJob = NO_SCREEN_MAP_WINDOW_JOBS.find(
    (job) => companyMapJobKey(job.functionId, job.jobName) === value,
  );
  return staticJob ?? noScreenJob ?? operationsWindowJobFromKey(value);
}

const PLAYBOOK_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const STEP_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

function isOperationsTarget(
  value: string,
): value is CompanyMapOperationsWindowTarget {
  return (
    value === "channel" ||
    value === "needs-you" ||
    value === "operations" ||
    value === "work"
  );
}

function operationsWindowJobFromKey(
  value: string,
): CompanyMapOperationsWindowJob | null {
  const segments = value.split(":");
  if (segments[0] !== "operations") return null;

  if (
    (segments[1] === "add-step" || segments[1] === "workflow") &&
    segments.length === 4 &&
    PLAYBOOK_ID_PATTERN.test(segments[2]) &&
    segments[3] === "operations"
  ) {
    return {
      functionId: "operations",
      jobName: "Operations",
      kind: segments[1],
      playbookId: segments[2],
      stepId: null,
      target: "operations",
    };
  }

  if (
    segments[1] === "add-workflow" &&
    segments.length === 3 &&
    (segments[2] === "channel" || segments[2] === "operations")
  ) {
    return {
      functionId: "operations",
      jobName: "Operations",
      kind: "add-workflow",
      playbookId: null,
      stepId: null,
      target: segments[2],
    };
  }

  if (
    segments[1] === "step" &&
    segments.length === 5 &&
    PLAYBOOK_ID_PATTERN.test(segments[2]) &&
    STEP_ID_PATTERN.test(segments[3]) &&
    isOperationsTarget(segments[4])
  ) {
    return {
      functionId: "operations",
      jobName: "Operations",
      kind: "step",
      playbookId: segments[2],
      stepId: segments[3],
      target: segments[4],
    };
  }

  return null;
}

function isCompanyMapOperationsWindowJob(
  value: unknown,
): value is CompanyMapOperationsWindowJob {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    functionId?: unknown;
    jobName?: unknown;
    kind?: unknown;
    playbookId?: unknown;
    stepId?: unknown;
    target?: unknown;
  };
  if (
    candidate.functionId !== "operations" ||
    candidate.jobName !== "Operations" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.target !== "string" ||
    !isOperationsTarget(candidate.target)
  ) {
    return false;
  }

  if (candidate.kind === "add-workflow") {
    return (
      candidate.playbookId === null &&
      candidate.stepId === null &&
      (candidate.target === "channel" || candidate.target === "operations")
    );
  }

  if (candidate.kind === "add-step" || candidate.kind === "workflow") {
    return (
      typeof candidate.playbookId === "string" &&
      PLAYBOOK_ID_PATTERN.test(candidate.playbookId) &&
      candidate.stepId === null &&
      candidate.target === "operations"
    );
  }

  return (
    candidate.kind === "step" &&
    typeof candidate.playbookId === "string" &&
    PLAYBOOK_ID_PATTERN.test(candidate.playbookId) &&
    typeof candidate.stepId === "string" &&
    STEP_ID_PATTERN.test(candidate.stepId)
  );
}

/** Confirms that persisted map state names one of the explicit empty spots. */
export function isCompanyMapNoScreenWindowJob(
  value: unknown,
): value is CompanyMapNoScreenWindowJob {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    functionId?: unknown;
    jobName?: unknown;
    noScreen?: unknown;
  };
  return (
    candidate.noScreen === true &&
    NO_SCREEN_MAP_WINDOW_JOBS.some(
      (job) =>
        job.functionId === candidate.functionId &&
        job.jobName === candidate.jobName,
    )
  );
}

/** Confirms a persisted trail root is one of the supported map jobs. */
export function isCompanyMapWindowJob(
  value: unknown,
): value is CompanyMapWindowJob {
  if (isCompanyMapOperationsWindowJob(value)) return true;
  if (isCompanyMapNoScreenWindowJob(value)) return true;
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
  if (isCompanyMapOperationsWindowJob(job)) {
    if (job.target === "operations") {
      return pathname === "/company/function/operations";
    }
    if (job.target === "work") {
      return pathname === "/work" || pathname.startsWith("/work/");
    }
    if (job.target === "needs-you") return pathname === "/today/needs-you";
    return pathname.startsWith("/channels/");
  }
  if (isCompanyMapNoScreenWindowJob(job)) {
    return pathname === `/company/function/${job.functionId}`;
  }
  if (
    job.functionId === "sales" &&
    job.jobName === "Outreach" &&
    (pathname === "/leads" ||
      pathname === "/lists" ||
      pathname.startsWith("/lists/") ||
      (pathname.startsWith("/channels/") &&
        (search.whatsappDeskTab === "needs-you" ||
          search.whatsappDeskTab === "pipeline" ||
          search.whatsappDeskTab === "chats" ||
          search.whatsappDeskTab === "discussion")))
  ) {
    return true;
  }
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
  if (
    pathname === "/leads" ||
    pathname === "/lists" ||
    pathname.startsWith("/lists/")
  ) {
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
    (search.whatsappDeskTab === "needs-you" ||
      search.whatsappDeskTab === "discussion")
  ) {
    return { functionId: "sales", jobName: "Outreach" };
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
