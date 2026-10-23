import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

async function openConfirmation(page: Parameters<typeof openSettings>[0]) {
  await openSettings(page, "security");
  await page.getByTestId("signout-open-dialog-remove-data").click();
  await expect(page.getByTestId("signout-dialog")).toBeVisible();
}

async function installSignOutFixture(page: Parameters<typeof openSettings>[0]) {
  await page.addInitScript(() => {
    const pubkey = "deadbeef".repeat(8);
    const draft = {
      content: "A draft to review before leaving",
      selectionStart: 0,
      selectionEnd: 0,
      channelId: "engineering",
      createdAt: "2026-09-25T09:00:00.000Z",
      updatedAt: "2026-09-25T09:01:00.000Z",
      pendingImeta: [
        {
          url: "https://example.test/pending-attachment.png",
          mimeType: "image/png",
          sha256: "a".repeat(64),
          size: 1024,
        },
      ],
      mentionRefs: [],
      spoileredAttachmentUrls: [],
      status: "active",
    };
    localStorage.setItem(
      `buzz-drafts.v2:ws://localhost:3000:${pubkey}`,
      JSON.stringify({ "channel:engineering": draft }),
    );
  });
  await installMockBridge(page, {
    managedAgents: [
      { pubkey: "a".repeat(64), name: "Ava", status: "running" },
      { pubkey: "b".repeat(64), name: "Noah", status: "running" },
    ],
  });
  await page.goto("/");
}

test("Sign out & remove data names what goes before anything is removed", async ({
  page,
}) => {
  await installSignOutFixture(page);
  await openConfirmation(page);

  const confirmation = page.getByTestId("signout-dialog");
  await expect(confirmation).toContainText("Remove this device’s data?");
  await expect(confirmation).toContainText("1 unsent draft");
  await expect(confirmation).toContainText("1 pending attachment");
  await expect(confirmation).toContainText(
    "Local agents managed on this Mac: Ava, Noah",
  );
  await expect(page.getByTestId("signout-confirm")).toBeEnabled();
  await expect(
    page.evaluate(() => {
      const commands = window.__BUZZ_E2E_COMMANDS__ ?? [];
      return (
        commands.includes("sign_out") || commands.includes("sign_out_keep_data")
      );
    }),
  ).resolves.toBe(false);
});

test("Cancel closes the confirmation and nothing is removed", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openConfirmation(page);
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByTestId("signout-dialog")).toHaveCount(0);
  await expect(
    page.getByTestId("signout-open-dialog-remove-data"),
  ).toBeVisible();
  await expect(
    page.evaluate(
      () => window.__BUZZ_E2E_COMMANDS__?.includes("sign_out") ?? false,
    ),
  ).resolves.toBe(false);
});

test("Sign out keeps this computer's data", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "security");
  await page.getByTestId("signout-keep-data").click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_COMMANDS__?.includes("sign_out_keep_data") ?? false,
      ),
    )
    .toBe(true);
  await expect(
    page.evaluate(
      () => window.__BUZZ_E2E_COMMANDS__?.includes("sign_out") ?? false,
    ),
  ).resolves.toBe(false);
});

test("confirming Sign out & remove data runs the wipe", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/");
  await openConfirmation(page);
  await page.getByTestId("signout-confirm").click();

  await expect
    .poll(() =>
      page.evaluate(
        () => window.__BUZZ_E2E_COMMANDS__?.includes("sign_out") ?? false,
      ),
    )
    .toBe(true);
});
