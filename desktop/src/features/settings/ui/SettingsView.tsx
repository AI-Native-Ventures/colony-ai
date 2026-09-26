import * as React from "react";
import { ArrowLeft, ArrowRight, Search, Settings, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  useSidebar,
} from "@/shared/ui/sidebar";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  useProfileQuery,
  useUpdateProfileMutation,
} from "@/features/profile/hooks";
import type { SyntaxThemeName } from "@/shared/theme/theme-loader";
import { toast } from "sonner";
import {
  appearanceLastBusinessKey,
  appearanceSnapshotKey,
  writeAppearanceSnapshot,
} from "../lib/appearanceSnapshot";
import {
  currentAppearanceSnapshot,
  mergeAppearanceSnapshot,
  readAppearanceSnapshot,
} from "./AppearanceSettingsPanel";
import {
  canonicalSettingsSection,
  renderSettingsSection,
  settingsGroups,
  type SettingsGroupDescriptor,
  type SettingsGroupId,
  type SettingsPanelProps,
  type SettingsSection,
} from "./SettingsPanels";
import {
  ThemeAppliedRoute,
  ThemeCatalogRoute,
  ThemePreviewRoute,
} from "./ThemeCatalogRoute";
import { ProfileAvatarDialog } from "./ProfileAvatarDialog";
import "./SettingsView.css";

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
  if (canonical.startsWith("settings/theme-")) {
    return (
      settingsGroups.find((group) => group.id === "appearance-group") ??
      settingsGroups[0]
    );
  }
  if (canonical === "settings/themes") {
    return (
      settingsGroups.find((group) => group.id === "appearance-group") ??
      settingsGroups[0]
    );
  }
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
      className={cn("w20-nav-item", active && "is-active")}
      data-active={active ? "true" : "false"}
      data-testid={`settings-group-${group.id}`}
      onClick={onSelect}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
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
  const theme = useTheme();
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const profile = useProfileQuery();
  const updateProfile = useUpdateProfileMutation();
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = React.useState(false);
  const [avatarSaved, setAvatarSaved] = React.useState(false);
  const [previewTheme, setPreviewTheme] = React.useState<SyntaxThemeName>(
    theme.selectedThemeName as SyntaxThemeName,
  );

  const activeSection = canonicalSettingsSection(section);
  const activeGroup = routeGroup(activeSection);
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

  function applyPreviewTheme() {
    const personId =
      identity.data?.pubkey ?? activeCommunity?.pubkey ?? "local";
    const businessId = activeCommunity?.id ?? "local-business";
    const key = appearanceSnapshotKey(personId, businessId);
    const lastBusinessKey = appearanceLastBusinessKey(personId);
    const current = mergeAppearanceSnapshot(
      currentAppearanceSnapshot(theme),
      readAppearanceSnapshot(key),
    );
    const next = {
      ...current,
      theme: previewTheme,
      followSystem: false,
    };
    let saved = false;
    try {
      saved = writeAppearanceSnapshot(window.localStorage, key, next);
    } catch {
      saved = false;
    }
    if (!saved) {
      toast.error("Theme could not be saved locally.");
      return;
    }
    try {
      window.localStorage.setItem(lastBusinessKey, businessId);
    } catch {
      // The scoped appearance snapshot does not depend on this migration hint.
    }
    theme.applyAppearance({
      theme: previewTheme,
      accent: next.accent,
      followSystem: false,
    });
    chooseSection("settings/theme-applied");
  }

  return (
    <>
      <Sidebar
        className="!border-r-0 w20-settings-sidebar"
        collapsible="offcanvas"
        data-testid="settings-sidebar"
        variant="sidebar"
      >
        <SidebarHeader className="w20-nav-header">
          <Button
            className="w20-nav-back"
            data-testid="settings-back-to-app"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Back to workspace
          </Button>
          <div>
            <h1 className="w20-nav-title text-settings-nav-title">Settings</h1>
            <label className="w20-nav-search" htmlFor="settings-search-input">
              <Search
                aria-hidden="true"
                className="pointer-events-none size-3.5 shrink-0 text-muted-foreground"
              />
              <Input
                aria-label="Find a setting"
                className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs shadow-none ring-0 focus-visible:ring-0"
                data-testid="settings-search"
                id="settings-search-input"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a setting"
                type="search"
                value={search}
              />
            </label>
          </div>
        </SidebarHeader>

        <SidebarContent className="w20-nav-content">
          {search.trim() ? (
            <div
              aria-label="Settings search results"
              className="w20-search-results"
              role="listbox"
            >
              {matchingSections.map(({ group, label, value }) => (
                <button
                  aria-label={`${label}, ${group.label}`}
                  className="w20-nav-item w20-search-result"
                  key={`${group.id}:${value}`}
                  onClick={() => chooseSection(value)}
                  role="option"
                  type="button"
                >
                  <span className="truncate">{label}</span>
                  <span className="ml-2 shrink-0 text-2xs text-muted-foreground">
                    {group.label}
                  </span>
                </button>
              ))}
              {matchingSections.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No settings found.
                </p>
              ) : null}
            </div>
          ) : (
            settingsGroups.map((group, index) => {
              const category =
                index < 3
                  ? "Personal"
                  : index < 7
                    ? (activeCommunity?.name ?? "Business")
                    : "This device";
              const previousCategory =
                index === 0
                  ? null
                  : index - 1 < 3
                    ? "Personal"
                    : index - 1 < 7
                      ? (activeCommunity?.name ?? "Business")
                      : "This device";
              return (
                <div className="w20-nav-group" key={group.id}>
                  {category !== previousCategory ? (
                    <h2 className="w20-nav-heading">{category}</h2>
                  ) : null}
                  <SettingsGroupButton
                    active={group.id === activeGroup.id}
                    group={group}
                    onSelect={() => chooseGroup(group)}
                  />
                </div>
              );
            })
          )}
        </SidebarContent>

        <SidebarFooter className="w20-nav-footer">
          <div className="w20-nav-person">
            <button
              aria-label="Edit profile photo"
              className="w20-nav-person-avatar"
              data-testid="profile-avatar-edit"
              onClick={() => {
                setAvatarSaved(false);
                setIsAvatarDialogOpen(true);
              }}
              title="Edit profile photo"
              type="button"
            >
              <ProfileAvatar
                avatarUrl={profile.data?.avatarUrl ?? null}
                className="size-full rounded-[7px]"
                label={signedInDisplayName}
                shape="squircle"
                testId="settings-profile-avatar"
              />
            </button>
            <div>
              <strong>{signedInDisplayName}</strong>
              <small>Workspace owner</small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset
        className={cn(
          "w20-settings-shell relative min-h-0 min-w-0 overflow-hidden",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        data-testid="settings-view"
      >
        <div className="w20-settings-topbar">
          <div className="w20-topbar-history">
            <Button
              aria-label="Back"
              data-testid="settings-history-back"
              disabled={!canGoBack}
              onClick={onGoBack}
              size="icon"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              aria-label="Forward"
              data-testid="settings-history-forward"
              disabled={!canGoForward}
              onClick={onGoForward}
              size="icon"
              variant="ghost"
            >
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
          <div className="w20-topbar-title text-settings-topbar">
            <Settings aria-hidden="true" className="size-4" />
            <span className="text-xs">Settings</span>
            <span aria-hidden="true" className="text-xs">
              /
            </span>
            <strong className="truncate">{activeGroup.label}</strong>
          </div>
          <div className="flex-1" />
          <Button
            aria-label="Close settings"
            data-testid="settings-close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
        <main
          className="w20-settings-surface"
          data-testid="settings-content-surface"
        >
          <div
            aria-label={`${activeGroup.label} settings sections`}
            className="w20-inner-tabs"
            role="tablist"
          >
            {activeGroup.sections.map((entry) => (
              <button
                aria-selected={entry.value === activeSection}
                className={cn(
                  "w20-inner-tab",
                  entry.value === activeSection && "is-active",
                )}
                data-testid={`settings-inner-${entry.value}`}
                key={entry.value}
                onClick={() => chooseSection(entry.value)}
                role="tab"
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
          <section
            aria-label={`${activeGroup.label} settings`}
            className={cn(
              "w20-route-scroll",
              activeSection === "appearance" && "w20-route-scroll-appearance",
              activeSection === "channel-templates" &&
                "w20-route-scroll-templates",
            )}
            data-testid="settings-content-scroll"
          >
            <div
              className={cn(
                "w20-route-content",
                ["profile", "security"].includes(activeSection) &&
                  "w20-route-content-account",
                activeSection === "appearance" &&
                  "w20-route-content-appearance",
                activeSection.startsWith("settings/theme") &&
                  "w20-route-content-theme",
                activeSection === "channel-templates" &&
                  "w20-route-content-templates",
              )}
              data-testid={`settings-panel-${activeSection}`}
            >
              {activeSection === "settings/themes" ? (
                <ThemeCatalogRoute
                  onBack={() => chooseSection("appearance")}
                  onPreview={(name) => {
                    setPreviewTheme(name);
                    chooseSection("settings/theme-preview");
                  }}
                />
              ) : activeSection === "settings/theme-preview" ? (
                <ThemePreviewRoute
                  name={previewTheme}
                  onBack={() => chooseSection("settings/themes")}
                  onApply={applyPreviewTheme}
                />
              ) : activeSection === "settings/theme-applied" ? (
                <ThemeAppliedRoute
                  name={previewTheme}
                  onBack={() => chooseSection("settings/themes")}
                  onDone={() => chooseSection("appearance")}
                />
              ) : (
                renderSettingsSection(activeSection, {
                  currentPubkey,
                  avatarSaved,
                  fallbackDisplayName,
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
                  onOpenThemeCatalog: () => chooseSection("settings/themes"),
                  onOpenDraftRecovery: () => chooseSection("recovery"),
                  onClose,
                  onSectionChange: chooseSection,
                })
              )}
            </div>
          </section>
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
