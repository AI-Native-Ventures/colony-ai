import { expect, type Page } from "@playwright/test";

type SettingsSection =
  | "profile"
  | "security"
  | "notifications"
  | "voice"
  | "agents"
  | "agent-defaults"
  | "harnesses"
  | "channel-templates"
  | "compute"
  | "privacy"
  | "appearance"
  | "accessibility"
  | "business-profile"
  | "people"
  | "shortcuts"
  | "community-members"
  | "moderation"
  | "audit"
  | "custom-emoji"
  | "local-archive"
  | "archived-records"
  | "recovery"
  | "storage"
  | "app"
  | "mobile"
  | "updates"
  | "experimental";

const sectionRoute: Record<
  SettingsSection,
  { group: string; section: string }
> = {
  profile: { group: "account", section: "profile" },
  security: { group: "account", section: "security" },
  notifications: { group: "preferences", section: "notifications" },
  voice: { group: "preferences", section: "voice" },
  agents: { group: "agents-group", section: "agent-defaults" },
  "agent-defaults": { group: "agents-group", section: "agent-defaults" },
  harnesses: { group: "agents-group", section: "harnesses" },
  "channel-templates": {
    group: "blocks-templates",
    section: "channel-templates",
  },
  compute: { group: "app-devices", section: "compute" },
  privacy: { group: "app-devices", section: "privacy" },
  appearance: { group: "appearance-group", section: "appearance" },
  accessibility: { group: "appearance-group", section: "accessibility" },
  "business-profile": { group: "business", section: "business-profile" },
  people: { group: "business", section: "people" },
  shortcuts: { group: "preferences", section: "shortcuts" },
  "community-members": { group: "business", section: "people" },
  moderation: { group: "administration", section: "moderation" },
  audit: { group: "administration", section: "audit" },
  "custom-emoji": { group: "blocks-templates", section: "custom-emoji" },
  "local-archive": { group: "storage-group", section: "storage" },
  "archived-records": { group: "storage-group", section: "archived-records" },
  recovery: { group: "storage-group", section: "recovery" },
  storage: { group: "storage-group", section: "storage" },
  app: { group: "app-devices", section: "app" },
  mobile: { group: "app-devices", section: "mobile" },
  updates: { group: "app-devices", section: "updates" },
  experimental: { group: "app-devices", section: "experimental" },
};

export async function openProfileMenu(page: Page) {
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();
}

export async function openSettings(page: Page, section?: SettingsSection) {
  await openProfileMenu(page);
  await page.getByTestId("profile-popover-settings").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();

  if (section) {
    await selectSettingsSection(page, section);
  }
}

export async function openAvatarProfileContext(page: Page) {
  await page.getByTestId("settings-profile-avatar-context").click();
  await expect(page.getByTestId("profile-avatar-edit")).toBeVisible();
}

export async function selectSettingsSection(
  page: Page,
  section: SettingsSection,
) {
  const route = sectionRoute[section];
  const groupButton = page.getByTestId(`settings-group-${route.group}`);
  await groupButton.click();
  await expect(groupButton).toHaveAttribute("aria-pressed", "true");

  const sectionTab = page.getByTestId(`settings-inner-${route.section}`);
  await sectionTab.click();
  await expect(sectionTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByTestId(`settings-panel-${route.section}`),
  ).toBeVisible();
}
