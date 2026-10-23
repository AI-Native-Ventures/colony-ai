import { ArchiveRestore, DoorOpen, Pin as PinIcon } from "lucide-react";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";

import {
  useArchiveChannelMutation,
  useCanvasQuery,
  useChannelDetailsQuery,
  useChannelMembersQuery,
  useDeleteChannelMutation,
  useJoinChannelMutation,
  useLeaveChannelMutation,
  useUnarchiveChannelMutation,
  useUpdateChannelMutation,
} from "@/features/channels/hooks";
import { compareMembersByRole } from "@/features/channels/lib/memberUtils";
import { DEFAULT_EPHEMERAL_TTL_SECONDS } from "@/features/channels/lib/ephemeralChannel";
import type { Channel, ChannelMember } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  AuxiliaryPanelContext,
  type AuxiliaryPanelMode,
  getAuxiliaryPanelMode,
} from "@/shared/layout/AuxiliaryPanel";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import { ChevronLeftIcon as ChevronLeftGlyph } from "@/shared/ui/colonyIcons";
import { LeaveChannelAlertDialog } from "@/features/sidebar/ui/ChannelSectionDialogs";
import { useScrollBoundaryLock } from "@/shared/hooks/useScrollBoundaryLock";
import { useDeferredModalOpen } from "@/shared/ui/deferredModalOpen";
import {
  OverlayPanelBackdrop,
  PANEL_BASE_CLASS,
  PANEL_ENTER_MOTION_CLASS,
  PANEL_OVERLAY_CLASS,
} from "@/shared/ui/OverlayPanelBackdrop";
import { ChannelCanvas } from "./ChannelCanvas";
import { CHANNEL_FORM_LABEL_CLASS } from "./channelFormStyles";
import {
  ChannelTypeDetailRow,
  ChannelTypeSettings,
} from "./ChannelTypeSettings";
import { ChannelPermissionsSettings } from "./ChannelPermissionsSettings";
import {
  ActionFieldGroup,
  ActionFieldRow,
  ChannelHero,
  CopyFieldRow,
  EditableInfoFieldRow,
  FieldGroup,
  getMarkdownPreviewText,
  InfoFieldRow,
  IngressRow,
  SettingsMemberStack,
} from "./ChannelManagementSheetRows";
import {
  ArchiveGlyph,
  CanvasGlyph,
  LeaveRowGlyph,
  TrashGlyph,
} from "./dialogIcons";
import {
  ChannelDeleteConfirmationDialog,
  useChannelModerationCapabilities,
} from "./ChannelManagementModerationActions";

type ChannelManagementSheetProps = {
  channel: Channel | null;
  animateSplitEnter?: boolean;
  currentPubkey?: string;
  layout?: "overlay" | "split";
  onDeleted?: () => void;
  onOpenMembers?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  transparentChrome?: boolean;
};

