import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  CAMPAIGN_SIZE_FILTERS,
  CAMPAIGN_SORTS,
  CAMPAIGN_STATUS_FILTERS,
} from "@/features/discovery/campaignsCatalog";
import {
  CampaignsScreen,
  type CampaignsSearch,
} from "@/features/discovery/CampaignsScreen";

function stringSearch(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function choice<T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] | undefined {
  return typeof value === "string" && choices.includes(value)
    ? (value as T[number])
    : undefined;
}

function dateSearch(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined;
}

function pageSearch(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 1) {
    return undefined;
  }
  return value;
}

function validateCampaignsSearch(
  search: Record<string, unknown>,
): CampaignsSearch {
  return {
    from: dateSearch(search.from),
    industry: stringSearch(search.industry),
    location: stringSearch(search.location),
    page: pageSearch(search.page),
    q: stringSearch(search.q),
    runner: stringSearch(search.runner),
    size: choice(search.size, CAMPAIGN_SIZE_FILTERS),
    sort: choice(search.sort, CAMPAIGN_SORTS),
    status: choice(search.status, CAMPAIGN_STATUS_FILTERS),
    to: dateSearch(search.to),
    type: stringSearch(search.type),
  };
}

export const Route = createFileRoute("/discovery/campaigns")({
  component: CampaignsRoute,
  validateSearch: validateCampaignsSearch,
});

function CampaignsRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const onSearchChange = React.useCallback(
    (next: CampaignsSearch) =>
      void navigate({ to: "/discovery/campaigns", search: next }),
    [navigate],
  );

  return <CampaignsScreen onSearchChange={onSearchChange} search={search} />;
}
