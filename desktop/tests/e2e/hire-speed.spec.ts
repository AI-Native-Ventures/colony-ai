import { expect } from "@playwright/test";

import { TEST_IDENTITIES } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import { fixture, selectMapPart } from "./cofounder-map-fixtures";
import { prepareMapShell } from "./mapShellTestSupport";

const INTRODUCTION_CHANNEL = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "general",
};

async function chooseRuntimeAndModel(page: import("@playwright/test").Page) {
  await page.getByTestId("prebuilt-hire-harness").click();
  await page.getByTestId("prebuilt-hire-harness-option-goose").click();
  await page.getByTestId("prebuilt-hire-model").click();
  await page
    .locator("[data-testid^='prebuilt-hire-model-option-']")
    .first()
    .click();
  await expect(page.getByTestId("prebuilt-hire-finish")).toBeEnabled();
}

test("a slow failed agent start closes the hire and keeps a visible retry on the map", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("company-map-prebuilt-")) {
        window.localStorage.removeItem(key);
      }
    }
  });
  await prepareMapShell(page, {
    cofounderEnabled: true,
    featureEnabled: true,
    height: 900,
    identity: TEST_IDENTITIES.tyler,
    mock: {
      ...fixture({ includeScout: true, identity: TEST_IDENTITIES.tyler }),
      startManagedAgentDelayMs: 45_000,
      startManagedAgentErrors: ["The local harness did not start."],
      visualChannels: [INTRODUCTION_CHANNEL],
    },
    theme: "light",
    width: 1440,
  });

  await selectMapPart(page, "finance", "Finance");
  const card = page.getByTestId("cofounder-map-part-card");
  await page.getByTestId("cofounder-hire-head-finance").click();
  const dialog = page.getByTestId("prebuilt-head-hire-dialog");
  await expect(dialog).toBeVisible();
  await chooseRuntimeAndModel(page);

  await page.getByTestId("prebuilt-hire-finish").click();
  await expect(dialog).toBeHidden({ timeout: 3_000 });
  await expect(card).toContainText("Just hired");

  const releasedFailedStart = await page.evaluate(
    () => window.__BUZZ_E2E_RELEASE_MANAGED_AGENT_STARTS__?.() ?? 0,
  );
  expect(releasedFailedStart).toBe(1);
  const startupNotice = page.getByTestId(
    "cofounder-prebuilt-hire-startup-finance",
  );
  await expect(startupNotice).toContainText("did not start");
  await expect(
    startupNotice.getByRole("button", { name: "Retry start" }),
  ).toBeVisible();

  await startupNotice.getByRole("button", { name: "Retry start" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
            (entry) => entry.command === "start_managed_agent",
          ).length,
      ),
    )
    .toBe(2);
  const releasedRetry = await page.evaluate(
    () => window.__BUZZ_E2E_RELEASE_MANAGED_AGENT_STARTS__?.() ?? 0,
  );
  expect(releasedRetry).toBe(1);
  await expect(startupNotice).toBeHidden();
});
