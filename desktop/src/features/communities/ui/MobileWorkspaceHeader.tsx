import { ChevronDown, Menu } from "lucide-react";

import type { Community } from "@/features/communities/types";
import { WorkspaceMark } from "@/features/communities/ui/WorkspaceMark";
import { WorkspaceSwitcherMenu } from "@/features/communities/ui/WorkspaceSwitcherMenu";
import { useSidebar } from "@/shared/ui/sidebar";

type MobileWorkspaceHeaderProps = {
  activeWorkspace: Community | null;
  workspaces: Community[];
  onCopyWorkspaceLink: () => void;
  onCreateWorkspace: () => void;
  onInvitePeople: () => void;
  onJoinWorkspace: () => void;
  onOpenWorkspaceSettings: () => void;
  onSwitchWorkspace: (id: string) => void;
};

export function MobileWorkspaceHeader({
  activeWorkspace,
  workspaces,
  onCopyWorkspaceLink,
  onCreateWorkspace,
  onInvitePeople,
  onJoinWorkspace,
  onOpenWorkspaceSettings,
  onSwitchWorkspace,
}: MobileWorkspaceHeaderProps) {
  const sidebar = useSidebar();
  const workspaceName = activeWorkspace?.name ?? "No workspace";
  const initial = workspaceName.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <div
      className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-12"
      data-testid="mobile-workspace-header"
    >
      <div className="min-w-0 flex-1">
        <WorkspaceSwitcherMenu
          activeWorkspace={activeWorkspace}
          onCopyWorkspaceLink={onCopyWorkspaceLink}
          onCreateWorkspace={onCreateWorkspace}
          onInvitePeople={onInvitePeople}
          onJoinWorkspace={onJoinWorkspace}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onSwitchWorkspace={onSwitchWorkspace}
          renderTrigger={({ open }) => (
            <button
              aria-expanded={open}
              aria-haspopup="dialog"
              aria-label={`Open workspace menu, current workspace ${workspaceName}`}
              className="flex min-h-10 max-w-full items-center gap-2.5 rounded-xl text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="mobile-workspace-switcher"
              type="button"
            >
              <WorkspaceMark
                className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-sidebar text-sm font-bold text-sidebar-foreground"
                communityIconFit="cover"
                communityId={activeWorkspace?.id}
                dataTestId="mobile-workspace-mark"
                fallbackContent={<span>{initial}</span>}
                imageFit="contain"
                name={workspaceName}
                relayUrl={activeWorkspace?.relayUrl}
              />
              <span className="truncate text-base font-semibold">
                {workspaceName}
              </span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
            </button>
          )}
          renderWorkspaceMark={(workspace) => (
            <WorkspaceMark
              className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-sidebar text-sm font-bold text-sidebar-foreground"
              communityIconFit="cover"
              communityId={workspace.id}
              dataTestId={`mobile-workspace-menu-mark-${workspace.id}`}
              fallbackContent={
                <span>
                  {workspace.name.trim().slice(0, 1).toUpperCase() || "C"}
                </span>
              }
              imageFit="contain"
              name={workspace.name}
              relayUrl={workspace.relayUrl}
            />
          )}
          workspaces={workspaces}
        />
      </div>
      <button
        aria-label="Open navigation"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="mobile-open-navigation"
        onClick={sidebar.toggleSidebar}
        type="button"
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </button>
    </div>
  );
}
