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
    await expect(page.getByText(/^More tools \(/)).toHaveCount(0);
    const card = page.getByTestId("onboarding-connect-runtime-codex");
    await expect(card).toContainText("Setup needed");
    await expect(card).toContainText(
      "Codex is installed. Its connection needs to be set up.",
    );
    await expect(card).not.toContainText("Not installed");
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/harness-detection/app-subscription-missing-${viewport.width}.png`,
    });
    await card
      .getByRole("button", { name: "Set up connection", exact: true })
      .click();
    await expect(card).toContainText("Installed");
    await expect(
      card.getByRole("button", { name: "Set up connection", exact: true }),
    ).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/harness-detection/app-connect-${viewport.width}.png`,
    });
  });
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`other harnesses stay in Settings, not onboarding, at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
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
      r17Runtime("codex", "available", { status: "unknown" }),
    ];
    await openR17ConnectionSetup(page, { runtimes });
    await expect(
      page.getByTestId("onboarding-connect-runtime-codex"),
    ).toBeVisible();
    for (const id of ["goose", "omp", "grok", "buzz-agent"])
      await expect(
        page.getByTestId(`onboarding-connect-runtime-${id}`),
      ).toHaveCount(0);
    await expect(page.getByText(/^More tools \(/)).toHaveCount(0);
    await expect(page.locator("details.more-tools")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Skip for now", exact: true }),
    ).toBeEnabled();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/harness-detection/app-two-paths-only-${viewport.width}.png`,
    });
  });
}

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
    await expect(
      page.getByRole("button", {
        name: "Check installed AI apps again",
        exact: true,
      }),
    ).toBeDisabled();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/harness-detection/app-subscription-scan-${viewport.width}.png`,
    });
    await expect(
      page.getByTestId("onboarding-connect-runtime-codex"),
    ).toContainText("Setup needed");
    await expect(page.getByTestId("onboarding-runtime-loading")).toHaveCount(0);
  });
}

test("bundled Colony Agent is its own path, not a setup card", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
    ],
  });
  await expect(
    page.getByTestId("onboarding-connect-runtime-buzz-agent"),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "Colony Agent", exact: true }).click();
  const colonyAgent = page.getByTestId("onboarding-colony-agent");
  await expect(colonyAgent).toBeVisible();
  await expect(
    colonyAgent.getByRole("button", { name: /Check .* again/ }),
  ).toHaveCount(0);
  await expect(
    colonyAgent.getByRole("button", { name: /Open .* setup guide/ }),
  ).toHaveCount(0);
});

test("runtime auth recheck is labelled and disabled during discovery", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [r17Runtime("codex", "available", { status: "unknown" })],
    discoveryDelayMs: 1500,
  });
  const card = page.getByTestId("onboarding-connect-runtime-codex");
  await expect(card).toContainText("Sign-in status unavailable");
  const check = card.getByRole("button", {
    name: "Check Codex again",
    exact: true,
  });
  await expect(check).toBeEnabled();
  await expect(
    card.getByRole("button", { name: "Open Codex setup guide", exact: true }),
  ).toBeEnabled();
  await check.click();
  await expect(check).toBeDisabled();
  await expect(check).toBeEnabled();
});

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`subscriptions show actual allowances and no other tools at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [
        r17Runtime("goose", "available", { status: "unknown" }),
        { ...readyCodex, availability: "adapter_outdated" },
        r17Runtime("claude", "available", { status: "logged_in" }),
      ],
      mock: {
        aiSubscriptions: [
          // This fixture uses the real redacted Codex result observed on this
          // Mac on 4 October. Browser bridge evidence is still not a packaged run.
          {
            id: "codex",
            signedIn: true,
            plan: "ChatGPT Pro",
            source: "live",
            windows: [
              {
                label: "Weekly allowance",
                remainingPercent: 87,
                resetsAt: 1791580861000,
              },
            ],
            message: null,
          },
          {
            id: "claude",
            signedIn: null,
            plan: "Max 20x",
            source: "cached",
            windows: [],
            message:
              "Allow access to Claude sign-in to check your subscription. macOS may ask for permission.",
          },
        ],
        installAcpRuntimeResults: [
          {
            success: false,
            steps: [
              {
                step: "adapter",
                command: "install",
                success: false,
                stdout: "",
                stderr:
                  "install command exceeded the 2-minute ceiling and was terminated",
                exit_code: null,
              },
            ],
            restarted_count: 0,
            failed_restart_count: 0,
            log_path: null,
          },
          {
            success: true,
            steps: [],
            restarted_count: 0,
            failed_restart_count: 0,
            log_path: null,
          },
        ],
        acpRuntimesCatalogAfterInstall: [
          readyCodex,
          r17Runtime("claude", "available", { status: "logged_in" }),
          r17Runtime("goose", "available", { status: "unknown" }),
        ],
      },
    });
    const codex = page.getByTestId("onboarding-connect-runtime-codex");
    await expect(codex).toBeVisible();
    await expect(codex).toContainText("ChatGPT Pro");
    await expect(codex).toContainText("87% left");
    await expect(codex.getByRole("progressbar")).toHaveAttribute("value", "87");
    await expect(codex).not.toContainText("5-hour allowance");
    await expect(
      page.getByTestId("onboarding-connect-runtime-goose"),
    ).toBeHidden();
    await expect(
      page.getByTestId("onboarding-connect-runtime-claude"),
    ).toContainText("Last known plan: Max 20x");
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/subscriptions/app-real-data-${viewport.width}.png`,
    });
    await codex
      .getByRole("button", { name: "Update connection", exact: true })
      .click();
    await expect(codex.getByRole("alert")).toContainText("timed out");
    await codex.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      codex.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/^More tools \(/)).toHaveCount(0);
    await expect(
      page.getByTestId("onboarding-connect-runtime-goose"),
    ).toHaveCount(0);
  });
}

test("Claude protected subscription is checked only after an explicit action", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
    mock: {
      aiSubscriptions: [
        {
          id: "claude",
          signedIn: null,
          plan: "Max 20x",
          source: "cached",
          windows: [],
          message: "macOS may ask for permission.",
        },
      ],
      claudeSubscriptionResult: {
        id: "claude",
        signedIn: true,
        plan: "Max 20x",
        source: "live",
        windows: [
          { label: "5-hour allowance", remainingPercent: 72, resetsAt: null },
        ],
        message: null,
      },
    },
  });
  const card = page.getByTestId("onboarding-connect-runtime-claude");
  await expect(card).toContainText("Last known plan");
  await expect(card).not.toContainText("72% left");
  await card
    .getByRole("button", { name: "Check Claude subscription", exact: true })
    .click();
  await expect(card).toContainText("72% left");
  await expect(card).toContainText("Subscription found");
  await expect(
    card.getByRole("button", {
      name: "Check Claude subscription",
      exact: true,
    }),
  ).toHaveCount(0);
});

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`local real subscription snapshot proof ${viewport.width}`, async ({
    page,
    context,
  }) => {
    test.skip(
      !process.env.COLONY_SUBSCRIPTION_PROOF_FILE,
      "Local acceptance only, uses a redacted production-reader result",
    );
    const { readFile, mkdir } = await import("node:fs/promises");
    const snapshot = JSON.parse(
      await readFile(
        process.env.COLONY_SUBSCRIPTION_PROOF_FILE as string,
        "utf8",
      ),
    );
    const proofDir =
      process.env.COLONY_SUBSCRIPTION_PROOF_DIR ?? "test-results/subscriptions";
    await mkdir(proofDir, { recursive: true });
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [
        r17Runtime("claude", "available", { status: "logged_in" }),
        readyCodex,
        r17Runtime("goose", "available", { status: "unknown" }),
      ],
      mock: { aiSubscriptions: snapshot.subscriptions },
    });
    await expect(
      page.getByTestId("onboarding-connect-runtime-codex"),
    ).toContainText("ChatGPT Pro");
    await expect(
      page.getByTestId("onboarding-connect-runtime-claude"),
    ).toContainText("Last known plan: Max 20x");
    await expect(
      page.getByTestId("onboarding-connect-runtime-goose"),
    ).toBeHidden();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${proofDir}/app-production-snapshot-${viewport.width}.png`,
    });
    if (process.env.COLONY_REFERENCE_URL) {
      const reference = await context.newPage();
      await reference.setViewportSize(viewport);
      await reference.emulateMedia({ reducedMotion: "reduce" });
      await reference.goto(`${process.env.COLONY_REFERENCE_URL}#connect`);
      await expect(
        reference.getByText("Subscription found", { exact: true }).first(),
      ).toBeVisible();
      await expect(reference.locator(".form-content")).toHaveCSS(
        "opacity",
        "1",
      );
      await waitForAnimations(reference);
      await reference.screenshot({
        path: `${proofDir}/reference-connect-${viewport.width}.png`,
      });
      await reference.close();
    }
  });
}
