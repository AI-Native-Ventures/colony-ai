import { expect, test } from "@playwright/test";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";
import { waitForAnimations } from "../helpers/animations";
import { mkdir } from "node:fs/promises";

const claude = r17Runtime("claude", "available", { status: "logged_in" });
const codex = r17Runtime("codex", "available", { status: "logged_in" });

test("Connect waits for the actual reply, then saves the selected runtime", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [claude, codex],
    mock: {
      discoverAgentModels: {
        supportsSwitching: true,
        models: [{ id: "actual-model", name: "Chosen model" }],
      },
      onboardingConnectionDelayMs: 400,
      startManagedAgentDelayMsByName: { Honey: 30_000, Pollen: 30_000 },
      onboardingConnectionResult: {
        reply: "A reply from the selected harness",
        model: "actual-model",
        startupMs: 80,
        totalMs: 400,
      },
    },
  });
  await page
    .getByTestId("onboarding-connect-runtime-codex")
    .getByRole("button", { name: /Codex/ })
    .click();
  await page.getByRole("button", { name: /^Connect with / }).click();
  await expect(page.getByTestId("onboarding-scene-testing")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Waiting for its first reply",
  );
  await expect(page.locator(".progress-list li.complete")).toHaveCount(2);
  await expect(
    page.locator(".progress-list li").nth(2).locator(".spinner"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A first hello." }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        window.__BUZZ_E2E_COMMANDS__?.filter(
          (command) => command === "set_global_agent_config",
        ).length ?? 0,
    ),
  ).toBe(0);
  await expect(page.getByText("Connection verified")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
  await expect(page.locator(".reply")).toContainText(
    "A reply from the selected harness",
  );
  await expect(page.locator(".connection-meta")).toContainText(
    "Codex · actual-model",
  );
  const probe = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.find(
      (entry) => entry.command === "test_onboarding_connection",
    ),
  );
  expect(probe?.payload).toMatchObject({
    config: { preferred_runtime: "codex" },
  });
  const saved = await page.evaluate(async () =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("get_global_agent_config", null),
  );
  expect(saved).toMatchObject({
    preferred_runtime: "codex",
    model: null,
  });
  await page
    .getByRole("button", { name: "Open my Colony", exact: true })
    .click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
            (entry) => entry.command === "create_managed_agent",
          ).length ?? 0,
      ),
    )
    .toBe(1);
  const creations = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
      (entry) => entry.command === "create_managed_agent",
    ),
  );
  for (const creation of creations ?? [])
    expect(creation.payload).toMatchObject({
      input: { agentCommand: "codex", harnessOverride: true },
    });
  await page.getByTestId("channel-Welcome").click();
  await expect(page.getByTestId("message-timeline")).toContainText("Scout", {
    timeout: 5_000,
  });
  expect(
    await page.evaluate(
      () =>
        window.__BUZZ_E2E_COMMANDS__?.filter(
          (command) => command === "set_global_agent_config",
        ).length ?? 0,
    ),
  ).toBe(1);
});

for (const result of [
  { error: "Provider rejected authentication. Sign in again." },
  { reply: "", model: "actual-model" },
]) {
  test(`Connect rejects ${result.error ? "provider failure" : "an empty reply"}`, async ({
    page,
  }) => {
    await openR17ConnectionSetup(page, {
      runtimes: [claude],
      mock: { onboardingConnectionResult: result },
    });
    const before = await page.evaluate(async () =>
      window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "get_global_agent_config",
        null,
      ),
    );
    await page.getByRole("button", { name: /^Connect with / }).click();
    await expect(
      page.getByTestId("onboarding-scene-connection-error"),
    ).toBeVisible();
    await expect(page.getByText("Connection verified")).toHaveCount(0);
    expect(
      await page.evaluate(async () =>
        window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
          "get_global_agent_config",
          null,
        ),
      ),
    ).toEqual(before);
    await expect(
      page.getByRole("button", { name: "Try again", exact: true }),
    ).toBeVisible();
  });
}

test("cancelling stops the native attempt, preserves settings and ignores a late reply", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [claude],
    mock: { onboardingConnectionDelayMs: 800 },
  });
  await page.getByRole("button", { name: /^Connect with / }).click();
  await page.getByRole("button", { name: "Cancel test" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_COMMANDS__?.filter(
            (command) => command === "cancel_onboarding_connection_test",
          ).length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  await expect(page.getByText("Connection verified")).toHaveCount(0);
  await page.getByRole("button", { name: /^Connect with / }).click();
  await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
  await page.getByRole("button", { name: "Change connection" }).click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
});

