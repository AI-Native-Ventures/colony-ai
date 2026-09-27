import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  parsePowerSection,
  PowerScreen,
  type PowerSection,
} from "@/features/power/PowerScreen";

type PowerSearch = {
  section?: PowerSection;
};

function validatePowerSearch(search: Record<string, unknown>): PowerSearch {
  return {
    section: parsePowerSection(
      typeof search.section === "string" ? search.section : undefined,
    ),
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
          search: { section: section === "overview" ? undefined : section },
        })
      }
      section={search.section ?? "overview"}
    />
  );
}
