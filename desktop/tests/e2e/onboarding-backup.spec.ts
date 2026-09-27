import { expect, test } from "@playwright/test";

import { startR17AccountAuth } from "../helpers/onboarding";

async function expectNoKeyCopy(page: import("@playwright/test").Page) {
  await expect(page.locator("body")).not.toContainText(/\bkey\b|nsec1/i);
}

test("R17 signup verifies the account with a six-digit email code", async ({
  page,
}) => {
  await startR17AccountAuth(page);
  await expectNoKeyCopy(page);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("signup@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();

  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await expect(
    page.getByText("Enter the six-digit code sent to your email."),
  ).toBeVisible();
  for (let index = 1; index <= 6; index += 1) {
    await expect(page.getByLabel(`Digit ${index} of 6`)).toBeVisible();
  }
  await expect(page.getByTestId("otp-continue")).toBeDisabled();
  await expectNoKeyCopy(page);
});

test("R17 password recovery requests a code without key backup screens", async ({
  page,
}) => {
  await startR17AccountAuth(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByTestId("account-auth-screen-reset-request"),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("reset@example.com");
  await page.getByRole("button", { name: "Send code" }).click();

  await expect(
    page.getByTestId("account-auth-screen-reset-confirm"),
  ).toBeVisible();
  for (let index = 1; index <= 6; index += 1) {
    await expect(page.getByLabel(`Digit ${index} of 6`)).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Resend code in 60s" }),
  ).toBeDisabled();
  await expectNoKeyCopy(page);
});
