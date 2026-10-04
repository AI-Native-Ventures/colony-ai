import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import {
  completeR17BusinessSetup,
  openR17BusinessSetup,
  r17Runtime,
} from "../helpers/onboarding";

test.setTimeout(90_000);

const sizes = [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
];
const before = process.env.POLISH_PROOF_STAGE === "before";
const proof = process.env.POLISH_PROOF_DIR;
async function capture(page: Page, name: string) {
  if (!proof) return;
  await mkdir(proof, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    path: `${proof}/${before ? "before" : "after"}-${name}.png`,
  });
}
for (const size of sizes) {
  test(`Today and Team share one header at ${size.width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(size);
    if (process.env.POLISH_REFERENCE_URL) {
      const reference = await context.newPage();
      await reference.setViewportSize(size);
      for (const route of ["today", "team", "channel", "thread"]) {
        await reference.goto(`${process.env.POLISH_REFERENCE_URL}#${route}`);
        await reference.evaluate(() => document.fonts.ready);
        await capture(reference, `reference-${route}-${size.width}`);
      }
      await reference.close();
    }
    await installMockBridge(page, {
      relaySelf: TEST_IDENTITIES.tyler.pubkey,
      referenceWorkspace: true,
      referenceSidebarShell: true,
    });
    await page.goto("/#/today");
    const needs = page.getByRole("region", { name: "Needs me" });
    await expect(needs).toBeVisible();
    if (!before) {
      await expect(
        page.getByRole("heading", { name: "Today", exact: true }),
      ).toBeVisible();
      await expect(
        needs.getByText("Needs me · 0 open decisions", { exact: true }),
      ).toBeVisible();
    }
    await capture(page, `today-${size.width}`);
    await page.goto("/#/team");
    const team = page.getByTestId("company-team-screen");
    await expect(team).toBeVisible();
    if (!before) {
      await expect(page.getByTestId("app-top-chrome")).toHaveCount(0);
      await expect(
        team.getByRole("navigation", { name: "Navigation history" }),
      ).toHaveCount(1);
      await expect(page.getByTestId("global-back")).toHaveCount(1);
      const header = await team.locator("header").boundingBox();
      const back = await team.getByTestId("global-back").boundingBox();
      expect(header).not.toBeNull();
      expect(back).not.toBeNull();
      expect(back!.y).toBeGreaterThanOrEqual(header!.y);
      expect(back!.y + back!.height).toBeLessThanOrEqual(
        header!.y + header!.height,
      );
    }
    await capture(page, `team-${size.width}`);
  });
  test(`Welcome stays readable with a thread at ${size.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openR17BusinessSetup(page, {
      runtimes: [
        r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
      ],
      mock: {
        managedAgents: [
          {
            pubkey: "f".repeat(64),
            name: "Scout",
            personaId: "builtin:fizz",
            status: "running",
            channelNames: ["Welcome"],
          },
        ],
        globalAgentConfig: {
          provider: "openai",
          model: "fixture-model",
          env_vars: { OPENAI_COMPAT_API_KEY: "e2e-placeholder" },
        },
      },
    });
    await completeR17BusinessSetup(page);
    const skip = page.getByRole("button", {
      name: "Skip for now",
      exact: true,
    });
    const initialSkip = await skip.elementHandle();
    expect(initialSkip).not.toBeNull();
    await expect(
      page.getByRole("button", { name: "Connect Colony Agent", exact: true }),
    ).toBeEnabled();
    // Harness readiness must not remove the fallback under the pointer.
    expect(await initialSkip!.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    expect(
      await skip.evaluate(
        (element, initial) => element === initial,
        initialSkip,
      ),
    ).toBe(true);
    await skip.click();
    await expect(page.getByTestId("chat-title")).toContainText("Welcome");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "Welcome",
              kind: 9,
            }) ?? false,
        ),
      )
      .toBe(true);
    await page.evaluate(() =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Welcome",
        content: "Welcome to Colony. What would you like to work on?",
        pubkey: "f".repeat(64),
      }),
    );
    const banner = page.getByTestId("welcome-composer-guide-banner");
    await expect(banner).toContainText("Mention");
    await capture(page, `welcome-${size.width}`);
    const row = page
      .getByTestId("message-row")
      .filter({ hasText: "Welcome to Colony" })
      .first();
    await expect(row).toBeVisible();
    await waitForAnimations(page);
    await row.hover();
    await waitForAnimations(page);
    await expect(row.locator('[data-testid^="message-action-bar-"]')).toHaveCSS(
      "opacity",
      "1",
    );
    await row.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await waitForAnimations(page);
    if (!before) {
      await expect(page.getByTestId("reference-goal-button")).toHaveCount(0);
      const geometry = await banner.evaluate((element) => {
        const copy = element.querySelector(
          '[data-testid="welcome-composer-prompt-copy"]',
        );
        const composer = document.querySelector(
          '[data-testid="channel-composer-overlay"] [data-testid="message-composer"]',
        );
        if (!copy || !composer) throw new Error("Welcome guidance is missing");
        const content = copy.getBoundingClientRect();
        return {
          copyBottom: content.bottom,
          composerTop: composer.getBoundingClientRect().top,
          height: content.height,
          lineHeight: parseFloat(getComputedStyle(copy).lineHeight),
        };
      });
      expect(geometry.copyBottom).toBeLessThanOrEqual(geometry.composerTop);
      const box = await banner.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(geometry.composerTop);
      expect(geometry.height).toBeLessThanOrEqual(2 * geometry.lineHeight + 1);
    }
    await capture(page, `welcome-thread-${size.width}`);
  });
}
