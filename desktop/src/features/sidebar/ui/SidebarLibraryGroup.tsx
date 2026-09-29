import { LayoutTemplate } from "lucide-react";

import { SidebarNavigationGroup } from "@/features/sidebar/ui/SidebarNavigationGroup";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import { FeatureGate } from "@/shared/features";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

export function SidebarLibraryGroup({
  onSelectSettings,
}: {
  onSelectSettings: AppSidebarProps["onSelectSettings"];
}) {
  return (
    <SidebarNavigationGroup
      defaultExpanded={false}
      label="Library"
      testId="sidebar-nav-library"
    >
      <FeatureGate feature="channel-templates">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="text-xs pl-7"
              data-testid="sidebar-blocks-templates"
              onClick={() => onSelectSettings("channel-templates")}
              tooltip="Blocks & templates"
              type="button"
            >
              <LayoutTemplate className="h-4 w-4" />
              <SidebarMenuLabel>Blocks &amp; templates</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </FeatureGate>
    </SidebarNavigationGroup>
  );
}
