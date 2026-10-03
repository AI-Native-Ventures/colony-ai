import { expect, type Page, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

// These scenarios include account setup, business creation, OAuth and a first reply.
// Keep action/assertion timeouts intact while budgeting for the complete workflow.
test.setTimeout(60_000);

const connected = {
  status: "connected",
  balance: 12.5,
  usage: 1.5,
  freeUsed: 12,
  limit: 5,
  limitRemaining: 0,
  freeRemaining: 38,
  freeLimit: 50,
  freeTier: true,
  failedRestarts: 0,
  model: "fixture/free:free",
  models: [
    {
      id: "fixture/free:free",
      name: "Fixture free model",
      free: true,
      context: 32000,
    },
    {
      id: "fixture/free-two:free",
      name: "Second free model",
      free: true,
      context: 16000,
    },
    {
      id: "fixture/paid",
      name: "Fixture paid model",
      free: false,
      context: 32000,
    },
  ],
};

async function mockOAuth(
  page: Page,
  outcome: Record<string, unknown> = connected,
  delay = false,
  initial: Record<string, unknown> = { status: "unlinked" },
) {
  await page.evaluate(
    ({ next, hold, initial }) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const original = internals.invoke.bind(internals);
      let saved = false;
      let cancel: (() => void) | undefined;
      internals.invoke = async (command, args) => {
        if (command === "get_openrouter_connection")
          return saved ? next : initial;
        if (command === "connect_openrouter") {
          if (hold)
            return new Promise((resolve) => {
              cancel = () => resolve({ status: "cancelled" });
            });
          if (next.status === "connected" || next.status === "limit") {
            await original("set_global_agent_config", {
              config: {
                preferred_runtime: "buzz-agent",
                provider: "openrouter",
                model: next.model,
                env_vars: { OPENROUTER_API_KEY: "e2e-placeholder" },
              },
            });
            saved = true;
          }
          return next;
        }
        if (command === "cancel_openrouter") {
          cancel?.();
          return true;
        }
        if (command === "test_openrouter_connection")
          return { ...next, testResult: "connected" };
        if (command === "select_openrouter_model") {
          await original("set_global_agent_config", {
            config: {
              preferred_runtime: "buzz-agent",
              provider: "openrouter",
              model: args?.model,
              env_vars: { OPENROUTER_API_KEY: "e2e-placeholder" },
            },
          });
          return { ...next, model: args?.model };
        }
        return original(command, args);
      };
    },
    { next: outcome, hold: delay, initial },
  );
}

