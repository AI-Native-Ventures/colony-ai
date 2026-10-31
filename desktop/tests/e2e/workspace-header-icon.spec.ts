import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const MOCK_PUBKEY = "deadbeef".repeat(8);
const RELAY_URL = (
  process.env.BUZZ_E2E_RELAY_URL ?? "http://localhost:3000"
).replace(/^http/u, "ws");
const COMMUNITY_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='12' fill='%23f5a4d5'/%3E%3Cg fill='%2325222c'%3E%3Ccircle cx='12' cy='20' r='4'/%3E%3Ccircle cx='20' cy='20' r='5'/%3E%3Ccircle cx='29' cy='20' r='4'/%3E%3C/g%3E%3C/svg%3E";
const CAPTURE_DIR = process.env.WS_HEADER_CAPTURE_DIR;
const CAPTURE_PHASE = process.env.WS_HEADER_CAPTURE_PHASE ?? "capture";
const COMMUNITY_THEME_KEY =
  "buzz-community-theme.v1:" +
  MOCK_PUBKEY +
  ":" +
  encodeURIComponent(RELAY_URL);

async function seedWorkspace(
  page: Page,
  options: {
    icon?: string;
    logoUrl?: string;
    theme?: "light" | "dark";
  } = {},
) {
  const theme = options.theme === "dark" ? "buzz-dark" : "buzz";
  await page.addInitScript(
    ({ communityThemeKey, icon, logoUrl, relayUrl, theme, pubkey }) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify([
          {
            id: "workspace-header-icon",
            name: "Colony",
            relayUrl,
            pubkey,
            addedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      );
      window.localStorage.setItem(
        "buzz-active-community-id",
        "workspace-header-icon",
      );
      window.localStorage.setItem(
        "buzz-community-icons",
        JSON.stringify(icon ? { [relayUrl]: icon } : {}),
      );
      if (logoUrl) {
        window.localStorage.setItem(
          `colony-business-profile.v1:${"workspace-header-icon"}`,
          JSON.stringify({
            name: "Colony",
            website: "",
            description: "",
            logoDataUrl: null,
            logoUrl,
          }),
        );
      }
      window.localStorage.setItem("buzz-theme", theme);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem(
        communityThemeKey,
        JSON.stringify({
          version: 1,
          theme,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    {
      communityThemeKey: COMMUNITY_THEME_KEY,
      icon: options.icon ?? null,
      logoUrl: options.logoUrl ?? null,
      relayUrl: RELAY_URL,
      theme,
      pubkey: MOCK_PUBKEY,
    },
  );
  await installMockBridge(page, undefined, { skipCommunitySeed: true });
}

const SIGN_IN_BUSINESS_ID = "signed-in-business";
const SIGN_IN_RELAY_URL = "wss://signed-in-business.accounts-test.example";
const BUSINESS_LOGO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='12' fill='%2368c8bf'/%3E%3C/svg%3E";

async function openReturningBusinessList(
  page: Page,
  options: {
    theme?: "light" | "dark";
    capture?: string;
    viewport?: { width: number; height: number };
    includeProfileLogo?: boolean;
    communityIcon?: string | null;
    holdCommunityIconFetch?: boolean;
  } = {},
) {
  const theme = options.theme === "dark" ? "buzz-dark" : "buzz";
  await page.addInitScript(
    ({ icon, profileKey, relayUrl, theme, profileLogo }) => {
      window.localStorage.setItem(
        "buzz-community-icons",
        JSON.stringify(icon ? { [relayUrl]: icon } : {}),
      );
      window.localStorage.setItem("buzz-theme", theme);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem(
        profileKey,
        JSON.stringify({
          name: "Lerato Social",
          website: "https://lerato.example",
          description: "",
          logoDataUrl: null,
          logoUrl: profileLogo,
        }),
      );
    },
    {
      icon:
        options.communityIcon === undefined
          ? COMMUNITY_ICON
          : options.communityIcon,
      profileKey: `colony-business-profile.v1:${SIGN_IN_BUSINESS_ID}`,
      relayUrl: SIGN_IN_RELAY_URL,
      theme,
      profileLogo: options.includeProfileLogo ? BUSINESS_LOGO : null,
    },
  );
  await installMockBridge(
    page,
    { accountLinked: true, accountEmail: "lerato@example.com" },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: "accounts-test.example",
        public: true,
        max_per_owner: 3,
      },
    }),
  );
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: {
        owner_pubkey: MOCK_PUBKEY,
        communities: [
          {
            id: SIGN_IN_BUSINESS_ID,
            name: "Lerato Social",
            slug: "lerato-social",
            normalized_host: new URL(SIGN_IN_RELAY_URL).hostname,
            owner_pubkey: MOCK_PUBKEY,
          },
        ],
      },
    }),
  );
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
  if (options.holdCommunityIconFetch) {
    await page.evaluate((icon) => {
      type IconFetchWindow = Window & {
        __TAURI_INTERNALS__?: {
          invoke?: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        __workspaceIconFetchPending?: boolean;
        __releaseWorkspaceIconFetch?: () => void;
      };
      const target = window as IconFetchWindow;
      const internals = target.__TAURI_INTERNALS__;
      if (!internals?.invoke) {
        throw new Error("Tauri mock invoke is unavailable");
      }
      const invoke = internals.invoke.bind(internals);
      target.__workspaceIconFetchPending = false;
      internals.invoke = (command, args) => {
        if (command !== "fetch_workspace_icon") {
          return invoke(command, args);
        }
        target.__workspaceIconFetchPending = true;
        return new Promise((resolve) => {
          target.__releaseWorkspaceIconFetch = () => {
            target.__workspaceIconFetchPending = false;
            target.__releaseWorkspaceIconFetch = undefined;
            resolve(icon);
          };
        });
      };
    }, COMMUNITY_ICON);
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-signin")).toBeVisible();
  await page.getByLabel("Email address").fill("lerato@example.com");
  await page.locator("#signin-password").fill("studio-afternoons");
  await page.getByTestId("account-auth-submit-signin").click();
  await expect(page.getByTestId("onboarding-business-list")).toBeVisible();
  if (options.holdCommunityIconFetch) {
    await page.waitForFunction(() => {
      type IconFetchWindow = Window & {
        __workspaceIconFetchPending?: boolean;
      };
      return (window as IconFetchWindow).__workspaceIconFetchPending === true;
    });
  }

  if (options.capture && CAPTURE_DIR) {
    mkdirSync(CAPTURE_DIR, { recursive: true });
    await waitForAnimations(page);
    await page.screenshot({
      fullPage: false,
      path: join(CAPTURE_DIR, `${CAPTURE_PHASE}-${options.capture}.png`),
    });
  }
}

async function openSidebar(page: Page) {
  const businessSwitcher = page.getByTestId("sidebar-business-switcher");
  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 768) {
    await setDesktopSidebarCollapsed(page, false);
  }
  if (!(await businessSwitcher.isVisible())) {
    const mobileSidebarTrigger = page
      .locator('[data-sidebar="trigger"]:visible')
      .first();
    await expect(mobileSidebarTrigger).toBeVisible();
    await mobileSidebarTrigger.click();
  }
  await expect(businessSwitcher).toBeVisible();
}

