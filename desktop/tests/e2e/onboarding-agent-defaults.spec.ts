import { expect, test } from "@playwright/test";

import {
  openR17ConnectionSetup,
  R17_BUSINESS_PROFILE_KEY,
  r17Runtime,
} from "../helpers/onboarding";

test("R17 connection setup discovers local apps and keeps its route choices available", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      r17Runtime("claude", "available", { status: "logged_in" }),
      r17Runtime("codex", "available", { status: "logged_in" }),
    ],
    discoveryDelayMs: 1_000,
  });

  await expect(
    page.getByRole("heading", { name: "Connect your AI." }),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-runtime-loading")).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-claude"),
  ).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-codex"),
  ).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-claude").getByRole("button"),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Bring your own key" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect directly to a provider" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "API key" })).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.getByRole("button", { name: "Check key" })).toBeVisible();

  await page.getByRole("button", { name: "OpenRouter" }).click();
  await expect(
    page.getByRole("heading", { name: "Your OpenRouter account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Subscriptions" }).click();
  await expect(
    page.getByRole("heading", { name: "On this computer" }),
  ).toBeVisible();
});

test("R17 onboarding can continue when provider discovery fails", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, { discoveryError: true });

  const discoveryNotice = page.getByRole("alert").filter({
    hasText: "We couldn’t check this computer.",
  });
  await expect(discoveryNotice).toBeVisible();
  await expect(discoveryNotice).not.toContainText("Mock ACP runtime discovery");
  await expect(
    page.getByRole("button", { name: "Bring your own key" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open my Colony" }),
  ).toBeEnabled();

  const savedBusiness = await page.evaluate((key) => {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  }, R17_BUSINESS_PROFILE_KEY);
  expect(savedBusiness).toMatchObject({
    name: "North Star",
    website: "northstar.example",
  });

  await page.getByRole("button", { name: "Open my Colony" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-nav-agents").click();
  await expect(page.getByTestId("settings-global-agent-config")).toBeVisible();
});
