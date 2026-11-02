import { expect, test } from "@playwright/test";

import {
  REFERENCE_CHANNEL_IDS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";

const FORM_FIELD = REFERENCE_PROSPECT_IDS["form-field"];

test("a lead card in a message uses the stubbed logo.dev image", async ({
  page,
}) => {
  await page.route("https://img.logo.dev/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#56815b"/></svg>',
    }),
  );
  await installMockBridge(page, { referenceWorkspace: true });
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.sales}`);
  await expect(page.getByTestId("message-input")).toBeVisible();
  await page.waitForFunction(
    () =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: "Sales",
      }) ?? false,
  );
  await page.evaluate((leadId) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "Sales",
      content: `Logo proof: buzz://lead/${leadId}`,
    });
  }, FORM_FIELD);

  const card = page.getByTestId(`lead-reference-card-${FORM_FIELD}`);
  await expect(card).toBeVisible();
  await expect(card.locator(".business-logo-mark img")).toBeVisible();
  await expect(card.locator(".business-logo-mark img")).toHaveAttribute(
    "src",
    /img\.logo\.dev\/form-field\.example/u,
  );
});
