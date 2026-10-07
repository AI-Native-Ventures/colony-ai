import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openProfileMenu, openSettings } from "../helpers/settings";

// Bound to the real SettingsView, ProfilePopover and ProfileAvatarDialog through
// App. Failures are injected by wrapping the real __TAURI_INTERNALS__.invoke, so
// the whole upload and profile-update path runs as in production.

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6okAAAAASUVORK5CYII=",
  "base64",
);

type FailureWindow = typeof window & {
  __AVATAR_FAIL__?: Record<string, string | null>;
  __AVATAR_HANG__?: Record<string, boolean>;
  __AVATAR_RELEASE__?: () => void;
  __BUZZ_E2E_COMMANDS__?: string[];
  __TAURI_INTERNALS__: {
    invoke: (
      command: string,
      payload: unknown,
      options: unknown,
    ) => Promise<unknown>;
  };
};

async function installFailureSwitch(page: Page) {
  await page.waitForFunction(
    () =>
      typeof (window as FailureWindow).__TAURI_INTERNALS__?.invoke ===
      "function",
  );
  await page.evaluate(() => {
    const w = window as FailureWindow;
    w.__AVATAR_FAIL__ = {};
    w.__AVATAR_HANG__ = {};
    const original = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
    w.__TAURI_INTERNALS__.invoke = async (command, payload, options) => {
      if (w.__AVATAR_HANG__?.[command]) {
        w.__AVATAR_HANG__[command] = false;
        w.__BUZZ_E2E_COMMANDS__?.push(`${command}:hung`);
        await new Promise<void>((resolve) => {
          w.__AVATAR_RELEASE__ = resolve;
        });
      }
      const message = w.__AVATAR_FAIL__?.[command];
      if (message) {
        w.__BUZZ_E2E_COMMANDS__?.push(`${command}:failed`);
        throw new Error(message);
      }
      return original(command, payload, options);
    };
  });
}

async function failCommand(
  page: Page,
  command: string,
  message: string | null,
) {
  await page.evaluate(
    ([name, text]) => {
      const w = window as FailureWindow;
      if (w.__AVATAR_FAIL__) w.__AVATAR_FAIL__[name] = text;
    },
    [command, message] as const,
  );
}

async function commandCount(page: Page, command: string) {
  return page.evaluate(
    (name) =>
      ((window as FailureWindow).__BUZZ_E2E_COMMANDS__ ?? []).filter(
        (entry) => entry === name,
      ).length,
    command,
  );
}

async function startOnProfilePanel(page: Page) {
  await installMockBridge(page);
  await page.goto("/");
  await installFailureSwitch(page);
  await openSettings(page, "profile");
  await expect(page.getByTestId("profile-photo-change")).toBeVisible();
}

async function openUploadWithPng(page: Page) {
  await page.getByTestId("profile-photo-change").click();
  await expect(page.getByTestId("profile-avatar-dialog")).toBeVisible();
  await page.getByTestId("avatar-upload-open").click();
  await page.getByTestId("avatar-file-input").setInputFiles({
    buffer: PNG_1X1,
    mimeType: "image/png",
    name: "me.png",
  });
  await expect(page.getByTestId("avatar-crop-preview")).toBeVisible();
}

async function expectDialogClosed(page: Page) {
  await expect(page.getByTestId("profile-avatar-dialog")).toHaveCount(0);
}

