import type * as React from "react";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import type {
  DiscoveryCampaign,
  DiscoveryCampaignProvider,
  DiscoveryRunner,
} from "./discoveryProvider";
import type { LeadPillTone } from "./leadShared";

export function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="17"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
      width="17"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function PlusGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowLeftGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function ChatGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M20.5 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12z" />
    </svg>
  );
}

export function LeadPill({
  children,
  tone = "neutral",
  large = false,
}: {
  children: React.ReactNode;
  tone?: LeadPillTone;
  large?: boolean;
}) {
  return (
    <span
      className={`c3l-pill c3l-pill-${tone}${large ? " c3l-pill-large" : ""}`}
    >
      {children}
    </span>
  );
}

/**
 * Who ran a discovery search. An agent keeps its own squircle picture and a
 * person stays round, as everywhere else in the app.
 */
export function RunnerMark({
  runner,
  size,
}: {
  runner: DiscoveryRunner;
  /** Edge length in design pixels: the Leads board draws 22, the lead 24. */
  size: 22 | 24;
}) {
  const pubkey = runner.pubkey;
  const profiles = useUsersBatchQuery(pubkey ? [pubkey] : [], {
    enabled: Boolean(pubkey),
  });
  const profile = pubkey
    ? (profiles.data?.profiles[pubkey.toLowerCase()] ?? null)
    : null;
  return (
    <UserAvatar
      avatarUrl={profile?.avatarUrl ?? null}
      className={`c3l-runner-avatar c3l-runner-avatar-${size}`}
      displayName={runner.name}
      pubkey={runner.pubkey}
      shape={profile?.isAgent ? "squircle" : "circle"}
      size="sm"
    />
  );
}

/** The campaign a lead was found by, when this device knows it. */
export function campaignFor(
  provider: DiscoveryCampaignProvider | null,
  current: DiscoveryCampaign | null,
  prospectId: string,
): DiscoveryCampaign | null {
  const known = provider?.getCampaigns() ?? [];
  return (
    known.find((campaign) => campaign.prospectIds.includes(prospectId)) ??
    (current?.prospectIds.includes(prospectId) ? current : null)
  );
}

/** Top bar trail for a lead: `Business / Sales / Leads / <name>`. */
export function LeadBreadcrumb({ name }: { name: string }) {
  return (
    <AppTopChromePortal>
      <nav
        aria-label="Breadcrumb"
        className="c3l-crumbs"
        data-testid="lead-breadcrumb"
      >
        <span>Business</span>
        <span aria-hidden="true">/</span>
        <span>Sales</span>
        <span aria-hidden="true">/</span>
        <a className="c3l-crumb-link" href="#/leads">
          Leads
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page" data-current="true">
          {name}
        </span>
      </nav>
    </AppTopChromePortal>
  );
}
