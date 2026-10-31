import * as React from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Link2,
  LogOut,
  Plus,
  Settings2,
  UserRoundPlus,
} from "lucide-react";

import { toast } from "sonner";

import type { LeaveCommunityResult } from "@/features/communities/leaveCommunity";
import type { Community } from "@/features/communities/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { isMacPlatform } from "@/shared/lib/platform";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";

type WorkspaceSwitcherMenuProps = {
  activeWorkspace: Community | null;
  workspaces: Community[];
  renderTrigger: (state: {
    open: boolean;
    mobile: boolean;
  }) => React.ReactElement;
  renderWorkspaceMark: (workspace: Community) => React.ReactNode;
  onSwitchWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onJoinWorkspace: () => void;
  onOpenWorkspaceSettings: () => void;
  onInvitePeople: () => void;
  onCopyWorkspaceLink: () => void;
  onRemoveWorkspace: (id: string) => Promise<LeaveCommunityResult | undefined>;
};

function workspaceAddress(relayUrl: string): string {
  try {
    return new URL(relayUrl).host;
  } catch {
    return relayUrl;
  }
}

function workspaceShortcut(index: number): string | null {
  if (index >= 9) return null;
  return `${isMacPlatform() ? "⌘" : "Ctrl+"}${index + 1}`;
}

