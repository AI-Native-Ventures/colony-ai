import type * as React from "react";

import {
  SIDEBAR_DESTINATIONS,
  type SidebarDestination,
  type SidebarDestinationContext,
  type SidebarDestinationItem,
} from "@/features/sidebar/ui/sidebarDestinations";
import { SidebarNavigationGroup } from "@/features/sidebar/ui/SidebarNavigationGroup";
import { useCommunities } from "@/features/communities/useCommunities";
import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";
import { FeatureGate } from "@/shared/features";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

/** Wraps an entry in its feature gate, when it names one. */
export function GatedDestination({
  children,
  feature,
}: {
  children: React.ReactNode;
  feature?: string;
}) {
  return feature ? (
    <FeatureGate feature={feature}>{children}</FeatureGate>
  ) : (
    children
  );
}

function DestinationItem({
  context,
  item,
}: {
  context: SidebarDestinationContext;
  item: SidebarDestinationItem;
}) {
  if (item.available && !item.available(context)) return null;
  const active = item.isActive(context);
  const Badge = item.Badge;
  const label = <SidebarMenuLabel>{item.label}</SidebarMenuLabel>;
  return (
    <GatedDestination feature={item.feature}>
      <SidebarMenu>
        <SidebarMenuItem>
          {item.href ? (
            <SidebarMenuButton
              asChild
              className="sidebar-navigation-child"
              data-testid={item.testId}
              isActive={active}
              tooltip={item.label}
            >
              <a aria-current={active ? "page" : undefined} href={item.href}>
                {label}
              </a>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton
              className="sidebar-navigation-child"
              data-testid={item.testId}
              isActive={active}
              onClick={() => item.onSelect?.(context)}
              tooltip={item.label}
              type="button"
            >
              {label}
            </SidebarMenuButton>
          )}
          {Badge ? <Badge /> : null}
        </SidebarMenuItem>
      </SidebarMenu>
    </GatedDestination>
  );
}

function Destination({
  context,
  entry,
}: {
  context: SidebarDestinationContext;
  entry: SidebarDestination;
}) {
  if (entry.kind === "custom") {
    return (
      <GatedDestination feature={entry.feature}>
        {entry.render(context)}
      </GatedDestination>
    );
  }
  if (entry.kind === "row") {
    const Icon = entry.Icon;
    return (
      <GatedDestination feature={entry.feature}>
        <SidebarMenu data-testid={entry.testId}>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid={entry.rowTestId}
              isActive={entry.isActive(context)}
              onClick={() => entry.onSelect(context)}
              tooltip={entry.label}
              type="button"
            >
              <Icon />
              <SidebarMenuLabel>{entry.label}</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </GatedDestination>
    );
  }
  const Icon = entry.Icon;
  return (
    <GatedDestination feature={entry.feature}>
      <SidebarNavigationGroup
        defaultExpanded={entry.defaultExpanded}
        expandForActiveRoute={entry.isActive(context)}
        icon={<Icon />}
        isCurrent={entry.isCurrent?.(context)}
        label={entry.label}
        testId={entry.testId}
      >
        {entry.items.map((item) => (
          <DestinationItem context={context} item={item} key={item.id} />
        ))}
      </SidebarNavigationGroup>
    </GatedDestination>
  );
}

/** The sidebar's destinations, drawn from `SIDEBAR_DESTINATIONS`. */
export function SidebarDestinationList({
  context,
}: {
  context: SidebarDestinationContext;
}) {
  const { activeCommunity } = useCommunities();
  const cofounderSettings = useCofounderSettingsQuery(
    activeCommunity?.id ?? null,
  );
  const destinationContext = {
    ...context,
    cofounderModeEnabled: cofounderSettings.data?.settings.enabled === true,
  };
  return (
    <>
      {SIDEBAR_DESTINATIONS.map((entry) => (
        <Destination
          context={destinationContext}
          entry={entry}
          key={entry.id}
        />
      ))}
    </>
  );
}
