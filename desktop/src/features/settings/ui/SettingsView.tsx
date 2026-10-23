import * as React from "react";

import { cn } from "@/shared/lib/cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  useSidebar,
} from "@/shared/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { ColonyField } from "@/shared/ui/ColonyField";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
} from "@/shared/ui/colonyIcons";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  useProfileQuery,
  useUpdateProfileMutation,
} from "@/features/profile/hooks";
import {
  canonicalSettingsSection,
  renderSettingsSection,
  settingsGroups,
  settingsNavCategory,
  type SettingsGroupDescriptor,
  type SettingsGroupId,
  type SettingsPanelProps,
  type SettingsSection,
} from "./SettingsPanels";
import { membershipRoleLabel } from "./membershipRoleLabel";
import { ProfileAvatarDialog } from "./ProfileAvatarDialog";
import { SettingsPageHead } from "./SettingsPageHead";
import "./SettingsShell.css";
import "./SettingsPages.css";

export {
  DEFAULT_SETTINGS_SECTION,
  type SettingsSection,
} from "./SettingsPanels";

type SettingsViewProps = SettingsPanelProps & {
  canGoBack: boolean;
  canGoForward: boolean;
  onClose: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
};

const LAST_SECTIONS_KEY = "colony.settings.last-inner-section.v1";

function safeReadLastSections(): Partial<
  Record<SettingsGroupId, SettingsSection>
> {
  try {
    const raw = sessionStorage.getItem(LAST_SECTIONS_KEY);
    return raw
      ? (JSON.parse(raw) as Partial<Record<SettingsGroupId, SettingsSection>>)
      : {};
  } catch {
    return {};
  }
}

function routeGroup(section: SettingsSection): SettingsGroupDescriptor {
  const canonical = canonicalSettingsSection(section);
  const found = settingsGroups.find((group) =>
    group.sections.some((entry) => entry.value === canonical),
  );
  if (found) return found;
  if (canonical === "feedback") {
    return (
      settingsGroups.find((group) => group.id === "app-devices") ??
      settingsGroups[0]
    );
  }
  return settingsGroups[0];
}

function defaultSectionFor(group: SettingsGroupDescriptor): SettingsSection {
  return group.sections[0]?.value ?? "profile";
}

function loadRememberedSection(
  group: SettingsGroupDescriptor,
  remembered: Partial<Record<SettingsGroupId, SettingsSection>>,
): SettingsSection {
  const candidate = remembered[group.id];
  if (candidate && group.sections.some((entry) => entry.value === candidate)) {
    return candidate;
  }
  return defaultSectionFor(group);
}

function SettingsGroupButton({
  group,
  active,
  onSelect,
}: {
  group: SettingsGroupDescriptor;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = group.icon;
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-pressed={active}
      className="cs-nav-item"
      data-active={active ? "true" : undefined}
      data-testid={`settings-group-${group.id}`}
      onClick={onSelect}
      type="button"
    >
      <Icon size={18} />
      <span className="truncate">{group.label}</span>
    </button>
  );
}

