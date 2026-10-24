import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  parsePowerSection,
  PowerScreen,
  type PowerPanel,
  type PowerSection,
} from "@/features/power/PowerScreen";

type PowerSearch = {
  section?: PowerSection;
  panel?: PowerPanel;
  employee?: string;
};

function validatePowerSearch(search: Record<string, unknown>): PowerSearch {
  // Cost records are not edited in this build, so only the employee panel is
  // an address; older cost-form addresses open the page without a panel.
  const panel = search.panel === "employee" ? "employee" : undefined;
  const section = parsePowerSection(
    typeof search.section === "string" ? search.section : undefined,
  );
  return {
    section: section === "overview" ? undefined : section,
    panel,
    employee:
      panel === "employee" &&
      typeof search.employee === "string" &&
      /^[0-9a-f]{64}$/i.test(search.employee)
        ? search.employee.toLowerCase()
        : undefined,
  };
}

export const Route = createFileRoute("/power")({
  validateSearch: validatePowerSearch,
  component: PowerRouteComponent,
});

function PowerRouteComponent() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  return (
    <PowerScreen
      onSectionChange={(section) =>
        void navigate({
          to: "/power",
          search: {
            section: section === "overview" ? undefined : section,
            panel: undefined,
            employee: undefined,
          },
        })
      }
      onOpenEmployee={(employee) =>
        void navigate({
          to: "/power",
          search: {
            section: undefined,
            panel: "employee",
            employee,
          },
        })
      }
      onClosePanel={() =>
        void navigate({
          to: "/power",
          search: {
            section: undefined,
            panel: undefined,
            employee: undefined,
          },
        })
      }
      section={search.section ?? "overview"}
      panel={search.panel}
      employeePubkey={search.employee}
    />
  );
}
