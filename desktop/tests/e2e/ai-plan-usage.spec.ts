import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  OUTREACH_CHANNEL_ID,
  gotoWhatsAppScreen,
  installWhatsAppMockBridge,
} from "../helpers/whatsappOutreach";

test("shows an honest unavailable plan chip and persists the owner reserve choice", async ({
  page,
}, testInfo) => {
  await installWhatsAppMockBridge(page, "light", { deskFixture: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);

  const chip = page.getByTestId("ai-plan-usage-chip");
  await expect(chip).toHaveText(
    "Your AI plan: usage not available for your AI",
  );
  await waitForAnimations(page);
  await chip.screenshot({
    path: testInfo.outputPath("ai-plan-usage-chip-unavailable.png"),
  });
  await chip.click();
  await expect(page).toHaveURL(/section=whatsapp/u);

  const setting = page.getByTestId("ai-plan-reserve-setting");
  await expect(setting).toContainText("Keep my AI plan free");
  await expect(setting).toContainText("usage not available for your AI");
  const reserveSwitch = setting.getByRole("switch", {
    name: "Turn on AI plan reserve",
  });
  await expect(reserveSwitch).toHaveAttribute("aria-checked", "false");
  await reserveSwitch.click();
  await expect(
    setting.getByRole("switch", { name: "Turn off AI plan reserve" }),
  ).toHaveAttribute("aria-checked", "true");
  await setting.getByLabel("Keep free").fill("30");
  await setting.getByRole("button", { name: "Save reserve" }).click();
  await expect(setting.getByLabel("Keep free")).toHaveValue("30");
  await expect(setting).toContainText("usage not available for your AI");
  await waitForAnimations(page);
  await setting.screenshot({
    path: testInfo.outputPath("ai-plan-reserve-unavailable.png"),
  });
});

test("shows a crossed reserve, leaves the prepared batch untouched, and allows one override", async ({
  page,
}, testInfo) => {
  const observedAt = Date.now();
  await installWhatsAppMockBridge(page, "light", {
    deskFixture: true,
    aiPlanReservePreference: { enabled: true, reservedPercent: 25 },
    aiPlanUsage: [
      {
        provider: "codex",
        availability: "available",
        usedPercent: 75,
        resetAt: observedAt + 60 * 60 * 1000,
        source: "codex-app-server",
        observedAt,
        freshness: "fresh",
        confidence: "reported",
        message: null,
      },
    ],
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);

  const chip = page.getByTestId("ai-plan-usage-chip");
  await expect(chip).toHaveText("Your AI plan: 75% used, 25% kept for you");
  await expect(chip).toHaveClass(/is-paused/u);
  await expect(
    page.getByTestId("outreach-needs-batch-e2e-whatsapp-batch"),
  ).toBeVisible();

  await chip.click();
  const setting = page.getByTestId("ai-plan-reserve-setting");
  await expect(setting).toContainText(
    "Scout outreach drafting is paused to keep 25% of your AI plan free.",
  );
  await waitForAnimations(page);
  await setting.screenshot({
    path: testInfo.outputPath("ai-plan-reserve-paused.png"),
  });
  await setting.getByRole("button", { name: "Allow Scout once" }).click();
  await expect(
    setting.getByRole("button", { name: "Allow Scout once" }),
  ).toHaveCount(0);
});
