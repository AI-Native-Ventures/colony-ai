import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

type UpdateStatus = Record<string, unknown>;

type FakeUpdaterWindow = Window & {
  __fakeUpdater?: {
    calls: string[];
    refuseInstallWith?: UpdateStatus;
    push: (status: UpdateStatus) => void;
  };
};

const DOWNLOAD_URL = "https://colony.global/#download";

/**
 * Stands in for the Electron preload's `window.colonyDesktop.updater`, so the
 * cards can be driven through the same states the main-process updater pushes
 * (downloading with progress, ready with a version, a refused update with the
 * manual link).
 */
async function installFakeElectronUpdater(page: Page, initial: UpdateStatus) {
  await installMockBridge(page);
  await page.addInitScript((initialStatus) => {
    const listeners = new Set<(status: UpdateStatus) => void>();
    let current = initialStatus as UpdateStatus;
    const fake: NonNullable<FakeUpdaterWindow["__fakeUpdater"]> = {
      calls: [],
      push(status) {
        current = status;
        for (const listener of listeners) listener(status);
      },
    };
    (window as FakeUpdaterWindow).__fakeUpdater = fake;
    Object.defineProperty(window, "colonyDesktop", {
      configurable: true,
      value: {
        // The Electron shim reads these when it loads; the Tauri mock then
        // replaces its internals, so only the updater is exercised.
        platform: "darwin",
        windowLabel: "main",
        request: async () => null,
        subscribe: () => () => {},
        updater: {
          getStatus: async () => current,
          check: async () => {
            fake.calls.push("check");
            return current;
          },
          install: async () => {
            fake.calls.push("install");
            if (fake.refuseInstallWith) {
              fake.push(fake.refuseInstallWith);
              return false;
            }
            return true;
          },
          subscribe: (callback: (status: UpdateStatus) => void) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
          },
        },
      },
    });
  }, initial);
}

async function push(page: Page, status: UpdateStatus) {
  await page.evaluate(
    (next) => (window as FakeUpdaterWindow).__fakeUpdater?.push(next),
    status,
  );
}

async function openUpdatesSettings(page: Page) {
  await page.getByTestId("sidebar-profile-card").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-app-devices").click();
  await page.getByTestId("settings-inner-updates").click();
}

async function openedUrls(page: Page) {
  return page.evaluate(() =>
    (
      window as Window & {
        __TAURI_INTERNALS__: { invoke: (name: string) => Promise<string[]> };
      }
    ).__TAURI_INTERNALS__.invoke("get_e2e_opened_external_urls"),
  );
}

test("a Mac update that is ready names its version and installs on one click", async ({
  page,
}) => {
  await installFakeElectronUpdater(page, { state: "idle" });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("sidebar-update-card")).toHaveCount(0);

  await push(page, { state: "ready", version: "3.0.91" });
  const card = page.getByTestId("sidebar-update-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Ready to update!");

  await openUpdatesSettings(page);
  await expect(page.getByTestId("settings-panel-updates")).toContainText(
    "Update v3.0.91 is ready. Colony will restart to apply it.",
  );
  await page.getByTestId("settings-back-to-app").click();

  await page.getByTestId("sidebar-update-now").click();
  await expect(card).toContainText("Updating");
  await expect
    .poll(() =>
      page.evaluate(() => (window as FakeUpdaterWindow).__fakeUpdater?.calls),
    )
    .toEqual(["install"]);
});

test("download progress shows in Settings and the sidebar stays quiet", async ({
  page,
}) => {
  await installFakeElectronUpdater(page, {
    state: "downloading",
    percent: 0,
  });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await openUpdatesSettings(page);

  const panel = page.getByTestId("settings-panel-updates");
  await expect(panel).toContainText("Downloading update... 0%");
  await push(page, { state: "downloading", percent: 42 });
  await expect(panel).toContainText("Downloading update... 42%");
  await expect(page.getByTestId("updates-action")).toHaveCount(0);

  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("sidebar-update-card")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-update-card-manual")).toHaveCount(0);
});

test("a refused Mac update shows what happened and the colony.global link", async ({
  page,
}) => {
  await installFakeElectronUpdater(page, { state: "idle" });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  const message =
    "The downloaded update did not match its checksum, so it was not installed.";
  await push(page, { state: "error", message, releaseUrl: DOWNLOAD_URL });

  const card = page.getByTestId("sidebar-update-card-error");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Update not installed");
  await expect(card).toContainText(message);
  await expect(page.getByTestId("sidebar-update-card")).toHaveCount(0);

  await page.getByTestId("sidebar-update-download-error").click();
  await expect.poll(() => openedUrls(page)).toEqual([DOWNLOAD_URL]);

  await openUpdatesSettings(page);
  const panel = page.getByTestId("settings-panel-updates");
  await expect(panel).toContainText(`Update failed: ${message}`);
  await expect(page.getByTestId("updates-action")).toHaveText("Retry");
  await page.getByTestId("updates-secondary-action").click();
  await expect
    .poll(() => openedUrls(page))
    .toEqual([DOWNLOAD_URL, DOWNLOAD_URL]);
});

test("a failed check without a manual link adds no card", async ({ page }) => {
  await installFakeElectronUpdater(page, { state: "idle" });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await push(page, { state: "error", message: "Update check failed." });
  await openUpdatesSettings(page);
  await expect(page.getByTestId("settings-panel-updates")).toContainText(
    "Update failed: Update check failed.",
  );
  await expect(page.getByTestId("updates-secondary-action")).toHaveCount(0);
  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("sidebar-update-card-error")).toHaveCount(0);
});

test("an install the updater refuses keeps its own explanation", async ({
  page,
}) => {
  await installFakeElectronUpdater(page, { state: "ready", version: "3.0.91" });
  await page.goto("/");
  await expect(page.getByTestId("sidebar-update-card")).toBeVisible();
  await page.evaluate(() => {
    const fake = (window as FakeUpdaterWindow).__fakeUpdater;
    if (fake) {
      fake.refuseInstallWith = {
        state: "error",
        message:
          "The downloaded update failed its signature check, so it was not installed.",
        releaseUrl: "https://colony.global/#download",
      };
    }
  });

  await page.getByTestId("sidebar-update-now").click();
  const card = page.getByTestId("sidebar-update-card-error");
  await expect(card).toBeVisible();
  await expect(card).toContainText("failed its signature check");
  await openUpdatesSettings(page);
  await expect(page.getByTestId("settings-panel-updates")).not.toContainText(
    "Automatic updates aren't available",
  );
});
