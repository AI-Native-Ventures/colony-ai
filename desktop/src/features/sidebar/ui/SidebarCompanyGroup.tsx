import { ListTodo, Target, Workflow } from "lucide-react";

import { FeatureGate } from "@/shared/features";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import { SidebarNavigationGroup } from "@/features/sidebar/ui/SidebarNavigationGroup";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";

type SidebarCompanyGroupProps = Pick<
  AppSidebarProps,
  "onSelectGoals" | "onSelectWork" | "onSelectWorkflows" | "selectedView"
>;

export function SidebarCompanyGroup({
  onSelectGoals,
  onSelectWork,
  onSelectWorkflows,
  selectedView,
}: SidebarCompanyGroupProps) {
  return (
    <SidebarNavigationGroup
      defaultExpanded
      expandForActiveRoute={
        selectedView === "goals" ||
        selectedView === "work" ||
        selectedView === "workflows"
      }
      label="Company"
      testId="sidebar-nav-company"
    >
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="sidebar-navigation-child pl-7"
            data-testid="sidebar-company-goals"
            isActive={selectedView === "goals"}
            onClick={onSelectGoals}
            tooltip="Goals"
            type="button"
          >
            <Target className="h-4 w-4" />
            <SidebarMenuLabel>Goals</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="sidebar-navigation-child pl-7"
            data-testid="sidebar-company-work"
            isActive={selectedView === "work"}
            onClick={onSelectWork}
            tooltip="Work"
            type="button"
          >
            <ListTodo className="h-4 w-4" />
            <SidebarMenuLabel>Work</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <FeatureGate feature="workflows">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="text-xs pl-7"
              data-testid="open-workflows-view"
              isActive={selectedView === "workflows"}
              onClick={onSelectWorkflows}
              tooltip="Workflows"
              type="button"
            >
              <Workflow className="h-4 w-4" />
              <SidebarMenuLabel>Workflows</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </FeatureGate>
    </SidebarNavigationGroup>
  );
}
