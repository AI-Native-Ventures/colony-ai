import type * as React from "react";

import { useCompanyTeamCountQuery } from "@/features/company-team/teamRelay";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import { SidebarSoftwareFactoryGroup } from "@/features/sidebar/ui/SidebarSoftwareFactoryGroup";
import type { FactoryScope } from "@/shared/api/factoryRuntime";
import {
  BusinessIcon,
  CompanyIcon,
  FactoryIcon,
  LibraryIcon,
} from "@/shared/ui/colonyIcons";
import { SidebarMenuBadge } from "@/shared/ui/sidebar";

/**
 * The sidebar's destinations, as data.
 *
 * Every row under Today, Activity and Saved for later, and every icon on the
 * collapsed rail that opens a part of the app, is one entry in
 * `SIDEBAR_DESTINATIONS`. `SidebarDestinationList` and `SidebarCollapsedNav`
 * only render this list, so a destination is added, moved or dropped by
 * editing the list below and nothing else: no component names a destination.
 */

/** What an entry needs to know about the app to draw itself. */
export type SidebarDestinationContext = {
  factoryScope: FactoryScope;
  handlers: Pick<
    AppSidebarProps,
    | "onSelectAgents"
    | "onSelectClients"
    | "onSelectFactory"
    | "onSelectGoals"
    | "onSelectSettings"
    | "onSelectTeam"
    | "onSelectWork"
    | "onSelectWorkflows"
  >;
  pathname: string;
  selectedChannelId: string | null;
  selectedView: AppSidebarProps["selectedView"];
};

type IconComponent = (props: { size?: number }) => React.ReactNode;

/** One row of a group. It opens a hash route (`href`) or runs a handler. */
export type SidebarDestinationItem = {
  id: string;
  testId: string;
  label: string;
  /** Hidden unless the manifest feature is on. */
  feature?: string;
  /** Hidden when this returns false (a handler that is not provided). */
  available?: (context: SidebarDestinationContext) => boolean;
  href?: string;
  isActive: (context: SidebarDestinationContext) => boolean;
  onSelect?: (context: SidebarDestinationContext) => void;
  /** A badge drawn beside the row, such as the team count. */
  Badge?: React.ComponentType;
};

/** The icon this entry puts on the collapsed rail. */
export type SidebarDestinationRail = {
  testId: string;
  label: string;
  Icon: IconComponent;
  isActive: (context: SidebarDestinationContext) => boolean;
  onSelect: (context: SidebarDestinationContext) => void;
};

type EntryBase = {
  id: string;
  /** Hidden unless the manifest feature is on. */
  feature?: string;
  rail?: SidebarDestinationRail;
};

export type SidebarDestination =
  | (EntryBase & {
      kind: "group";
      testId: string;
      label: string;
      Icon: IconComponent;
      defaultExpanded: boolean;
      /** The group opens by itself while any of its destinations is open. */
      isActive: (context: SidebarDestinationContext) => boolean;
      items: readonly SidebarDestinationItem[];
    })
  | (EntryBase & {
      kind: "row";
      /** The list that holds the row. */
      testId: string;
      /** The row's own button. */
      rowTestId: string;
      label: string;
      Icon: IconComponent;
      isActive: (context: SidebarDestinationContext) => boolean;
      onSelect: (context: SidebarDestinationContext) => void;
    })
  | (EntryBase & {
      kind: "custom";
      render: (context: SidebarDestinationContext) => React.ReactNode;
    });

function TeamCountBadge() {
  const teamCountQuery = useCompanyTeamCountQuery();
  const teamCount = teamCountQuery.data?.membershipSnapshotFound
    ? teamCountQuery.data.memberCount
    : null;
  return teamCount !== null ? (
    <SidebarMenuBadge data-testid="sidebar-team-count">
      {teamCount}
    </SidebarMenuBadge>
  ) : null;
}

function isSalesPath(pathname: string): boolean {
  return (
    pathname === "/leads" ||
    pathname === "/pipeline" ||
    pathname.startsWith("/sales/")
  );
}

function isMoneyPath(pathname: string): boolean {
  return pathname === "/money" || pathname.startsWith("/money/");
}

function isDiscoveryPath(pathname: string): boolean {
  return pathname === "/discovery" || pathname === "/campaign";
}

const COMPANY_VIEWS: readonly AppSidebarProps["selectedView"][] = [
  "agents",
  "goals",
  "team",
  "work",
  "workflows",
];

