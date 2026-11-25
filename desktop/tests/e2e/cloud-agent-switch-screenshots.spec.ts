import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
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

/**
 * Proof screenshots for the cloud agent switch: the header menu, the profile
 * section and each notice card, at phone and desktop width. Written to
 * `test-results/screenshots/cloud-agents`; the PR posts them with
 * `scripts/post-screenshots.sh`.
 */
const SCOUT = REFERENCE_AGENTS.scout.pubkey;
const OWNER = TEST_IDENTITIES.tyler.pubkey;
const MODEL = "deepseek/deepseek-v4.1-flash";
const OUT = resolve("test-results/screenshots/cloud-agents");

const WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;

async function open(
  page: Page,
  placement: Partial<MockAgentPlacement>,
  options: { local?: boolean; clock?: boolean } = {},
) {
  if (options.clock) await page.clock.install();
  const relaySecret = generateSecretKey();
  await installMockBridge(
    page,
    {
      relaySelf: getPublicKey(relaySecret),
      companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
      referenceWorkspace: true,
      colony3Sidebar: true,
      cloudCapabilities: {
        enabled: true,
        allowed: true,
        maxPerAccount: 2,
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
          cloudModel: MODEL,
          ...placement,
        },
      ],
      relayAgents:
        options.local === false
          ? [
              {
                pubkey: SCOUT,
                ownerPubkey: OWNER,
                name: "Scout",
                channelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
                status: "offline",
              },
            ]
          : [],
      managedAgents:
        options.local === false
          ? []
          : [
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

async function shot(page: Page, name: string) {
  await mkdir(OUT, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
}

for (const size of WIDTHS) {
  test.describe(`cloud agent switch at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("header menu", async ({ page }) => {
      await open(page, {});
      await page.getByTestId("agent-home-trigger").click();
      await expect(page.getByTestId("agent-home-menu")).toBeVisible();
      await shot(page, `${size.name}-header-menu`);
    });

    test("header, agent in the cloud and asleep", async ({ page }) => {
      await open(page, { home: "cloud", status: "asleep" });
      await expect(page.getByTestId("agent-home-status")).toHaveText("Asleep");
      await shot(page, `${size.name}-header-cloud-asleep`);
    });

    test("profile section", async ({ page }) => {
      await open(page, { home: "cloud", status: "asleep" });
      await page.goto(`/#/agents?agent=${SCOUT}`);
      await page.getByTestId("agent-edit-configuration").click();
      const section = page
        .getByTestId("edit-agent-dialog")
        .getByTestId("agent-home-settings");
      await expect(section).toBeVisible();
      await section.scrollIntoViewIfNeeded();
      await shot(page, `${size.name}-settings-section`);
    });

    test("out of AI credit card", async ({ page }) => {
      await open(page, { home: "cloud", status: "outOfCredit" });
      await expect(page.getByTestId("agent-home-card")).toBeVisible();
      await shot(page, `${size.name}-card-out-of-credit`);
    });

    test("Mac off card", async ({ page }) => {
      // Scout works on a Mac this device does not have, and a message to it
      // has gone unanswered for more than a minute.
      await open(page, {}, { local: false, clock: true });
      await page.waitForFunction(
        () =>
          typeof (window as unknown as Record<string, unknown>)
            .__BUZZ_E2E_EMIT_MOCK_PRESENCE__ === "function",
      );
      await page.evaluate((pubkey) => {
        (
          window as unknown as {
            __BUZZ_E2E_EMIT_MOCK_PRESENCE__: (input: {
              pubkey: string;
              status: string;
            }) => void;
          }
        ).__BUZZ_E2E_EMIT_MOCK_PRESENCE__({ pubkey, status: "offline" });
      }, SCOUT);
      const input = page.getByTestId("message-input");
      await input.fill("are you there?");
      await page.getByTestId("send-message").click();
      await expect(page.getByTestId("message-row").last()).toContainText(
        "are you there?",
      );
      for (let spent = 0; spent < 90_000; spent += 500) {
        await page.clock.runFor(500);
      }
      await expect(page.getByTestId("agent-home-card")).toBeVisible();
      await expect(page.getByTestId("agent-home-card")).toHaveAttribute(
        "data-notice",
        "macOff",
      );
      await shot(page, `${size.name}-card-mac-off`);
    });

    test("could not start card", async ({ page }) => {
      await open(page, { home: "cloud", status: "failed" });
      await expect(page.getByTestId("agent-home-card")).toBeVisible();
      await shot(page, `${size.name}-card-could-not-start`);
    });
  });
}
