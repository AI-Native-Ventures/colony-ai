import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/lockedBrowserTest";
import { fixture } from "./cofounder-map-fixtures";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { mapShellCofounderEnabledStorageKey } from "../../src/features/map-shell/mapShellLaunchState";

const DEFAULT_COMMUNITY_SCOPE = {
  id: "e2e-default-community",
  relayUrl: "ws://localhost:3000",
};

type LaunchSurfaceObservations = {
  legacy: string[];
  map: string[];
};

async function watchLaunchSurfaces(page: Page) {
  await page.addInitScript(() => {
    const legacySelectors = [
      '[data-testid="app-sidebar-layer"]',
      '[data-testid="app-sidebar"]',
      '[data-testid="community-rail"]',
      '[data-testid="home-inbox-list"]',
    ];
    const mapSelectors = [
      '[data-testid="map-shell-bar"]',
      '[data-testid="cofounder-company-map"]',
    ];
    const observations: LaunchSurfaceObservations = { legacy: [], map: [] };

    const recordMatches = (node: Node) => {
      if (!(node instanceof Element)) return;
      for (const selector of legacySelectors) {
        if (node.matches(selector) || node.querySelector(selector)) {
          observations.legacy.push(selector);
        }
      }
      for (const selector of mapSelectors) {
        if (node.matches(selector) || node.querySelector(selector)) {
          observations.map.push(selector);
        }
      }
    };

    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) recordMatches(node);
      }
    }).observe(document, { childList: true, subtree: true });

    (
      window as Window & {
        __MAP_HOME_LAUNCH_SURFACES__?: LaunchSurfaceObservations;
      }
    ).__MAP_HOME_LAUNCH_SURFACES__ = observations;
  });
}

async function launchSurfaceObservations(
  page: Page,
): Promise<LaunchSurfaceObservations> {
  return page.evaluate(() => {
    return (
      (
        window as Window & {
          __MAP_HOME_LAUNCH_SURFACES__?: LaunchSurfaceObservations;
        }
      ).__MAP_HOME_LAUNCH_SURFACES__ ?? { legacy: [], map: [] }
    );
  });
}

test("default map home never mounts the legacy shell while co-founder settings are delayed", async ({
  page,
}) => {
  await watchLaunchSurfaces(page);
  await installMockBridge(
    page,
    {
      ...fixture({ enabled: true }),
      cofounderSettingsReadDelaysMs: [2_000],
    },
    { seedPreviewFeatures: false },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");

  expect(
    await page.evaluate(
      (key) => window.localStorage.getItem(key),
      FEATURE_OVERRIDES_STORAGE_KEY,
    ),
  ).toBeNull();
  await expect(page.getByTestId("map-shell-launch-frame")).toBeVisible();
  expect((await launchSurfaceObservations(page)).legacy).toEqual([]);

  await expect(page.getByTestId("cofounder-company-map")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("map-shell-bar")).toBeVisible();
  expect((await launchSurfaceObservations(page)).legacy).toEqual([]);
});

test("cached enabled co-founder mode keeps the map after settings reads fail", async ({
  page,
}) => {
  await watchLaunchSurfaces(page);
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, "true");
  }, mapShellCofounderEnabledStorageKey(DEFAULT_COMMUNITY_SCOPE));
  await installMockBridge(
    page,
    {
      ...fixture({ enabled: true }),
      cofounderSettingsReadErrors: [
        "intentional co-founder settings read failure",
        "intentional co-founder settings read failure",
      ],
    },
    { seedPreviewFeatures: false },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");

  await expect(page.getByTestId("map-shell-bar")).toBeVisible();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const config = (
          window as Window & {
            __BUZZ_E2E__?: {
              mock?: { cofounderSettingsReadErrors?: string[] };
            };
          }
        ).__BUZZ_E2E__;
        return config?.mock?.cofounderSettingsReadErrors?.length ?? -1;
      }),
    )
    .toBe(0);
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  expect((await launchSurfaceObservations(page)).legacy).toEqual([]);
});

test("co-founder mode off settles on the legacy shell without mounting the map", async ({
  page,
}) => {
  await watchLaunchSurfaces(page);
  await installMockBridge(
    page,
    {
      ...fixture({ enabled: false }),
      cofounderSettingsReadDelaysMs: [200],
    },
    { seedPreviewFeatures: false },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");

  await expect(page.getByTestId("map-shell-launch-frame")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("map-shell-bar")).toHaveCount(0);
  await expect(page.getByTestId("cofounder-company-map")).toHaveCount(0);
  expect((await launchSurfaceObservations(page)).map).toEqual([]);
});
