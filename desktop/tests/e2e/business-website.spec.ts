import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { openR17BusinessSetup } from "../helpers/onboarding";

const metadata = {
  title: "Colony",
  description: "A team for your business.",
  faviconDataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz0AAAAASUVORK5CYII=",
  siteName: null,
  imageDataUrl: null,
  imageDomain: null,
  imageFetchState: "none" as const,
  imageRetryAfterMs: null,
};

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`website assistance preserves edits and shows recovery at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17BusinessSetup(page, {
      mock: { linkPreviewMetadata: metadata, linkPreviewMetadataDelayMs: 250 },
    });
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/business-detect/app-business-${viewport.width}.png`,
    });
    await page
      .getByLabel("Website", { exact: false })
      .fill("https://colony.global");
    await page
      .getByRole("button", { name: "Read website", exact: true })
      .click();
    await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
      "",
    );
    await expect(page.getByLabel("What does your business do?")).toHaveValue(
      metadata.description,
    );
    await expect(page.locator(".logo-editor img")).toHaveAttribute(
      "src",
      metadata.faviconDataUrl,
    );
    await page.getByLabel("Business name", { exact: true }).fill("My business");
    await page
      .getByLabel("What does your business do?")
      .fill("My own description");
    await page
      .getByRole("button", { name: "Read website", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Reading…" })).toBeVisible();
    await page
      .getByLabel("What does your business do?")
      .fill("Edited while reading");
    await expect(
      page.getByRole("button", { name: "Read website", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
      "My business",
    );
    await expect(page.getByLabel("What does your business do?")).toHaveValue(
      "Edited while reading",
    );
  });
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`failed website analysis keeps the manual form usable at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17BusinessSetup(page);
    await page
      .getByLabel("Website", { exact: false })
      .fill("https://colony.global");
    await page
      .getByRole("button", { name: "Read website", exact: true })
      .click();
    await expect(
      page.getByText(
        "We couldn’t read that website. You can add a logo and description yourself.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Read website", exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("What does your business do?")
      .fill("Manual description");
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/business-detect/app-business-error-${viewport.width}.png`,
    });
  });
}

test("a result for an old URL cannot overwrite the new URL's state", async ({
  page,
}) => {
  await openR17BusinessSetup(page, {
    mock: { linkPreviewMetadata: metadata, linkPreviewMetadataDelayMs: 500 },
  });
  await page
    .getByLabel("Website", { exact: false })
    .fill("https://colony.global");
  await page.getByRole("button", { name: "Read website", exact: true }).click();
  await page
    .getByLabel("Website", { exact: false })
    .fill("https://example.com");
  await page.waitForTimeout(650);
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("What does your business do?")).toHaveValue("");
  await expect(page.locator(".logo-editor img")).toHaveCount(0);
});

test("an uploaded logo wins over an in-flight website icon", async ({
  page,
}) => {
  await openR17BusinessSetup(page, {
    mock: { linkPreviewMetadata: metadata, linkPreviewMetadataDelayMs: 500 },
  });
  await page
    .getByLabel("Website", { exact: false })
    .fill("https://colony.global");
  await page.getByRole("button", { name: "Read website", exact: true }).click();
  await page.locator("#business-logo").setInputFiles({
    name: "business.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle r="8" cx="8" cy="8" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".logo-editor img")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
  await expect(
    page.getByRole("button", { name: "Read website", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".logo-editor img")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
});