function WorkspaceChoices({
  activeWorkspace,
  workspaces,
  renderWorkspaceMark,
  onChoose,
}: {
  activeWorkspace: Community | null;
  workspaces: Community[];
  renderWorkspaceMark: (workspace: Community) => React.ReactNode;
  onChoose: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5" data-testid="workspace-menu-list">
      {workspaces.map((workspace, index) => {
        const isActive = workspace.id === activeWorkspace?.id;
        const shortcut = workspaceShortcut(index);
        const address = workspaceAddress(workspace.relayUrl);
        return (
          <button
            aria-current={isActive ? "true" : undefined}
            aria-label={`Open workspace ${workspace.name}, ${address}${isActive ? ", current workspace" : ""}${shortcut ? `, ${shortcut}` : ""}`}
            className="flex min-h-16 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-hidden transition-colors hover:bg-accent focus-visible:bg-accent"
            data-testid={`workspace-menu-item-${workspace.id}`}
            key={workspace.id}
            onClick={() => onChoose(workspace.id)}
            type="button"
          >
            {renderWorkspaceMark(workspace)}
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-semibold">
                {workspace.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {address}
              </span>
            </span>
            {isActive ? (
              <Check
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-emerald-600"
                strokeWidth={3}
              />
            ) : null}
            {shortcut ? (
              <span
                aria-hidden="true"
                className="shrink-0 rounded-md bg-muted px-1.5 py-1 text-xs text-muted-foreground"
              >
                {shortcut}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function WorkspaceAction({
  children,
  description,
  icon,
  onSelect,
  testId,
}: {
  children: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      aria-label={`${children}. ${description}`}
      className="flex min-h-16 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-hidden transition-colors hover:bg-accent focus-visible:bg-accent"
      data-testid={testId}
      onClick={onSelect}
      type="button"
    >
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-sm font-semibold">{children}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

function WorkspaceActions({
  onOpenWorkspaceSettings,
  onInvitePeople,
  onCopyWorkspaceLink,
  onLeaveWorkspace,
  leaveError,
  isLeaving,
  mobile = false,
}: {
  onOpenWorkspaceSettings: () => void;
  onInvitePeople: () => void;
  onCopyWorkspaceLink: () => void;
  onLeaveWorkspace: () => void;
  leaveError: string | null;
  isLeaving: boolean;
  mobile?: boolean;
}) {
  if (mobile) {
    return (
      <div className="flex flex-col">
        <button
          aria-label="Workspace settings"
          className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold outline-hidden transition-colors hover:bg-accent focus-visible:bg-accent"
          data-testid="workspace-settings-action"
          onClick={onOpenWorkspaceSettings}
          type="button"
        >
          <Settings2 aria-hidden="true" className="h-5 w-5" />
          <span className="flex-1">Workspace settings</span>
          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 text-muted-foreground"
          />
        </button>
        <button
          aria-label="Leave workspace"
          className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-destructive outline-hidden transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
          data-testid="workspace-leave-action"
          disabled={isLeaving}
          onClick={onLeaveWorkspace}
          type="button"
        >
          <LogOut aria-hidden="true" className="h-5 w-5" />
          <span className="flex-1">
            {isLeaving ? "Leaving workspace…" : "Leave workspace"}
          </span>
        </button>
        {leaveError ? (
          <p
            className="px-3 py-2 text-xs text-destructive"
            data-testid="workspace-leave-error"
            role="alert"
          >
            {leaveError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <DropdownMenuSeparator className="my-1.5" />
      <DropdownMenuItem asChild>
        <button
          aria-label="Workspace settings"
          className="flex w-full items-center gap-3"
          data-testid="workspace-settings-action"
          onClick={onOpenWorkspaceSettings}
          type="button"
        >
          <Settings2 aria-hidden="true" className="h-4 w-4" />
          <span>Workspace settings</span>
        </button>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <button
          aria-label="Invite people"
          className="flex w-full items-center gap-3"
          data-testid="workspace-invite-action"
          onClick={onInvitePeople}
          type="button"
        >
          <UserRoundPlus aria-hidden="true" className="h-4 w-4" />
          <span>Invite people</span>
        </button>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <button
          aria-label="Copy workspace link"
          className="flex w-full items-center gap-3"
          data-testid="workspace-copy-link-action"
          onClick={onCopyWorkspaceLink}
          type="button"
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          <span>Copy workspace link</span>
        </button>
      </DropdownMenuItem>
      <DropdownMenuSeparator className="my-1.5" />
      <DropdownMenuItem
        aria-label="Leave workspace"
        className="text-destructive focus:text-destructive"
        data-testid="workspace-leave-action"
        disabled={isLeaving}
        onSelect={(event) => {
          event.preventDefault();
          onLeaveWorkspace();
        }}
      >
        <LogOut aria-hidden="true" className="h-4 w-4" />
        <span>{isLeaving ? "Leaving workspace…" : "Leave workspace"}</span>
      </DropdownMenuItem>
      {leaveError ? (
        <p
          className="px-2 py-2 text-xs text-destructive"
          data-testid="workspace-leave-error"
          role="alert"
        >
          {leaveError}
        </p>
      ) : null}
    </>
  );
}

export function WorkspaceSwitcherMenu({
  activeWorkspace,
  workspaces,
  renderTrigger,
  renderWorkspaceMark,
  onSwitchWorkspace,
  onCreateWorkspace,
  onJoinWorkspace,
  onOpenWorkspaceSettings,
  onInvitePeople,
  onCopyWorkspaceLink,
  onRemoveWorkspace,
}: WorkspaceSwitcherMenuProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [leaveError, setLeaveError] = React.useState<string | null>(null);
  const [isLeaving, setIsLeaving] = React.useState(false);
  const menuContentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open || isMobile) return;
    menuContentRef.current
      ?.querySelector<HTMLElement>("[role='menuitem']")
      ?.focus();
  }, [isMobile, open]);

  const chooseWorkspace = React.useCallback(
    (id: string) => {
      setOpen(false);
      onSwitchWorkspace(id);
    },
    [onSwitchWorkspace],
  );

  const leaveWorkspace = React.useCallback(async () => {
    if (!activeWorkspace || isLeaving) return;
    setIsLeaving(true);
    setLeaveError(null);
    try {
      const result = await onRemoveWorkspace(activeWorkspace.id);
      setOpen(false);
      if (result?.status === "already-absent") {
        toast("Workspace removed", {
          description:
            "You were no longer a member, so Colony removed the workspace from this device.",
        });
      }
    } catch (error) {
      setLeaveError(
        error instanceof Error
          ? error.message
          : "Couldn't leave the workspace. Try again.",
      );
      setOpen(true);
    } finally {
      setIsLeaving(false);
    }
  }, [activeWorkspace, isLeaving, onRemoveWorkspace]);

  const renderActions = (mobile = false) => (
    <WorkspaceActions
      mobile={mobile}
      onCopyWorkspaceLink={() => {
        setOpen(false);
        onCopyWorkspaceLink();
      }}
      onInvitePeople={() => {
        setOpen(false);
        onInvitePeople();
      }}
      onOpenWorkspaceSettings={() => {
        setOpen(false);
        onOpenWorkspaceSettings();
      }}
      onLeaveWorkspace={() => void leaveWorkspace()}
      leaveError={leaveError}
      isLeaving={isLeaving}
    />
  );

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetTrigger asChild>
          {renderTrigger({ mobile: true, open })}
        </SheetTrigger>
        <SheetContent
          aria-describedby={undefined}
          className="flex max-h-[82vh] flex-col gap-4 rounded-t-3xl border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] pt-4"
          data-testid="workspace-switcher-sheet"
          side="bottom"
        >
          <div
            aria-hidden="true"
            className="mx-auto h-1.5 w-10 rounded-full bg-muted"
          />
          <SheetHeader className="text-left">
            <SheetTitle className="text-lg font-bold">
              Switch workspace
            </SheetTitle>
          </SheetHeader>
          <div className="max-h-[54vh] overflow-y-auto rounded-2xl border border-border">
            <WorkspaceChoices
              activeWorkspace={activeWorkspace}
              onChoose={chooseWorkspace}
              renderWorkspaceMark={renderWorkspaceMark}
              workspaces={workspaces}
            />
            <div className="flex flex-col gap-1 px-1 pb-1">
              <WorkspaceAction
                description="A separate space for another business"
                icon={<Plus className="h-5 w-5" />}
                onSelect={() => {
                  setOpen(false);
                  onCreateWorkspace();
                }}
                testId="workspace-create-action"
              >
                Create a workspace
              </WorkspaceAction>
              <WorkspaceAction
                description="Paste a link someone sent you"
                icon={<Link2 className="h-5 w-5" />}
                onSelect={() => {
                  setOpen(false);
                  onJoinWorkspace();
                }}
                testId="workspace-join-action"
              >
                Join with an invite link
              </WorkspaceAction>
            </div>
          </div>
          <div className="mt-1">{renderActions(true)}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        {renderTrigger({ mobile: false, open })}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label="Workspace menu"
        className="w-[360px] rounded-2xl p-2"
        data-testid="workspace-switcher-menu"
        onCloseAutoFocus={(event) => event.preventDefault()}
        ref={menuContentRef}
        side="bottom"
        sideOffset={8}
      >
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((workspace, index) => {
          const isActive = workspace.id === activeWorkspace?.id;
          const shortcut = workspaceShortcut(index);
          const address = workspaceAddress(workspace.relayUrl);
          return (
            <DropdownMenuItem
              aria-current={isActive ? "true" : undefined}
              aria-label={`Open workspace ${workspace.name}, ${address}${isActive ? ", current workspace" : ""}${shortcut ? `, ${shortcut}` : ""}`}
              className="min-h-12 rounded-xl px-2.5 py-2 focus:bg-accent"
              data-testid={`workspace-menu-item-${workspace.id}`}
              key={workspace.id}
              onSelect={() => onSwitchWorkspace(workspace.id)}
            >
              {renderWorkspaceMark(workspace)}
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-semibold">
                  {workspace.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {address}
                </span>
              </span>
              {isActive ? (
                <Check
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-emerald-600"
                  strokeWidth={3}
                />
              ) : null}
              {shortcut ? (
                <DropdownMenuShortcut aria-hidden="true">
                  {shortcut}
                </DropdownMenuShortcut>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem asChild>
          <button
            aria-label="Create a workspace. A separate space for another business"
            className="flex w-full items-center gap-3"
            data-testid="workspace-create-action"
            onClick={() => {
              setOpen(false);
              onCreateWorkspace();
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-sm font-semibold">Create a workspace</span>
              <span className="text-xs text-muted-foreground">
                A separate space for another business
              </span>
            </span>
          </button>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <button
            aria-label="Join with an invite link. Paste a link someone sent you"
            className="flex w-full items-center gap-3"
            data-testid="workspace-join-action"
            onClick={() => {
              setOpen(false);
              onJoinWorkspace();
            }}
            type="button"
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-sm font-semibold">
                Join with an invite link
              </span>
              <span className="text-xs text-muted-foreground">
                Paste a link someone sent you
              </span>
            </span>
          </button>
        </DropdownMenuItem>
        {renderActions()}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
