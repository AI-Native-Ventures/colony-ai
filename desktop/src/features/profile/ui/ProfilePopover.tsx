import * as React from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { getPresenceLabel } from "@/features/presence/lib/presence";
import { useUpdateProfileMutation } from "@/features/profile/hooks";
import { ProfileAvatarDialog } from "@/features/settings/ui/ProfileAvatarDialog";
import { SetStatusDialog } from "@/features/user-status/ui/SetStatusDialog";
import {
  DEFAULT_USER_STATUS_EMOJI,
  StatusEmoji,
} from "@/features/user-status/ui/StatusEmoji";
import type { UserStatusInput } from "@/features/user-status/types";
import type { PresenceStatus } from "@/shared/api/types";
import { CheckIcon, SettingsIcon } from "@/shared/ui/colonyIcons";
import { isMacPlatform } from "@/shared/lib/platform";
import {
  CameraIcon,
  ChevronDownIcon,
  FeedbackIcon,
  StatusFaceIcon,
} from "./profileIcons";
import "./ProfileMenus.css";

interface ProfilePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  avatarUrl: string | null;
  avatarDataUrl?: string | null;
  currentStatus: PresenceStatus;
  isStatusPending?: boolean;
  userStatusText?: string;
  userStatusEmoji?: string;
  userStatusExpiresAt?: number;
  userStatusUpdatedAt?: number;
  onSetStatus: (status: PresenceStatus) => void;
  onSetUserStatus: (status: UserStatusInput) => void;
  onClearUserStatus: () => void;
  onOpenSettings: (section?: "profile" | "appearance") => void;
  onSendFeedback?: () => void;
  children: React.ReactNode;
  // Optional outer container whose clicks should NOT close the popover.
  // Used when auxiliary triggers (avatar, status text) live alongside the
  // primary PopoverTrigger and toggle the popover via controlled `open`.
  triggerContainerRef?: React.RefObject<HTMLElement | null>;
  // Optional slot rendered before the profile actions. Used by the sidebar to
  // surface active-community actions inside the profile menu.
  communitySwitcherSlot?: React.ReactNode;
  /** Colour mode of the app, for the light/dark switch row. */
  isDark?: boolean;
  /** Switches between the light and dark twin of the current theme. */
  onToggleTheme?: () => void;
}

const ALL_STATUSES: PresenceStatus[] = ["online", "away", "offline"];

/**
 * The account menu, opened from the sidebar footer (`ProfilePopover.dc.html`):
 * who you are and your presence, your status and photo, the community you are
 * in, feedback and Settings.
 */