test("Welcome exposes recovery when the saved runtime disappears, then retries provisioning", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, { runtimes: [claude] });
  await page.getByRole("button", { name: /^Connect with / }).click();
  await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
  await page.evaluate(async () => {
    await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("set_global_agent_config", {
      config: {
        preferred_runtime: "codex",
        model: null,
        provider: null,
        env_vars: {},
      },
    });
  });
  await page
    .getByRole("button", { name: "Open my Colony", exact: true })
    .click();
  await page.getByTestId("channel-Welcome").click();
  const recovery = page.getByTestId("welcome-kickoff-recovery");
  await expect(recovery).toBeVisible();
  await expect(
    page.getByTestId("welcome-composer-guide-banner"),
  ).not.toContainText("Setting up your welcome team");
  await expect(recovery).toContainText("reconnect");
  await expect(
    recovery.getByRole("button", { name: "Open AI settings" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.__BUZZ_E2E_COMMANDS__?.filter(
          (command) => command === "create_managed_agent",
        ).length ?? 0,
    ),
  ).toBe(0);
  await page.evaluate(async () => {
    await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("set_global_agent_config", {
      config: {
        preferred_runtime: "claude",
        model: null,
        provider: null,
        env_vars: {},
      },
    });
  });
  const discoveryBeforeRetry = await page.evaluate(
    () =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
        (entry) =>
          entry.command === "discover_acp_providers" &&
          (entry.payload as { force?: boolean })?.force,
      ).length ?? 0,
  );
  await recovery.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Scout",
  );
  await expect(recovery).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
          (entry) =>
            entry.command === "discover_acp_providers" &&
            (entry.payload as { force?: boolean })?.force,
        ).length ?? 0,
    ),
  ).toBeGreaterThan(discoveryBeforeRetry);
});

for (const id of [
  "claude",
  "codex",
  "cursor",
  "devin",
  "omp",
  "grok",
  "opencode",
  "kimi",
  "amp",
  "hermes",
  "openclaw",
  "buzz-agent",
  "goose",
]) {
  test(`selected ${id} reaches the real Connect request without a bundled fallback`, async ({
    page,
  }) => {
    const providerRuntime = id === "buzz-agent" || id === "goose";
    const runtime = {
      ...r17Runtime("claude", "available", {
        status: providerRuntime ? "not_applicable" : "logged_in",
      }),
      id,
      label: id,
      command: id,
    };
    await openR17ConnectionSetup(page, {
      runtimes: [runtime],
      mock: {
        globalAgentConfig: {
          preferred_runtime: id,
          provider: providerRuntime ? "anthropic" : null,
          model: providerRuntime ? "provider-model" : null,
          env_vars: providerRuntime ? { ANTHROPIC_API_KEY: "fixture" } : {},
        },
      },
    });
    if (providerRuntime)
      await expect(
        page.getByTestId(`onboarding-connect-runtime-${id}`),
      ).not.toContainText("Signed in");
    await page.getByRole("button", { name: /^Connect with / }).click();
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    const request = await page.evaluate(() =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__?.find(
        (entry) => entry.command === "test_onboarding_connection",
      ),
    );
    expect(request?.payload).toMatchObject({
      config: {
        preferred_runtime: id,
        model: providerRuntime ? "provider-model" : null,
      },
    });
    const saved = await page.evaluate(async () =>
      window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "get_global_agent_config",
        null,
      ),
    );
    expect(saved).toMatchObject({
      preferred_runtime: id,
      model: providerRuntime ? "provider-model" : null,
    });
  });
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`first reply reference comparison ${viewport.width}`, async ({
    page,
    context,
  }) => {
    test.skip(
      !process.env.COLONY_REFERENCE_URL,
      "Local frozen-reference capture only",
    );
    const proofDir =
      process.env.COLONY_PROOF_DIR ?? "test-results/first-reply-proof";
    await mkdir(proofDir, { recursive: true });
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [claude],
      mock: { onboardingConnectionDelayMs: 2000 },
    });
    await page.getByRole("button", { name: /^Connect with / }).click();
    await expect(page.getByTestId("onboarding-scene-testing")).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "Waiting for its first reply",
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: `${proofDir}/app-testing-${viewport.width}.png`,
    });
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${proofDir}/app-connected-${viewport.width}.png`,
    });
    const reference = await context.newPage();
    await reference.setViewportSize(viewport);
    for (const scene of ["testing", "connected"]) {
      await reference.goto(`${process.env.COLONY_REFERENCE_URL}#${scene}`);
      // The frozen prototype reads its route on load, not hashchange.
      await reference.reload();
      if (scene === "connected")
        await expect(reference.getByText("Connection verified")).toBeVisible();
      await waitForAnimations(reference);
      await reference.screenshot({
        path: `${proofDir}/reference-${scene}-${viewport.width}.png`,
      });
    }
    await reference.close();
  });
}

test("an unavailable connection requires an explicit skip before app entry", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, { runtimes: [] });
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open my Colony", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});
