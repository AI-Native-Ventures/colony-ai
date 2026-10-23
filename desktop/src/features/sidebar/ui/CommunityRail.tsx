import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCheck, Link2, Settings2, Ticket } from "lucide-react";
import * as React from "react";

import type { Community } from "@/features/communities/types";
import { EditCommunityDialog } from "@/features/communities/ui/EditCommunityDialog";
import { useCommunityIcons } from "@/features/communities/useCommunityIcons";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import {
  useCommunityUnread,
  type CommunityUnreadState,
} from "@/features/communities/useCommunityUnread";
import { useAppShell } from "@/app/AppShellContext";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { getInitials } from "@/shared/lib/initials";
import { isMacPlatform } from "@/shared/lib/platform";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";
import { ColonyField } from "@/shared/ui/ColonyField";
import { PlusIcon } from "@/shared/ui/colonyIcons";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

type CommunityRailProps = {
  communities: Community[];
  activeCommunityId: string | null;
  onSwitchCommunity: (id: string) => void;
  onAddCommunity: () => void;
  onUpdateCommunity: (
    id: string,
    updates: Partial<Pick<Community, "name" | "relayUrl" | "token">>,
  ) => void;
  onReorderCommunities: (orderedIds: string[]) => void;
};

const MAX_BADGE = 99;

/**
 * Presentation decisions for one community button, derived from its observed
 * mention state. Pure so it can be unit-tested without a DOM. The `state` guard
 * ensures we NEVER render any indicator for a relay we could not observe
 * (`unknown`/`loading`/`error`) — only a `ready` observation is trusted.
 *
 * Two-tier indicator system:
 * - `showBadge`: numeric mention count (mentions/thread-replies present).
 * - `showDot`: plain unread dot when there are regular channel unreads but no
 *   mentions. Mutually exclusive with `showBadge` by construction.
 */
export function communityRailIndicators(unread: CommunityUnreadState): {
  mentionCount: number;
  showBadge: boolean;
  showDot: boolean;
  pending: boolean;
  badgeLabel: string;
} {
  const observed = unread.state === "ready";
  const mentionCount = observed ? (unread.count ?? 0) : 0;
  const showBadge = mentionCount > 0;
  const showDot = observed && unread.hasUnread && !showBadge;
  return {
    mentionCount,
    showBadge,
    showDot,
    pending: unread.state === "unknown" || unread.state === "loading",
    badgeLabel:
      mentionCount > MAX_BADGE ? `${MAX_BADGE}+` : String(mentionCount),
  };
}