async function openRouterTab(page: Page) {
  await openR17ConnectionSetup(page, {
    runtimes: [
      {
        ...r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
        model_env_var: "BUZZ_AGENT_MODEL",
        provider_env_var: "BUZZ_AGENT_PROVIDER",
      },
    ],
  });
  await mockOAuth(page);
  await page.getByRole("radio", { name: "OpenRouter", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect OpenRouter", exact: true }),
  ).toBeEnabled();
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  for (const state of [
    "unlinked",
    "connected",
    "usage",
    "limit",
    "error",
  ] as const) {
    test(`OpenRouter ${state} at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openRouterTab(page);
      if (state !== "unlinked") {
        await mockOAuth(
          page,
          state === "error"
            ? {
                status: "error",
                message: "OpenRouter sign-in did not finish. Try again.",
              }
            : {
                ...connected,
                status: state === "usage" ? "connected" : state,
                balance:
                  state === "connected" || state === "limit" ? 12.5 : null,
                freeRemaining: state === "limit" ? 0 : 38,
                freeUsed: state === "limit" ? 50 : 12,
              },
        );
        await page
          .getByRole("button", { name: "Connect OpenRouter", exact: true })
          .click();
      }
      // "usage" is a connected key without an account balance, so it shares
      // the connected onboarding scene.
      await expect(
        page.getByTestId(
          `onboarding-scene-openrouter-${state === "usage" ? "connected" : state}`,
        ),
      ).toBeVisible();
      if (state === "error" || state === "limit")
        await expect(
          page.getByText("Needs your attention", { exact: true }),
        ).toBeVisible();
      const panel = page.getByTestId("openrouter-connection");
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(panel.locator('input[type="password"]')).toHaveCount(0);
      if (state === "connected" || state === "usage" || state === "limit") {
        await expect(
          panel.getByRole("button", { name: "Test connection", exact: true }),
        ).toHaveClass(/primary/);
        if (state === "connected")
          await expect(
            page.locator(".form-content button.primary"),
          ).toHaveCount(1);
        await expect(
          panel.getByText("Connected", { exact: true }),
        ).toBeVisible();
        await expect(
          panel.getByText(
            state === "connected" || state === "limit"
              ? "OpenRouter balance"
              : "Spent so far on this key",
            { exact: false },
          ),
        ).toBeVisible();
        await expect(
          panel.getByText(
            state === "connected" || state === "limit" ? "$12.50" : "$1.50",
            {
              exact: true,
            },
          ),
        ).toBeVisible();
        await expect(panel).toContainText(
          "Key limit: $5.00. Remaining: $0.00.",
        );
        await expect(panel).toContainText("Resets at midnight UTC.");
        await expect(
          panel.getByRole("status", {
            name:
              state === "usage"
                ? "Spent so far on this key"
                : "OpenRouter balance",
            exact: true,
          }),
        ).toBeVisible();
        await expect(panel).toContainText(
          `${state === "limit" ? 50 : 12} requests used today.`,
        );
        await expect(
          panel.getByRole("button", {
            name: "Add credits on OpenRouter (opens in your browser)",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          panel.getByRole("button", { name: "Use this model", exact: true }),
        ).toHaveCount(0);
        await expect(panel.getByLabel("Model", { exact: true })).toHaveValue(
          "fixture/free:free",
        );
        await expect(
          panel.getByRole("button", { name: "Paid models" }),
        ).toBeDisabled();
        await expect(
          panel.getByText(`${state === "limit" ? 0 : 38} / 50 requests left`),
        ).toBeVisible();
        await expect(
          page.getByText("AI employees will not reply", { exact: false }),
        ).toHaveCount(0);
        if (state === "limit")
          await expect(
            panel.getByRole("button", { name: "Test connection", exact: true }),
          ).toBeDisabled();
      }
      if (state === "error")
        await expect(panel.getByRole("alert")).toContainText(
          "sign-in did not finish",
        );
      await waitForAnimations(page);
      await page.screenshot({
        path: `test-results/openrouter-proof/app-${state}-${viewport.width}.png`,
      });
      if (process.env.COLONY_DESIGN_REFERENCE_URL && state !== "usage") {
        const reference = await page.context().newPage();
        await reference.setViewportSize(viewport);
        await reference.goto(
          `${process.env.COLONY_DESIGN_REFERENCE_URL}#openrouter-${state}`,
        );
        await expect(
          reference.getByRole("heading", { name: "Your OpenRouter account" }),
        ).toBeVisible();
        await waitForAnimations(reference);
        await reference.screenshot({
          path: `test-results/openrouter-proof/reference-${state}-${viewport.width}.png`,
        });
        await reference.close();
      }
      if (state === "connected" || state === "usage" || state === "limit") {
        await panel
          .getByRole("button", {
            name: "Add credits on OpenRouter (opens in your browser)",
            exact: true,
          })
          .click();
        const urls = await page.evaluate(() =>
          (
            window as unknown as {
              __TAURI_INTERNALS__: {
                invoke: (command: string) => Promise<string[]>;
              };
            }
          ).__TAURI_INTERNALS__.invoke("get_e2e_opened_external_urls"),
        );
        expect(urls).toContain("https://openrouter.ai/credits");
      }
      if (state === "connected") {
        await panel
          .getByRole("button", { name: "Test connection", exact: true })
          .click();
        await expect(
          page.getByTestId("onboarding-scene-connected"),
        ).toBeVisible();
      }
    });
  }
}

test("OpenRouter cancellation enables a fresh retry", async ({ page }) => {
  await openRouterTab(page);
  await mockOAuth(page, connected, true);
  await page
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(
    page.getByRole("button", { name: "Connect OpenRouter", exact: true }),
  ).toBeEnabled();
  await mockOAuth(page);
  await page
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();
  await expect(
    page
      .getByTestId("openrouter-connection")
      .getByText("Connected", { exact: true }),
  ).toBeVisible();
});

test("Settings provides OAuth and keeps manual configuration under Bring your own key", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRouterTab(page);
  await page.getByRole("radio", { name: "Subscriptions", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-agents-group").click();
  const card = page.getByTestId("settings-global-agent-config");
  await expect(
    card.getByRole("button", { name: "Connect OpenRouter", exact: true }),
  ).toBeEnabled();
  await card
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();
  await expect(
    card
      .getByTestId("openrouter-connection")
      .getByText("Connected", { exact: true }),
  ).toBeVisible();
  await expect(
    card
      .getByRole("region", { name: "Bring your own key" })
      .getByTestId("global-agent-provider"),
  ).toHaveAttribute("data-value", "openrouter");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/openrouter-proof/settings-connected-1440.png",
  });
});

