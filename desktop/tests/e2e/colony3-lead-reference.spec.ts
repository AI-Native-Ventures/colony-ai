import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  REFERENCE_CHANNEL_IDS,
  REFERENCE_LONG_LEAD_NAME,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const FORM_FIELD = REFERENCE_PROSPECT_IDS["form-field"];
const OLIVE_HOUSE = REFERENCE_PROSPECT_IDS["the-olive-house"];
const LONG_LEAD = REFERENCE_PROSPECT_IDS["cedar-co"];
const UNKNOWN_LEAD = "1e1a7000-0000-4000-9000-00000000ffff";
const PICKER_SHOTS = "test-results/reference-lead-dialog";

async function openSales(
  page: Page,
  options: { longLeadNames?: boolean } = {},
) {
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceWorkspaceLongLeadNames: options.longLeadNames,
  });
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
    await expect(picker.getByRole("region", { name: "Leads" })).toBeVisible();
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
    await expect(picker.getByTestId("lead-reference-empty")).toContainText(
      "No mentions or references match",
    );
  });

  for (const state of [
    { width: 390, height: 844, theme: "light", storage: "buzz" },
    { width: 390, height: 844, theme: "dark", storage: "buzz-dark" },
    { width: 1440, height: 900, theme: "light", storage: "buzz" },
    { width: 1440, height: 900, theme: "dark", storage: "buzz-dark" },
  ] as const) {
    test(
      "long lead rows stay inside the dialog at " +
        state.width +
        "px in " +
        state.theme +
        " mode",
      async ({ page }, testInfo) => {
        await page.setViewportSize({
          width: state.width,
          height: state.height,
        });
        await page.emulateMedia({
          colorScheme: state.theme === "dark" ? "dark" : "light",
        });
        await page.addInitScript((themeValue) => {
          window.localStorage.setItem("buzz-theme", themeValue);
          window.localStorage.setItem("buzz-follow-system", "false");
        }, state.storage);
        await openSales(page, { longLeadNames: true });
        expect(
          await page.evaluate(
            () =>
              (
                window as Window & {
                  __BUZZ_E2E__?: {
                    mock?: { referenceWorkspaceLongLeadNames?: boolean };
                  };
                }
              ).__BUZZ_E2E__?.mock?.referenceWorkspaceLongLeadNames,
          ),
        ).toBe(true);

        await page.getByTestId("reference-lead-button").click();
        const picker = page.getByTestId("lead-reference-picker");
        await expect(
          picker.getByRole("region", { name: "Leads" }),
        ).toBeVisible();
        await waitForAnimations(page);
        const longName = picker
          .getByTestId(`lead-reference-option-${LONG_LEAD}`)
          .locator(".c3r-name");
        await expect(longName).toBeVisible();

        const measurements = await picker.evaluate((dialog, longLeadId) => {
          const dialogBox = dialog.getBoundingClientRect();
          const dialogStyle = getComputedStyle(dialog);
          const groups = dialog.querySelector<HTMLElement>(
            ".c3r-mention-groups",
          );
          const footer =
            dialog.querySelector<HTMLElement>(".c3r-picker-footer");
          const rowElements = Array.from(
            dialog.querySelectorAll<HTMLElement>(".c3r-picker-item"),
          );
          const name = dialog.querySelector<HTMLElement>(
            `[data-testid="lead-reference-option-${longLeadId}"] .c3r-name`,
          );
          const list = dialog.querySelector<HTMLElement>(
            ".c3r-mention-picker .c3r-picker-list",
          );
          if (!groups || !footer || !list || !name)
            throw new Error(
              "missing picker groups, footer, list, or long name",
            );
          const groupsStyle = getComputedStyle(groups);
          const listStyle = getComputedStyle(list);
          const nameStyle = getComputedStyle(name);
          const footerBox = footer.getBoundingClientRect();
          const groupsBox = groups.getBoundingClientRect();
          const rowBounds = rowElements.map((row) => {
            const rect = row.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          });
          return {
            dialogTop: dialogBox.top,
            dialogBottom: dialogBox.bottom,
            dialogLeft: dialogBox.left,
            dialogRight: dialogBox.right,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            dialogPaddingBottom: Number.parseFloat(dialogStyle.paddingBottom),
            dialogPaddingLeft: Number.parseFloat(dialogStyle.paddingLeft),
            dialogPaddingRight: Number.parseFloat(dialogStyle.paddingRight),
            groupsLeft: groupsBox.left,
            groupsRight: groupsBox.right,
            groupsBottom: groupsBox.bottom,
            footerLeft: footerBox.left,
            footerRight: footerBox.right,
            footerBottom: footerBox.bottom,
            groupsHeight: groups.clientHeight,
            groupsScrollHeight: groups.scrollHeight,
            groupsOverflowY: groupsStyle.overflowY,
            listHeight: list.clientHeight,
            listScrollHeight: list.scrollHeight,
            listMaxHeight: listStyle.maxHeight,
            listOverflowY: listStyle.overflowY,
            rowBounds,
            longNameClips:
              name.scrollWidth > name.clientWidth &&
              nameStyle.textOverflow === "ellipsis" &&
              nameStyle.whiteSpace === "nowrap",
          };
        }, LONG_LEAD);

        expect(measurements.dialogTop).toBeGreaterThanOrEqual(0);
        expect(measurements.dialogLeft).toBeGreaterThanOrEqual(0);
        expect(measurements.dialogRight).toBeLessThanOrEqual(
          measurements.viewportWidth,
        );
        expect(measurements.dialogBottom).toBeLessThanOrEqual(
          measurements.viewportHeight,
        );
        expect(measurements.groupsLeft).toBeGreaterThanOrEqual(
          measurements.dialogLeft + measurements.dialogPaddingLeft - 1,
        );
        expect(measurements.groupsRight).toBeLessThanOrEqual(
          measurements.dialogRight - measurements.dialogPaddingRight + 1,
        );
        expect(measurements.footerLeft).toBeGreaterThanOrEqual(
          measurements.dialogLeft + measurements.dialogPaddingLeft - 1,
        );
        expect(measurements.footerRight).toBeLessThanOrEqual(
          measurements.dialogRight - measurements.dialogPaddingRight + 1,
        );
        expect(measurements.footerBottom).toBeLessThanOrEqual(
          measurements.dialogBottom - measurements.dialogPaddingBottom + 1,
        );
        for (const row of measurements.rowBounds) {
          expect(row.left).toBeGreaterThanOrEqual(
            measurements.dialogLeft + measurements.dialogPaddingLeft - 1,
          );
          expect(row.right).toBeLessThanOrEqual(
            measurements.dialogRight - measurements.dialogPaddingRight + 1,
          );
        }
        await expect(longName).toHaveAttribute(
          "title",
          REFERENCE_LONG_LEAD_NAME,
        );
        expect(measurements.longNameClips).toBe(true);
        expect(measurements.groupsOverflowY).toBe("auto");
        expect(measurements.groupsScrollHeight).toBeGreaterThan(
          measurements.groupsHeight,
        );
        expect(measurements.listMaxHeight).toBe("none");
        expect(measurements.listOverflowY).toBe("visible");
        expect(measurements.listScrollHeight).toBeLessThanOrEqual(
          measurements.listHeight,
        );
        expect(measurements.dialogPaddingBottom).toBe(
          measurements.dialogPaddingLeft,
        );
        expect(measurements.dialogPaddingBottom).toBe(
          measurements.dialogPaddingRight,
        );
        await waitForAnimations(page);
        mkdirSync(PICKER_SHOTS, { recursive: true });
        if (testInfo.project.name === "smoke") {
          await page.screenshot({
            path: `${PICKER_SHOTS}/${state.width}-${state.theme}.png`,
          });
        }
        await longName.scrollIntoViewIfNeeded();
        await picker.evaluate((dialog, longLeadId) => {
          const groups = dialog.querySelector<HTMLElement>(
            ".c3r-mention-groups",
          );
          const name = dialog.querySelector<HTMLElement>(
            `[data-testid="lead-reference-option-${longLeadId}"] .c3r-name`,
          );
          const row = name?.closest<HTMLElement>(".c3r-picker-item");
          if (!groups || !row) throw new Error("missing long lead row");
          groups.scrollTop +=
            row.getBoundingClientRect().top -
            groups.getBoundingClientRect().top;
        }, LONG_LEAD);
        await expect(longName).toBeVisible();
      },
    );
  }
});
