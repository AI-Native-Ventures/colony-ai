import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

async function setup(
  page: import("@playwright/test").Page,
  lifecycle: "ready" | "failed" | "stopped" = "ready",
  options: {
    source?: "claude-code" | "openrouter" | "own-key";
    auth?: "logged_in" | "logged_out" | "unknown" | "config_invalid";
    connection?: "connected" | "limit" | "unlinked";
  } = {},
) {
  const pubkey = TEST_IDENTITIES.alice.pubkey;
  const source = options.source ?? "claude-code";
  const harness = source === "claude-code" ? "claude" : "buzz-agent";
  const provider = source === "openrouter" ? "openrouter" : "anthropic";
  await page.addInitScript(
    (identity) =>
      localStorage.setItem(
        "buzz:e2e-identity-override.v1",
        JSON.stringify(identity),
      ),
    TEST_IDENTITIES.tyler,
  );
  await installMockBridge(page, {
    relaySelf: getPublicKey(generateSecretKey()),
    relayMembers: [{ pubkey: TEST_IDENTITIES.tyler.pubkey, role: "owner" }],
    relayAgents: [
      {
        pubkey,
        name: "Scout",
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
        status: "unknown",
      },
    ],
    searchProfiles: [
      { pubkey, displayName: "Scout" },
      { pubkey: TEST_IDENTITIES.tyler.pubkey, displayName: "Basheer Phiri" },
    ],
    managedAgents: [
      {
        pubkey,
        name: "Scout",
        personaId: "builtin:fizz",
        runtime: harness,
        model: "sonnet",
        provider,
        envVars:
          source === "own-key"
            ? { ANTHROPIC_API_KEY: "test-only-placeholder" }
            : {},
        status: lifecycle === "stopped" ? "stopped" : "running",
      },
    ],
    managedAgentRuntimes: [
      { pubkey, relayUrl: "ws://localhost:3000", lifecycle },
    ],
    acpRuntimesCatalog: [
      {
        id: harness,
        label: source === "claude-code" ? "Claude Code" : "Colony Agent",
        availability: "available",
        command: harness,
        auth_status: {
          status:
            source === "claude-code"
              ? (options.auth ?? "logged_in")
              : "not_applicable",
        },
        requires_external_cli: true,
        source: "preset",
      },
    ],
  });
  await page.goto("/#/team");
  await expect(page.getByTestId(`company-team-member-${pubkey}`)).toBeVisible();
  // Supply the same typed IPC payload consumed by production. No personal file is read.
  await page.evaluate(
    ({ provider, connection }) => {
      const bridge = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, payload?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const invoke = bridge.invoke.bind(bridge);
      const field = (value: string) => ({
        value,
        origin: "configFile",
        writeVia: { type: "readOnly" },
        overriddenValue: null,
        overriddenOrigin: null,
        isRequired: false,
      });
      bridge.invoke = (command, payload) =>
        command === "get_agent_config_surface"
          ? Promise.resolve({
              runtimeId: "claude",
              runtimeLabel: "Claude Code",
              isPreSpawn: false,
              normalized: {
                model: field("sonnet"),
                thinkingEffort: field("high"),
                provider: field(provider),
                maxOutputTokens: field("16384"),
                contextLimit: null,
                mode: null,
                systemPrompt: null,
              },
              advanced: [
                "agentPushNotifEnabled",
                "autoUpdatesChannel",
                "enableAllProjectMcpServers",
                "enabledPlugins.agent-sdk-dev@claude-plugins-official",
                "enabledPlugins.caveman@caveman",
              ].map((key) => ({
                key,
                label: key,
                value: "true",
                origin: "configFile",
                schemaType: { type: "boolean" },
                writeVia: { type: "readOnly" },
              })),
              extensions: [],
              sources: { configFilePath: "private-settings-path" },
            })
          : command === "get_openrouter_connection"
            ? Promise.resolve({
                status: connection,
                balance: null,
                usage: null,
                freeUsed: null,
                limit: null,
                limitRemaining: null,
                freeRemaining: null,
                freeLimit: null,
                freeTier: null,
                models: [],
                model: "sonnet",
                failedRestarts: 0,
              })
            : invoke(command, payload);
    },
    { provider, connection: options.connection ?? "connected" },
  );
  return pubkey;
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`Scout artwork, runtime privacy and connected Salary at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const pubkey = await setup(page);
    const row = page.getByTestId(`company-team-member-${pubkey}`);
    await expect(row).toContainText("Ready");
    await expect(row).not.toContainText("unknown");
    await expect(page.getByTestId(`team-avatar-${pubkey}-image`)).toBeVisible();
    const dir =
      process.env.COLONY_TEAM_SCOUT_ARTIFACT_DIR ?? "test-results/team-scout";
    mkdirSync(dir, { recursive: true });
    async function capture(name: string) {
      await waitForAnimations(page);
      await page.screenshot({
        path: `${dir}/${name}-${viewport.width}-${info.project.name}.png`,
      });
    }
    await capture("team");
    await page.getByRole("tab", { name: "Reporting lines" }).click();
    await expect(
      page.getByRole("treeitem").filter({ hasText: "Scout" }),
    ).toContainText("Ready");
    await expect(page.getByTestId(`team-avatar-${pubkey}-image`)).toBeVisible();
    await capture("team-org");
    await page.getByTestId(`company-team-member-${pubkey}`).click();
    await expect(
      page.getByTestId("employee-header-avatar-image"),
    ).toBeVisible();
    await expect(page.getByTestId("company-position-header")).toContainText(
      "Employee · Ready",
    );
    await capture("scout-detail");
    await page.getByRole("tab", { name: "Model & runtime" }).click();
    const summary = page.getByTestId("employee-runtime-summary");
    await expect(summary).toContainText("HarnessClaude Code");
    await expect(summary).toContainText("Modelsonnet");
    await expect(summary).toContainText("Thinking efforthigh");
    const harnessLabel = await summary.locator("dt").first().boundingBox();
    const harnessValue = await summary.locator("dd").first().boundingBox();
    if (!harnessLabel || !harnessValue)
      throw new Error(
        "Runtime fields must render before measuring the reference rows",
      );
    expect(harnessValue.x).toBeGreaterThan(harnessLabel.x + harnessLabel.width);
    expect(harnessValue.y).toBe(harnessLabel.y);
    await expect(
      page.getByTestId("employee-runtime-advanced"),
    ).not.toHaveAttribute("open", "");
    await expect(summary.getByText("16384", { exact: true })).not.toBeVisible();
    for (const key of [
      "agentPushNotifEnabled",
      "autoUpdatesChannel",
      "enableAllProjectMcpServers",
      "enabledPlugins",
      "private-settings-path",
      "Provider",
      "template default",
    ])
      await expect(summary).not.toContainText(key);
    await capture("scout-model");
    await summary.getByText("Advanced", { exact: true }).click();
    await expect(summary.getByText("16384", { exact: true })).toBeVisible();
    await expect(summary).not.toContainText("agentPushNotifEnabled");
    await capture("scout-model-advanced");
    await page.getByRole("tab", { name: "Salary" }).click();
    const salary = page.getByTestId("employee-salary");
    await expect(salary).toContainText("Claude Code account");
    await expect(
      page.getByTestId("employee-funding-source").getByRole("status"),
    ).toHaveText("Connected");
    await expect(salary).not.toContainText("Not configured");
    await expect(salary).toContainText("No company allowance recorded");
    await expect(
      salary.getByRole("button", { name: "Change allowance or funding" }),
    ).toHaveCount(0);
    await capture("scout-salary");
  });
}

for (const [lifecycle, label] of [
  ["failed", "Needs attention"],
  ["stopped", "Offline"],
] as const) {
  test(`Scout ${lifecycle} state is shown in Team and profile`, async ({
    page,
  }) => {
    const pubkey = await setup(page, lifecycle);
    await expect(
      page.getByTestId(`company-team-member-${pubkey}`),
    ).toContainText(label);
    await page.getByTestId(`company-team-member-${pubkey}`).click();
    await expect(page.getByTestId("company-position-header")).toContainText(
      `Employee · ${label}`,
    );
  });
}

test("Scout active work changes the live Team status", async ({ page }) => {
  const pubkey = await setup(page);
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate((agentPubkey) => {
    window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
      agentPubkey,
      channelId: "team-scout-status",
      turnId: "team-scout-turn",
    });
  }, pubkey);
  await expect(page.getByTestId(`company-team-member-${pubkey}`)).toContainText(
    "Working",
  );
  await page.getByTestId(`company-team-member-${pubkey}`).click();
  await expect(page.getByTestId("company-position-header")).toContainText(
    "Employee · Working",
  );
});

test("Scout artwork and runtime state are shared with the agent profile", async ({
  page,
}) => {
  const pubkey = await setup(page);
  await page.evaluate(() => {
    window.location.hash = "/agents";
  });
  const directory = page.getByTestId("agent-directory");
  await expect(directory).toBeVisible();
  await expect(
    page.getByTestId(`agent-directory-avatar-${pubkey}-image`),
  ).toBeVisible();
  await expect(page.getByTestId(`managed-agent-${pubkey}`)).toContainText(
    "Ready",
  );
  await expect(
    directory.getByRole("option", { name: "Unknown", exact: true }),
  ).toHaveCount(0);
  await directory.getByLabel("Filter by status").selectOption("idle");
  await expect(page.getByTestId(`managed-agent-${pubkey}`)).toBeVisible();
  await directory.getByLabel("Filter by status").selectOption("stopped");
  await expect(page.getByTestId(`managed-agent-${pubkey}`)).toHaveCount(0);
  await directory.getByLabel("Filter by status").selectOption("all");
  const dir =
    process.env.COLONY_TEAM_SCOUT_ARTIFACT_DIR ?? "test-results/team-scout";
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1728, height: 1117 });
  await waitForAnimations(page);
  await page.screenshot({
    path: `${dir}/scout-directory-1728-${test.info().project.name}.png`,
  });
  await page.evaluate((agent) => {
    window.location.hash = `/agents?agent=${agent}`;
  }, pubkey);
  const profile = page.getByTestId("agent-profile");
  await expect(profile).toBeVisible();
  await expect(page.getByTestId("agent-profile-avatar-image")).toBeVisible();
  await expect(
    profile.getByText("Presence: Ready", { exact: true }),
  ).toBeVisible();
  await expect(profile.getByText("Unknown", { exact: true })).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: `${dir}/scout-agent-profile-1728-${test.info().project.name}.png`,
  });
});

for (const [auth, expected] of [
  ["logged_out", "Sign-in needed"],
  ["unknown", "Connection not reported"],
  ["config_invalid", "Needs attention"],
] as const) {
  test(`Salary reports Claude Code ${auth} separately from an allowance`, async ({
    page,
  }) => {
    const pubkey = await setup(page, "ready", { auth });
    await page.getByTestId(`company-team-member-${pubkey}`).click();
    await page.getByRole("tab", { name: "Salary" }).click();
    await expect(
      page.getByTestId("employee-funding-source").getByRole("status"),
    ).toHaveText(expected);
    await expect(page.getByTestId("employee-funding-source")).toContainText(
      "Claude Code account",
    );
  });
}

for (const [connection, expected] of [
  ["connected", "Connected"],
  ["limit", "Spending limit reached"],
  ["unlinked", "Not connected"],
] as const) {
  test(`Salary reports OpenRouter ${connection} from connection metadata`, async ({
    page,
  }) => {
    const pubkey = await setup(page, "ready", {
      source: "openrouter",
      connection,
    });
    await page.getByTestId(`company-team-member-${pubkey}`).click();
    await page.getByRole("tab", { name: "Salary" }).click();
    await expect(
      page.getByTestId("employee-funding-source").getByRole("status"),
    ).toHaveText(expected);
    await expect(page.getByTestId("employee-funding-source")).toContainText(
      "OpenRouter",
    );
  });
}

test("Salary distinguishes a configured own key from a proven account connection", async ({
  page,
}) => {
  const pubkey = await setup(page, "ready", { source: "own-key" });
  await page.getByTestId(`company-team-member-${pubkey}`).click();
  await page.getByRole("tab", { name: "Salary" }).click();
  const funding = page.getByTestId("employee-funding-source");
  await expect(funding).toContainText("Anthropic · Own key");
  await expect(funding.getByRole("status")).toHaveText(
    "Key configured; account status not reported",
  );
  await expect(funding).not.toContainText("test-only-placeholder");
});