for (const status of ["linked", "reauth", "unmanaged"] as const) {
  test(`saved OpenRouter ${status} cannot silently mint another key`, async ({
    page,
  }) => {
    await openRouterTab(page);
    await page
      .getByRole("radio", { name: "Bring your own key", exact: true })
      .click();
    const initial =
      status === "linked"
        ? {
            ...connected,
            status,
            balance: null,
            freeTier: null,
            freeUsed: null,
            freeRemaining: null,
            freeLimit: null,
            limit: null,
            limitRemaining: null,
            usage: null,
            models: [],
            metadataWarning:
              "Your OpenRouter connection is saved. Could not read key limits. Refresh to try again.",
          }
        : {
            status,
            message:
              status === "reauth"
                ? "OpenRouter rejected the saved key. Sign in again."
                : "This key uses a custom OpenRouter address. Manage it under Bring your own key.",
          };
    await mockOAuth(page, connected, false, initial);
    await page.getByRole("radio", { name: "OpenRouter", exact: true }).click();
    const panel = page.getByTestId("openrouter-connection");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(
      panel.getByRole("button", { name: "Connect OpenRouter", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByRole("alert")).toBeVisible();
    if (status === "linked") {
      await expect(panel.getByText("Saved", { exact: true })).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Test connection", exact: true }),
      ).toBeDisabled();
    } else if (status === "reauth")
      await expect(
        panel.getByRole("button", { name: "Sign in again", exact: true }),
      ).toBeEnabled();
    else
      await expect(
        panel.getByRole("button", { name: "Refresh connection", exact: true }),
      ).toBeEnabled();
  });
}

test("model selection keeps focus and saves only on explicit confirmation", async ({
  page,
}) => {
  await openRouterTab(page);
  await page
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();
  const panel = page.getByTestId("openrouter-connection");
  const select = panel.getByLabel("Model", { exact: true });
  await select.focus();
  await select.selectOption("fixture/free-two:free");
  await expect(select).toBeFocused();
  const model = () =>
    page.evaluate(async () => {
      const config = await (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string) => Promise<{ model: string }>;
          };
        }
      ).__TAURI_INTERNALS__.invoke("get_global_agent_config");
      return config.model;
    });
  expect(await model()).toBe("fixture/free:free");
  await panel
    .getByRole("button", { name: "Use this model", exact: true })
    .click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  expect(await model()).toBe("fixture/free-two:free");
});

test("paid key using a free model shows daily requests and hides them in paid mode", async ({
  page,
}) => {
  await openRouterTab(page);
  await mockOAuth(page, {
    ...connected,
    balance: null,
    freeTier: false,
    limit: null,
    limitRemaining: null,
  });
  await page
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();
  const panel = page.getByTestId("openrouter-connection");
  await expect(
    panel.getByText("Spent so far on this key", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByText("$1.50", { exact: true })).toBeVisible();
  await expect(panel.getByText("Key limit:", { exact: false })).toHaveCount(0);
  await expect(panel.getByText("38 / 50 requests left")).toBeVisible();
  await panel.getByRole("button", { name: "Paid models", exact: true }).click();
  await expect(
    panel.getByText("Daily free allowance", { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Paid models", exact: true }),
  ).toBeEnabled();
});

for (const balance of [0, -0.004, -1]) {
  test(`account balance ${balance} shows Out of credits without disabling a usable model`, async ({
    page,
  }) => {
    await openRouterTab(page);
    await mockOAuth(page, { ...connected, balance });
    await page
      .getByRole("button", { name: "Connect OpenRouter", exact: true })
      .click();
    const panel = page.getByTestId("openrouter-connection");
    await expect(
      panel.getByRole("status", { name: "OpenRouter balance", exact: true }),
    ).toContainText("Out of credits");
    await expect(
      panel.getByRole("button", { name: "Test connection", exact: true }),
    ).toBeEnabled();
    await expect(panel.getByText(/-\$/)).toHaveCount(0);
  });
}

test("balance, spending and key limits share currency formatting with thousands separators", async ({
  page,
}) => {
  await openRouterTab(page);
  await mockOAuth(page, {
    ...connected,
    balance: 1250.5,
    limit: 10000,
    limitRemaining: 9998.5,
  });
  await page
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();
  const panel = page.getByTestId("openrouter-connection");
  await expect(panel.getByText("$1,250.50", { exact: true })).toBeVisible();
  await expect(panel).toContainText(
    "Key limit: $10,000.00. Remaining: $9,998.50.",
  );
  await mockOAuth(page, { ...connected, balance: null, usage: 1250.5 }, false, {
    ...connected,
    balance: null,
    usage: 1250.5,
  });
  await page.getByRole("radio", { name: "Subscriptions", exact: true }).click();
  await page.getByRole("radio", { name: "OpenRouter", exact: true }).click();
  await expect(
    panel.getByRole("status", {
      name: "Spent so far on this key",
      exact: true,
    }),
  ).toContainText("$1,250.50");
});

test("OpenRouter reload failure updates Scout and clears connection readiness", async ({
  page,
}) => {
  await openRouterTab(page);
  await page
    .getByRole("button", { name: "Connect OpenRouter", exact: true })
    .click();
  await expect(
    page.getByTestId("onboarding-scene-openrouter-connected"),
  ).toBeVisible();
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    internals.invoke = (command, args) =>
      command === "get_openrouter_connection"
        ? Promise.reject(new Error("fixture metadata unavailable"))
        : invoke(command, args);
  });
  await page.getByRole("radio", { name: "Subscriptions", exact: true }).click();
  await page.getByRole("radio", { name: "OpenRouter", exact: true }).click();
  await expect(
    page.getByTestId("onboarding-scene-openrouter-error"),
  ).toBeVisible();
  await expect(
    page.getByText("Needs your attention", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("openrouter-connection").getByRole("alert"),
  ).toContainText("Could not read your OpenRouter connection");
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
});
