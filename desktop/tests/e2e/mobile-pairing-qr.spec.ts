import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { selectSettingsSection } from "../helpers/settings";

const SCREENSHOT_DIR = "test-results/mobile-pairing-qr";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, { pairingStartDelayMs: 300 });
});

async function emitPairingEvent(page: Page, event: string, payload?: unknown) {
  await page.evaluate(
    async ({ eventName, eventPayload }) => {
      const internals = (
        window as Window & {
          __TAURI_INTERNALS__?: {
            invoke?: (
              command: string,
              args: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      if (!internals?.invoke) {
        throw new Error("Tauri E2E event bridge is unavailable");
      }
      await internals.invoke("plugin:event|emit", {
        event: eventName,
        payload: eventPayload,
      });
    },
    { eventName: event, eventPayload: payload },
  );
}

test("mobile pairing starts on demand and reveals the QR code", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await selectSettingsSection(page, "mobile");

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const section = page.getByTestId("settings-mobile");
  const card = page.getByTestId("mobile-pairing-card");
  const layout = card.getByTestId("mobile-pairing-layout");
  const qrContainer = page.getByTestId("mobile-pairing-qr-container");
  const steps = card.getByTestId("mobile-pairing-steps");
  const scanStepIndicator = card.getByTestId(
    "mobile-pairing-scan-step-indicator",
  );
  const confirmStepIndicator = card.getByTestId(
    "mobile-pairing-confirm-step-indicator",
  );
  const finalStep = card.getByTestId("mobile-pairing-final-step");
  const startButton = card.getByTestId("start-pairing-button");
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS("border-top-width", "0px");
  await expect(card).toHaveCSS("border-radius", "20px");
  expect(
    await card.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await expect(startButton).toHaveText("Start pairing");
  await expect(steps.getByText("Scan QR code", { exact: true })).toBeVisible();
  await expect(
    steps.getByText("Confirm mobile code", { exact: true }),
  ).toBeVisible();
  await expect(
    finalStep.getByText("Pair your mobile app", { exact: true }),
  ).toBeVisible();
  const finalStepIndicator = finalStep.getByTestId(
    "mobile-pairing-final-step-indicator",
  );
  await expect(finalStepIndicator).toHaveText("3");
  await expect(scanStepIndicator).toHaveAttribute("data-completed", "false");
  await expect(confirmStepIndicator).toHaveAttribute("data-completed", "false");
  await expect(finalStepIndicator).toHaveCSS("width", "30px");
  await expect(finalStepIndicator).toHaveCSS("height", "30px");
  expect(
    await finalStepIndicator.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderRadius),
    ),
  ).toBeGreaterThanOrEqual(15);
  const indicatorBackground = await finalStepIndicator.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const primaryActionBackground = await startButton.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(indicatorBackground).not.toBe(primaryActionBackground);
  await expect(card).toHaveCSS("padding-top", "24px");
  await expect(card).toHaveCSS("padding-left", "24px");
  await expect(layout).toHaveCSS("column-gap", "40px");
  await expect(page.getByTestId("mobile-pairing-qr")).toHaveCount(0);
  await expect(page.getByTestId("copy-pairing-code")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
          (entry) => entry.command === "start_pairing",
        ).length,
    ),
  ).toBe(0);

  const sectionBox = await section.boundingBox();
  const cardBox = await card.boundingBox();
  expect(sectionBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  const initialQrBox = await qrContainer.boundingBox();
  expect(initialQrBox).not.toBeNull();
  const qrTopSpace = (initialQrBox?.y ?? 0) - (cardBox?.y ?? 0);
  const qrLeftSpace = (initialQrBox?.x ?? 0) - (cardBox?.x ?? 0);
  // The design pins the QR panel to the card's top-left padding.
  expect(Math.abs(qrTopSpace - qrLeftSpace)).toBeLessThan(0.5);
  const sectionCenter = (sectionBox?.x ?? 0) + (sectionBox?.width ?? 0) / 2;
  const cardCenter = (cardBox?.x ?? 0) + (cardBox?.width ?? 0) / 2;
  expect(Math.abs(sectionCenter - cardCenter)).toBeLessThan(0.5);
  await waitForAnimations(page);
  await card.screenshot({ path: `${SCREENSHOT_DIR}/pairing-start.png` });

  await startButton.click();

  const loadingSpinner = card.getByTestId("pairing-loading-spinner");
  await expect(loadingSpinner).toBeVisible();
  await expect(loadingSpinner).toHaveCSS("animation-name", "spin");

  const qrCode = page.getByTestId("mobile-pairing-qr");
  const copyButton = card.getByTestId("copy-pairing-code");
  await expect(qrCode).toBeVisible();
  await expect(copyButton).toHaveText("Copy pairing code");
  await expect(startButton).toHaveCount(0);
  await expect(card.getByText("Pair mobile device")).toHaveCount(0);
  await expect(page.getByTestId("mobile-pairing-dialog")).toHaveCount(0);
  await expect(
    page.getByText("Securely transfer your identity via NIP-AB protocol"),
  ).toHaveCount(0);
  await expect(qrCode).toHaveAttribute("data-qr-matrix-size", "57");
  await expect(qrCode.locator("[data-qr-finder-pattern]")).toHaveCount(3);
  expect(await qrCode.locator("circle").count()).toBeGreaterThan(100);
  expect(await qrCode.locator(".buzz-qr-cell-reveal").count()).toBeGreaterThan(
    100,
  );
  await expect(qrCode.locator(".buzz-qr-cell-reveal").first()).toHaveCSS(
    "animation-name",
    "buzz-qr-cell-reveal",
  );
  await expect(qrCode.locator(".buzz-qr-cell-reveal").first()).toHaveCSS(
    "animation-duration",
    "0.058s",
  );
  await expect(qrCode.locator(".buzz-qr-cell-reveal").first()).toHaveCSS(
    "animation-timing-function",
    "linear",
  );
  await expect(
    qrCode.locator('[data-qr-cell-row="56"].buzz-qr-cell-reveal').first(),
  ).toHaveCSS("animation-delay", "0.189s");
  await expect(copyButton).toHaveCSS("animation-name", "enter");
  await expect(copyButton).toHaveCSS("animation-duration", "0.25s");
  await expect(qrCode.locator("image")).toHaveAttribute(
    "href",
    "/app-icon@2x.png",
  );
  await waitForAnimations(page);
  const qrBox = await qrContainer.boundingBox();
  const copyBox = await copyButton.boundingBox();
  const stepsBox = await steps.boundingBox();
  const qrCardBox = await card.boundingBox();
  expect(qrBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  expect(stepsBox).not.toBeNull();
  expect(qrCardBox).not.toBeNull();
  expect(qrBox?.x ?? 0).toBeLessThan(stepsBox?.x ?? 0);
  // The design's idle panel is 204px; the QR state is taller, so the card may
  // grow when the code appears.
  expect(qrCardBox?.height ?? 0).toBeGreaterThanOrEqual(cardBox?.height ?? 0);
  expect(copyBox?.y ?? 0).toBeGreaterThan(
    (qrBox?.y ?? 0) + (qrBox?.height ?? 0),
  );
  // The design's Copy pairing code is a text button inside the QR column.
  expect(copyBox?.x ?? 0).toBeGreaterThanOrEqual((qrBox?.x ?? 0) - 0.5);
  expect((copyBox?.x ?? 0) + (copyBox?.width ?? 0)).toBeLessThanOrEqual(
    (qrBox?.x ?? 0) + (qrBox?.width ?? 0) + 0.5,
  );

  await emitPairingEvent(page, "pairing-error", {
    message: "Session timed out",
  });

  await expect(qrCode).toHaveCount(0);
  await expect(copyButton).toHaveCount(0);
  await expect(card.getByText("Pairing code expired.")).toBeVisible();

  const regenerateButton = card.getByTestId("regenerate-pairing-button");
  await expect(regenerateButton).toHaveText("Generate new pairing code");
  await waitForAnimations(page);
  await card.screenshot({ path: `${SCREENSHOT_DIR}/pairing-expired.png` });
  await regenerateButton.click();
  await expect(loadingSpinner).toBeVisible();
  await expect(qrCode).toBeVisible();
  await expect(copyButton).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
          (entry) => entry.command === "start_pairing",
        ).length,
    ),
  ).toBe(2);

  await waitForAnimations(page);
  await card.screenshot({ path: `${SCREENSHOT_DIR}/pairing-card.png` });
  await qrCode.screenshot({ path: `${SCREENSHOT_DIR}/pairing-qr.png` });
});

