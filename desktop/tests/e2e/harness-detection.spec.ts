import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

const missingAdapter = {
  ...r17Runtime("codex", "adapter_missing", { status: "unknown" }),
  underlying_cli_path: "/Users/test/.local/bin/codex",
};
const readyCodex = {
  ...r17Runtime("codex", "available", { status: "logged_in" }),
  command: "codex-acp",
  binary_path: "/Users/test/.npm-global/bin/codex-acp",
  underlying_cli_path: "/Users/test/.local/bin/codex",
};

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`Codex CLI with missing adapter offers connection setup at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [missingAdapter],
      mock: { acpRuntimesCatalogAfterInstall: [readyCodex] },
    });
    const card = page.getByTestId("onboarding-connect-runtime-codex");
    await expect(card).toContainText("Connection needed");
    await expect(card).toContainText(
      "Codex is installed. Its connection adapter is missing.",
    );
    await expect(card).not.toContainText("Not installed");
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/harness-detection/app-subscription-missing-${viewport.width}.png`,
    });
    await card
      .getByRole("button", { name: "Set up connection", exact: true })
      .click();
    await expect(card).toContainText("Ready on this computer");
    await expect(
      card.getByRole("button", { name: "Set up connection", exact: true }),
    ).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/harness-detection/app-connect-${viewport.width}.png`,
    });
  });
}

test("unprobed provider harnesses never claim ready and retain setup recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1728, height: 1117 });
  const runtimes = [
    r17Runtime("goose", "available", { status: "not_applicable" }),
    {
      ...r17Runtime("goose", "available", { status: "unknown" }),
      id: "omp",
      label: "Oh My Pi",
      command: "omp",
    },
    {
      ...r17Runtime("goose", "available", { status: "unknown" }),
      id: "grok",
      label: "Grok Build",
      command: "grok",
    },
  ];
  await openR17ConnectionSetup(page, { runtimes });
  for (const id of ["goose", "omp", "grok"]) {
    const card = page.getByTestId(`onboarding-connect-runtime-${id}`);
    await expect(card).toContainText("Authentication not checked");
    await expect(card).not.toContainText("Ready on this computer");
    await expect(card.locator(".provider-status.is-connected")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Open setup guide", exact: true }),
    ).toBeEnabled();
    await expect(
      card.getByRole("button", { name: "Check again", exact: true }),
    ).toHaveCount(0);
    await expect(card).toContainText("Choose another connection here");
    await expect(
      card.getByRole("button", { name: "Install", exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    page.getByRole("button", { name: "Open my Colony", exact: true }),
  ).toBeEnabled();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/harness-detection/app-auth-unknown-1728.png",
  });
});

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`discovery shows its loading state at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [missingAdapter],
      discoveryDelayMs: 4000,
    });
    await expect(page.getByTestId("onboarding-runtime-loading")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/harness-detection/app-subscription-scan-${viewport.width}.png`,
    });
    await expect(
      page.getByTestId("onboarding-connect-runtime-codex"),
    ).toContainText("Connection needed");
    await expect(page.getByTestId("onboarding-runtime-loading")).toHaveCount(0);
  });
}

test("bundled Colony Agent does not offer an external setup guide or auth recheck", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
    ],
  });
  const card = page.getByTestId("onboarding-connect-runtime-buzz-agent");
  await expect(card).toContainText("No AI connected yet");
  await expect(
    card.getByRole("button", { name: "Check again", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Open setup guide", exact: true }),
  ).toHaveCount(0);
});
