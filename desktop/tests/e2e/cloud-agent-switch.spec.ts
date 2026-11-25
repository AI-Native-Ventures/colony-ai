import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, test, type Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import type { MockAgentPlacement } from "../../src/testing/e2eBridge";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const SCOUT = REFERENCE_AGENTS.scout.pubkey;
const OWNER = TEST_IDENTITIES.tyler.pubkey;
const MODEL = "deepseek/deepseek-v4.1-flash";

async function openScoutDm(
  page: Page,
  options: {
    placement?: Partial<MockAgentPlacement>;
    maxPerAccount?: number;
    capabilities?: boolean;
    extraPlacements?: MockAgentPlacement[];
  } = {},
) {
  const relaySecret = generateSecretKey();
  await installMockBridge(
    page,
    {
      relaySelf: getPublicKey(relaySecret),
      companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
      referenceWorkspace: true,
      colony3Sidebar: true,
      cloudCapabilities:
        options.capabilities === false
          ? undefined
          : {
              enabled: true,
              allowed: true,
              maxPerAccount: options.maxPerAccount ?? 2,
              models: [MODEL],
              defaultModel: MODEL,
            },
      agentPlacements: [
        {
          agent: SCOUT,
          owner: OWNER,
          home: "mac",
          generation: 1,
          cloudReady: true,
          ...options.placement,
        },
        ...(options.extraPlacements ?? []),
      ],
      managedAgents: [
        {
          pubkey: SCOUT,
          name: "Scout",
          runtime: "claude",
          status: "running",
          channelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
        },
      ],
    },
    { identity: TEST_IDENTITIES.tyler },
  );
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
  await expect(page.getByTestId("chat-header")).toBeVisible();
}

test("flipping Scout to the cloud from the header shows Cloud and its status", async ({
  page,
}) => {
  await openScoutDm(page);
  const trigger = page.getByTestId("agent-home-trigger");
  await expect(trigger).toHaveText("Working on: This Mac");
  await expect(page.getByTestId("agent-home-status")).toHaveCount(0);

  await trigger.click();
  await expect(page.getByTestId("agent-home-menu")).toBeVisible();
  await expect(
    page.getByRole("menuitemradio", { name: /^This Mac/ }),
  ).toBeChecked();
  await page.getByRole("menuitemradio", { name: /^Cloud/ }).click();

  await expect(trigger).toHaveText("Working on: Cloud");
  await expect(page.getByTestId("agent-home-status")).toHaveText("Asleep");

  // And back: the Mac is still the agent's other home.
  await expect(page.getByTestId("agent-home-menu")).toHaveCount(0);
  await trigger.click();
  await page.getByRole("menuitemradio", { name: /^This Mac/ }).click();
  await expect(trigger).toHaveText("Working on: This Mac");
  await expect(page.getByTestId("agent-home-status")).toHaveCount(0);
});

