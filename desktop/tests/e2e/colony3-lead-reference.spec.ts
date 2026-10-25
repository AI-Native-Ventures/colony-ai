import { expect, test, type Page } from "@playwright/test";

import {
  REFERENCE_CHANNEL_IDS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";

const FORM_FIELD = REFERENCE_PROSPECT_IDS["form-field"];
const OLIVE_HOUSE = REFERENCE_PROSPECT_IDS["the-olive-house"];
const UNKNOWN_LEAD = "1e1a7000-0000-4000-9000-00000000ffff";

async function openSales(page: Page) {
  await installMockBridge(page, { referenceWorkspace: true });
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.sales}`);
  await expect(page.getByTestId("message-input")).toBeVisible();
}

async function emitSalesMessage(page: Page, content: string) {
  await page.waitForFunction(
    () =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: "Sales",
      }) ?? false,
  );
  await page.evaluate((text) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "Sales",
      content: text,
    });
  }, content);
}

test.describe("Lead references in chat", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a lead picked in the composer is sent as a link and shown as a lead card", async ({
    page,
  }) => {
    await openSales(page);

    await page.getByTestId("reference-lead-button").click();
    const picker = page.getByTestId("lead-reference-picker");
    await expect(
      picker.getByRole("heading", { name: "Reference a lead" }),
    ).toBeVisible();
    await picker.getByTestId("lead-reference-search").fill("Form");
    await expect(
      picker.getByTestId(`lead-reference-option-${FORM_FIELD}`),
    ).toBeVisible();
    await expect(
      picker.getByTestId(`lead-reference-option-${OLIVE_HOUSE}`),
    ).toHaveCount(0);

    await picker.getByTestId(`lead-reference-option-${FORM_FIELD}`).click();
    await expect(picker).toBeHidden();

    const composer = page.getByTestId("message-input");
    const chip = composer.locator(
      `[data-composer-buzz-link][data-href="buzz://lead/${FORM_FIELD}"]`,
    );
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("Form & Field");

    // The composer keeps the caret after the chip: typing continues there.
    await page.keyboard.type("please follow up this week");
    await expect(composer).toContainText("please follow up this week");

    await page.getByTestId("send-message").click();

    const card = page.getByTestId(`lead-reference-card-${FORM_FIELD}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Form & Field");
    await expect(card).toContainText("Design-led home and living store");
    await expect(card).toContainText("Woodstock, Cape Town");
    await expect(card).toContainText("fit 91");
    await expect(card.locator(".c3r-pill")).toHaveText("New");

    await card.click();
    await expect(page.getByTestId("w10-prospect-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Form & Field" }),
    ).toBeVisible();
  });

  test("a message that already holds a lead link shows the lead's stage", async ({
    page,
  }) => {
    await openSales(page);
    await emitSalesMessage(
      page,
      `Great news on this one: buzz://lead/${OLIVE_HOUSE}`,
    );

    const card = page.getByTestId(`lead-reference-card-${OLIVE_HOUSE}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("The Olive House");
    await expect(card).toContainText("fit 94");
    const pill = card.locator(".c3r-pill");
    await expect(pill).toHaveText("Won");
    await expect(pill).toHaveAttribute("data-tone", "green");
  });

  test("a lead that is gone says so instead of failing the message", async ({
    page,
  }) => {
    await openSales(page);
    await emitSalesMessage(page, `Old note: buzz://lead/${UNKNOWN_LEAD}`);

    const gone = page.getByTestId(`lead-reference-unavailable-${UNKNOWN_LEAD}`);
    await expect(gone).toBeVisible();
    await expect(gone).toContainText("This lead is no longer available");
    await expect(
      page.getByTestId(`lead-reference-card-${UNKNOWN_LEAD}`),
    ).toHaveCount(0);
  });

  test("the picker offers every lead and filters by name and place", async ({
    page,
  }) => {
    await openSales(page);
    await page.getByTestId("reference-lead-button").click();
    const picker = page.getByTestId("lead-reference-picker");
    await expect(
      picker.locator("[data-testid^='lead-reference-option-']"),
    ).toHaveCount(12);

    await picker.getByTestId("lead-reference-search").fill("Cape Town");
    await expect(
      picker.getByTestId(`lead-reference-option-${FORM_FIELD}`),
    ).toBeVisible();
    await expect(
      picker.getByTestId(`lead-reference-option-${OLIVE_HOUSE}`),
    ).toHaveCount(0);

    await picker.getByTestId("lead-reference-search").fill("zzzz");
    await expect(picker.getByText("No leads match")).toBeVisible();
  });
});
