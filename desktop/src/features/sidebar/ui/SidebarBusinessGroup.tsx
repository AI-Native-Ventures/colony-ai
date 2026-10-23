import { useLocation } from "@tanstack/react-router";

import { SidebarNavigationGroup } from "@/features/sidebar/ui/SidebarNavigationGroup";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import { BusinessIcon } from "@/shared/ui/colonyIcons";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

type SidebarBusinessGroupProps = Pick<
  AppSidebarProps,
  "onSelectClients" | "selectedView"
>;

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

/** Business group: Discovery, Sales, Clients and Money. */
export function SidebarBusinessGroup({
  onSelectClients,
  selectedView,
}: SidebarBusinessGroupProps) {
  const { pathname } = useLocation();
  const discoveryActive = pathname === "/discovery" || pathname === "/campaign";
  const salesActive = isSalesPath(pathname);
  const moneyActive = isMoneyPath(pathname);

  return (
    <SidebarNavigationGroup
      defaultExpanded={false}
      expandForActiveRoute={
        selectedView === "business" ||
        selectedView === "clients" ||
        discoveryActive ||
        salesActive ||
        moneyActive
      }
      icon={<BusinessIcon />}
      label="Business"
      testId="sidebar-nav-business"
    >
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            className="sidebar-navigation-child"
            data-testid="sidebar-business-discovery"
            isActive={discoveryActive}
            tooltip="Discovery"
          >
            <a
              aria-current={discoveryActive ? "page" : undefined}
              href="#/discovery"
            >
              <SidebarMenuLabel>Discovery</SidebarMenuLabel>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            className="sidebar-navigation-child"
            data-testid="sidebar-business-sales"
            isActive={salesActive}
            tooltip="Sales"
          >
            <a aria-current={salesActive ? "page" : undefined} href="#/leads">
              <SidebarMenuLabel>Sales</SidebarMenuLabel>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {onSelectClients ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              className="sidebar-navigation-child"
              data-testid="sidebar-business-clients"
              isActive={selectedView === "clients"}
              onClick={onSelectClients}
              tooltip="Clients"
              type="button"
            >
              <SidebarMenuLabel>Clients</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            className="sidebar-navigation-child"
            data-testid="sidebar-business-money"
            isActive={moneyActive}
            tooltip="Money"
          >
            <a aria-current={moneyActive ? "page" : undefined} href="#/money">
              <SidebarMenuLabel>Money</SidebarMenuLabel>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarNavigationGroup>
  );
}
