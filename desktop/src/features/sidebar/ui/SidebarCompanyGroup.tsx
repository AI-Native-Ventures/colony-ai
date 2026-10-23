import { useCompanyTeamCountQuery } from "@/features/company-team/teamRelay";
import { FeatureGate } from "@/shared/features";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import { SidebarNavigationGroup } from "@/features/sidebar/ui/SidebarNavigationGroup";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import { CompanyIcon } from "@/shared/ui/colonyIcons";

type SidebarCompanyGroupProps = Pick<
  AppSidebarProps,
  | "onSelectAgents"
  | "onSelectGoals"
  | "onSelectTeam"
  | "onSelectWork"
  | "onSelectWorkflows"
  | "selectedView"
>;

export function SidebarCompanyGroup({
  onSelectAgents,
  onSelectGoals,
  onSelectTeam,
  onSelectWork,
  onSelectWorkflows,
  selectedView,
}: SidebarCompanyGroupProps) {
  const teamCountQuery = useCompanyTeamCountQuery();
  const teamCount = teamCountQuery.data?.membershipSnapshotFound
    ? teamCountQuery.data.memberCount
    : null;

  return (
    <SidebarNavigationGroup
      defaultExpanded={false}
      expandForActiveRoute={
        selectedView === "agents" ||
        selectedView === "goals" ||
        selectedView === "team" ||
        selectedView === "work" ||
        selectedView === "workflows"
      }
      icon={<CompanyIcon />}
      label="Company"
      testId="sidebar-nav-company"
    >
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="sidebar-navigation-child"
            data-testid="sidebar-company-team"
            isActive={selectedView === "team"}
            onClick={onSelectTeam}
            tooltip="Team"
            type="button"
          >
            <SidebarMenuLabel>Team</SidebarMenuLabel>
          </SidebarMenuButton>
          {teamCount !== null ? (
            <SidebarMenuBadge data-testid="sidebar-team-count">
              {teamCount}
            </SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="sidebar-navigation-child"
            data-testid="sidebar-company-agents"
            isActive={selectedView === "agents"}
            onClick={onSelectAgents}
            tooltip="Agents"
            type="button"
          >
            <SidebarMenuLabel>Agents</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="sidebar-navigation-child"
            data-testid="sidebar-company-goals"
            isActive={selectedView === "goals"}
            onClick={onSelectGoals}
            tooltip="Goals"
            type="button"
          >
            <SidebarMenuLabel>Goals</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="sidebar-navigation-child"
            data-testid="sidebar-company-work"
            isActive={selectedView === "work"}
            onClick={onSelectWork}
            tooltip="Work"
            type="button"
          >
            <SidebarMenuLabel>Work</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <FeatureGate feature="workflows">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="sidebar-navigation-child"
              data-testid="open-workflows-view"
              isActive={selectedView === "workflows"}
              onClick={onSelectWorkflows}
              tooltip="Workflows"
              type="button"
            >
              <SidebarMenuLabel>Workflows</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </FeatureGate>
    </SidebarNavigationGroup>
  );
}
