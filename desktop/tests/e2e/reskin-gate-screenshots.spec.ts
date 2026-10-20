import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import {
  captureReskinState,
  seedReskinTheme,
} from "../helpers/reskinScreenshots";

test.beforeEach(async ({ page }) => seedReskinTheme(page));

async function pasteCode(page: Page, code: string) {
  const firstDigit = page.getByTestId("nostr-bind-code-digit-1");
  await firstDigit.click();
  await page.keyboard.type(code);
}

test("legacy fallback screens render in the Colony visual shell", async ({
  page,
}) => {
  await page.goto("/tests/visual/onboarding.html?reskin=account-legacy");
  await expect(page.getByTestId("reskin-account-card")).toBeVisible();
  const legacyHeading = page.locator(
    '[data-testid="reskin-account-card"] h1[tabindex="-1"]',
  );
  await expect(legacyHeading).toBeFocused();
  await expect(legacyHeading).toHaveCSS("outline-style", "none");
  await captureReskinState(page, "account-legacy-fallback");

  await page.goto("/tests/visual/onboarding.html?reskin=identity-intro");
  await expect(page.getByTestId("onboarding-page-key-intro")).toBeVisible();
  await captureReskinState(page, "identity-introduction");
  await page.getByTestId("identity-key-help-trigger").click();
  await expect(page.getByTestId("identity-key-help-body")).toBeVisible();
  await captureReskinState(page, "identity-key-help");

  await page.goto("/tests/visual/onboarding.html?reskin=native-unavailable");
  await expect(page.getByTestId("native-unavailable")).toBeVisible();
  await captureReskinState(page, "native-unavailable");
});

test("machine identity landing and help fit both review widths", async ({
  page,
}) => {
  await page.goto("/tests/visual/onboarding.html?reskin=machine-identity");
  await expect(page.getByTestId("machine-onboarding-gate")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create a Colony sign-in" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use a sign-in I already have" }),
  ).toBeVisible();
  await captureReskinState(page, "machine-identity-landing");

  await page.getByTestId("identity-key-help-trigger").click();
  await expect(page.getByTestId("identity-key-help-body")).toBeVisible();
  // This route reuses the shared help screen captured with identity intro.
});

test("identity help dialog and machine sign-in error follow the selected theme", async ({
  page,
}) => {
  await page.goto("/tests/visual/onboarding.html?reskin=identity-help-dialog");
  const helpTrigger = page.getByTestId("identity-key-help-trigger");
  await expect(helpTrigger).toHaveCSS("opacity", "1");
  await helpTrigger.click();
  await expect(page.getByTestId("identity-key-help-dialog")).toBeVisible();
  await captureReskinState(page, "identity-key-help-dialog");

  await page.goto(
    "/tests/visual/onboarding.html?reskin=machine-identity-error",
  );
  await expect(page.getByTestId("machine-onboarding-gate")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Native identity-read");
  const detailsButton = page.getByRole("button", {
    name: "Technical details",
  });
  await expect(detailsButton).toHaveAttribute("aria-expanded", "false");
  await captureReskinState(page, "machine-identity-error");
  await detailsButton.click();
  await expect(page.locator("body")).toContainText("Native identity-read");
  await expect(detailsButton).toHaveAttribute("aria-expanded", "true");
  await captureReskinState(page, "machine-identity-error-technical-details");
});

test("locked sign-in screen fits both review widths", async ({ page }) => {
  await installMockBridge(
    page,
    { identityLocked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await captureReskinState(page, "keyring-locked");
});

test("recovery failure screen fits both review widths", async ({ page }) => {
  await installMockBridge(
    page,
    { identityResetFailed: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("reset-failed")).toBeVisible();
  await captureReskinState(page, "recovery-failed");
});

test("pending community link gate fits both review widths", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      accountLinked: true,
      pendingCommunityDeepLinks: [
        {
          id: "reskin-connect-link",
          kind: "connect",
          relayUrl: "wss://studio.example.com",
          code: null,
        },
      ],
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("pending-invite-gate")).toBeVisible();
  await captureReskinState(page, "pending-invite-gate");
});

test("Nostr bind consent and completion fit both review widths", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("channel-general")).toBeVisible();
  await page.evaluate(async () => {
    const internals = (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke: (command: string, args: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    if (!internals) throw new Error("Mock event bridge is unavailable");
    await internals.invoke("plugin:event|emit", {
      event: "deep-link-nostr-bind",
      payload: {
        action: "bind_nostr_identity",
        audience: "buzz:nostr-identity",
        challengeId: "550e8400-e29b-41d4-a716-446655440000",
        expiresAt: "2099-01-01T00:00:00Z",
        nonce: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi01234567",
        origin: "https://admin.example.com",
        protocol: "buzz-nostr-identity",
        returnMode: "clipboard",
        verificationCode: "123456",
        version: "1",
      },
    });
  });
  await expect(page.getByTestId("nostr-bind-page")).toBeVisible();
  await captureReskinState(page, "nostr-bind-consent");
  await pasteCode(page, "123456");
  await expect(page.getByTestId("nostr-bind-finish-step")).toBeVisible();
  await expect(
    page.getByTestId("nostr-bind-technical-details"),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("nostr-bind-signed-response")).toHaveCount(0);
  await captureReskinState(page, "nostr-bind-complete");
  const technicalDetails = page.getByTestId("nostr-bind-technical-details");
  await technicalDetails.click();
  await expect(technicalDetails).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("nostr-bind-signed-response")).toBeVisible();
  await captureReskinState(page, "nostr-bind-complete-technical-details");
});
