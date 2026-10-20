import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOT_DIR = "/Users/mac/worktrees/.lanes/reskin/shots";

async function capture(page: Page, name: string) {
  const originalViewport = page.viewportSize();
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOT_DIR}/${name}-${width}.png` });
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}

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
  await capture(page, "account-legacy-fallback");

  await page.goto("/tests/visual/onboarding.html?reskin=identity-intro");
  await expect(page.getByTestId("onboarding-page-key-intro")).toBeVisible();
  await capture(page, "identity-introduction");
  await page.getByTestId("identity-key-help-trigger").click();
  await expect(page.getByTestId("identity-key-help-body")).toBeVisible();
  await capture(page, "identity-key-help");

  await page.goto("/tests/visual/onboarding.html?reskin=native-unavailable");
  await expect(page.getByTestId("native-unavailable")).toBeVisible();
  await capture(page, "native-unavailable");
});

test("locked sign-in screen fits both review widths", async ({ page }) => {
  await installMockBridge(
    page,
    { identityLocked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await capture(page, "keyring-locked");
});

test("recovery failure screen fits both review widths", async ({ page }) => {
  await installMockBridge(
    page,
    { identityResetFailed: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("reset-failed")).toBeVisible();
  await capture(page, "recovery-failed");
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
          relayUrl: "wss://hive.example.com",
          code: null,
        },
      ],
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("pending-invite-gate")).toBeVisible();
  await capture(page, "pending-invite-gate");
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
  await capture(page, "nostr-bind-consent");
  await pasteCode(page, "123456");
  await expect(page.getByTestId("nostr-bind-finish-step")).toBeVisible();
  await capture(page, "nostr-bind-complete");
});
