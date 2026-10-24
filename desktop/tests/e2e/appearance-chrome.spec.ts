import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { r17Runtime } from "../helpers/onboarding";

async function start(page: Page, auth = "logged_in", provider?: "openrouter") {
  await page.addInitScript(() => {
    if (!localStorage.getItem("buzz-theme")) {
      localStorage.setItem("buzz-theme", "buzz");
      localStorage.setItem("buzz-follow-system", "false");
      localStorage.setItem("buzz-accent-color", "#5B45BE");
    }
    if (!localStorage.getItem("buzz-communities")) {
      localStorage.setItem(
        "buzz-communities",
        JSON.stringify([
          {
            id: "chrome-a",
            name: "Colony AI",
            relayUrl: "ws://localhost:3000",
            pubkey: "deadbeef".repeat(8),
            addedAt: "2026-10-04T00:00:00Z",
          },
          {
            id: "chrome-b",
            name: "Other business",
            relayUrl: "ws://localhost:3001",
            pubkey: "deadbeef".repeat(8),
            addedAt: "2026-10-04T00:00:00Z",
          },
        ]),
      );
      localStorage.setItem("buzz-active-community-id", "chrome-a");
    }
  });
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: provider
        ? [
            {
              ...r17Runtime("buzz-agent", "available", {
                status: "not_applicable",
              }),
              label: "Colony Agent",
              provider_env_var: "BUZZ_AGENT_PROVIDER",
            },
          ]
        : [r17Runtime("claude", "available", { status: auth })],
      globalAgentConfig: {
        env_vars: {},
        provider: provider ?? null,
        model: provider ? "chosen-model" : "Claude Sonnet",
        preferred_runtime: provider ? "buzz-agent" : "claude",
      },
    },
    { skipCommunitySeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("community-rail")).toBeVisible();
}
async function appearance(page: Page) {
  await page.goto("/#/settings?section=appearance");
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
}
/** Sea, then a custom bottom colour, and the Teal accent: an unapplied draft. */
async function fieldDraft(page: Page) {
  await page.getByTestId("appearance-field-preset-sea").click();
  await page.getByTestId("appearance-field-bottom").fill("#00ace6");
  await page.getByTestId("appearance-accent-teal").click();
}
function rootField(page: Page) {
  return page.evaluate(() => {
    const style = document.documentElement.style;
    return [
      style.getPropertyValue("--colony-field-top"),
      style.getPropertyValue("--colony-field-middle"),
      style.getPropertyValue("--colony-field-bottom"),
    ];
  });
}
/** The field the sidebar paints: shown for the Colony themes, hidden for named ones. */
function sidebarField(page: Page) {
  return page.locator(
    '[data-testid="app-sidebar"] [data-colony-field="sidebar"]',
  );
}
for (const width of [1728, 1440]) {
  for (const variant of ["default", "catppuccin-latte", "dracula", "field"]) {
    test(`chrome paint ${variant} ${width}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({
        width,
        height: width === 1728 ? 1117 : 900,
      });
      await start(page);
      await appearance(page);
      if (variant === "field") {
        await fieldDraft(page);
        await page.getByTestId("appearance-apply").click();
        await expect(page.getByTestId("appearance-apply-status")).toHaveText(
          "Applied",
        );
        expect(await rootField(page)).toEqual([
          "#A3E3D3",
          "#9CC2F7",
          "#00ACE6",
        ]);
      } else if (variant !== "default") {
        await page.getByTestId("appearance-open-themes").click();
        await page.getByTestId(`theme-catalog-${variant}`).click();
        await page.getByTestId("theme-use").click();
        await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
        await page.getByTestId("theme-done").click();
      }
      const dir = process.env.COLONY_APPEARANCE_PROOF_DIR;
      const capture = async (route: string) => {
        await waitForAnimations(page);
        if (dir) {
          await mkdir(dir, { recursive: true });
          await page.screenshot({
            path: `${dir}/${variant}-${width}-${route}.png`,
          });
        }
      };
      await page.locator("#settings-search-input").focus();
      await capture("appearance");
      if (variant === "field") {
        const primary = await page
          .getByTestId("appearance-apply")
          .evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(primary).toBe("rgb(31, 122, 112)");
      }
      await page.getByTestId("settings-back-to-app").click();
      await capture("workspace");
      // Colony themes paint the person's field in the sidebar; a named theme
      // keeps its own flat sidebar colour and draws no field at all.
      if (variant === "default" || variant === "field")
        await expect(sidebarField(page)).toBeVisible();
      else await expect(sidebarField(page)).toBeHidden();
      if (variant === "field")
        expect(
          await sidebarField(page)
            .locator(".colony-field-blob-top")
            .evaluate((element) => getComputedStyle(element).backgroundColor),
        ).toBe("rgb(163, 227, 211)");
      await page.getByTestId("open-settings").click();
      await capture("menu");
      await page.goto("/#/settings?section=agent-defaults");
      await expect(page.getByTestId("agent-defaults-connection")).toContainText(
        "Claude Code subscription connected",
      );
      await capture("agent-defaults");
      await page.reload();
      await expect(page.getByTestId("agent-defaults-connection")).toContainText(
        "Claude Code subscription connected",
      );
      if (variant === "field")
        expect(await rootField(page)).toEqual([
          "#A3E3D3",
          "#9CC2F7",
          "#00ACE6",
        ]);
      else
        expect(
          await page.evaluate(() => localStorage.getItem("buzz-theme")),
        ).toBe(variant === "default" ? "buzz" : variant);
    });
  }
}

test("field Apply is one atomic snapshot, Cancel and Revert preserve the chosen state", async ({
  page,
}) => {
  await start(page);
  await appearance(page);
  expect(await rootField(page)).toEqual(["", "", ""]);
  await fieldDraft(page);
  await expect(page.getByTestId("appearance-apply-status")).toHaveText(
    "Preview only",
  );
  // A draft changes nothing outside the preview until it is applied.
  expect(await rootField(page)).toEqual(["", "", ""]);
  await page.getByTestId("appearance-cancel").click();
  await expect(
    page.getByTestId("appearance-field-preset-dawn"),
  ).toHaveAttribute("aria-pressed", "true");
  await fieldDraft(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as Window & { appearanceWrites?: number }).appearanceWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("colony.appearance.v1:") &&
        !key.endsWith(":last-business")
      )
        (window as Window & { appearanceWrites: number }).appearanceWrites++;
      original.call(this, key, value);
    };
  });

  await page.getByTestId("appearance-apply").click();
  await expect(page.getByTestId("appearance-apply-status")).toHaveText(
    "Applied",
  );
  expect(await rootField(page)).toEqual(["#A3E3D3", "#9CC2F7", "#00ACE6"]);
  expect(
    await page.evaluate(
      () => (window as Window & { appearanceWrites?: number }).appearanceWrites,
    ),
  ).toBe(1);
  await page.getByTestId("appearance-links-rich").click();
  await page.getByTestId("appearance-revert").click();
  expect(await rootField(page)).toEqual(["", "", ""]);
  await expect(page.getByTestId("appearance-links-rich")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  expect(await rootField(page)).toEqual(["", "", ""]);
});

for (const auth of ["unknown", "logged_out"])
  test(`saved Claude selection does not claim connection when auth is ${auth}`, async ({
    page,
  }) => {
    await start(page, auth);
    await page.goto("/#/settings?section=agent-defaults");
    const connection = page.getByTestId("agent-defaults-connection");
    await expect(connection).not.toHaveAttribute("aria-busy", "true");
    await expect(connection).not.toContainText("subscription connected");
    await expect(connection).toContainText(
      auth === "unknown" ? "connection not confirmed" : "needs sign-in",
    );
    await page
      .getByTestId("agent-defaults-openrouter-alternative")
      .locator("summary")
      .click();
    const bullets = page.getByTestId("openrouter-connection").locator("ul");
    await expect(bullets).toHaveCSS("padding-left", "20px");
  });

test("Agent Defaults shows the saved OpenRouter connection first", async ({
  page,
}) => {
  await start(page, "not_applicable", "openrouter");
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command === "get_openrouter_connection")
        return {
          status: "connected",
          model: "chosen-model",
          models: [],
          balance: null,
          usage: null,
          limit: null,
          limitRemaining: null,
          failedRestarts: 0,
          testResult: "connected",
        };
      return original(command, args, options);
    };
  });
  await page.goto("/#/settings?section=agent-defaults");
  await expect(page.getByTestId("agent-defaults-connection")).toContainText(
    "OpenRouter connected",
  );
  await expect(
    page.getByTestId("agent-defaults-openrouter-alternative"),
  ).toHaveCount(0);
  await expect(page.getByTestId("openrouter-connection")).toBeVisible();
});

for (const width of [1728, 1440]) {
  test(`approved named preview and applied states ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1728 ? 1117 : 900 });
    await start(page);
    await appearance(page);
    await page.getByTestId("appearance-open-themes").click();
    await page.getByTestId("theme-catalog-buzz").click();
    await expect(page.getByTestId("theme-use")).toHaveText("Use Colony");
    const dir = process.env.COLONY_APPEARANCE_PROOF_DIR;
    await waitForAnimations(page);
    if (dir)
      await page.screenshot({
        path: `${dir}/reference-flow-${width}-preview.png`,
      });
    await page.getByTestId("theme-use").click();
    await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
    await expect(page.getByTestId("theme-done")).toHaveText("Done");
    await waitForAnimations(page);
    if (dir)
      await page.screenshot({
        path: `${dir}/reference-flow-${width}-applied.png`,
      });
  });
}