test("pairing completion updates the final step and resets after leaving", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await selectSettingsSection(page, "mobile");

  const card = page.getByTestId("mobile-pairing-card");
  const finalStep = card.getByTestId("mobile-pairing-final-step");
  const scanStepIndicator = card.getByTestId(
    "mobile-pairing-scan-step-indicator",
  );
  const confirmStepIndicator = card.getByTestId(
    "mobile-pairing-confirm-step-indicator",
  );
  await card.getByTestId("start-pairing-button").click();
  await expect(page.getByTestId("mobile-pairing-qr")).toBeVisible();

  await emitPairingEvent(page, "pairing-sas-received", { sas: "123456" });
  const confirmation = card.getByTestId("mobile-pairing-code-confirmation");
  await expect(scanStepIndicator).toHaveAttribute("data-completed", "true");
  await expect(scanStepIndicator.locator("svg")).toHaveCount(1);
  await expect(confirmStepIndicator).toHaveAttribute("data-completed", "false");
  await expect(page.getByTestId("mobile-pairing-dialog")).toHaveCount(0);
  await expect(page.getByTestId("mobile-pairing-qr")).toHaveCount(0);
  const confirmationCode = confirmation.getByTestId("pairing-sas-code");
  await expect(confirmationCode).toHaveAccessibleName(
    "Confirmation code 123 456",
  );
  await expect(
    confirmationCode.locator('[data-testid^="pairing-sas-code-digit-"]'),
  ).toHaveCount(6);
  await expect(
    confirmationCode.getByTestId("pairing-sas-code-digit-1"),
  ).toHaveCSS("border-radius", "10px");
  const firstCodeDigit = confirmationCode.getByTestId(
    "pairing-sas-code-digit-1",
  );
  const firstCodeDigitBox = await firstCodeDigit.boundingBox();
  expect(firstCodeDigitBox).not.toBeNull();
  expect(firstCodeDigitBox?.width ?? 0).toBeGreaterThanOrEqual(32);
  expect(firstCodeDigitBox?.height ?? 0).toBeGreaterThanOrEqual(48);
  const secondCodeDigitBox = await confirmationCode
    .getByTestId("pairing-sas-code-digit-2")
    .boundingBox();
  const thirdCodeDigitBox = await confirmationCode
    .getByTestId("pairing-sas-code-digit-3")
    .boundingBox();
  const fourthCodeDigitBox = await confirmationCode
    .getByTestId("pairing-sas-code-digit-4")
    .boundingBox();
  expect(secondCodeDigitBox).not.toBeNull();
  expect(thirdCodeDigitBox).not.toBeNull();
  expect(fourthCodeDigitBox).not.toBeNull();
  const regularDigitGap =
    (thirdCodeDigitBox?.x ?? 0) -
    ((secondCodeDigitBox?.x ?? 0) + (secondCodeDigitBox?.width ?? 0));
  const groupedDigitGap =
    (fourthCodeDigitBox?.x ?? 0) -
    ((thirdCodeDigitBox?.x ?? 0) + (thirdCodeDigitBox?.width ?? 0));
  expect(groupedDigitGap).toBeGreaterThan(regularDigitGap);
  await expect(card.getByTestId("mobile-pairing-qr-container")).toHaveCSS(
    "box-shadow",
    "none",
  );
  const confirmButton = confirmation.getByTestId("confirm-sas");
  const cancelButton = confirmation.getByTestId("deny-sas");
  const confirmationBox = await confirmation.boundingBox();
  const confirmationTitle = confirmation.getByTestId("pairing-sas-title");
  const confirmationTitleBox = await confirmationTitle.boundingBox();
  const confirmationCodeBox = await confirmationCode.boundingBox();
  const confirmationActionsBox = await confirmation
    .getByTestId("pairing-sas-actions")
    .boundingBox();
  expect(confirmationBox).not.toBeNull();
  expect(confirmationTitleBox).not.toBeNull();
  expect(confirmationCodeBox).not.toBeNull();
  expect(confirmationActionsBox).not.toBeNull();
  // Title, code, then actions, top to bottom.
  expect(
    Math.abs((confirmationTitleBox?.y ?? 0) - (confirmationBox?.y ?? 0)),
  ).toBeLessThan(0.5);
  expect(confirmationCodeBox?.y ?? 0).toBeGreaterThan(
    (confirmationTitleBox?.y ?? 0) + (confirmationTitleBox?.height ?? 0),
  );
  expect(confirmationActionsBox?.y ?? 0).toBeGreaterThan(
    (confirmationCodeBox?.y ?? 0) + (confirmationCodeBox?.height ?? 0),
  );
  await expect(confirmButton).toHaveCSS("height", "40px");
  await expect(cancelButton).toHaveCSS("height", "40px");
  await expect(confirmButton.locator("svg")).toHaveCount(1);
  await expect(cancelButton.locator("svg")).toHaveCount(0);
  const confirmBox = await confirmButton.boundingBox();
  const cancelBox = await cancelButton.boundingBox();
  expect(confirmBox).not.toBeNull();
  expect(cancelBox).not.toBeNull();
  // The design puts Codes match first, Cancel beside it.
  expect(confirmBox?.x ?? 0).toBeLessThan(cancelBox?.x ?? 0);
  await expect(
    confirmation.getByText(/Only confirm if you started this pairing/),
  ).toHaveCount(0);
  await expect(confirmationTitle).toHaveCSS("font-size", "17px");

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await waitForAnimations(page);
  await card.screenshot({
    path: `${SCREENSHOT_DIR}/pairing-code-confirmation.png`,
  });

  await confirmation.getByTestId("confirm-sas").click();
  await expect(card.getByText("Pairing mobile device...")).toBeVisible();
  await expect(confirmStepIndicator).toHaveAttribute("data-completed", "true");
  await expect(confirmStepIndicator.locator("svg")).toHaveCount(1);

  await emitPairingEvent(page, "pairing-complete");

  await expect(finalStep.getByText("Paired", { exact: true })).toBeVisible();
  await expect(
    finalStep.getByText("Your mobile app is now connected to this relay."),
  ).toBeVisible();
  await expect(
    finalStep.getByTestId("mobile-pairing-final-step-indicator").locator("svg"),
  ).toHaveCount(1);
  await expect(
    finalStep.getByTestId("mobile-pairing-final-step-indicator"),
  ).toHaveAttribute("data-completed", "true");
  const pairedSurface = card.getByTestId("mobile-pairing-qr-container");
  await expect(
    pairedSurface.getByText("Paired", { exact: true }),
  ).toBeVisible();
  await expect(
    pairedSurface.getByText("Your mobile app is now connected to this relay."),
  ).toHaveCount(0);

  await waitForAnimations(page);
  await card.screenshot({ path: `${SCREENSHOT_DIR}/pairing-complete.png` });

  await selectSettingsSection(page, "updates");
  await selectSettingsSection(page, "mobile");

  const restartedCard = page.getByTestId("mobile-pairing-card");
  await expect(restartedCard.getByTestId("start-pairing-button")).toBeVisible();
  await expect(
    restartedCard
      .getByTestId("mobile-pairing-final-step")
      .getByText("Pair your mobile app", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("mobile-pairing-qr")).toHaveCount(0);
});

