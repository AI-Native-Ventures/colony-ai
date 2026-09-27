import { useLocation } from "@tanstack/react-router";
import {
  BriefcaseBusiness,
  ChevronDown,
  FileText,
  KanbanSquare,
  ListTodo,
  Search,
  Users,
} from "lucide-react";

import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

const BUSINESS_DESTINATIONS = [
  ["/discovery", "Discovery", Search],
  ["/leads", "Leads", Users],
  ["/pipeline", "Pipeline", KanbanSquare],
  ["/sales/proposals", "Proposals", FileText],
  ["/sales/service", "Services", BriefcaseBusiness],
] as const;

/** Whether `pathname` is the destination at `href` or one of its detail routes. */
function isDestinationPath(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    (href === "/sales/proposals" && pathname.startsWith("/sales/proposal/")) ||
    (href === "/leads" && pathname.startsWith("/sales/lead/"))
  );
}

type AppSidebarBusinessSectionProps = Pick<
  AppSidebarProps,
  "onSelectClients" | "onSelectWork" | "selectedView"
>;

/** Business heading with the client, work, and sales destinations. */
export function AppSidebarBusinessSection({
  onSelectClients,
  onSelectWork,
  selectedView,
}: AppSidebarBusinessSectionProps) {
  const location = useLocation();
  return (
    <>
      <h2
        className="colony-sidebar-business-heading"
        data-testid="sidebar-business-section"
      >
        <ChevronDown aria-hidden="true" />
        <span data-sidebar-section-title>Business</span>
      </h2>
      <SidebarMenu data-testid="sidebar-business-destinations">
        {onSelectClients ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="sidebar-business-clients"
              isActive={selectedView === "clients"}
              onClick={onSelectClients}
              tooltip="Clients"
              type="button"
            >
              <BriefcaseBusiness aria-hidden="true" />
              <SidebarMenuLabel>Clients</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="sidebar-business-work"
            isActive={selectedView === "work"}
            onClick={onSelectWork}
            tooltip="Work"
            type="button"
          >
            <ListTodo aria-hidden="true" />
            <SidebarMenuLabel>Work</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {BUSINESS_DESTINATIONS.map(([href, label, Icon]) => {
          const isCurrent = isDestinationPath(location.pathname, href);
          return (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton asChild isActive={isCurrent} tooltip={label}>
                <a
                  href={`#${href}`}
                  aria-current={
                    selectedView === "business" && isCurrent
                      ? "page"
                      : undefined
                  }
                >
                  <Icon aria-hidden="true" />
                  <SidebarMenuLabel>{label}</SidebarMenuLabel>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </>
  );
}