async function setDesktopSidebarCollapsed(page: Page, collapsed: boolean) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width < 768) return;
  const sidebar = page.getByTestId("app-sidebar");
  const sidebarShell = sidebar.locator("xpath=..");
  const currentCollapsed =
    (await sidebarShell.getAttribute("data-collapsible")) === "icon";
  if (currentCollapsed !== collapsed) {
    await sidebar.locator(".colony-sidebar-collapse").click();
  }
  if (collapsed) {
    await expect(sidebarShell).toHaveAttribute("data-collapsible", "icon");
  } else {
    await expect(sidebarShell).not.toHaveAttribute("data-collapsible", "icon");
  }
}

async function openProfileCommunitySwitcher(page: Page) {
  await page.getByTestId("sidebar-business-switcher").click();
  const communityRow = page.getByTestId("profile-popover-community");
  await expect(communityRow).toBeVisible();
  return communityRow.getByTestId("community-switcher");
}

test("header icon matches the community switcher and remains in the collapsed sidebar", async ({
  page,
}) => {
  await seedWorkspace(page, { icon: COMMUNITY_ICON });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/today");
  await openSidebar(page);

  const brandMark = page.getByTestId("sidebar-community-brand-mark");
  const headerImage = brandMark.locator("img");
  await expect(headerImage).toHaveCount(1);
  await expect(headerImage).toBeVisible();
  await expect(headerImage).toHaveAttribute("src", COMMUNITY_ICON);
  await expect(brandMark.locator(".colony-sidebar-brand-dot")).toHaveCount(0);

  const communitySwitcher = await openProfileCommunitySwitcher(page);
  const switcherImage = communitySwitcher.locator("img");
  await expect(switcherImage).toBeVisible();
  expect(await headerImage.getAttribute("src")).toBe(
    await switcherImage.getAttribute("src"),
  );

  await page.keyboard.press("Escape");
  await setDesktopSidebarCollapsed(page, true);
  await expect(headerImage).toBeVisible();
  const tile = await brandMark.boundingBox();
  expect(tile?.width).toBe(40);
  expect(tile?.height).toBe(40);
});

test("header keeps the letter tile when the community has no icon", async ({
  page,
}) => {
  await seedWorkspace(page);
  await page.goto("/#/today");
  await openSidebar(page);

  const brandMark = page.getByTestId("sidebar-community-brand-mark");
  await expect(
    brandMark.getByTestId("sidebar-community-brand-fallback"),
  ).toHaveText("C");
  await expect(brandMark.locator("img")).toHaveCount(0);
  await expect(brandMark.locator(".colony-sidebar-brand-dot")).toBeVisible();
});