test("late pairing events are ignored after canceling", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await selectSettingsSection(page, "mobile");

  const card = page.getByTestId("mobile-pairing-card");
  await card.getByTestId("start-pairing-button").click();
  await expect(page.getByTestId("mobile-pairing-qr")).toBeVisible();

  await emitPairingEvent(page, "pairing-sas-received", { sas: "123456" });
  const confirmation = card.getByTestId("mobile-pairing-code-confirmation");
  await expect(confirmation).toBeVisible();
  await confirmation.getByTestId("deny-sas").click();

  await expect(confirmation).toHaveCount(0);
  await expect(
    card.getByText("The codes didn't match. Pairing was canceled."),
  ).toBeVisible();

  await emitPairingEvent(page, "pairing-complete");
  await emitPairingEvent(page, "pairing-sas-received", { sas: "654321" });

  await expect(confirmation).toHaveCount(0);
  await expect(
    card
      .getByTestId("mobile-pairing-final-step")
      .getByText("Paired", { exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByText("The codes didn't match. Pairing was canceled."),
  ).toBeVisible();
});

test("step completion respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await selectSettingsSection(page, "mobile");

  const card = page.getByTestId("mobile-pairing-card");
  const scanStepIndicator = card.getByTestId(
    "mobile-pairing-scan-step-indicator",
  );
  await card.getByTestId("start-pairing-button").click();
  await expect(page.getByTestId("mobile-pairing-qr")).toBeVisible();

  await emitPairingEvent(page, "pairing-sas-received", { sas: "123456" });

  await expect(scanStepIndicator).toHaveAttribute("data-completed", "true");
  await expect(scanStepIndicator).toHaveCSS("transition-property", "none");
  await expect(scanStepIndicator.locator("svg")).toHaveCount(1);
});
