import * as React from "react";
import { FactoryNavigator } from "@/features/factory/ui/FactoryNavigator";
import { SidebarProjectsSection } from "@/features/sidebar/ui/SidebarProjectsSection";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import type { FactoryScope } from "@/shared/api/factoryRuntime";
import { FactoryIcon } from "@/shared/ui/colonyIcons";

/** App-shell entry for the existing factory and project routes. */
export function SidebarSoftwareFactoryGroup({
  isActive,
  isProjectsActive,
  selectedChannelId,
  onSelectFactory,
  scope,
}: {
  isActive: boolean;
  isProjectsActive: boolean;
  selectedChannelId: string | null;
  onSelectFactory: () => void;
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
            data-testid="open-factory-view"
            isActive={isActive}
            onClick={onSelectFactory}
            tooltip="Software Factory"
            type="button"
          >
            <FactoryIcon />
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
          {isActive ? <FactoryNavigator scope={scope} /> : null}
        </section>
      ) : null}
    </section>
  );
}