function CommunityButton({
  community,
  isActive,
  unread,
  iconUrl,
  onSwitch,
  menu,
  dragListeners,
  dragAttributes,
  isDragging,
}: {
  community: Community;
  isActive: boolean;
  unread: CommunityUnreadState;
  iconUrl: string | null;
  onSwitch: () => void;
  menu: React.ReactNode;
  dragListeners?: React.HTMLAttributes<HTMLElement>;
  dragAttributes?: React.HTMLAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const { mentionCount, showBadge, showDot, badgeLabel } =
    communityRailIndicators(unread);

  const tooltipLabel = showBadge
    ? `${community.name}, ${mentionCount} mention${mentionCount === 1 ? "" : "s"}`
    : showDot
      ? `${community.name}, unread`
      : community.name;

  return (
    <ContextMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <button
              aria-current={isActive ? "true" : undefined}
              aria-label={tooltipLabel}
              className={cn(
                "colony-rail-button touch-none outline-hidden focus:outline-none focus-visible:outline-none",
                isDragging && "opacity-30",
              )}
              data-testid={`community-rail-button-${community.id}`}
              onClick={onSwitch}
              type="button"
              {...dragAttributes}
              {...dragListeners}
            >
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="colony-rail-active-bar"
                  data-testid={`community-rail-active-${community.id}`}
                />
              ) : null}
              {iconUrl ? (
                <img
                  alt=""
                  data-testid={`community-rail-icon-${community.id}`}
                  draggable={false}
                  src={iconUrl}
                />
              ) : isActive ? (
                // The open community reads as its single-letter brand mark,
                // the same letter the sidebar header shows.
                (community.name.trim().slice(0, 1).toUpperCase() ?? "C") || "C"
              ) : (
                getInitials(community.name) || "C"
              )}
              {showBadge ? (
                <span
                  className="colony-rail-badge"
                  data-testid={`community-rail-mentions-${community.id}`}
                >
                  {badgeLabel}
                </span>
              ) : showDot ? (
                <span
                  className="colony-rail-dot"
                  data-testid={`community-rail-unread-dot-${community.id}`}
                >
                  <span className="sr-only">unread</span>
                </span>
              ) : null}
            </button>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent data-testid={`community-rail-menu-${community.id}`}>
        {menu}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CommunityDragOverlay({
  community,
  iconUrl,
}: {
  community: Community;
  iconUrl: string | null;
}) {
  return (
    <div
      className="colony-rail-button cursor-grabbing opacity-90 shadow-lg"
      data-buzz-flat
    >
      {iconUrl ? (
        <img
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          src={iconUrl}
        />
      ) : (
        getInitials(community.name) || "C"
      )}
    </div>
  );
}

function SortableCommunityButton({
  community,
  activeCommunityId,
  iconsByCommunity,
  unreadByCommunity,
  canInvite,
  onInvite,
  onSwitchCommunity,
  onMarkAllRead,
  onSetEditingCommunity,
}: {
  community: Community;
  activeCommunityId: string | null;
  iconsByCommunity: Record<string, string | null | undefined>;
  unreadByCommunity: Record<string, CommunityUnreadState>;
  canInvite: boolean;
  onInvite: () => void;
  onSwitchCommunity: (id: string) => void;
  onMarkAllRead: (community: Community) => void;
  onSetEditingCommunity: (community: Community) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: community.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <CommunityButton
        community={community}
        dragAttributes={attributes}
        dragListeners={listeners}
        iconUrl={iconsByCommunity[community.id] ?? null}
        isActive={community.id === activeCommunityId}
        isDragging={isDragging}
        menu={
          <>
            <ContextMenuItem onClick={() => onMarkAllRead(community)}>
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => {
                void writeTextToClipboard(community.relayUrl);
              }}
            >
              <Link2 className="h-4 w-4" />
              Copy community URL
            </ContextMenuItem>
            {canInvite ? (
              <ContextMenuItem onClick={onInvite}>
                <Ticket className="h-4 w-4" />
                Invite to community
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onClick={() => onSetEditingCommunity(community)}>
              <Settings2 className="h-4 w-4" />
              Community settings
            </ContextMenuItem>
          </>
        }
        onSwitch={() => onSwitchCommunity(community.id)}
        unread={
          unreadByCommunity[community.id] ?? {
            hasUnread: false,
            state: "unknown",
          }
        }
      />
    </div>
  );
}

/**
 * Discord/Slack-style vertical rail of communities on the far left of the app.
 * Shows a mention-count badge for inactive communities (observed via
 * `useCommunityUnread`) and switches relays on click. Right-click opens a
 * per-community menu for read state, community URL, invites, and settings.
 *
 * Hidden entirely with a single community — a rail of one adds no value.
 */
export function CommunityRail({
  communities,
  activeCommunityId,
  onSwitchCommunity,
  onAddCommunity,
  onUpdateCommunity,
  onReorderCommunities,
}: CommunityRailProps) {
  const isFullscreen = useIsFullscreen();
  const { unreadByCommunity, markCommunityRead } = useCommunityUnread(
    communities,
    activeCommunityId,
  );
  const iconsByCommunity = useCommunityIcons(communities);
  const { markAllChannelsRead, onOpenSettings } = useAppShell();
  const myMembershipQuery = useMyRelayMembershipLookupQuery();
  const activeRole = myMembershipQuery.data?.membership?.role;
  const canInviteToActiveCommunity =
    onOpenSettings !== null &&
    (activeRole === "owner" || activeRole === "admin");
  const [editingCommunity, setEditingCommunity] =
    React.useState<Community | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (communities.length <= 1) {
    return null;
  }

  const communityIds = communities.map((c) => c.id);
  const draggingCommunity = draggingId
    ? (communities.find((c) => c.id === draggingId) ?? null)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = communityIds.indexOf(active.id as string);
    const newIdx = communityIds.indexOf(over.id as string);
    if (oldIdx !== -1 && newIdx !== -1) {
      onReorderCommunities(arrayMove(communityIds, oldIdx, newIdx));
    }
  };

  const handleMarkAllRead = (community: Community) => {
    if (community.id === activeCommunityId) {
      markAllChannelsRead();
      return;
    }
    markCommunityRead(community.id).catch((error) => {
      console.warn(
        `[CommunityRail] mark all read failed community=${community.id}:`,
        error,
      );
    });
  };

  return (
    <nav
      aria-label="Communities"
      // The native window buttons sit over the rail's top-left corner.
      data-mac-chrome={isMacPlatform() && !isFullscreen ? "true" : undefined}
      data-testid="community-rail"
    >
      <ColonyField variant="rail" />
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        <SortableContext
          items={communityIds}
          strategy={verticalListSortingStrategy}
        >
          {communities.map((community) => (
            <SortableCommunityButton
              key={community.id}
              activeCommunityId={activeCommunityId}
              canInvite={
                community.id === activeCommunityId && canInviteToActiveCommunity
              }
              community={community}
              iconsByCommunity={iconsByCommunity}
              unreadByCommunity={unreadByCommunity}
              onInvite={() => onOpenSettings?.("community-members")}
              onMarkAllRead={handleMarkAllRead}
              onSetEditingCommunity={setEditingCommunity}
              onSwitchCommunity={onSwitchCommunity}
            />
          ))}
        </SortableContext>
        <DragOverlay>
          {draggingCommunity ? (
            <CommunityDragOverlay
              community={draggingCommunity}
              iconUrl={iconsByCommunity[draggingCommunity.id] ?? null}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Add community"
            className="colony-rail-add outline-hidden focus:outline-none focus-visible:outline-none"
            data-testid="community-rail-add"
            onClick={onAddCommunity}
            type="button"
          >
            <PlusIcon size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Add community
        </TooltipContent>
      </Tooltip>
      <EditCommunityDialog
        onOpenChange={(open) => {
          if (!open) setEditingCommunity(null);
        }}
        onSave={onUpdateCommunity}
        open={editingCommunity !== null}
        community={editingCommunity}
        showIconEditor={editingCommunity?.id === activeCommunityId}
      />
    </nav>
  );
}
