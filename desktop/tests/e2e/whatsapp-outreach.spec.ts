import { expect, test } from "@playwright/test";

import {
  installWhatsAppMockBridge,
  gotoWhatsAppScreen,
} from "../helpers/whatsappOutreach";

test.describe("WhatsApp outreach settings", () => {
  test("validates connection details, clears secrets after save, and edits the new-chat cap", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(
      page,
      "/settings?section=whatsapp",
      "whatsapp=disconnected",
    );

    const form = page.getByTestId("whatsapp-connect-form");
    await expect(form).toBeVisible();
    expect(
      await page
        .getByTestId("wa-access-token")
        .evaluate((element) => (element as HTMLInputElement).checkValidity()),
    ).toBe(false);
    await page.getByTestId("whatsapp-connect-submit").click();
    expect(
      await page.evaluate(
        () => window.__BUZZ_E2E_WHATSAPP_STATE__?.connectCalls,
      ),
    ).toBe(0);

    const syntheticAccessToken = "e2e-synthetic-access-token";
    const syntheticAppSecret = "e2e-synthetic-app-secret";
    await page.getByTestId("wa-access-token").fill(syntheticAccessToken);
    await page.getByTestId("wa-phone-number-id").fill("1234567890");
    await page.getByTestId("wa-waba-id").fill("9876543210");
    await page.getByTestId("wa-app-secret").fill(syntheticAppSecret);
    await page.evaluate(() => {
      const state = window.__BUZZ_E2E_WHATSAPP_STATE__;
      if (state) state.holdConnect = true;
    });
    await page.getByTestId("whatsapp-connect-submit").click();

    await expect
      .poll(() =>
        page.evaluate(() => window.__BUZZ_E2E_WHATSAPP_STATE__?.connectCalls),
      )
      .toBe(1);
    await expect(page.getByTestId("wa-access-token")).toHaveValue("");
    await expect(page.getByTestId("wa-phone-number-id")).toHaveValue("");
    await expect(page.getByTestId("wa-waba-id")).toHaveValue("");
    await expect(page.getByTestId("wa-app-secret")).toHaveValue("");
    await page.evaluate(() => {
      const state = window.__BUZZ_E2E_WHATSAPP_STATE__;
      if (state) {
        state.holdConnect = false;
        state.releaseConnect?.();
        state.releaseConnect = undefined;
      }
    });

    await expect(
      page.getByText("Your WhatsApp number is connected."),
    ).toBeVisible();
    const settings = page.getByTestId("whatsapp-settings");
    await expect(
      settings.getByText("Horizon Labs", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByText("+27 61 534 0627", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("wa-access-token")).toHaveCount(0);
    await expect(page.getByTestId("wa-app-secret")).toHaveCount(0);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(syntheticAccessToken);
    expect(visibleText).not.toContain(syntheticAppSecret);
    const localStorageText = await page.evaluate(() =>
      Object.keys(window.localStorage).join("\n"),
    );
    expect(localStorageText).not.toContain(syntheticAccessToken);
    expect(localStorageText).not.toContain(syntheticAppSecret);
    expect(
      await page.evaluate(
        () => window.__BUZZ_E2E_WHATSAPP_STATE__?.connectCalls,
      ),
    ).toBe(1);

    await expect(
      settings.getByText("Built a site for you", { exact: true }),
    ).toBeVisible();
    await expect(settings.getByText("hl_vb", { exact: true })).toBeVisible();
    await expect(settings.getByText("hl_hs_v1", { exact: true })).toHaveCount(
      0,
    );
    await settings
      .getByText("Has a website: open to a chat?", { exact: true })
      .click();
    await expect(settings.getByText("hl_hs_v1", { exact: true })).toBeVisible();

    const cap = page.getByTestId("whatsapp-daily-cap");
    await cap.fill("36");
    await page.getByRole("button", { name: "Save cap" }).click();
    await expect(page.getByText("Daily cap saved.")).toBeVisible();
    await expect(page.getByText("12 of 36", { exact: true })).toBeVisible();
    const commands = await page.evaluate(
      () => window.__BUZZ_E2E_WHATSAPP_STATE__?.commands ?? [],
    );
    expect(
      commands.some(
        ({ kind, body }) => kind === 47051 && body.dailyNewChatCap === 36,
      ),
    ).toBe(true);

    await gotoWhatsAppScreen(page, "/channels/e2e-whatsapp-outreach-channel");
    await page
      .getByRole("button", { name: "WhatsApp conversation actions" })
      .click();
    const pause = page.getByRole("switch", {
      name: "Pause all WhatsApp sending",
    });
    await expect(pause).toHaveAttribute("aria-checked", "false");
    await pause.click();
    await expect(
      page.getByRole("switch", { name: "Pause all WhatsApp sending" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
