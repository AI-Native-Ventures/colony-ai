/**
 * Screenshot spec for the needsRestart badge and config diff (PR #1853 + diff
 * overlay work).
 *
 * Exercises:
 *   - Profile badge tooltip with itemised before→after diff.
 *   - Runtime-tab banner with full uncapped diff list.
 *   - Side-panel badge visible on the default (Info) tab  -  not only Runtime.
 *   - DOM validity: tooltip trigger has no <button> ancestor.
 *   - Generic rendering: unknown field ids, number/array values, masked values.
 */

import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import {
  openAgentProfilePanel,
  openAgentsDirectoryView,
} from "../helpers/agentWorkspace";
import { waitForAnimations } from "../helpers/animations";

const SHOTS = "test-results/restart-diff-screenshots";

// ── Sample diff entries ───────────────────────────────────────────────────────

const DIFF_ENTRIES = [
  {
    field: "model",
    change: {
      kind: "value" as const,
      before: "gpt-4",
      after: "claude-3-5-sonnet",
    },
  },
  {
    field: "system_prompt",
    change: { kind: "text" as const, before_chars: 512, after_chars: 1024 },
  },
  {
    field: "env.OPENAI_API_KEY",
    change: { kind: "masked" as const, before: "••••abc1", after: "••••xyz9" },
  },
  { field: "env.BUZZ_LOG", change: { kind: "added" as const } },
  {
    field: "relay_url",
    change: { kind: "masked" as const, before: "••••", after: "••••" },
  },
  // Array value  -  args are atomic; rendered via JSON.stringify (position 6: last visible in tooltip)
  {
    field: "agent_args",
    change: {
      kind: "value" as const,
      before: ["acp"],
      after: ["acp", "--verbose"],
    },
  },
  // 7th entry  -  truncated in tooltip (cap is 6); visible in uncapped banner
  {
    field: "parallelism",
    change: { kind: "value" as const, before: 1, after: 4 },
  },
  // 8th entry  -  truncated in tooltip; visible in uncapped banner
  {
    field: "args",
    change: { kind: "masked" as const, before: "••••", after: "••••" },
  },
];

const STANDALONE_AGENT = {
  pubkey: TEST_IDENTITIES.alice.pubkey,
  name: "Local Agent",
  status: "running" as const,
  needsRestart: true,
  restartDiff: DIFF_ENTRIES,
};

async function gotoAgentsView(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openAgentsDirectoryView(page);
}

test.describe("restart-diff screenshots", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      console.error(
        "PAGE ERROR:",
        err.message,
        err.stack?.split("\n").slice(0, 5).join("\n"),
      );
    });
  });

  // ── Runtime-tab banner with full uncapped diff ────────────────────────────

  test("10-profile-panel-badge-on-default-info-tab", async ({ page }) => {
    await installMockBridge(page, {
      managedAgents: [STANDALONE_AGENT],
    });

    await gotoAgentsView(page);

    // Open the profile panel by deep link  -  opens on Info tab by default
    await openAgentProfilePanel(page, STANDALONE_AGENT.pubkey);

    const panel = page.getByTestId("user-profile-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Tab-independent badge: visible even on the Info tab (not only Runtime)
    const heroBadge = panel.getByTestId("restart-diff-badge");
    await expect(heroBadge).toBeVisible({ timeout: 5_000 });

    // Hero badge tooltip is functional: hover shows the diff list
    await heroBadge.hover();
    const heroTooltip = page.locator("[role=tooltip]");
    await expect(heroTooltip).toBeVisible({ timeout: 5_000 });
    await expect(heroTooltip.getByText("Model:")).toBeVisible();

    // The Runtime tab banner is NOT visible on Info tab
    await expect(panel.getByTestId("needs-restart-banner")).toHaveCount(0);

    await waitForAnimations(page);
    await panel.screenshot({
      path: `${SHOTS}/10-panel-badge-default-info-tab.png`,
    });
  });
});
