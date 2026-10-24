/**
 * Default breadcrumb trail for the shell top bar, by route. A screen that
 * needs a richer trail (a project, a person) portals its own content into the
 * bar through `AppTopChromePortal`, which replaces this default.
 *
 * The last segment is the current page; earlier segments are the area it
 * belongs to. Labels follow the sidebar so the bar and the navigation agree.
 */
type Crumb = { label: string };

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

function trail(...labels: string[]): Crumb[] {
  return labels.map((label) => ({ label }));
}

export function breadcrumbForPath(pathname: string): Crumb[] | null {
  const segments = pathname.split("/").filter(Boolean);
  const [first, second] = segments;

  switch (first) {
    case "agents":
      return trail("Company", "Agents");
    case "team":
      return segments.length > 1
        ? trail("Company", "Team", "Member")
        : trail("Company", "Team");
    case "hire":
      return trail("Company", "Team", HIRE_PAGES[second ?? ""] ?? "Hire");
    case "work":
      return trail("Company", "Work");
    case "discovery":
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
      return trail("AI spend & power");
    default:
      return null;
  }
}
