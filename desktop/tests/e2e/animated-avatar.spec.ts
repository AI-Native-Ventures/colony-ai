import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installFakeCamera } from "../helpers/fakeCamera";
import { openAvatarProfileContext, openSettings } from "../helpers/settings";

const UPLOADED_PNG_DESCRIPTOR = {
  sha256: "ab".repeat(32),
  size: 4096,
  type: "image/png",
  uploaded: 1700000000,
  url: `https://relay.example.com/media/${"ab".repeat(32)}.png`,
};

async function openAvatarEditor(
  page: import("@playwright/test").Page,
  options: { holdCamera?: boolean; uploadDelayMs?: number } = {},
) {
  if (options.holdCamera) {
    await installFakeCamera(page, { holdCamera: true });
  } else {
    await installFakeCamera(page);
  }
  await installMockBridge(page, {
    uploadDescriptors: [UPLOADED_PNG_DESCRIPTOR],
    uploadDelayMs: options.uploadDelayMs,
  });
  await page.goto("/");
  await openSettings(page, "profile");
  await openAvatarProfileContext(page);
  await page.getByTestId("profile-avatar-edit").click();
}

async function waitForCameraFrame(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page
        .getByTestId("avatar-camera-preview")
        .evaluate((video) => (video as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0);
}

test.describe("R19 profile avatar editor", () => {
  test("offers the designed preset, upload, and camera choices", async ({
    page,
  }) => {
    await openAvatarEditor(page);

    const dialog = page.getByTestId("profile-avatar-dialog");
    await expect(dialog).toBeVisible();
    const options = dialog.getByTestId("avatar-options");
    await expect(options.getByTestId("avatar-option-initials")).toBeVisible();
    for (const preset of ["star", "leaf", "diamond", "sun", "flower"]) {
      await expect(
        options.getByTestId(`avatar-option-${preset}`),
      ).toBeVisible();
    }
    await expect(options.getByRole("button")).toHaveCount(6);
    await expect(dialog.getByRole("tablist")).toHaveCount(0);
    await expect(dialog.getByRole("tab", { name: "Animated" })).toHaveCount(0);
    await expect(dialog.getByTestId("avatar-upload-open")).toBeVisible();
    await expect(dialog.getByTestId("avatar-camera-open")).toBeVisible();

    await dialog.getByTestId("avatar-cancel").click();
    await expect(dialog).toHaveCount(0);
  });

  test("camera capture opens the designed crop state", async ({ page }) => {
    await openAvatarEditor(page, { holdCamera: true });
    const dialog = page.getByTestId("profile-avatar-dialog");

    await dialog.getByTestId("avatar-camera-open").click();
    await expect(dialog.getByTestId("avatar-camera-preview")).toBeVisible();
    await expect(dialog.getByTestId("avatar-camera-capture")).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __BUZZ_E2E_CAMERA_REQUEST_COUNT__?: number;
              }
            ).__BUZZ_E2E_CAMERA_REQUEST_COUNT__ ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    await page.evaluate(() => {
      (
        window as Window & {
          __BUZZ_E2E_RELEASE_CAMERA__?: () => void;
        }
      ).__BUZZ_E2E_RELEASE_CAMERA__?.();
    });
    await expect(dialog.getByTestId("avatar-camera-capture")).toBeEnabled();
    await waitForCameraFrame(page);
    await dialog.getByTestId("avatar-camera-capture").click();

    const crop = dialog.getByTestId("avatar-crop-preview");
    await expect(crop).toBeVisible();
    await expect(dialog.getByTestId("avatar-crop-zoom")).toBeVisible();
    await expect(dialog.getByTestId("avatar-save")).toBeVisible();
    await expect(
      dialog.getByText(
        "Drag to position; use arrow keys when the crop is focused.",
      ),
    ).toBeVisible();
  });

  test("saving a captured photo requires the designed confirmation", async ({
    page,
  }) => {
    await openAvatarEditor(page, { uploadDelayMs: 1_000 });
    const dialog = page.getByTestId("profile-avatar-dialog");

    await dialog.getByTestId("avatar-camera-open").click();
    await waitForCameraFrame(page);
    await dialog.getByTestId("avatar-camera-capture").click();
    await expect(dialog.getByTestId("avatar-crop-preview")).toBeVisible();
    await expect(dialog.getByTestId("avatar-save")).toBeVisible();

    await dialog.getByTestId("avatar-save").click();
    await expect(dialog.getByTestId("avatar-saving")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("profile-avatar-saved")).toHaveText(
      "Profile photo updated",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
              .__BUZZ_E2E_COMMANDS__ ?? [],
        ),
      )
      .toEqual(
        expect.arrayContaining(["upload_media_bytes_raw", "update_profile"]),
      );
  });
});