export function ChannelManagementSheet({
  animateSplitEnter = false,
  channel,
  currentPubkey,
  layout = "overlay",
  onDeleted,
  onOpenMembers,
  onOpenChange,
  open,
  transparentChrome = false,
}: ChannelManagementSheetProps) {
  const navigate = useNavigate();
  const isSplitLayout = layout === "split";
  const auxiliaryPanelMode = getAuxiliaryPanelMode(
    isSplitLayout,
    !isSplitLayout,
  );
  const channelId = channel?.id ?? null;
  const detailsQuery = useChannelDetailsQuery(channelId, open);
  const membersQuery = useChannelMembersQuery(channelId, open);
  const canvasQuery = useCanvasQuery(channelId, channelId !== null && open);
  const updateChannelDetailsMutation = useUpdateChannelMutation(channelId);
  const archiveChannelMutation = useArchiveChannelMutation(channelId);
  const unarchiveChannelMutation = useUnarchiveChannelMutation(channelId);
  const deleteChannelMutation = useDeleteChannelMutation(channelId);
  const joinChannelMutation = useJoinChannelMutation(channelId);
  const leaveChannelMutation = useLeaveChannelMutation(channelId);

  const detail = detailsQuery.data ?? channel;
  const members = React.useMemo(() => {
    const currentMembers = membersQuery.data ?? [];
    return [...currentMembers].sort((left, right) =>
      compareMembersByRole(left, right, currentPubkey),
    );
  }, [currentPubkey, membersQuery.data]);
  const selfMember =
    members.find((member) => member.pubkey === currentPubkey) ?? null;
  const hasResolvedMembership = membersQuery.data !== undefined;

  const { canDeleteChannel, canManageChannel } =
    useChannelModerationCapabilities(membersQuery.data, currentPubkey, open);
  const canEditChannel = canManageChannel && detail?.channelType !== "dm";
  const canEditNarrative =
    canManageChannel && selfMember !== null && detail?.channelType !== "dm";
  const isArchived =
    detail?.archivedAt !== null && detail?.archivedAt !== undefined;
  const canJoin =
    hasResolvedMembership &&
    detail?.channelType !== "dm" &&
    detail?.visibility === "open" &&
    !isArchived &&
    selfMember === null;
  const canLeave =
    hasResolvedMembership &&
    detail?.channelType !== "dm" &&
    !isArchived &&
    selfMember !== null;
  const memberCount =
    members.length || detail?.memberCount || channel?.memberCount || 0;

  const [nameDraft, setNameDraft] = React.useState("");
  const [descriptionDraft, setDescriptionDraft] = React.useState("");
  const [isPrivateDraft, setIsPrivateDraft] = React.useState(false);
  const [isEphemeralDraft, setIsEphemeralDraft] = React.useState(false);
  const [ttlSecondsDraft, setTtlSecondsDraft] = React.useState(
    DEFAULT_EPHEMERAL_TTL_SECONDS,
  );
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [hasUserEditedChannelDraft, setHasUserEditedChannelDraft] =
    React.useState(false);
  const [activeView, setActiveView] = React.useState<"summary" | "canvas">(
    "summary",
  );
  const { cancelDeferredModalOpen, openNextFrame: openModalNextFrame } =
    useDeferredModalOpen();

  const openEditDialog = React.useCallback(() => {
    setIsEditDialogOpen(false);
    openModalNextFrame(() => setIsEditDialogOpen(true));
  }, [openModalNextFrame]);

  const openMembersDialog = React.useCallback(() => {
    if (!onOpenMembers) return;

    openModalNextFrame(onOpenMembers);
  }, [onOpenMembers, openModalNextFrame]);

  // Sync drafts from server only when the sheet opens or the channel changes -
  // not on every background refetch, which would clobber in-flight edits.
  const syncedForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      // Reset on close so the next open re-syncs from server.
      cancelDeferredModalOpen();
      syncedForRef.current = null;
      setIsDeleteDialogOpen(false);
      setIsEditDialogOpen(false);
      setActiveView("summary");
      return;
    }
    if (!detail) {
      return;
    }

    const key = detail.id;
    if (syncedForRef.current === key) {
      return;
    }
    syncedForRef.current = key;

    setNameDraft(detail.name);
    setDescriptionDraft(detail.description);
    setIsPrivateDraft(detail.visibility === "private");
    setIsEphemeralDraft(detail.ttlSeconds !== null);
    setTtlSecondsDraft(detail.ttlSeconds ?? DEFAULT_EPHEMERAL_TTL_SECONDS);
    setHasUserEditedChannelDraft(false);
    setActiveView("summary");
  }, [cancelDeferredModalOpen, detail, open]);

  if (!channel) {
    return null;
  }

  function handleDeleteDialogOpenChange(next: boolean) {
    deleteChannelMutation.reset();
    setIsDeleteDialogOpen(next);
  }

  async function handleDeleteChannel() {
    try {
      await deleteChannelMutation.mutateAsync();
      handleDeleteDialogOpenChange(false);
      onOpenChange(false);
      onDeleted?.();
    } catch {
      // The mutation error is rendered inline in the confirmation dialog.
    }
  }

  function handlePanelOpenChange(next: boolean) {
    if (!next) {
      handleDeleteDialogOpenChange(false);
    }

    onOpenChange(next);
  }

  function handleOpenPins() {
    if (!channelId) return;
    handlePanelOpenChange(false);
    void navigate({
      params: { channelId },
      to: "/channels/pins/$channelId",
    });
  }

  const currentVisibility = detail?.visibility ?? channel.visibility;
  const currentTtlSeconds = detail?.ttlSeconds ?? null;
  const nextVisibility: "open" | "private" = isPrivateDraft
    ? "private"
    : "open";
  const nextTtlSeconds: number | null = isEphemeralDraft
    ? ttlSecondsDraft
    : null;
  const lifecycleDirty =
    nextVisibility !== currentVisibility ||
    nextTtlSeconds !== currentTtlSeconds;

  const resolvedChannel = detail ?? channel;
  const nameDirty = nameDraft.trim() !== resolvedChannel.name.trim();
  const descriptionDirty =
    descriptionDraft.trim() !== resolvedChannel.description.trim();
  const isSavingChannelEdits = updateChannelDetailsMutation.isPending;
  const hasChannelEditChanges = nameDirty || descriptionDirty || lifecycleDirty;
  const canSaveChannelEdits =
    nameDraft.trim().length > 0 &&
    hasUserEditedChannelDraft &&
    hasChannelEditChanges &&
    !isSavingChannelEdits;
  const canvasContent = canvasQuery.data?.content?.trim() ?? "";
  const hasCanvas = canvasContent.length > 0;
  const canvasPreview = hasCanvas
    ? getMarkdownPreviewText(canvasContent)
    : undefined;
  const canOpenCanvas = hasCanvas || canEditNarrative;

  function handleEditDialogOpenChange(next: boolean) {
    if (next) {
      openEditDialog();
      return;
    }

    cancelDeferredModalOpen();
    setNameDraft(resolvedChannel.name);
    setDescriptionDraft(resolvedChannel.description);
    setIsPrivateDraft(currentVisibility === "private");
    setIsEphemeralDraft(currentTtlSeconds !== null);
    setTtlSecondsDraft(currentTtlSeconds ?? DEFAULT_EPHEMERAL_TTL_SECONDS);
    setHasUserEditedChannelDraft(false);

    setIsEditDialogOpen(false);
  }

  async function handleSaveChannelEdits() {
    try {
      if (nameDirty || descriptionDirty || lifecycleDirty) {
        await updateChannelDetailsMutation.mutateAsync({
          description: descriptionDirty ? descriptionDraft.trim() : undefined,
          name: nameDirty ? nameDraft.trim() : undefined,
          ttlSeconds:
            nextTtlSeconds !== currentTtlSeconds ? nextTtlSeconds : undefined,
          visibility:
            lifecycleDirty && nextVisibility !== currentVisibility
              ? nextVisibility
              : undefined,
        });
      }

      setHasUserEditedChannelDraft(false);
      setIsEditDialogOpen(false);
    } catch {
      // React Query stores mutation errors; keep the dialog open and render them.
    }
  }

  return (
    <DialogPrimitive.Root
      modal={!isSplitLayout}
      onOpenChange={handlePanelOpenChange}
      open={open}
    >
      {!isSplitLayout ? (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay asChild>
            <OverlayPanelBackdrop
              onClose={() => handlePanelOpenChange(false)}
            />
          </DialogPrimitive.Overlay>
        </DialogPrimitive.Portal>
      ) : null}
      {isSplitLayout ? (
        // No translucent backdrop-blur surface here: `backdrop-filter`
        // creates a stacking context that traps the z-40 panel header below
        // the shared z-30 header blur strip in split layout. The pane sits on
        // the opaque `bg-background` from PANEL_BASE_CLASS instead.
        <DialogPrimitive.Content
          className={cn(
            PANEL_BASE_CLASS,
            "h-full w-full cursor-default overflow-hidden border-l-0 bg-[#FBF8F6] p-0 dark:bg-colony-surface-raised",
            animateSplitEnter && PANEL_ENTER_MOTION_CLASS,
          )}
          data-testid="channel-management-sheet"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <ChannelManagementPanelContent
            activeView={activeView}
            archiveChannelMutation={archiveChannelMutation}
            canEditNarrative={canEditNarrative}
            canEditChannel={canEditChannel}
            canJoin={canJoin}
            canLeave={canLeave}
            canOpenCanvas={canOpenCanvas}
            canvasPreview={canvasPreview}
            canvasQuery={canvasQuery}
            channelId={channelId}
            currentPubkey={currentPubkey}
            onOpenPins={handleOpenPins}
            deleteChannelMutation={deleteChannelMutation}
            detailsError={detailsQuery.error}
            handleDeleteChannel={handleDeleteChannel}
            handleDeleteDialogOpenChange={handleDeleteDialogOpenChange}
            isArchived={isArchived}
            isDeleteDialogOpen={isDeleteDialogOpen}
            canDeleteChannel={canDeleteChannel}
            mode={auxiliaryPanelMode}
            transparentChrome={transparentChrome}
            joinChannelMutation={joinChannelMutation}
            leaveChannelMutation={leaveChannelMutation}
            memberCount={memberCount}
            members={members}
            membersError={membersQuery.error}
            onOpenEdit={openEditDialog}
            onOpenMembers={onOpenMembers ? openMembersDialog : undefined}
            onOpenChange={handlePanelOpenChange}
            resolvedChannel={resolvedChannel}
            setActiveView={setActiveView}
            unarchiveChannelMutation={unarchiveChannelMutation}
          />
        </DialogPrimitive.Content>
      ) : (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            className={cn(
              PANEL_BASE_CLASS,
              PANEL_OVERLAY_CLASS,
              PANEL_ENTER_MOTION_CLASS,
              "w-[380px] cursor-default overflow-hidden border-colony-border bg-[#FBF8F6] p-0 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200 dark:bg-colony-surface-raised",
            )}
            data-testid="channel-management-sheet"
          >
            <ChannelManagementPanelContent
              activeView={activeView}
              archiveChannelMutation={archiveChannelMutation}
              canEditNarrative={canEditNarrative}
              canEditChannel={canEditChannel}
              canJoin={canJoin}
              canLeave={canLeave}
              canOpenCanvas={canOpenCanvas}
              canvasPreview={canvasPreview}
              canvasQuery={canvasQuery}
              channelId={channelId}
              currentPubkey={currentPubkey}
              onOpenPins={handleOpenPins}
              deleteChannelMutation={deleteChannelMutation}
              detailsError={detailsQuery.error}
              handleDeleteChannel={handleDeleteChannel}
              handleDeleteDialogOpenChange={handleDeleteDialogOpenChange}
              isArchived={isArchived}
              isDeleteDialogOpen={isDeleteDialogOpen}
              canDeleteChannel={canDeleteChannel}
              mode={auxiliaryPanelMode}
              transparentChrome={transparentChrome}
              joinChannelMutation={joinChannelMutation}
              leaveChannelMutation={leaveChannelMutation}
              memberCount={memberCount}
              members={members}
              membersError={membersQuery.error}
              onOpenEdit={openEditDialog}
              onOpenMembers={onOpenMembers ? openMembersDialog : undefined}
              onOpenChange={handlePanelOpenChange}
              resolvedChannel={resolvedChannel}
              setActiveView={setActiveView}
              unarchiveChannelMutation={unarchiveChannelMutation}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}

      {canEditChannel ? (
        <Dialog
          onOpenChange={handleEditDialogOpenChange}
          open={isEditDialogOpen}
        >
          <DialogContent
            aria-describedby={undefined}
            className="max-w-[520px] gap-0 overflow-hidden bg-colony-surface p-0"
            showCloseButton={false}
            style={{
              boxShadow:
                "0 30px 80px -30px rgba(30, 15, 50, 0.55), 0 0 0 1px rgba(37, 34, 44, 0.06)",
            }}
          >
            <div className="flex max-h-[calc(100vh-2rem)] flex-col">
              <div className="flex shrink-0 items-center gap-3 border-b border-colony-border pb-[18px] pl-6 pr-5 pt-5">
                <DialogTitle className="flex-1 leading-[normal]">
                  Edit {nextVisibility === "private" ? "private" : "public"}{" "}
                  channel
                </DialogTitle>
                <DialogClose
                  aria-label="Close"
                  className="flex size-10 shrink-0 items-center justify-center rounded-colony-control-lg text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
                >
                  <CloseIcon size={16} strokeWidth={2.6} />
                </DialogClose>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-[22px]">
                <div className="flex flex-col gap-2">
                  <label
                    className={CHANNEL_FORM_LABEL_CLASS}
                    htmlFor="channel-name"
                  >
                    Name
                  </label>
                  <Input
                    className="font-semibold"
                    data-testid="channel-management-name"
                    disabled={isSavingChannelEdits}
                    id="channel-name"
                    onChange={(event) => {
                      setNameDraft(event.target.value);
                      setHasUserEditedChannelDraft(true);
                    }}
                    value={nameDraft}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    className={CHANNEL_FORM_LABEL_CLASS}
                    htmlFor="channel-description"
                  >
                    Description
                  </label>
                  <Textarea
                    className="min-h-0 resize-none text-sm leading-normal"
                    data-testid="channel-management-description"
                    disabled={isSavingChannelEdits}
                    id="channel-description"
                    onChange={(event) => {
                      setDescriptionDraft(event.target.value);
                      setHasUserEditedChannelDraft(true);
                    }}
                    rows={2}
                    value={descriptionDraft}
                  />
                </div>

                {resolvedChannel.channelType !== "dm" ? (
                  <div
                    className="flex flex-col gap-5"
                    data-testid="channel-management-lifecycle"
                  >
                    <ChannelTypeSettings
                      channelId={resolvedChannel.id}
                      disabled={isSavingChannelEdits}
                      onTemporaryChange={(temporary) => {
                        setIsEphemeralDraft(temporary);
                        setHasUserEditedChannelDraft(true);
                      }}
                      onTtlSecondsChange={(ttlSeconds) => {
                        setTtlSecondsDraft(ttlSeconds);
                        setHasUserEditedChannelDraft(true);
                      }}
                      temporary={isEphemeralDraft}
                      testIdPrefix="channel-management"
                      ttlSeconds={ttlSecondsDraft}
                      variant="card"
                    />
                    <ChannelPermissionsSettings
                      disabled={isSavingChannelEdits}
                      onVisibilityChange={(visibility) => {
                        setIsPrivateDraft(visibility === "private");
                        setHasUserEditedChannelDraft(true);
                      }}
                      testIdPrefix="channel-management"
                      variant="card"
                      visibility={isPrivateDraft ? "private" : "open"}
                    />
                  </div>
                ) : null}

                {updateChannelDetailsMutation.error instanceof Error ? (
                  <p className="rounded-colony-control-lg bg-colony-danger-bg px-4 py-3 text-xs font-semibold text-colony-danger">
                    {updateChannelDetailsMutation.error.message}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 justify-end gap-2.5 border-t border-colony-border bg-[#FBF8F6] px-6 py-4 dark:bg-colony-surface-raised">
                <Button
                  className="border-0 px-4.5 font-bold shadow-[0_0_0_1px_hsl(var(--colony-border-strong))]"
                  onClick={() => handleEditDialogOpenChange(false)}
                  size="dialog"
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  className="px-4.5"
                  data-testid="channel-management-save-changes"
                  disabled={!canSaveChannelEdits}
                  onClick={() => void handleSaveChannelEdits()}
                  size="dialog"
                  type="button"
                  variant="agent"
                >
                  {isSavingChannelEdits ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </DialogPrimitive.Root>
  );
}

type ChannelMutation<TArgs = void> = {
  error: unknown;
  isPending: boolean;
  mutateAsync: (args: TArgs) => Promise<unknown>;
};

type ChannelManagementPanelContentProps = {
  activeView: "summary" | "canvas";
  archiveChannelMutation: ChannelMutation;
  canEditChannel: boolean;
  canEditNarrative: boolean;
  canJoin: boolean;
  canLeave: boolean;
  canOpenCanvas: boolean;
  canvasPreview?: string;
  canvasQuery: { isLoading: boolean };
  channelId: string | null;
  currentPubkey?: string;
  onOpenPins: () => void;
  deleteChannelMutation: ChannelMutation;
  detailsError: unknown;
  handleDeleteChannel: () => Promise<void>;
  handleDeleteDialogOpenChange: (open: boolean) => void;
  isArchived: boolean;
  isDeleteDialogOpen: boolean;
  canDeleteChannel: boolean; // true when caller may delete the channel
  mode: AuxiliaryPanelMode;
  transparentChrome?: boolean;
  joinChannelMutation: ChannelMutation;
  leaveChannelMutation: ChannelMutation;
  memberCount: number;
  members: ChannelMember[];
  membersError: unknown;
  onOpenEdit: () => void;
  onOpenMembers?: () => void;
  onOpenChange: (open: boolean) => void;
  resolvedChannel: Channel;
  setActiveView: React.Dispatch<React.SetStateAction<"summary" | "canvas">>;
  unarchiveChannelMutation: ChannelMutation;
};

function ChannelManagementPanelContent({
  activeView,
  archiveChannelMutation,
  canEditChannel,
  canEditNarrative,
  canJoin,
  canLeave,
  canOpenCanvas,
  canvasPreview,
  canvasQuery,
  channelId,
  currentPubkey,
  onOpenPins,
  deleteChannelMutation,
  detailsError,
  handleDeleteChannel,
  handleDeleteDialogOpenChange,
  isArchived,
  isDeleteDialogOpen,
  canDeleteChannel,
  mode,
  transparentChrome = false,
  joinChannelMutation,
  leaveChannelMutation,
  memberCount,
  members,
  membersError,
  onOpenEdit,
  onOpenMembers,
  onOpenChange,
  resolvedChannel,
  setActiveView,
  unarchiveChannelMutation,
}: ChannelManagementPanelContentProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  useScrollBoundaryLock(scrollRef);
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = React.useState(false);

  return (
    <AuxiliaryPanelContext.Provider
      value={{
        isFloatingOverlay: mode === "panel",
        isOverlay: mode !== "docked",
        isSinglePanelView: mode === "single-panel",
        isSplitLayout: mode === "docked",
        layout: mode === "docked" ? "split" : "standalone",
        mode,
        onClose: () => onOpenChange(false),
        transparentChrome,
        widthPx: 380,
      }}
    >
      <div
        className="flex h-[4.5rem] shrink-0 items-center gap-2.5 border-b border-colony-border pl-6 pr-4"
        data-testid="channel-management-header"
      >
        {activeView !== "summary" ? (
          <button
            aria-label="Back to channel"
            className="-ml-2 flex size-[2.375rem] shrink-0 items-center justify-center rounded-[0.625rem] text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
            data-testid="channel-management-back"
            onClick={() => setActiveView("summary")}
            type="button"
          >
            <ChevronLeftGlyph size={17} strokeWidth={2.4} />
          </button>
        ) : null}
        <DialogPrimitive.Title asChild>
          <h2 className="min-w-0 flex-1 truncate text-xl font-extrabold tracking-[-0.02em] leading-[normal]">
            {activeView === "canvas" ? "Canvas" : "Channel settings"}
          </h2>
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">
          Channel settings
        </DialogPrimitive.Description>
        <button
          aria-label="Close panel"
          className="flex size-[2.375rem] shrink-0 items-center justify-center rounded-[0.625rem] text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
          data-testid="auxiliary-panel-close"
          onClick={() => onOpenChange(false)}
          type="button"
        >
          <CloseIcon size={17} strokeWidth={2.4} />
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-6 [overflow-anchor:none]"
        ref={scrollRef}
      >
        {activeView === "summary" ? (
          <div className="flex flex-col gap-[18px]">
            <ChannelHero
              channel={resolvedChannel}
              onEdit={canEditChannel ? onOpenEdit : undefined}
            />

            {detailsError instanceof Error ? (
              <p className="rounded-colony-control-lg bg-colony-danger-bg px-3 py-2 text-xs font-semibold text-colony-danger">
                {detailsError.message}
              </p>
            ) : null}

            {membersError instanceof Error ? (
              <p className="rounded-colony-control-lg bg-colony-danger-bg px-3 py-2 text-xs font-semibold text-colony-danger">
                {membersError.message}
              </p>
            ) : null}

            <FieldGroup testId="channel-management-details" title="Details">
              {resolvedChannel.channelType !== "dm" ? (
                <>
                  <ChannelTypeDetailRow
                    canEdit={canEditChannel}
                    channel={resolvedChannel}
                    onEdit={onOpenEdit}
                  />
                  <EditableInfoFieldRow
                    editTestId="channel-management-edit-visibility"
                    label="Visibility"
                    onEdit={canEditChannel ? onOpenEdit : undefined}
                    testId="channel-management-visibility"
                    value={
                      resolvedChannel.visibility === "private"
                        ? "Private"
                        : "Public"
                    }
                  />
                </>
              ) : null}
              <InfoFieldRow
                label="Members"
                onClick={onOpenMembers}
                testId="channel-management-member-count"
                trailing={
                  <SettingsMemberStack
                    currentPubkey={currentPubkey}
                    members={members}
                  />
                }
                value={`${memberCount} member${memberCount === 1 ? "" : "s"}`}
              />
              <CopyFieldRow
                label="Channel ID"
                testId="channel-management-channel-id"
                value={resolvedChannel.id}
              />
            </FieldGroup>

            {canOpenCanvas ? (
              <IngressRow
                description={canvasPreview}
                helpText="Use the canvas as a shared space for notes, plans, and other channel information."
                icon={CanvasGlyph}
                label="Canvas"
                onClick={() => setActiveView("canvas")}
                testId="channel-canvas-ingress"
                trailing={canvasQuery.isLoading ? "Loading..." : undefined}
              />
            ) : null}

            {resolvedChannel.channelType !== "dm" ? (
              <IngressRow
                helpText="Messages the team wanted to keep within reach"
                icon={PinIcon}
                label="Pinned messages"
                onClick={onOpenPins}
                testId="channel-pins-trigger"
              />
            ) : null}

            {canJoin || canLeave || canEditChannel ? (
              <ActionFieldGroup testId="channel-management-actions">
                {canJoin ? (
                  <ActionFieldRow
                    description="Add this channel to your sidebar"
                    disabled={joinChannelMutation.isPending}
                    icon={DoorOpen}
                    label={
                      joinChannelMutation.isPending
                        ? "Joining channel..."
                        : "Join channel"
                    }
                    onClick={() => {
                      void joinChannelMutation.mutateAsync();
                    }}
                    testId="channel-management-join"
                  />
                ) : null}
                {canLeave ? (
                  <ActionFieldRow
                    disabled={leaveChannelMutation.isPending}
                    icon={LeaveRowGlyph}
                    label={
                      leaveChannelMutation.isPending
                        ? "Leaving channel..."
                        : "Leave channel"
                    }
                    onClick={() => setIsLeaveDialogOpen(true)}
                    testId="channel-management-leave"
                  />
                ) : null}
                {canEditChannel ? (
                  isArchived ? (
                    <ActionFieldRow
                      disabled={unarchiveChannelMutation.isPending}
                      icon={ArchiveRestore}
                      label={
                        unarchiveChannelMutation.isPending
                          ? "Restoring channel..."
                          : "Unarchive channel"
                      }
                      onClick={() => {
                        void unarchiveChannelMutation.mutateAsync();
                      }}
                      testId="channel-management-unarchive"
                    />
                  ) : (
                    <ActionFieldRow
                      disabled={archiveChannelMutation.isPending}
                      icon={ArchiveGlyph}
                      label={
                        archiveChannelMutation.isPending
                          ? "Archiving channel..."
                          : "Archive channel"
                      }
                      onClick={() => {
                        void archiveChannelMutation.mutateAsync();
                      }}
                      testId="channel-management-archive"
                    />
                  )
                ) : null}
                {canEditChannel && canDeleteChannel ? (
                  <ChannelDeleteConfirmationDialog
                    channelName={resolvedChannel.name}
                    error={deleteChannelMutation.error}
                    isPending={deleteChannelMutation.isPending}
                    onConfirm={() => {
                      void handleDeleteChannel();
                    }}
                    onOpenChange={handleDeleteDialogOpenChange}
                    open={isDeleteDialogOpen}
                    trigger={
                      <ActionFieldRow
                        destructive
                        disabled={deleteChannelMutation.isPending}
                        icon={TrashGlyph}
                        label="Delete channel"
                        testId="channel-management-delete"
                      />
                    }
                  />
                ) : null}
              </ActionFieldGroup>
            ) : null}

            <LeaveChannelAlertDialog
              channelName={resolvedChannel.name}
              onConfirm={() => {
                void leaveChannelMutation.mutateAsync().then(() => {
                  onOpenChange(false);
                });
              }}
              onOpenChange={setIsLeaveDialogOpen}
              open={isLeaveDialogOpen}
            />

            {joinChannelMutation.error instanceof Error ? (
              <p className="text-xs font-semibold text-colony-danger">
                {joinChannelMutation.error.message}
              </p>
            ) : null}
            {leaveChannelMutation.error instanceof Error ? (
              <p className="text-xs font-semibold text-colony-danger">
                {leaveChannelMutation.error.message}
              </p>
            ) : null}
            {archiveChannelMutation.error instanceof Error ? (
              <p className="text-xs font-semibold text-colony-danger">
                {archiveChannelMutation.error.message}
              </p>
            ) : null}
            {unarchiveChannelMutation.error instanceof Error ? (
              <p className="text-xs font-semibold text-colony-danger">
                {unarchiveChannelMutation.error.message}
              </p>
            ) : null}
          </div>
        ) : activeView === "canvas" ? (
          <div data-testid="channel-canvas-section">
            <ChannelCanvas
              canEdit={canEditNarrative}
              channelId={channelId}
              isArchived={isArchived}
            />
          </div>
        ) : null}
      </div>
    </AuxiliaryPanelContext.Provider>
  );
}
