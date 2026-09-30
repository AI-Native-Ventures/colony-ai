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
  record?: string;
};

function validatePowerSearch(search: Record<string, unknown>): PowerSearch {
  const panel = parsePowerPanel(search.panel);
  return {
    section: parsePowerSection(
      typeof search.section === "string" ? search.section : undefined,
    ),
    panel,
    employee:
      panel === "employee" &&
      typeof search.employee === "string" &&
      /^[0-9a-f]{64}$/i.test(search.employee)
        ? search.employee.toLowerCase()
        : undefined,
    record:
      (panel === "source" ||
        panel === "edit-cost" ||
        panel === "remove-cost") &&
      typeof search.record === "string" &&
      /^cost:[0-9a-f-]{36}$/i.test(search.record)
        ? search.record.toLowerCase()
        : undefined,
  };
}

function parsePowerPanel(value: unknown): PowerPanel | undefined {
  return value === "employee" ||
    value === "new-cost" ||
    value === "edit-cost" ||
    value === "source" ||
    value === "remove-cost"
    ? value
    : undefined;
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
            record: undefined,
          },
        })
      }
      onOpenCost={(record) =>
        void navigate({
          to: "/power",
          search: {
            section: undefined,
            panel: "source",
            employee: undefined,
            record,
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
            record: undefined,
          },
        })
      }
      onOpenNewCost={() =>
        void navigate({
          to: "/power",
          search: {
            section: undefined,
            panel: "new-cost",
            employee: undefined,
            record: undefined,
          },
        })
      }
      onEditCost={(record) =>
        void navigate({
          to: "/power",
          search: {
            section: undefined,
            panel: "edit-cost",
            employee: undefined,
            record,
          },
        })
      }
      onRemoveCost={(record) =>
        void navigate({
          to: "/power",
          search: {
            section: undefined,
            panel: "remove-cost",
            employee: undefined,
            record,
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
            record: undefined,
          },
        })
      }
      section={search.section ?? "overview"}
      panel={search.panel}
      employeePubkey={search.employee}
      recordId={search.record}
    />
  );
}
