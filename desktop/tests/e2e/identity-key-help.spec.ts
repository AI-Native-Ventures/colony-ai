import { expect, test } from "@playwright/test";

import { startR17AccountAuth } from "../helpers/onboarding";

test("R17 account access fits a compact desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 620 });
  await startR17AccountAuth(page);

  await expect(page.getByTestId("google-account-scene")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
  await expect(page.getByTestId("identity-key-help-dialog")).toHaveCount(0);
});

test("R17 account access remains readable in the system dark theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await startR17AccountAuth(page);

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\bkey\b|nsec1/i);
});
