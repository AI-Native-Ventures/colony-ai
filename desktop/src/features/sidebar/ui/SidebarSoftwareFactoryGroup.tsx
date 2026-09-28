import * as React from "react";
import { Cpu, Factory } from "lucide-react";

import { FactoryNavigator } from "@/features/factory/ui/FactoryNavigator";
import { SidebarProjectsSection } from "@/features/sidebar/ui/SidebarProjectsSection";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import type { SettingsSection } from "@/features/settings/ui/SettingsPanels";
import type { FactoryScope } from "@/shared/api/factoryRuntime";

/** App-shell entry for the existing factory, project, and shared-compute routes. */
export function SidebarSoftwareFactoryGroup({
  isActive,
  isProjectsActive,
  selectedChannelId,
  onSelectFactory,
  onSelectSettings,
  scope,
}: {
  isActive: boolean;
  isProjectsActive: boolean;
  selectedChannelId: string | null;
  onSelectFactory: () => void;
  onSelectSettings: (section?: SettingsSection) => void;
  scope: FactoryScope;
}) {
  const [activeProjectChannelId, setActiveProjectChannelId] = React.useState<
    string | null
  >(null);
  const showFactoryDestinations =
    isActive ||
    isProjectsActive ||
    (selectedChannelId !== null &&
      selectedChannelId === activeProjectChannelId);

  return (
    <section
      className="sidebar-navigation-group sidebar-software-factory-group"
      data-expanded={showFactoryDestinations}
      data-testid="sidebar-software-factory-group"
    >
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="text-xs data-[active=true]:font-normal"
            data-testid="open-factory-view"
            isActive={isActive}
            onClick={onSelectFactory}
            tooltip="Software Factory"
            type="button"
          >
            <Factory className="h-4 w-4" />
            <SidebarMenuLabel>Software Factory</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {showFactoryDestinations ? (
        <section
          aria-label="Software Factory destinations"
          className="sidebar-software-factory-content"
          data-testid="sidebar-software-factory-content"
        >
          <SidebarProjectsSection
            onProjectChannelSelect={setActiveProjectChannelId}
          />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="sidebar-navigation-child pl-7"
                data-testid="sidebar-shared-compute"
                onClick={() => onSelectSettings("compute")}
                tooltip="Shared compute"
                type="button"
              >
                <Cpu className="h-4 w-4" />
                <SidebarMenuLabel>Shared compute</SidebarMenuLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {isActive ? <FactoryNavigator scope={scope} /> : null}
        </section>
      ) : null}
    </section>
  );
}
