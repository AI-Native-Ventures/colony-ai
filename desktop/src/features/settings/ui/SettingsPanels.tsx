import type {
  DesktopNotificationPermissionState,
  NotificationSettings,
} from "@/features/notifications/hooks";
import type { SoundName, SoundSlot } from "@/features/notifications/lib/sound";
import { CommunityMembersSettingsCard } from "@/features/community-members/ui/CommunityMembersSettingsCard";
import { CustomEmojiSettingsCard } from "@/features/custom-emoji/ui/CustomEmojiSettingsCard";
import { ExperimentalFeaturesCard } from "./ExperimentalFeaturesCard";
import { KeyboardShortcutsCard } from "./KeyboardShortcutsCard";
import { MobilePairingCard } from "./MobilePairingCard";
import { NotificationSettingsCard } from "./NotificationSettingsCard";
import { AccountProfileSettingsPanel } from "./AccountProfileSettingsPanel";
import { AccountSecuritySettingsPanel } from "./AccountSecuritySettingsPanel";
import { UpdateChecker } from "../UpdateChecker";
import {
  AccountIcon,
  AppearanceIcon,
  BlocksIcon,
  DeviceIcon,
  PreferencesIcon,
  SettingsAgentsIcon,
  SettingsBusinessIcon,
} from "./settingsIcons";
import { DevicePrivacySettingsPanel } from "./DevicePrivacySettingsPanel";
import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel";
import { AgentDefaultsSettingsCard } from "./AgentDefaultsSettingsCard";
import { AccessibilitySettingsPanel } from "./AccessibilitySettingsPanel";
import { BusinessProfileSettingsPanel } from "./BusinessProfileSettingsPanel";
import {
  AppPreferencesSettingsPanel,
  FeedbackSettingsPanel,
  HarnessLifecycleSettingsPanel,
} from "./SettingsAdditionalSections";

export type SettingsSection =
  | "profile"
  | "security"
  | "notifications"
  | "experimental"
  | "agents"
  | "agent-defaults"
  | "harnesses"
  | "privacy"
  | "appearance"
  | "accessibility"
  | "business-profile"
  | "people"
  | "shortcuts"
  | "community-members"
  | "custom-emoji"
  | "app"
  | "mobile"
  | "updates"
  | "feedback";

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "profile";

export type SettingsGroupId =
  | "account"
  | "appearance-group"
  | "preferences"
  | "business"
  | "agents-group"
  | "blocks-templates"
  | "app-devices";

export type SettingsInnerSection = {
  value: SettingsSection;
  label: string;
};

export type SettingsGroupDescriptor = {
  id: SettingsGroupId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** The page title (the Appearance page greets instead of naming itself). */
  title: string;
  /** The line under the page title; `{business}` is the business name. */
  subtitle: string;
  sections: SettingsInnerSection[];
};

/**
 * The Settings groups, one long page each (`Settings*.dc.html`). Storage,
 * administration (reports) and channel templates are cut from the lean build,
 * so they have no row; their code stays and nothing links to it.
 */
export const settingsGroups: SettingsGroupDescriptor[] = [
  {
    id: "account",
    label: "Account",
    icon: AccountIcon,
    title: "Account",
    subtitle: "How you appear to people and agents in {business}.",
    sections: [
      { value: "profile", label: "Profile" },
      { value: "security", label: "Sign-in & devices" },
    ],
  },
  {
    id: "appearance-group",
    label: "Appearance",
    icon: AppearanceIcon,
    title: "Make yourself at home.",
    subtitle: "Your appearance in {business}.",
    sections: [
      { value: "appearance", label: "Theme & layout" },
      { value: "accessibility", label: "Accessibility" },
    ],
  },
  {
    id: "preferences",
    label: "Preferences",
    icon: PreferencesIcon,
    title: "Preferences",
    subtitle: "When Colony gets your attention, and how it sounds.",
    sections: [
      { value: "notifications", label: "Notifications & sounds" },
      { value: "shortcuts", label: "Keyboard shortcuts" },
    ],
  },
  {
    id: "business",
    label: "Business",
    icon: SettingsBusinessIcon,
    title: "Business",
    subtitle: "{business}\u2019s profile, and who can get in.",
    sections: [
      { value: "business-profile", label: "Profile" },
      { value: "people", label: "People & access" },
    ],
  },
  {
    id: "agents-group",
    label: "Agents",
    icon: SettingsAgentsIcon,
    title: "Agents",
    subtitle:
      "How the agents in {business} reach AI, unless an agent is set up its own way.",
    sections: [
      { value: "agent-defaults", label: "Defaults" },
      { value: "harnesses", label: "Harnesses" },
    ],
  },
  {
    // "Blocks & templates" without the templates (cut): custom emoji stays.
    id: "blocks-templates",
    label: "Custom emoji",
    icon: BlocksIcon,
    title: "Custom emoji",
    subtitle: "Emoji your business adds for everyone to use.",
    sections: [{ value: "custom-emoji", label: "Custom emoji" }],
  },
  {
    id: "app-devices",
    label: "App & devices",
    icon: DeviceIcon,
    title: "App & devices",
    subtitle: "Settings for this Mac only.",
    sections: [
      { value: "app", label: "App preferences" },
      { value: "privacy", label: "Privacy" },
      { value: "experimental", label: "Experiments" },
      { value: "mobile", label: "Mobile" },
      { value: "updates", label: "Updates" },
    ],
  },
];

