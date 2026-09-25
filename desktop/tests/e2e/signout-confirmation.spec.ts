import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

async function openSignOutDialog(page: Parameters<typeof openSettings>[0]) {
  await openSettings(page, "security");
  await page.getByTestId("signout-open-dialog").click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
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

test("sign-out confirmation previews running agents and unsynced work", async ({
  page,
}) => {
  await installSignOutFixture(page);
  await openSignOutDialog(page);

  const dialog = page.getByRole("alertdialog");
  const removeButton = page.getByTestId("signout-confirm");

  await expect(
    dialog.getByText("Sign out of this device?", { exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    "Your remote business and conversations stay available.",
  );
  await expect(dialog).toContainText("2 local agents are running");
  await expect(dialog).toContainText(
    "Sign-out stops local agents on this device. Remote agents continue with their own permissions.",
  );
  await expect(dialog).toContainText("1 draft · 1 pending attachment");
  await expect(
    dialog.getByRole("button", { name: "Review before leaving" }),
  ).toBeVisible();
  await expect(removeButton).toBeEnabled();
  await expect(
    page.evaluate(
      () => window.__BUZZ_E2E_COMMANDS__?.includes("sign_out") ?? false,
    ),
  ).resolves.toBe(false);
  await dialog.getByRole("button", { name: "Review before leaving" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("settings-draft-recovery")).toBeVisible();
});

test("staying signed in closes the dialog and restores the security panel", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSignOutDialog(page);
  await page.getByRole("button", { name: "Stay signed in" }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("settings-account-security")).toBeVisible();
  await expect(page.getByTestId("signout-open-dialog")).toBeVisible();
  await selectSettingsSection(page, "profile");
  await expect(page.getByTestId("settings-profile")).toBeVisible();
});
