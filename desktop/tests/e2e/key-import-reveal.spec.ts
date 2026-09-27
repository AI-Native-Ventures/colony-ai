import { expect, test } from "@playwright/test";

import { startR17AccountAuth } from "../helpers/onboarding";

test("R17 account passwords stay masked while entering credentials", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startR17AccountAuth(page);

  const signInPassword = page.getByLabel("Password", { exact: true });
  await expect(signInPassword).toHaveAttribute("type", "password");
  await signInPassword.fill("correct-horse-12");
  await expect(signInPassword).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Create an account" }).click();
  const signupPassword = page.getByRole("textbox", { name: "Password" });
  await expect(signupPassword).toHaveAttribute("type", "password");
  await signupPassword.fill("correct-horse-12");
  await expect(signupPassword).toHaveAttribute("type", "password");

  await page.setViewportSize({ width: 720, height: 620 });
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});
