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
  adjustments: "Credit notes & refunds",
  "follow-ups": "Follow-ups",
  invoices: "Invoices",
  invoice: "Invoice",
  revenue: "Revenue",
  costs: "Costs",
  profitability: "Profitability",
  tax: "Tax",
};

const SALES_PAGES: Record<string, string> = {
  proposals: "Proposals",
  proposal: "Proposal",
  service: "Service",
  lead: "Lead",
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
    case "supervision":
      return trail("Company", "Supervision");
    case "team":
      return segments.length > 1
        ? trail("Company", "Team", second === "org" ? "Org chart" : "Member")
        : trail("Company", "Team");
    case "hire":
      return trail("Company", "Team", "Hire");
    case "goals":
      return segments.length > 1
        ? trail("Company", "Goals", "Goal")
        : trail("Company", "Goals");
    case "work":
      return trail("Company", "Work");
    case "workflows":
      return segments.length > 1
        ? trail("Company", "Workflows", "Workflow")
        : trail("Company", "Workflows");
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
    case "reminders":
      return trail("Saved for later");
    case "pulse":
      return trail("Pulse");
    case "secrets":
      return trail("Company", "Secrets");
    case "projects":
      return trail("Software Factory", "Projects");
    default:
      return null;
  }
}