test("the switch menu works from the keyboard", async ({ page }) => {
  await openScoutDm(page);
  const trigger = page.getByTestId("agent-home-trigger");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("agent-home-menu")).toBeVisible();
  await expect(
    page.getByRole("menuitemradio", { name: /^This Mac/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: /^Cloud/ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("Working on: Cloud");
  // Escape closes it and focus returns to the control.
  await page.keyboard.press("Space");
  await expect(page.getByTestId("agent-home-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("agent-home-menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("one accessible name for the switch and none repeated for its status", async ({
  page,
}) => {
  await openScoutDm(page, {
    placement: { home: "cloud", status: "asleep", cloudModel: MODEL },
  });
  const switchRoot = page.getByTestId("agent-home-switch");
  await expect(
    switchRoot.getByRole("button", { name: "Working on: Cloud" }),
  ).toHaveCount(1);
  await expect(switchRoot.getByRole("button")).toHaveCount(1);
  await expect(page.getByTestId("agent-home-status")).toHaveText("Asleep");
});

test("an agent whose key is not on the relay stays on the Mac and says why", async ({
  page,
}) => {
  await openScoutDm(page, { placement: { cloudReady: false } });
  await page.getByTestId("agent-home-trigger").click();
  await page.getByRole("menuitemradio", { name: /^Cloud/ }).click();
  await expect(page.getByTestId("agent-home-message")).toHaveText(
    "Open Colony on your Mac once to make Scout cloud-ready.",
  );
  await expect(page.getByTestId("agent-home-trigger")).toHaveText(
    "Working on: This Mac",
  );
});

test("the beta cap is explained when a third agent is moved", async ({
  page,
}) => {
  await openScoutDm(page, {
    maxPerAccount: 1,
    extraPlacements: [
      {
        agent: "b1b1".repeat(16),
        owner: OWNER,
        home: "cloud",
        generation: 1,
        cloudReady: true,
        status: "asleep",
      },
    ],
  });
  await page.getByTestId("agent-home-trigger").click();
  await page.getByRole("menuitemradio", { name: /^Cloud/ }).click();
  await expect(page.getByTestId("agent-home-message")).toHaveText(
    "You can have 1 agents in the cloud during the beta.",
  );
  await expect(page.getByTestId("agent-home-trigger")).toHaveText(
    "Working on: This Mac",
  );
});

test("a stale flip shows where the agent really works", async ({ page }) => {
  await openScoutDm(page);
  // Another device moved Scout meanwhile: the head is ahead of this screen.
  await page.evaluate((agent) => {
    const bridge = window as Window & {
      __BUZZ_E2E__?: {
        mock?: { agentPlacements?: { agent: string; generation: number }[] };
      };
    };
    const placement = bridge.__BUZZ_E2E__?.mock?.agentPlacements?.find(
      (candidate) => candidate.agent === agent,
    );
    if (placement) placement.generation += 5;
  }, SCOUT);
  await page.getByTestId("agent-home-trigger").click();
  await page.getByRole("menuitemradio", { name: /^Cloud/ }).click();
  await expect(page.getByTestId("agent-home-message")).toContainText(
    "was just moved",
  );
});

test("out of AI credit shows one card with Top up and Move to This Mac", async ({
  page,
}) => {
  await openScoutDm(page, {
    placement: { home: "cloud", status: "outOfCredit" },
  });
  const card = page.getByTestId("agent-home-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-notice", "outOfCredit");
  await expect(card.getByTestId("agent-home-card-message")).toHaveText(
    "Out of AI credit.",
  );
  await expect(card.getByRole("button", { name: "Top up" })).toBeVisible();
  await card.getByRole("button", { name: "Move to This Mac" }).click();
  await expect(page.getByTestId("agent-home-trigger")).toHaveText(
    "Working on: This Mac",
  );
  await expect(page.getByTestId("agent-home-card")).toHaveCount(0);
});

test("a cloud agent that could not start offers Try again", async ({
  page,
}) => {
  await openScoutDm(page, { placement: { home: "cloud", status: "failed" } });
  const card = page.getByTestId("agent-home-card");
  await expect(card.getByTestId("agent-home-card-message")).toHaveText(
    "Scout could not start in the cloud.",
  );
  await expect(page.getByTestId("agent-home-status")).toHaveText(
    "Could not start",
  );
  await card.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("agent-home-status")).toHaveText("Waking");
});

test("the profile has a Where Scout works section that moves the agent", async ({
  page,
}) => {
  await openScoutDm(page);
  await page.goto(`/#/agents?agent=${SCOUT}`);
  await page.getByTestId("agent-edit-configuration").click();
  const dialog = page.getByTestId("edit-agent-dialog");
  await expect(dialog).toBeVisible();
  const section = dialog.getByTestId("agent-home-settings");
  await expect(
    section.getByRole("group", { name: "Where Scout works" }),
  ).toBeVisible();
  await expect(section.getByTestId("agent-home-setting-mac")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await section.getByTestId("agent-home-setting-cloud").click();
  await expect(section.getByTestId("agent-home-setting-cloud")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(section.getByTestId("agent-home-settings-status")).toContainText(
    "Wakes when you message",
  );
  await waitForAnimations(page);
});

test("without cloud agents on the relay nothing changes in the header", async ({
  page,
}) => {
  await openScoutDm(page, { capabilities: false });
  await expect(page.getByTestId("agent-home-switch")).toHaveCount(0);
  await expect(page.getByTestId("chat-header-agent-runtime")).toBeVisible();
});