/** The sidebar's three headings and the group rows under each. */
export function settingsNavCategory(businessName: string) {
  const byId = (...ids: SettingsGroupId[]) =>
    ids
      .map((id) => settingsGroups.find((group) => group.id === id))
      .filter((group): group is SettingsGroupDescriptor => Boolean(group));
  return [
    {
      label: "Personal",
      groups: byId("account", "appearance-group", "preferences"),
    },
    {
      label: businessName,
      groups: byId("business", "agents-group", "blocks-templates"),
    },
    { label: "This device", groups: byId("app-devices") },
  ];
}

/** Old addresses that still mean something. */
const SETTINGS_SECTION_ALIASES: Partial<Record<string, SettingsSection>> = {
  agents: "agent-defaults",
  "community-members": "people",
};

export function canonicalSettingsSection(
  section: SettingsSection,
): SettingsSection {
  return SETTINGS_SECTION_ALIASES[section] ?? section;
}

const SETTINGS_SECTION_VALUES: readonly SettingsSection[] = [
  "profile",
  "security",
  "notifications",
  "experimental",
  "agents",
  "agent-defaults",
  "harnesses",
  "privacy",
  "appearance",
  "accessibility",
  "business-profile",
  "people",
  "shortcuts",
  "community-members",
  "custom-emoji",
  "app",
  "mobile",
  "updates",
  "feedback",
];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTION_VALUES as readonly string[]).includes(value)
  );
}

export type SettingsPanelProps = {
  currentPubkey?: string;
  fallbackDisplayName?: string;
  avatarSaved?: boolean;
  onClose?: () => void;
  onSectionChange?: (section: SettingsSection) => void;
  isUpdatingDesktopNotifications: boolean;
  notificationErrorMessage: string | null;
  notificationPermission: DesktopNotificationPermissionState;
  notificationSettings: NotificationSettings;
  onSetDesktopNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  onSetHomeBadgeEnabled: (enabled: boolean) => void;
  onSetSlotAlertsEnabled: (slot: SoundSlot, enabled: boolean) => void;
  onSetNotifyWhileViewing: (enabled: boolean) => void;
  onSetAllSlotAlertsEnabled: (enabled: boolean) => void;
  onSetSoundForSlot: (slot: SoundSlot, name: SoundName) => void;
  onEditAvatar?: () => void;
  /** Opens the Team page, where AI employees are managed. */
  onOpenTeam?: () => void;
};

export function renderSettingsSection(
  section: SettingsSection,
  props: SettingsPanelProps,
): React.ReactNode {
  switch (section) {
    case "profile":
      return (
        <AccountProfileSettingsPanel
          avatarSaved={props.avatarSaved ?? false}
          fallbackDisplayName={props.fallbackDisplayName}
          onEditAvatar={props.onEditAvatar}
          onSectionChange={props.onSectionChange ?? (() => undefined)}
        />
      );
    case "security":
      return <AccountSecuritySettingsPanel />;
    case "notifications":
      return (
        <NotificationSettingsCard
          isUpdatingDesktopNotifications={props.isUpdatingDesktopNotifications}
          notificationErrorMessage={props.notificationErrorMessage}
          notificationPermission={props.notificationPermission}
          notificationSettings={props.notificationSettings}
          onSetDesktopNotificationsEnabled={
            props.onSetDesktopNotificationsEnabled
          }
          onSetHomeBadgeEnabled={props.onSetHomeBadgeEnabled}
          onSetSlotAlertsEnabled={props.onSetSlotAlertsEnabled}
          onSetNotifyWhileViewing={props.onSetNotifyWhileViewing}
          onSetAllSlotAlertsEnabled={props.onSetAllSlotAlertsEnabled}
          onSetSoundForSlot={props.onSetSoundForSlot}
        />
      );
    case "experimental":
      return <ExperimentalFeaturesCard />;
    case "agents":
    case "agent-defaults":
      return (
        <AgentDefaultsSettingsCard
          onOpenHarnesses={() => props.onSectionChange?.("harnesses")}
        />
      );
    case "harnesses":
      return <HarnessLifecycleSettingsPanel />;
    case "appearance":
      return <AppearanceSettingsPanel />;
    case "privacy":
      return <DevicePrivacySettingsPanel />;
    case "accessibility":
      return <AccessibilitySettingsPanel />;
    case "business-profile":
      return <BusinessProfileSettingsPanel />;
    case "people":
      return (
        <CommunityMembersSettingsCard
          currentPubkey={props.currentPubkey}
          onBack={() => props.onSectionChange?.("business-profile")}
          onOpenTeam={props.onOpenTeam}
        />
      );
    case "shortcuts":
      return <KeyboardShortcutsCard />;
    case "community-members":
      return (
        <CommunityMembersSettingsCard
          currentPubkey={props.currentPubkey}
          onBack={() => props.onSectionChange?.("business-profile")}
        />
      );
    case "custom-emoji":
      return <CustomEmojiSettingsCard />;
    case "app":
      return <AppPreferencesSettingsPanel />;
    case "mobile":
      return <MobilePairingCard currentPubkey={props.currentPubkey} />;
    case "updates":
      return <UpdateChecker />;
    case "feedback":
      return <FeedbackSettingsPanel />;
    default: {
      const exhaustiveCheck: never = section;
      return exhaustiveCheck;
    }
  }
}