const company: SidebarDestination = {
  kind: "group",
  id: "company",
  testId: "sidebar-nav-company",
  label: "Company",
  Icon: CompanyIcon,
  defaultExpanded: false,
  isActive: ({ selectedView }) => COMPANY_VIEWS.includes(selectedView),
  rail: {
    testId: "sidebar-collapsed-company",
    label: "Company",
    Icon: CompanyIcon,
    isActive: ({ selectedView }) => COMPANY_VIEWS.includes(selectedView),
    onSelect: ({ handlers }) => handlers.onSelectTeam(),
  },
  items: [
    {
      id: "team",
      testId: "sidebar-company-team",
      label: "Team",
      isActive: ({ selectedView }) => selectedView === "team",
      onSelect: ({ handlers }) => handlers.onSelectTeam(),
      Badge: TeamCountBadge,
    },
    {
      id: "agents",
      testId: "sidebar-company-agents",
      label: "Agents",
      isActive: ({ selectedView }) => selectedView === "agents",
      onSelect: ({ handlers }) => handlers.onSelectAgents(),
    },
    {
      id: "goals",
      testId: "sidebar-company-goals",
      label: "Goals",
      isActive: ({ selectedView }) => selectedView === "goals",
      onSelect: ({ handlers }) => handlers.onSelectGoals(),
    },
    {
      id: "work",
      testId: "sidebar-company-work",
      label: "Work",
      isActive: ({ selectedView }) => selectedView === "work",
      onSelect: ({ handlers }) => handlers.onSelectWork(),
    },
    {
      id: "workflows",
      testId: "open-workflows-view",
      label: "Workflows",
      feature: "workflows",
      isActive: ({ selectedView }) => selectedView === "workflows",
      onSelect: ({ handlers }) => handlers.onSelectWorkflows(),
    },
  ],
};

const businessActive = ({
  pathname,
  selectedView,
}: SidebarDestinationContext) =>
  selectedView === "business" ||
  selectedView === "clients" ||
  isDiscoveryPath(pathname) ||
  isSalesPath(pathname) ||
  isMoneyPath(pathname);

const business: SidebarDestination = {
  kind: "group",
  id: "business",
  testId: "sidebar-nav-business",
  label: "Business",
  Icon: BusinessIcon,
  defaultExpanded: false,
  isActive: businessActive,
  rail: {
    testId: "sidebar-collapsed-business",
    label: "Business",
    Icon: BusinessIcon,
    isActive: businessActive,
    onSelect: () => {
      window.location.hash = "#/discovery";
    },
  },
  items: [
    {
      id: "discovery",
      testId: "sidebar-business-discovery",
      label: "Discovery",
      href: "#/discovery",
      isActive: ({ pathname }) => isDiscoveryPath(pathname),
    },
    {
      id: "sales",
      testId: "sidebar-business-sales",
      label: "Sales",
      href: "#/leads",
      isActive: ({ pathname }) => isSalesPath(pathname),
    },
    {
      id: "clients",
      testId: "sidebar-business-clients",
      label: "Clients",
      available: ({ handlers }) => Boolean(handlers.onSelectClients),
      isActive: ({ selectedView }) => selectedView === "clients",
      onSelect: ({ handlers }) => handlers.onSelectClients?.(),
    },
    {
      id: "money",
      testId: "sidebar-business-money",
      label: "Money",
      href: "#/money",
      isActive: ({ pathname }) => isMoneyPath(pathname),
    },
  ],
};

const softwareFactory: SidebarDestination = {
  kind: "custom",
  id: "software-factory",
  rail: {
    testId: "sidebar-collapsed-factory",
    label: "Software Factory",
    Icon: FactoryIcon,
    isActive: ({ selectedView }) => selectedView === "factory",
    onSelect: ({ handlers }) => handlers.onSelectFactory(),
  },
  render: ({ factoryScope, handlers, selectedChannelId, selectedView }) => (
    <SidebarSoftwareFactoryGroup
      isActive={selectedView === "factory"}
      isProjectsActive={selectedView === "projects"}
      onSelectFactory={handlers.onSelectFactory}
      scope={factoryScope}
      selectedChannelId={selectedChannelId}
    />
  ),
};

const library: SidebarDestination = {
  kind: "row",
  id: "library",
  feature: "channel-templates",
  testId: "sidebar-nav-library",
  rowTestId: "sidebar-blocks-templates",
  label: "Library",
  Icon: LibraryIcon,
  isActive: () => false,
  onSelect: ({ handlers }) => handlers.onSelectSettings("custom-emoji"),
  rail: {
    testId: "sidebar-collapsed-library",
    label: "Library",
    Icon: LibraryIcon,
    isActive: () => false,
    onSelect: ({ handlers }) => handlers.onSelectSettings("custom-emoji"),
  },
};

/** The destinations, top to bottom. Edit this list to change the sidebar. */
export const SIDEBAR_DESTINATIONS: readonly SidebarDestination[] = [
  company,
  business,
  softwareFactory,
  library,
];
