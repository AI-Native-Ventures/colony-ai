/**
 * Default breadcrumb trail for the shell top bar, by route. A screen that
 * needs a richer trail (a project, a person) portals its own content into the
 * bar through `AppTopChromePortal`, which replaces this default.
 *
 * The last segment is the current page; earlier segments are the area it
 * belongs to. Labels follow the sidebar so the bar and the navigation agree.
 */
type Crumb = { label: string };

export type MapShellTrail = { part: string; job: string } | { screen: string };

/** Optional screen data used when a route ID is not enough to identify its part. */
export type MapShellTrailContext = {
  channelName?: string | null;
};

const MAP_SHELL_FUNCTIONS: Record<string, string> = {
  sales: "Sales",
  finance: "Finance",
  operations: "Operations",
  customer_success: "Customer Success",
  brand: "Brand",
};

const MAP_SHELL_JOB_ROUTES: Array<{
  match: (pathname: string) => boolean;
  part: string;
  job: string;
}> = [
  {
    match: (path) => path === "/discovery" || path.startsWith("/discovery/"),
    part: "Sales",
    job: "Lead finding",
  },
  {
    match: (path) => path === "/leads" || path.startsWith("/sales/lead"),
    part: "Sales",
    job: "Outreach",
  },
  { match: (path) => path === "/pipeline", part: "Sales", job: "Closing" },
  {
    match: (path) => path.startsWith("/money/invoice"),
    part: "Finance",
    job: "Invoices",
  },
  {
    match: (path) => path === "/money",
    part: "Finance",
    job: "Chasing payments",
  },
  {
    match: (path) => path === "/company/access",
    part: "Finance",
    job: "Costs",
  },
  {
    match: (path) => path === "/work" || path.startsWith("/work/"),
    part: "Operations",
    job: "Delivery",
  },
  {
    match: (path) => path.startsWith("/clients/record/"),
    part: "Finance",
    job: "Deposits",
  },
  {
    match: (path) => path.startsWith("/whatsapp/batches/"),
    part: "Sales",
    job: "Outreach",
  },
];

const MAP_SHELL_SCREEN_NAMES: Record<string, string> = {
  "/activity": "Activity",
  "/agents": "Agents",
  "/asks/new": "New ask",
  "/company/weekly-review": "Weekly review",
  "/hire/configure": "Configure employee",
  "/hire/review": "Review hire",
  "/hire/role-pack": "Edit a role pack",
  "/hire/roles": "Role catalog",
  "/hire/success": "Hired",
  "/messages/new": "New message",
  "/navigation/history": "History",
  "/navigation/start": "Start",
  "/power": "Power",
  "/settings": "Settings",
  "/team": "Team",
  "/today": "Today",
  "/today/needs-you": "Needs you",
  "/today/reviews-empty": "Reviews",
};

/** Return the one or two labels shown after Map in the redesign shell. */
function legacyMapShellTrailForPath(pathname: string): MapShellTrail | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  if (path === "/" || path === "/company/map") return null;

  const functionMatch = path.match(/^\/company\/function\/([^/]+)/);
  if (functionMatch) {
    const part = MAP_SHELL_FUNCTIONS[functionMatch[1]];
    if (part) return { part, job: `All of ${part}` };
  }

  const job = MAP_SHELL_JOB_ROUTES.find((entry) => entry.match(path));
  if (job) return { part: job.part, job: job.job };

  const exactName = MAP_SHELL_SCREEN_NAMES[path];
  if (exactName) return { screen: exactName };
  if (path.startsWith("/team/")) return { screen: "Team member" };
  if (path.startsWith("/clients/")) return { screen: "Client" };
  if (path.startsWith("/asks/")) return { screen: "Ask" };
  if (path.startsWith("/channels/pins/")) return { screen: "Pins" };
  if (path.startsWith("/channels/")) return { screen: "Chat" };

  const lastSegment = path.split("/").filter(Boolean).at(-1) ?? "Workspace";
  return {
    screen: lastSegment
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
  };
}

