import { expect, test } from "@playwright/test";

import { startR17AccountAuth } from "../helpers/onboarding";

test("R17 lost-session boot offers account sign in", async ({ page }) => {
  await startR17AccountAuth(page, { identityLost: true });

  await expect(page.getByTestId("google-account-scene")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.locator("body")).not.toContainText(
    /\bkey\b|nsec1|pairing code/i,
  );
  await expect(page.getByTestId("identity-recovery-pairing")).toHaveCount(0);
});

test("R17 signup offers email-code resend after the cooldown", async ({
  page,
}) => {
  await page.clock.install();
  await startR17AccountAuth(page, { identityLost: true });
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("lost-session@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();

  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  const resend = page.getByRole("button", { name: "Resend code in 60s" });
  await expect(resend).toBeDisabled();
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("button", { name: "Resend code" })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText(
    /backup file|pairing code|nsec1/i,
  );
});

test("R17 lost-session recovery uses a six-digit email code", async ({
  page,
}) => {
  await startR17AccountAuth(page, { identityLost: true });
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address").fill("recover@example.com");
  await page.getByRole("button", { name: "Send code" }).click();

  await expect(
    page.getByTestId("account-auth-screen-reset-confirm"),
  ).toBeVisible();
  for (let index = 1; index <= 6; index += 1) {
    await expect(page.getByLabel(`Digit ${index} of 6`)).toBeVisible();
  }
  await expect(page.getByTestId("identity-recovery-qr")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    /phone recovery|ncryptsec/i,
  );
});
