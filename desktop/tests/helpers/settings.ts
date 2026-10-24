import { expect, type Page } from "@playwright/test";

type SettingsSection =
  | "profile"
  | "security"
  | "notifications"
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
  | "experimental";

const sectionRoute: Record<
  SettingsSection,
  { group: string; section: string }
> = {
  profile: { group: "account", section: "profile" },
  security: { group: "account", section: "security" },
  notifications: { group: "preferences", section: "notifications" },
  agents: { group: "agents-group", section: "agent-defaults" },
  "agent-defaults": { group: "agents-group", section: "agent-defaults" },
  harnesses: { group: "agents-group", section: "harnesses" },
  privacy: { group: "app-devices", section: "privacy" },
  appearance: { group: "appearance-group", section: "appearance" },
  accessibility: { group: "appearance-group", section: "accessibility" },
  "business-profile": { group: "business", section: "business-profile" },
  people: { group: "business", section: "people" },
  shortcuts: { group: "preferences", section: "shortcuts" },
  "community-members": { group: "business", section: "people" },
  "custom-emoji": { group: "blocks-templates", section: "custom-emoji" },
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

/** The footer person opens the Account page, where Change photo lives. */
/** The Account page carries the photo and its Change photo button itself. */
export async function openAvatarProfileContext(page: Page) {
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

  // A page with one section has no tab bar.
  const sectionTab = page.getByTestId(`settings-inner-${route.section}`);
  if ((await sectionTab.count()) > 0) {
    await sectionTab.click();
    await expect(sectionTab).toHaveAttribute("aria-selected", "true");
  }
  await expect(
    page.getByTestId(`settings-panel-${route.section}`),
  ).toBeVisible();
}
