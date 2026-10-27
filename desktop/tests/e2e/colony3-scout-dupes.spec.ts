import { expect, test, type Page } from "@playwright/test";

import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

/**
 * One account can end up with many "Scout" agents: every reinstall, new Mac or
 * reset makes a new agent key, and the old ones stay on the relay. A person
 * sees one Scout they can talk to: new channels hold only the agents this Mac
 * runs, and the mention picker lists the Scout this Mac runs first and says
 * which other Scouts are not on this Mac.
 */

const OWNER = "deadbeef".repeat(8);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const THIS_MAC_SCOUT = "5c".repeat(32);
const OLD_SCOUTS = ["a1", "a2", "a3"].map((byte) => byte.repeat(32));

type RawChannel = { id: string; name: string };
type RawMember = { pubkey: string; role: string };

const oldScoutSeeds = (channelNames: string[]) =>
  OLD_SCOUTS.map((pubkey) => ({
    pubkey,
    name: "Scout",
    ownerPubkey: OWNER,
    respondTo: "owner-only" as const,
    channelNames,
  }));

async function invoke<T>(
  page: Page,
  command: string,
  payload?: unknown,
): Promise<T> {
  return page.evaluate(
    ([name, args]) =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, payload?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__.invoke(name as string, args) as Promise<T>,
    [command, payload] as const,
  );
}

test.describe("One Scout per business", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a new Sales channel holds the agents this Mac runs, not every Scout on the account", async ({
    page,
  }) => {
    await installMockBridge(page, {
      // The company team (the AI employees) is read from the relay's signed
      // member positions, so the mock relay needs a signing identity.
      relaySelf: "c".repeat(64),
      managedAgents: [
        { pubkey: REFERENCE_AGENTS.scout.pubkey, name: "Scout" },
        { pubkey: REFERENCE_AGENTS.aya.pubkey, name: "Aya" },
      ],
      relayAgents: oldScoutSeeds([]),
      referenceWorkspace: true,
      referenceWorkspaceWithoutSales: true,
      referenceWorkspaceDiscoveryStandIn: false,
    });
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();

    const { channels } = await invoke<{ channels: RawChannel[] | null }>(
      page,
      "get_channels",
      { knownHash: null },
    );
    const sales = (channels ?? []).filter(
      (channel) => channel.name.toLowerCase() === "sales",
    );
    expect(sales).toHaveLength(1);
    const { members } = await invoke<{ members: RawMember[] }>(
      page,
      "get_channel_members",
      { channelId: sales[0].id },
    );
    const memberKeys = members.map((member) => member.pubkey);

    // Both agents this Mac runs are in, as bots.
    for (const agent of [REFERENCE_AGENTS.scout, REFERENCE_AGENTS.aya]) {
      expect(memberKeys).toContain(agent.pubkey);
    }
    // The earlier installs' Scouts are not.
    for (const pubkey of OLD_SCOUTS) {
      expect(memberKeys).not.toContain(pubkey);
    }
    expect(
      memberKeys.filter((pubkey) =>
        [...OLD_SCOUTS, REFERENCE_AGENTS.scout.pubkey].includes(pubkey),
      ),
    ).toEqual([REFERENCE_AGENTS.scout.pubkey]);
  });

  test("the mention picker lists the Scout this Mac runs first and marks the others", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [{ pubkey: THIS_MAC_SCOUT, name: "Scout" }],
      relayAgents: oldScoutSeeds(["general"]),
    });
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    // The earlier installs' Scouts already sit in this channel; this Mac's
    // Scout does not, which is what ranked it below them.
    await page.evaluate(
      async ({ channelId, pubkeys }) => {
        await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("add_channel_members", {
          channelId,
          pubkeys,
          role: "bot",
        });
        await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
          queryKey: ["channels"],
        });
        await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
          queryKey: ["relay-agents"],
        });
      },
      { channelId: GENERAL, pubkeys: OLD_SCOUTS },
    );

    await page.getByTestId("message-input").fill("@Scout");
    const picker = page
      .getByTestId("mention-autocomplete-layer")
      .getByTestId("mention-autocomplete");
    const rows = picker.locator("[data-mention-suggestion-index]");
    await expect(rows).toHaveCount(1 + OLD_SCOUTS.length);

    // This Mac's Scout is first, and one row per pubkey.
    const rowIds = await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")),
    );
    expect(rowIds[0]).toBe(`mention-suggestion-${THIS_MAC_SCOUT}`);
    expect(new Set(rowIds).size).toBe(rowIds.length);
    expect(rowIds.slice(1).sort()).toEqual(
      OLD_SCOUTS.map((pubkey) => `mention-suggestion-${pubkey}`).sort(),
    );

    // Only the Scouts that are not on this Mac say so.
    await expect(rows.first()).not.toContainText("Not on this Mac");
    for (const pubkey of OLD_SCOUTS) {
      await expect(
        picker.getByTestId(`mention-suggestion-${pubkey}`),
      ).toContainText("Not on this Mac");
    }

    await waitForAnimations(page);
    await page.screenshot({
      path: "test-results/screenshots/scout-picker-1440.png",
    });
  });

  test("the always-address shortcut picks the Scout this Mac runs, not a same-named Scout", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [{ pubkey: THIS_MAC_SCOUT, name: "Scout" }],
      relayAgents: oldScoutSeeds(["general"]),
    });
    await page.goto(
      `/#/channels/${GENERAL}?messageId=mock-general-welcome&thread=mock-general-welcome`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await page.evaluate(
      async ({ channelId, pubkeys }) => {
        await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("add_channel_members", {
          channelId,
          pubkeys,
          role: "bot",
        });
        await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
          queryKey: ["channels"],
        });
        await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
          queryKey: ["relay-agents"],
        });
      },
      { channelId: GENERAL, pubkeys: OLD_SCOUTS },
    );
    // Someone just mentioned one of the earlier-install Scouts, which is what
    // made the shortcut prefer it over the Scout this Mac runs.
    await page.evaluate((pubkey) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "Please ask Scout",
        mentionPubkeys: [pubkey],
      });
    }, OLD_SCOUTS[0]);

    const composer = page.getByTestId("thread-composer-overlay");
    const input = composer.getByTestId("message-input");
    await input.fill("draft text");
    const isMac = await page.evaluate(() =>
      /mac|iphone|ipad|ipod/i.test(navigator.platform),
    );
    await page.keyboard.press(`${isMac ? "Meta" : "Control"}+Shift+M`);

    await expect(input).toHaveText("@Scout draft text");
    await expect(
      composer.getByTestId(`composer-address-lock-${THIS_MAC_SCOUT}`),
    ).toBeVisible();
    for (const pubkey of OLD_SCOUTS) {
      await expect(
        composer.getByTestId(`composer-address-lock-${pubkey}`),
      ).toHaveCount(0);
    }
  });
});