export function SettingsView({
  currentPubkey,
  fallbackDisplayName,
  isUpdatingDesktopNotifications,
  notificationErrorMessage,
  notificationPermission,
  notificationSettings,
  canGoBack,
  canGoForward,
  onClose,
  onGoBack,
  onGoForward,
  onSectionChange,
  onSetDesktopNotificationsEnabled,
  onSetHomeBadgeEnabled,
  onSetSlotAlertsEnabled,
  onSetNotifyWhileViewing,
  onSetAllSlotAlertsEnabled,
  onSetSoundForSlot,
  section,
}: SettingsViewProps) {
  const { isMobile, open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [remembered, setRemembered] = React.useState(safeReadLastSections);
  const { activeCommunity } = useCommunities();
  const { goTeam } = useAppNavigation();
  const profile = useProfileQuery();
  // Same source as the People panel, so the footer never claims a role the
  // person does not hold.
  const membershipQuery = useMyRelayMembershipQuery();
  const roleCaption = membershipRoleLabel(membershipQuery.data?.role);
  const updateProfile = useUpdateProfileMutation();
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = React.useState(false);
  const [avatarSaved, setAvatarSaved] = React.useState(false);
  const mainRef = React.useRef<HTMLElement | null>(null);

  const activeSection = canonicalSettingsSection(section);
  const activeGroup = routeGroup(activeSection);
  const businessName = activeCommunity?.name ?? "Business";
  const signedInDisplayName =
    profile.data?.displayName ?? fallbackDisplayName ?? "Signed-in identity";
  React.useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setIsLoaded(true));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  React.useEffect(() => {
    if (activeSection !== section) onSectionChange(activeSection);
    if (activeGroup.sections.some((entry) => entry.value === activeSection)) {
      setRemembered((current) => {
        const next = { ...current, [activeGroup.id]: activeSection };
        try {
          sessionStorage.setItem(LAST_SECTIONS_KEY, JSON.stringify(next));
        } catch {
          // Session memory is optional when storage is blocked.
        }
        return next;
      });
    }
  }, [activeGroup, activeSection, onSectionChange, section]);

  React.useEffect(() => {
    if (!isMobile && !sidebarOpen) setSidebarOpen(true);
  }, [isMobile, setSidebarOpen, sidebarOpen]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // A page shows its sections one after another, starting with the one the
  // tab names; choosing a section starts the page at it.
  React.useLayoutEffect(() => {
    if (activeSection) mainRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  const matchingSections = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return settingsGroups.flatMap((group) =>
      group.sections
        .filter((entry) =>
          `${group.label} ${entry.label}`.toLowerCase().includes(query),
        )
        .map((entry) => ({ ...entry, group })),
    );
  }, [search]);

  function chooseGroup(group: SettingsGroupDescriptor) {
    onSectionChange(loadRememberedSection(group, remembered));
    setSearch("");
  }

  function chooseSection(next: SettingsSection) {
    onSectionChange(canonicalSettingsSection(next));
    setSearch("");
  }

  const categories = settingsNavCategory(businessName);

  return (
    <>
      <Sidebar
        className="cs-sidebar !border-r-0"
        collapsible="offcanvas"
        data-testid="settings-sidebar"
        variant="sidebar"
      >
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
          data-sidebar-background
        >
          <ColonyField />
          <SidebarHeader className="cs-sidebar-header">
            <button
              className="cs-back"
              data-testid="settings-back-to-app"
              onClick={onClose}
              type="button"
            >
              <ChevronLeftIcon size={16} strokeWidth={2.4} />
              Back to workspace
            </button>
            <h1 className="cs-sidebar-title">Settings</h1>
            <label className="cs-search" htmlFor="settings-search-input">
              <SearchIcon size={17} strokeWidth={2.2} />
              <input
                aria-label="Find a setting"
                data-testid="settings-search"
                id="settings-search-input"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a setting"
                type="search"
                value={search}
              />
            </label>
          </SidebarHeader>

          <SidebarContent className="cs-sidebar-content">
            {search.trim() ? (
              <div
                aria-label="Settings search results"
                className="cs-nav-group"
                role="listbox"
              >
                {matchingSections.map(({ group, label, value }) => (
                  <button
                    aria-label={`${label}, ${group.label}`}
                    className="cs-nav-item cs-search-result"
                    key={`${group.id}:${value}`}
                    onClick={() => chooseSection(value)}
                    role="option"
                    type="button"
                  >
                    <span className="truncate">{label}</span>
                    <small>{group.label}</small>
                  </button>
                ))}
                {matchingSections.length === 0 ? (
                  <p className="cs-sidebar-empty">No settings found.</p>
                ) : null}
              </div>
            ) : (
              categories.map((category) => (
                <div className="cs-nav-group" key={category.label}>
                  <h2 className="cs-nav-heading">{category.label}</h2>
                  {category.groups.map((group) => (
                    <SettingsGroupButton
                      active={group.id === activeGroup.id}
                      group={group}
                      key={group.id}
                      onSelect={() => chooseGroup(group)}
                    />
                  ))}
                </div>
              ))
            )}
          </SidebarContent>

          <SidebarFooter className="cs-sidebar-footer">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={`Profile and account, ${signedInDisplayName}`}
                  className="cs-person"
                  data-testid="settings-profile-avatar-context"
                  onClick={() => {
                    chooseSection("profile");
                    setAvatarSaved(false);
                  }}
                  type="button"
                >
                  <ProfileAvatar
                    avatarUrl={profile.data?.avatarUrl ?? null}
                    className="cs-person-avatar"
                    label={signedInDisplayName}
                    testId="settings-profile-avatar"
                  />
                  <span className="cs-person-copy">
                    <strong>{signedInDisplayName}</strong>
                    <small>{roleCaption}</small>
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent
                data-testid="settings-profile-avatar-context-tooltip"
                side="right"
              >
                Profile and account
              </TooltipContent>
            </Tooltip>
          </SidebarFooter>
        </div>
      </Sidebar>

      <SidebarInset
        className={cn(
          "cs-shell relative",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        data-testid="settings-view"
      >
        <div
          className="colony-topbar"
          data-tauri-drag-region
          data-testid="settings-top-chrome"
        >
          <button
            aria-label="Back"
            className="colony-topbar-button"
            data-testid="settings-history-back"
            disabled={!canGoBack}
            onClick={onGoBack}
            type="button"
          >
            <ChevronLeftIcon size={17} strokeWidth={2.4} />
          </button>
          <button
            aria-label="Forward"
            className="colony-topbar-button"
            data-testid="settings-history-forward"
            disabled={!canGoForward}
            onClick={onGoForward}
            type="button"
          >
            <ChevronRightIcon size={17} strokeWidth={2.4} />
          </button>
          <nav
            aria-label="Breadcrumb"
            className="colony-breadcrumb"
            data-testid="settings-breadcrumb"
          >
            <span>Settings</span>
            <span aria-hidden="true">/</span>
            <span data-current="true">{activeGroup.label}</span>
          </nav>
          <span className="flex-1" />
          <button
            aria-label="Close settings"
            className="colony-topbar-button"
            data-testid="settings-close"
            onClick={onClose}
            style={{
              width: "2.5rem",
              height: "2.5rem",
              borderRadius: "0.75rem",
            }}
            type="button"
          >
            <CloseIcon size={18} strokeWidth={2.4} />
          </button>
        </div>
        <main
          className="cs-main"
          data-testid="settings-content-surface"
          ref={mainRef}
        >
          <div
            className="cs-page"
            data-testid="settings-content-scroll"
            data-wide={
              activeGroup.id === "appearance-group" ? "true" : undefined
            }
          >
            <SettingsPageHead
              activeSection={activeSection}
              businessName={businessName}
              group={activeGroup}
              onSelect={chooseSection}
            />
            {activeGroup.sections
              .slice(
                Math.max(
                  0,
                  activeGroup.sections.findIndex(
                    (entry) => entry.value === activeSection,
                  ),
                ),
              )
              .map((entry) => (
                <section
                  aria-label={`${entry.label} settings`}
                  className="cs-section"
                  data-testid={`settings-panel-${entry.value}`}
                  id={`settings-${entry.value}`}
                  key={entry.value}
                >
                  {renderSettingsSection(entry.value, {
                    currentPubkey,
                    avatarSaved,
                    fallbackDisplayName,
                    onEditAvatar: () => {
                      setAvatarSaved(false);
                      setIsAvatarDialogOpen(true);
                    },
                    isUpdatingDesktopNotifications,
                    notificationErrorMessage,
                    notificationPermission,
                    notificationSettings,
                    onSetDesktopNotificationsEnabled,
                    onSetHomeBadgeEnabled,
                    onSetSlotAlertsEnabled,
                    onSetNotifyWhileViewing,
                    onSetAllSlotAlertsEnabled,
                    onSetSoundForSlot,
                    onClose,
                    onOpenTeam: () => void goTeam(),
                    onSectionChange: chooseSection,
                  })}
                </section>
              ))}
          </div>
        </main>
      </SidebarInset>
      <ProfileAvatarDialog
        avatarUrl={profile.data?.avatarUrl ?? ""}
        displayName={
          profile.data?.displayName ?? fallbackDisplayName ?? "Your profile"
        }
        onOpenChange={setIsAvatarDialogOpen}
        onSave={async (avatarUrl) => {
          await updateProfile.mutateAsync({ avatarUrl });
          setAvatarSaved(true);
        }}
        open={isAvatarDialogOpen}
      />
    </>
  );
}