export function ProfilePopover({
  open,
  onOpenChange,
  displayName,
  avatarUrl,
  avatarDataUrl,
  currentStatus,
  isStatusPending,
  userStatusText,
  userStatusEmoji,
  userStatusExpiresAt,
  userStatusUpdatedAt,
  onSetStatus,
  onSetUserStatus,
  onClearUserStatus,
  onOpenSettings,
  onSendFeedback,
  children,
  triggerContainerRef,
  communitySwitcherSlot,
  isDark = false,
  onToggleTheme,
}: ProfilePopoverProps) {
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = React.useState(false);
  const updateProfile = useUpdateProfileMutation();
  const [presenceMenuOpen, setPresenceMenuOpen] = React.useState(false);
  const hasUserStatus = Boolean(userStatusText || userStatusEmoji);
  const settingsShortcutLabel = isMacPlatform() ? "\u2318," : "Ctrl+,";

  function handlePopoverOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setPresenceMenuOpen(false);
    }
    onOpenChange(nextOpen);
  }

  function closePopover() {
    setPresenceMenuOpen(false);
    onOpenChange(false);
  }

  function handlePresenceSelect(status: PresenceStatus) {
    onSetStatus(status);
    closePopover();
  }

  return (
    <>
      <Popover open={open} onOpenChange={handlePopoverOpenChange}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>

        <PopoverContent
          align="start"
          alignOffset={-52}
          className="pm-menu"
          data-testid="profile-popover"
          onInteractOutside={(event) => {
            const target = event.target as Node | null;
            if (target && triggerContainerRef?.current?.contains(target)) {
              // Click on an auxiliary trigger inside the same card
              // (e.g. avatar or status) - let that trigger toggle the
              // controlled state instead of auto-closing here.
              event.preventDefault();
            }
          }}
          side="top"
          sideOffset={27}
        >
          <Popover onOpenChange={setPresenceMenuOpen} open={presenceMenuOpen}>
            <PopoverAnchor asChild>
              <div aria-label="Profile menu" className="pm-list" role="menu">
                {/* Identity: photo with presence dot, name, presence chip. */}
                <div className="pm-identity">
                  <span className="pm-avatar">
                    <ProfileAvatar
                      avatarDataUrl={avatarDataUrl}
                      avatarUrl={avatarUrl}
                      className="pm-avatar-image"
                      label={displayName}
                    />
                    <span
                      aria-label={getPresenceLabel(currentStatus)}
                      className="pm-presence-dot"
                      data-status={currentStatus}
                      data-testid="profile-popover-current-status"
                      role="img"
                    />
                  </span>
                  <span className="pm-identity-copy">
                    <span className="pm-name">{displayName}</span>
                    <PopoverTrigger asChild>
                      <button
                        aria-expanded={presenceMenuOpen}
                        aria-haspopup="menu"
                        className="pm-chip"
                        data-status={currentStatus}
                        data-testid="profile-popover-presence-trigger"
                        disabled={isStatusPending}
                        onClick={() => setPresenceMenuOpen((prev) => !prev)}
                        role="menuitem"
                        type="button"
                      >
                        <i aria-hidden="true" />
                        {getPresenceLabel(currentStatus)}
                        <ChevronDownIcon size={13} strokeWidth={2.6} />
                      </button>
                    </PopoverTrigger>
                  </span>
                </div>

                <button
                  className="pm-row"
                  data-testid="profile-popover-set-status"
                  onClick={() => {
                    closePopover();
                    window.requestAnimationFrame(() => {
                      setStatusDialogOpen(true);
                    });
                  }}
                  role="menuitem"
                  type="button"
                >
                  {hasUserStatus ? (
                    <StatusEmoji
                      className="size-4.5 shrink-0 text-base"
                      showTitle={false}
                      value={userStatusEmoji || DEFAULT_USER_STATUS_EMOJI}
                    />
                  ) : (
                    <StatusFaceIcon size={18} />
                  )}
                  <span className="pm-row-label">
                    {hasUserStatus ? userStatusText : "Update your status"}
                  </span>
                </button>

                <button
                  className="pm-row"
                  data-testid="profile-popover-change-photo"
                  onClick={() => {
                    closePopover();
                    window.requestAnimationFrame(() => {
                      setAvatarDialogOpen(true);
                    });
                  }}
                  role="menuitem"
                  type="button"
                >
                  <CameraIcon size={18} />
                  <span className="pm-row-label">Change photo</span>
                </button>

                <hr className="pm-rule" />

                {communitySwitcherSlot ? (
                  <>
                    {/* Community actions */}
                    <div data-testid="profile-popover-community">
                      {communitySwitcherSlot}
                    </div>
                    <hr className="pm-rule" />
                  </>
                ) : null}

                {onSendFeedback ? (
                  <button
                    className="pm-row"
                    data-testid="profile-popover-send-feedback"
                    onClick={() => {
                      closePopover();
                      window.requestAnimationFrame(() => {
                        onSendFeedback();
                      });
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <FeedbackIcon size={18} />
                    <span className="pm-row-label">Send feedback</span>
                  </button>
                ) : null}

                {onToggleTheme ? (
                  <button
                    aria-label={
                      isDark ? "Switch to light theme" : "Switch to dark theme"
                    }
                    className="pm-row"
                    data-testid="sidebar-theme-toggle"
                    onClick={() => {
                      closePopover();
                      onToggleTheme();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="pm-row-icon-gap" />
                    <span className="pm-row-label">
                      {isDark
                        ? "Switch to light theme"
                        : "Switch to dark theme"}
                    </span>
                  </button>
                ) : null}

                <button
                  className="pm-row"
                  data-testid="profile-popover-settings"
                  onClick={() => {
                    closePopover();
                    window.requestAnimationFrame(() => {
                      onOpenSettings();
                    });
                  }}
                  role="menuitem"
                  type="button"
                >
                  <SettingsIcon size={18} />
                  <span className="pm-row-label">Settings</span>
                  <kbd className="pm-kbd">{settingsShortcutLabel}</kbd>
                </button>
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              alignOffset={-8}
              className="pm-presence"
              side="right"
              sideOffset={28}
            >
              <div aria-label="Presence status" role="menu">
                {ALL_STATUSES.map((status) => (
                  <button
                    aria-checked={status === currentStatus}
                    className="pm-presence-row"
                    data-status={status}
                    data-testid={`profile-popover-status-${status}`}
                    disabled={isStatusPending}
                    key={status}
                    onClick={() => handlePresenceSelect(status)}
                    role="menuitemradio"
                    type="button"
                  >
                    <i aria-hidden="true" />
                    <span className="pm-row-label">
                      {getPresenceLabel(status)}
                    </span>
                    {status === currentStatus ? (
                      <CheckIcon size={16} strokeWidth={2.8} />
                    ) : null}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>

      <ProfileAvatarDialog
        avatarUrl={avatarUrl ?? ""}
        displayName={displayName}
        onOpenChange={setAvatarDialogOpen}
        onSave={async (nextAvatarUrl) => {
          await updateProfile.mutateAsync({ avatarUrl: nextAvatarUrl });
        }}
        open={avatarDialogOpen}
      />

      <SetStatusDialog
        hasExistingStatus={hasUserStatus}
        initialEmoji={userStatusEmoji}
        initialExpiresAt={userStatusExpiresAt}
        initialText={userStatusText}
        initialUpdatedAt={userStatusUpdatedAt}
        onClear={onClearUserStatus}
        onOpenChange={setStatusDialogOpen}
        onSave={onSetUserStatus}
        open={statusDialogOpen}
      />
    </>
  );
}