test.describe("profile photo is easy to find", () => {
  test("Settings Profile panel has a labelled Change photo control", async ({
    page,
  }) => {
    await startOnProfilePanel(page);

    const control = page.getByTestId("profile-photo-change");
    await expect(control).toHaveText("Change photo");
    await expect(
      page
        .getByTestId("settings-account-profile-card")
        .getByTestId("account-profile-avatar"),
    ).toBeVisible();

    await control.click();
    await expect(page.getByTestId("profile-avatar-dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Edit avatar" }),
    ).toBeVisible();
    await page.getByTestId("avatar-cancel").click();
    await expectDialogClosed(page);
  });

  test("the sidebar profile menu has a Change photo action", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto("/");
    await openProfileMenu(page);

    const item = page.getByTestId("profile-popover-change-photo");
    await expect(item).toHaveText("Change photo");
    await item.click();
    await expect(page.getByTestId("profile-avatar-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectDialogClosed(page);
  });

  test("the settings footer button is labelled Profile and account", async ({
    page,
  }) => {
    await startOnProfilePanel(page);

    const footer = page.getByTestId("settings-profile-avatar-context");
    await expect(footer).toHaveAccessibleName(/^Profile and account/);
    await footer.hover();
    await expect(
      page.getByTestId("settings-profile-avatar-context-tooltip").first(),
    ).toContainText("Profile and account");

    // The footer opens the avatar context view. Leaving it through the sidebar
    // must not strand the person without a photo control.
    await footer.click();
    await expect(page.getByTestId("profile-avatar-edit")).toBeVisible();
    await page.getByTestId("settings-group-account").click();
    await expect(page.getByTestId("profile-photo-change")).toBeVisible();
  });

  for (const [role, caption] of [
    ["owner", "Owner"],
    ["admin", "Admin"],
    ["member", "Member"],
  ] as const) {
    test(`the settings footer shows the real role: ${role}`, async ({
      page,
    }) => {
      await installMockBridge(page, {
        relayRequiresMembership: true,
        relayRole: role,
      });
      await page.goto("/");
      await openSettings(page, "profile");

      const footer = page.getByTestId("settings-profile-avatar-context");
      await expect(footer.locator("small")).toHaveText(caption);
      // A member or admin must never be told they own the workspace.
      if (role !== "owner") {
        await expect(footer).not.toContainText("Workspace owner");
      }
    });
  }

  test("keyboard only: Tab to Change photo, Enter opens, Escape closes and returns focus", async ({
    page,
  }) => {
    await startOnProfilePanel(page);

    const control = page.getByTestId("profile-photo-change");
    await page.getByTestId("settings-inner-profile").focus();
    let reached = false;
    for (let step = 0; step < 12 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await control.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("profile-avatar-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectDialogClosed(page);
    await expect(control).toBeFocused();
    // Escape closed only the dialog, not Settings.
    await expect(page.getByTestId("settings-view")).toBeVisible();
  });
});

test.describe("avatar dialog never hides a failure", () => {
  test("an unsupported file shows what is accepted and a way to choose another", async ({
    page,
  }) => {
    await startOnProfilePanel(page);
    await page.getByTestId("profile-photo-change").click();
    await page.getByTestId("avatar-upload-open").click();
    const input = page.getByTestId("avatar-file-input");
    await expect(input).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );

    await input.setInputFiles({
      buffer: Buffer.from("<svg/>"),
      mimeType: "image/svg+xml",
      name: "me.svg",
    });
    const alert = page.getByTestId("avatar-invalid");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toContainText("That file is not a supported image");
    await expect(alert).toContainText("JPEG, PNG or WebP image up to 20 MB");
    await expect(page.getByTestId("avatar-choose-another")).toBeVisible();
    await expect(page.getByTestId("avatar-crop-preview")).toHaveCount(0);

    await page.getByTestId("avatar-cancel").click();
    await expectDialogClosed(page);
  });

  test("a file over the limit says so and states the limit", async ({
    page,
  }) => {
    await startOnProfilePanel(page);
    await page.getByTestId("profile-photo-change").click();
    await page.getByTestId("avatar-upload-open").click();
    await page.getByTestId("avatar-file-input").setInputFiles({
      buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
      mimeType: "image/png",
      name: "huge.png",
    });
    const alert = page.getByTestId("avatar-invalid");
    await expect(alert).toContainText("That image is too large");
    await expect(alert).toContainText("up to 20 MB");
    await expect(alert).toHaveAttribute("data-error-kind", "too-large");
  });

  test("an upload that fails shows the error inline; Retry finishes the save", async ({
    page,
  }) => {
    await startOnProfilePanel(page);
    await failCommand(
      page,
      "upload_media_bytes_raw",
      "relay unreachable: request timed out",
    );
    await openUploadWithPng(page);
    await page.getByTestId("avatar-save").click();

    const alert = page.getByTestId("avatar-save-error");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveAttribute("data-error-kind", "network");
    await expect(alert).toContainText("Your avatar wasn’t saved");
    await expect(alert).toContainText("Check your connection");
    await expect(alert).not.toContainText("timed out");
    await expect(page.getByTestId("avatar-crop-preview")).toBeVisible();
    const retry = page.getByTestId("avatar-retry");
    await expect(retry).toHaveText("Try again");
    await expect(retry).toBeFocused();

    await failCommand(page, "upload_media_bytes_raw", null);
    await retry.click();
    await expectDialogClosed(page);
    await expect(page.getByTestId("profile-avatar-saved")).toHaveText(
      "Profile photo updated",
    );
  });

  test("a relay refusal is reported in plain words", async ({ page }) => {
    await startOnProfilePanel(page);
    await failCommand(
      page,
      "upload_media_bytes_raw",
      "relay returned 403 Forbidden: relay membership required",
    );
    await openUploadWithPng(page);
    await page.getByTestId("avatar-save").click();

    const alert = page.getByTestId("avatar-save-error");
    await expect(alert).toHaveAttribute("data-error-kind", "refused");
    await expect(alert).toContainText(
      "Your community did not accept the photo",
    );
    await expect(page.getByTestId("avatar-retry")).toBeVisible();
    await page.getByTestId("avatar-cancel").click();
    await expectDialogClosed(page);
  });

  test("a failed profile update keeps the upload and does not upload twice", async ({
    page,
  }) => {
    await startOnProfilePanel(page);
    await failCommand(page, "update_profile", "relay unreachable: offline");
    await openUploadWithPng(page);
    await page.getByTestId("avatar-save").click();
    await expect(page.getByTestId("avatar-save-error")).toBeVisible();
    await expect(page.getByTestId("avatar-retry")).toBeVisible();

    await failCommand(page, "update_profile", null);
    await page.getByTestId("avatar-retry").click();
    await expectDialogClosed(page);
    await expect(page.getByTestId("profile-avatar-saved")).toBeVisible();
    expect(await commandCount(page, "upload_media_bytes_raw")).toBe(1);
  });

  test("a failed preset save stays open with the error and Retry", async ({
    page,
  }) => {
    await startOnProfilePanel(page);
    await failCommand(page, "update_profile", "relay unreachable: offline");
    await page.getByTestId("profile-photo-change").click();
    await page.getByTestId("avatar-option-star").click();

    const alert = page.getByTestId("avatar-save-error");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("crop");
    await expect(page.getByTestId("profile-avatar-dialog")).toBeVisible();
    await expect(page.getByTestId("avatar-option-star")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await failCommand(page, "update_profile", null);
    await page.getByTestId("avatar-retry").click();
    await expectDialogClosed(page);
    await expect(page.getByTestId("profile-avatar-saved")).toBeVisible();
  });

  test("a camera that cannot start explains why and offers upload", async ({
    page,
  }) => {
    await startOnProfilePanel(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(new DOMException("denied", "NotAllowedError")),
        },
      });
    });
    await page.getByTestId("profile-photo-change").click();
    await page.getByTestId("avatar-camera-open").click();

    const alert = page.getByTestId("avatar-camera-error");
    await expect(alert).toContainText("Colony cannot use your camera");
    await page.getByTestId("avatar-camera-use-upload").click();
    await expect(page.getByTestId("avatar-file-input")).toBeVisible();
  });

  test("Cancel and Escape work while a save is in flight, and the save is dropped", async ({
    page,
  }) => {
    await startOnProfilePanel(page);
    await page.evaluate(() => {
      (window as FailureWindow).__AVATAR_HANG__ = {
        upload_media_bytes_raw: true,
      };
    });
    await openUploadWithPng(page);
    await page.getByTestId("avatar-save").click();
    await expect(page.getByTestId("avatar-saving")).toBeVisible();

    const cancel = page.getByTestId("avatar-cancel");
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expectDialogClosed(page);

    // The stalled upload finishes after Cancel: the profile must not change.
    const updatesBefore = await commandCount(page, "update_profile");
    await page.evaluate(() => (window as FailureWindow).__AVATAR_RELEASE__?.());
    await page.waitForTimeout(400);
    expect(await commandCount(page, "update_profile")).toBe(updatesBefore);
    await expect(page.getByTestId("profile-avatar-saved")).toHaveCount(0);

    // Escape closes a saving dialog as well.
    await page.evaluate(() => {
      (window as FailureWindow).__AVATAR_HANG__ = {
        upload_media_bytes_raw: true,
      };
    });
    await openUploadWithPng(page);
    await page.getByTestId("avatar-save").click();
    await expect(page.getByTestId("avatar-saving")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectDialogClosed(page);
    await expect(page.getByTestId("settings-view")).toBeVisible();
  });
});
