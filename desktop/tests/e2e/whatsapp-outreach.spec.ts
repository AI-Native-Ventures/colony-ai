import { expect, test } from "@playwright/test";

import {
  WHATSAPP_BATCH_ID,
  installWhatsAppMockBridge,
  gotoWhatsAppScreen,
} from "../helpers/whatsappOutreach";

test.describe("WhatsApp outreach settings", () => {
  test("owner sends a small approved batch now after confirming the test warning", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(
      page,
      `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
      "batch=send-now",
    );

    const batchPage = page.getByTestId("whatsapp-batch-page");
    await expect(batchPage).toBeVisible();
    const sendNowButton = batchPage.getByRole("button", {
      name: "Send now (test)",
    });
    await expect(sendNowButton).toBeVisible();
    await expect(
      batchPage.getByTestId("whatsapp-batch-row-schedule-0").first(),
    ).toContainText(/Sends (today at \d{2}:\d{2}|tomorrow at 08:00)/u);
    await sendNowButton.click();

    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("heading", {
        name: "Send now, outside 08:00 to 18:00?",
      }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "Use this for tests to your own number.",
    );
    await dialog.getByRole("button", { name: "Send now", exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
            ({ kind, body }) =>
              kind === 47049 &&
              body.batchId === "e2e-whatsapp-batch" &&
              body.decision === "send_now",
          ),
        ),
      )
      .toBe(true);
  });

  test("does not offer send now to relay members", async ({ page }) => {
    await installWhatsAppMockBridge(page, "light", { relayRole: "member" });
    await gotoWhatsAppScreen(
      page,
      `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
      "batch=send-now",
    );

    await expect(
      page.getByTestId("whatsapp-batch-page").getByRole("button", {
        name: "Send now (test)",
      }),
    ).toHaveCount(0);
  });

  test("does not offer send now to profile-flagged agents", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      relayRole: "owner",
      profileIsAgent: true,
    });
    await gotoWhatsAppScreen(
      page,
      `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
      "batch=send-now",
    );

    await expect(
      page.getByTestId("whatsapp-batch-page").getByRole("button", {
        name: "Send now (test)",
      }),
    ).toHaveCount(0);
  });

  test("does not offer send now to an owned agent with the owner role", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      relayRole: "owner",
      profileIsAgent: false,
      profileOwnerPubkey: "self",
    });
    await gotoWhatsAppScreen(
      page,
      `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
      "batch=send-now",
    );

    await expect(
      page.getByTestId("whatsapp-batch-page").getByRole("button", {
        name: "Send now (test)",
      }),
    ).toHaveCount(0);
  });

  test("does not offer send now for an approved batch over three rows", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(
      page,
      `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
      "batch=approved",
    );

    await expect(
      page.getByTestId("whatsapp-batch-page").getByRole("button", {
        name: "Send now (test)",
      }),
    ).toHaveCount(0);
  });

  test("labels a held-only contact as waiting, never sent", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(page, "/channels/e2e-whatsapp-outreach-channel");

    const heldContact = page
      .getByTestId("whatsapp-outreach")
      .getByTestId("whatsapp-contact-27821234410");
    await expect(heldContact).toContainText("Waiting for your approval");
    await expect(heldContact).not.toContainText("Sent");
  });

  test("shows pending batches and opens the review from Outreach", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(page, "/channels/e2e-whatsapp-outreach-channel");

    const outreach = page.getByTestId("whatsapp-outreach");
    await expect(outreach).toBeVisible();
    const pendingBatches = outreach.getByTestId("whatsapp-pending-batches");
    await expect(pendingBatches.getByRole("heading")).toHaveText(
      "Waiting for your approval",
    );
    await expect(
      pendingBatches.getByTestId("whatsapp-pending-batch-e2e-whatsapp-batch"),
    ).toContainText("Built a site for you");
    await expect(
      pendingBatches.getByTestId(/whatsapp-pending-batch-/),
    ).toHaveCount(2);
    const firstBatch = pendingBatches.getByTestId(
      "whatsapp-pending-batch-e2e-whatsapp-batch",
    );
    await expect(firstBatch).toContainText("3 rows");
    await expect(firstBatch).toContainText("Created by Scout");
    await expect(firstBatch).toContainText("10:46");

    await firstBatch.getByRole("button", { name: "Review" }).click();
    await expect(page.getByTestId("whatsapp-batch-page")).toBeVisible();
    await expect(page).toHaveURL(/whatsappBatchId=e2e-whatsapp-batch/u);
    await page.getByRole("button", { name: /Approve all/u }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
            ({ kind, body }) =>
              kind === 47049 &&
              body.batchId === "e2e-whatsapp-batch" &&
              body.decision === "approve",
          ),
        ),
      )
      .toBe(true);
  });

  test("switches settings sections without leaving the settings route", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoWhatsAppScreen(page, "/settings?section=whatsapp");

    const settings = page.getByTestId("whatsapp-settings");
    await expect(settings).toBeVisible();
    const settingsUrl = page.url();
    const tabs = settings.getByRole("navigation", {
      name: "WhatsApp sections",
    });
    for (const [label, sectionId] of [
      ["Number", "wa-number"],
      ["Sending", "wa-sending"],
      ["Templates", "wa-templates"],
    ]) {
      await tabs.getByText(label, { exact: true }).click();
      await expect(page).toHaveURL(settingsUrl);
      await expect(settings).toBeVisible();
      await expect(settings.locator(`#${sectionId}`)).toBeInViewport();
      const activeTab = tabs.getByRole("button", { name: label });
      await expect(activeTab).toHaveAttribute("type", "button");
      await expect(activeTab).toHaveAttribute("aria-current", "page");
    }

    const numberTab = tabs.getByRole("button", { name: "Number" });
    await numberTab.focus();
    await numberTab.press("Enter");
    await expect(page).toHaveURL(settingsUrl);
    await expect(settings.locator("#wa-number")).toBeInViewport();
  });

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
      settings
        .getByTestId("whatsapp-template-hl_vb")
        .getByText("Built a site for you", { exact: true }),
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