const MAP_SHELL_ROUTE_JOBS: Array<{
  match: (pathname: string) => boolean;
  part: string;
  job: string;
}> = [
  {
    match: (path) => path === "/discovery" || path === "/campaign",
    part: "Sales",
    job: "Lead finding",
  },
  {
    match: (path) =>
      path === "/leads" ||
      path === "/lists" ||
      path.startsWith("/lists/") ||
      path.startsWith("/sales/lead"),
    part: "Sales",
    job: "Outreach",
  },
  { match: (path) => path === "/pipeline", part: "Sales", job: "Closing" },
  {
    match: (path) =>
      path === "/money/invoices" || path.startsWith("/money/invoice/"),
    part: "Finance",
    job: "Invoices",
  },
  {
    match: (path) =>
      path === "/money" ||
      path === "/money/revenue" ||
      path.startsWith("/money/revenue/"),
    part: "Finance",
    job: "Chasing payments",
  },
  {
    match: (path) => path === "/company/access",
    part: "Finance",
    job: "Costs",
  },
  {
    match: (path) => path === "/company/function/operations",
    part: "Operations",
    job: "Delivery",
  },
  { match: (path) => path === "/work", part: "Operations", job: "Delivery" },
  {
    match: (path) => path.startsWith("/work/"),
    part: "Operations",
    job: "Revisions",
  },
  {
    match: (path) => path === "/clients" || /^\/clients\/[^/]+$/.test(path),
    part: "Customer Success",
    job: "Client chats",
  },
  {
    match: (path) => path.startsWith("/clients/record/"),
    part: "Finance",
    job: "Deposits",
  },
  {
    match: (path) => path.startsWith("/whatsapp/batches/"),
    part: "Sales",
    job: "Outreach",
  },
];

/** Return the board-derived part/job trail, or the screen name when unmapped. */
export function mapShellTrailForPath(
  pathname: string,
  context: MapShellTrailContext = {},
): MapShellTrail | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  if (path === "/" || path === "/company/map") return null;

  const functionMatch = path.match(/^\/company\/function\/([^/]+)/);
  if (functionMatch) {
    const part = MAP_SHELL_FUNCTIONS[functionMatch[1]];
    if (part) {
      return {
        part,
        job: functionMatch[1] === "operations" ? "Delivery" : `All of ${part}`,
      };
    }
  }

  const channelName = context.channelName?.trim().toLocaleLowerCase();
  if (path.startsWith("/channels/") && channelName === "outreach") {
    return { part: "Sales", job: "Outreach" };
  }
  if (path.startsWith("/channels/") && channelName === "marketing") {
    return { part: "Brand", job: "Marketing" };
  }
  if (path.startsWith("/channels/pins/")) {
    return { screen: "Pins" };
  }
  if (path.startsWith("/channels/") && context.channelName?.trim()) {
    return { screen: context.channelName.trim() };
  }

  const mappedJob = MAP_SHELL_ROUTE_JOBS.find((entry) => entry.match(path));
  if (mappedJob) return { part: mappedJob.part, job: mappedJob.job };

  return legacyMapShellTrailForPath(path);
}

const MONEY_PAGES: Record<string, string> = {
  invoices: "Invoices",
  invoice: "Invoice",
  revenue: "Revenue",
};

const SALES_PAGES: Record<string, string> = {
  lead: "Lead",
};

const HIRE_PAGES: Record<string, string> = {
  roles: "Role catalog",
  configure: "Configure employee",
  review: "Review hire",
  success: "Hired",
};

const COMPANY_FUNCTION_PAGES: Record<string, string> = {
  sales: "Sales",
  operations: "Operations",
  customer_success: "Customer Success",
  finance: "Finance",
  brand: "Brand",
};

function trail(...labels: string[]): Crumb[] {
  return labels.map((label) => ({ label }));
}

export function breadcrumbForPath(pathname: string): Crumb[] | null {
  const segments = pathname.split("/").filter(Boolean);
  const [first, second] = segments;

  switch (first) {
    case "company":
      if (second === "map") return trail("Company", "Company map");
      if (second === "function") {
        return trail(
          "Company",
          "Company map",
          COMPANY_FUNCTION_PAGES[segments[2] ?? ""] ?? "Function",
        );
      }
      return trail("Company");
    case "agents":
      return trail("Company", "Agents");
    case "team":
      return segments.length > 1
        ? trail("Company", "Team", "Member")
        : trail("Company", "Team");
    case "hire":
      if (second === "role-pack") {
        return trail("Company", "Team", "Role catalog", "Edit a role pack");
      }
      return trail("Company", "Team", HIRE_PAGES[second ?? ""] ?? "Hire");
    case "work":
      return trail("Company", "Work");
    case "discovery":
      if (second === "campaigns") {
        return trail("Business", "Discovery", "All campaigns");
      }
      return trail("Business", "Discovery");
    case "campaign":
      return trail("Business", "Discovery", "Campaign");
    case "leads":
      return trail("Business", "Sales", "Leads");
    case "pipeline":
      return trail("Business", "Sales", "Pipeline");
    case "sales":
      return second === "lead"
        ? trail("Business", "Sales", "Leads", "Lead")
        : trail("Business", "Sales", SALES_PAGES[second ?? ""] ?? "Overview");
    case "clients":
      return segments.length > 1
        ? trail("Business", "Clients", "Client")
        : trail("Business", "Clients");
    case "money":
      return second
        ? trail("Business", "Money", MONEY_PAGES[second] ?? "Details")
        : trail("Business", "Money");
    case "power":
      return trail("Company", "AI spend & power");
    default:
      return null;
  }
}
