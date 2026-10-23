import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import { FeatureGate } from "@/shared/features";
import { LibraryIcon } from "@/shared/ui/colonyIcons";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

/**
 * Library is one row that opens Blocks & templates. It used to be a
 * collapsed group with that single child; the Colony 3.0 sidebar shows it as
 * a destination of its own.
 */
export function SidebarLibraryGroup({
  isActive = false,
  onSelectSettings,
}: {
  isActive?: boolean;
  onSelectSettings: AppSidebarProps["onSelectSettings"];
}) {
  return (
    <FeatureGate feature="channel-templates">
      <SidebarMenu data-testid="sidebar-nav-library">
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="sidebar-blocks-templates"
            isActive={isActive}
            onClick={() => onSelectSettings("channel-templates")}
            tooltip="Library"
            type="button"
          >
            <LibraryIcon />
            <SidebarMenuLabel>Library</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </FeatureGate>
  );
}
