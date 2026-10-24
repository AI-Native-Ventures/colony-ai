import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Charlie is a `bot` member of #agents and authors the seeded "Indexing the
// channel catalog now." message (see e2eBridge.ts). Seeding a managed agent
// with this same pubkey makes the message avatar open a managed-agent profile
// panel — the surface that renders the active-turn badges.
const AGENT_PUBKEY =
  "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";

// Channel ID the seeded turn points at. The badge label resolves it to
// #general via the channels query.
const CHANNEL_GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

function seedAgent() {
  return {
    managedAgents: [
      {
        pubkey: AGENT_PUBKEY,
        name: "Charlie",
        status: "running" as const,
        channelNames: ["agents"],
      },
    ],
  };
}

async function waitForBridge(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () =>
      typeof (window as Window & { __BUZZ_E2E_SEED_ACTIVE_TURNS__?: unknown })
        .__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
    null,
    { timeout: 10_000 },
  );
}

async function openAgentsChannel(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForBridge(page);
  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");
}

async function seedActiveTurns(
  page: import("@playwright/test").Page,
  turns: { channelId: string; turnId: string }[],
) {
  await page.evaluate(
    ({ pubkey, seeds }) => {
      const win = window as Window & {
        __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
          agentPubkey: string;
          channelId: string;
          turnId: string;
        }) => void;
      };
      for (const { channelId, turnId } of seeds) {
        win.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: pubkey,
          channelId,
          turnId,
        });
      }
    },
    { pubkey: AGENT_PUBKEY, seeds: turns },
  );
}

// The agent's avatar is the popover trigger inside its message row; clicking it
// opens the profile panel, hovering opens the popover.
function agentAvatar(page: import("@playwright/test").Page) {
  return page
    .getByTestId("message-row")
    .filter({ has: page.locator('[data-testid^="message-avatar-"]') })
    .last()
    .getByRole("button")
    .first();
}

test.describe("profile active turn indicator", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("03 — hover popover: agent working", async ({ page }) => {
    await installMockBridge(page, seedAgent());
    await openAgentsChannel(page);
    await seedActiveTurns(page, [
      { channelId: CHANNEL_GENERAL, turnId: "turn-301" },
    ]);

    await agentAvatar(page).hover();

    const popover = page.getByTestId("user-profile-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });
    await expect(popover).toContainText("Working in #general");
  });
});