test("header falls back to the saved business logo when the community icon fails", async ({
  page,
}) => {
  const brokenIcon = "https://icon.invalid/workspace-icon-unavailable.png";
  await page.route("**/workspace-icon-unavailable.png", (route) =>
    route.abort(),
  );
  await seedWorkspace(page, { icon: brokenIcon, logoUrl: BUSINESS_LOGO });
  await page.goto("/#/today");
  await openSidebar(page);

  const brandMark = page.getByTestId("sidebar-community-brand-mark");
  const fallbackLogo = brandMark.locator("img");
  await expect(fallbackLogo).toHaveAttribute("src", BUSINESS_LOGO);
  await expect(fallbackLogo).toBeVisible();
  await expect(brandMark).toHaveAttribute("data-source", "profile");
  await expect(brandMark.locator(".colony-sidebar-brand-dot")).toHaveCount(0);
});

test("returning-user business list prefers the cached community icon over its saved logo", async ({
  page,
}) => {
  await openReturningBusinessList(page, {
    holdCommunityIconFetch: true,
    includeProfileLogo: true,
  });
  const business = page.getByTestId(
    `onboarding-business-${SIGN_IN_BUSINESS_ID}`,
  );
  const mark = business.locator(".c3fr-mark");
  const image = mark.locator("img");
  await expect(image).toHaveAttribute("src", COMMUNITY_ICON);
  await expect(image).toBeVisible();
  await expect(mark).toHaveAttribute("data-source", "community");
  await expect(mark).toHaveText("");
  await page.evaluate(() => {
    type IconFetchWindow = Window & {
      __releaseWorkspaceIconFetch?: () => void;
    };
    (window as IconFetchWindow).__releaseWorkspaceIconFetch?.();
  });
  await expect(image).toHaveAttribute("src", COMMUNITY_ICON);
});

test("returning-user business list falls back to its saved logo", async ({
  page,
}) => {
  await openReturningBusinessList(page, {
    communityIcon: null,
    includeProfileLogo: true,
  });
  const businessWithLogo = page.getByTestId(
    `onboarding-business-${SIGN_IN_BUSINESS_ID}`,
  );
  const logoMark = businessWithLogo.locator(".c3fr-mark");
  await expect(logoMark).toHaveAttribute("data-source", "profile");
  await expect(logoMark.locator("img")).toHaveAttribute("src", BUSINESS_LOGO);
  await expect(logoMark.locator("img")).toBeVisible();
});

test("returning-user business list shows the initial when no icon or logo exists", async ({
  page,
}) => {
  await openReturningBusinessList(page, { communityIcon: null });
  const business = page.getByTestId(
    `onboarding-business-${SIGN_IN_BUSINESS_ID}`,
  );
  const mark = business.locator(".c3fr-mark");
  await expect(mark).toHaveAttribute("data-source", "initial");
  await expect(mark.locator("img")).toHaveCount(0);
  await expect(mark).toHaveText("L");
});

const captureViews = [
  { key: "expanded-1440-light", width: 1440, height: 900, theme: "light" },
  { key: "expanded-1440-dark", width: 1440, height: 900, theme: "dark" },
  { key: "expanded-390-light", width: 390, height: 844, theme: "light" },
  { key: "expanded-390-dark", width: 390, height: 844, theme: "dark" },
  {
    key: "collapsed-1440-light",
    width: 1440,
    height: 900,
    theme: "light",
    collapsed: true,
  },
  {
    key: "collapsed-1440-dark",
    width: 1440,
    height: 900,
    theme: "dark",
    collapsed: true,
  },
] as const;

for (const view of captureViews) {
  test(`captures owner view: ${view.key}`, async ({ page }) => {
    test.skip(
      !CAPTURE_DIR,
      "Set WS_HEADER_CAPTURE_DIR to write review captures.",
    );
    mkdirSync(CAPTURE_DIR as string, { recursive: true });
    await page.setViewportSize({ width: view.width, height: view.height });
    await seedWorkspace(page, {
      icon: COMMUNITY_ICON,
      theme: view.theme,
    });
    await page.goto("/#/today");
    await openSidebar(page);

    await setDesktopSidebarCollapsed(
      page,
      "collapsed" in view && view.collapsed,
    );
    await waitForAnimations(page);
    await page.screenshot({
      fullPage: false,
      path: join(CAPTURE_DIR as string, `${CAPTURE_PHASE}-${view.key}.png`),
    });
  });
}

const signInCaptureViews = [
  {
    key: "signin-businesses-1440-light",
    width: 1440,
    height: 960,
    theme: "light",
  },
  {
    key: "signin-businesses-1440-dark",
    width: 1440,
    height: 960,
    theme: "dark",
  },
  {
    key: "signin-businesses-390-light",
    width: 390,
    height: 844,
    theme: "light",
  },
  { key: "signin-businesses-390-dark", width: 390, height: 844, theme: "dark" },
] as const;

for (const view of signInCaptureViews) {
  test(`captures owner view: ${view.key}`, async ({ page }) => {
    test.skip(
      !CAPTURE_DIR,
      "Set WS_HEADER_CAPTURE_DIR to write review captures.",
    );
    await openReturningBusinessList(page, {
      capture: view.key,
      theme: view.theme,
      viewport: { width: view.width, height: view.height },
    });
  });
}
