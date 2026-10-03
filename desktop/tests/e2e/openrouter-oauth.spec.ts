import { expect, type Page, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

const connected = {
  status: "connected",
  balance: 0,
  limit: null,
  limitRemaining: null,
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
) {
  await page.evaluate(
    ({ next, hold }) => {
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
          return saved ? next : { status: "unlinked" };
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
        if (command === "select_openrouter_model")
          return { ...next, model: args?.model };
        return original(command, args);
      };
    },
    { next: outcome, hold: delay },
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
  await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect OpenRouter", exact: true }),
  ).toBeEnabled();
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  for (const state of ["unlinked", "connected", "limit", "error"] as const) {
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
                status: state,
                freeRemaining: state === "limit" ? 0 : 38,
              },
        );
        await page
          .getByRole("button", { name: "Connect OpenRouter", exact: true })
          .click();
      }
      const panel = page.getByTestId("openrouter-connection");
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(panel.locator('input[type="password"]')).toHaveCount(0);
      if (state === "connected" || state === "limit") {
        await expect(
          panel.getByText("Connected", { exact: true }),
        ).toBeVisible();
        await expect(panel.getByText("$0.00", { exact: true })).toBeVisible();
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
        await expect(panel.getByRole("status")).toContainText(
          "sign-in did not finish",
        );
      await waitForAnimations(page);
      await page.screenshot({
        path: `test-results/openrouter-proof/app-${state}-${viewport.width}.png`,
      });
      if (process.env.COLONY_DESIGN_REFERENCE_URL) {
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
      if (state === "connected") {
        await panel
          .getByRole("button", { name: "Test connection", exact: true })
          .click();
        await expect(
          panel.getByText("Connection works.", { exact: true }),
        ).toBeVisible();
        await panel.getByRole("button", { name: "Refresh connection" }).click();
        await expect(panel).toHaveAttribute("aria-busy", "false");
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
  await page
    .getByRole("button", { name: "Open my Colony", exact: true })
    .click();
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
