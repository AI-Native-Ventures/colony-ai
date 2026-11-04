import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const BASHEER = TEST_IDENTITIES.tyler;
const TEAMMATE = TEST_IDENTITIES.alice;
const ZAINA = TEST_IDENTITIES.bob;
const BASHEER_SCOUT = "a1".repeat(32);
const BASHEER_SECOND_SCOUT = "a2".repeat(32);
const ZAINA_SCOUT = "b1".repeat(32);
const COLD_AGENT = "c1".repeat(32);

const agentSeeds = [
  {
    pubkey: BASHEER_SCOUT,
    name: "Scout",
    ownerPubkey: BASHEER.pubkey,
    channelNames: ["general"],
    respondTo: "anyone" as const,
  },
  {
    pubkey: BASHEER_SECOND_SCOUT,
    name: "Scout",
    ownerPubkey: BASHEER.pubkey,
    channelNames: ["general"],
    respondTo: "anyone" as const,
  },
  {
    pubkey: ZAINA_SCOUT,
    name: "Scout",
    ownerPubkey: ZAINA.pubkey,
    channelNames: ["general"],
    respondTo: "anyone" as const,
  },
  {
    pubkey: COLD_AGENT,
    // The relay directory confirms this is an agent, but its shared profile
    // and display name are absent. The UI must use the neutral agent fallback.
    name: "",
    ownerPubkey: BASHEER.pubkey,
    channelNames: ["general"],
    respondTo: "anyone" as const,
  },
];

async function waitForLiveSubscription(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "general",
          }) === true,
      ),
    )
    .toBe(true);
}

async function addAgentsToGeneral(page: Page) {
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
    { channelId: GENERAL, pubkeys: agentSeeds.map((agent) => agent.pubkey) },
  );
}

async function emitAgentMessage(page: Page, pubkey: string, content: string) {
  await page.evaluate(
    ({ content, pubkey }) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content,
        pubkey,
      }),
    { content, pubkey },
  );
}

async function installViewer(
  page: Page,
  identity: (typeof TEST_IDENTITIES)[keyof typeof TEST_IDENTITIES],
  options: { theme?: "light" | "dark" } = {},
) {
  const theme = options.theme ?? "light";
  // Init scripts run before the bridge and before React reads either setting.
  // Each proof viewer is also a real member of the same seeded channel, which
  // makes the following users-batch request exercise its production member
  // lookup rather than a test-only directory bypass.
  await page.addInitScript(
    ({ channelId, pubkey, themeName, username }) => {
      const communityId = "e2e-default-community";
      const storageKey = `buzz-e2e-channel-members-v1:${encodeURIComponent(communityId)}:${channelId}`;
      window.localStorage.setItem("buzz-theme", themeName);
      window.localStorage.setItem(
        storageKey,
        JSON.stringify([
          {
            pubkey,
            role: "owner",
            joined_at: new Date(0).toISOString(),
            display_name: username,
          },
        ]),
      );
    },
    {
      channelId: GENERAL,
      pubkey: identity.pubkey,
      themeName: theme === "dark" ? "buzz-dark" : "buzz",
      username: identity.username,
    },
  );
  await installMockBridge(
    page,
    {
      relayAgents: agentSeeds,
      searchProfiles: [
        {
          pubkey: BASHEER_SCOUT,
          displayName: "Scout",
          ownerPubkey: BASHEER.pubkey,
          isAgent: true,
        },
        {
          pubkey: BASHEER_SECOND_SCOUT,
          displayName: "Scout",
          ownerPubkey: BASHEER.pubkey,
          isAgent: true,
        },
        {
          pubkey: ZAINA_SCOUT,
          displayName: "Scout",
          ownerPubkey: ZAINA.pubkey,
          isAgent: true,
        },
        { pubkey: BASHEER.pubkey, displayName: "Basheer Phiri" },
        { pubkey: ZAINA.pubkey, displayName: "Zaina Patel" },
      ],
    },
    { identity },
  );
  await page.goto(`/#/channels/${GENERAL}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await addAgentsToGeneral(page);
  await waitForLiveSubscription(page);
}

async function renderedText(page: Page) {
  return page.locator("body").innerText();
}

function assertNoRawIdentityText(text: string) {
  expect(text).not.toMatch(/\b[a-f0-9]{40,}\b/iu);
  expect(text).not.toMatch(/\bnpub1[0-9a-z]+\b/iu);
}

test("two viewer profile lookup resolves a shared agent identity and never renders a key", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const inspectViewer = async ({
    identity,
    message,
    expectedLabel,
    includeColdAgent = false,
  }: {
    identity: (typeof TEST_IDENTITIES)[keyof typeof TEST_IDENTITIES];
    message: string;
    expectedLabel: string;
    includeColdAgent?: boolean;
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await installViewer(page, identity);
    await emitAgentMessage(page, BASHEER_SCOUT, message);
    if (includeColdAgent) {
      await emitAgentMessage(page, COLD_AGENT, "Cold-profile identity proof.");
    }

    const row = page.getByTestId("message-row").filter({ hasText: message });
    await expect(row).toContainText(expectedLabel);
    const profileLookupPubkeys = await page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
        .filter((call) => call.command === "get_users_batch")
        .flatMap((call) => {
          const payload = call.payload;
          if (typeof payload !== "object" || payload === null) return [];
          const pubkeys = (payload as { pubkeys?: unknown }).pubkeys;
          return Array.isArray(pubkeys)
            ? pubkeys.filter((pubkey): pubkey is string => typeof pubkey === "string")
            : [];
        }),
    );
    expect(profileLookupPubkeys.map((pubkey) => pubkey.toLowerCase())).toContain(
      BASHEER_SCOUT,
    );
    expect(profileLookupPubkeys.map((pubkey) => pubkey.toLowerCase())).toContain(
      BASHEER.pubkey,
    );
    if (includeColdAgent) {
      await expect(
        page
          .getByTestId("message-row")
          .filter({ hasText: "Cold-profile identity proof." }),
      ).toContainText("AI employee");
    }
    assertNoRawIdentityText(await renderedText(page));
    // The runner owns this context. Explicit shutdown can wait on the mock
    // relay's long-lived socket and obscure the proof result.
  };

  await test.step("owner sees their Scout without a suffix", () =>
    inspectViewer({
      identity: BASHEER,
      message: "Owner-view identity proof.",
      expectedLabel: "Scout",
    }));
  await test.step("teammate fetches the shared profile and sees owner context", () =>
    inspectViewer({
      identity: TEAMMATE,
      message: "Teammate-view identity proof.",
      expectedLabel: "Scout (Basheer)",
      includeColdAgent: true,
    }));
});

test("mention picker uses shared owner-qualified labels and keeps pubkey routing", async ({
  page,
}) => {
  await installViewer(page, TEAMMATE);
  await emitAgentMessage(page, BASHEER_SCOUT, "Mention label source.");
  await page.getByTestId("message-input").fill("@Scout");
  const picker = page.getByTestId("mention-autocomplete");
  await expect(
    picker.getByTestId(`mention-suggestion-${BASHEER_SCOUT}`),
  ).toContainText("Scout (Basheer) 1");
  await expect(
    picker.getByTestId(`mention-suggestion-${BASHEER_SECOND_SCOUT}`),
  ).toContainText("Scout (Basheer) 2");
  await expect(
    picker.getByTestId(`mention-suggestion-${ZAINA_SCOUT}`),
  ).toContainText("Scout (Zaina)");

  await picker
    .getByTestId(`mention-suggestion-${ZAINA_SCOUT}`)
    .getByRole("button", { name: "Mention Scout (Zaina)" })
    .click();
  const input = page.getByTestId("message-input");
  await expect(input).toContainText("@Scout (Zaina)");
  await input.pressSequentially(" please review");
  await page.getByTestId("send-message").click();
  const sentRow = page
    .getByTestId("message-row")
    .filter({ hasText: "please review" });
  // This chip is rendered only after the returned message's `p` tag has been
  // resolved. It binds the visibly qualified name to the selected Scout key.
  await expect(
    sentRow.locator(`[data-mention-pubkey="${ZAINA_SCOUT}"]`),
  ).toHaveText("Scout (Zaina)");
  assertNoRawIdentityText(await renderedText(page));
});

const proofTheme = process.env.COLONY3_PROOF_THEME ?? "light";
const captureProof = process.env.COLONY3_IDENTITY_PROOF === "1";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`identity proof screenshots ${proofTheme} ${viewport.width}`, async ({
    browser,
  }) => {
    test.skip(!captureProof, "Capture only when preparing the PR evidence.");
    test.setTimeout(90_000);
    const colorScheme = proofTheme === "dark" ? "dark" : "light";
    const ownerContext = await browser.newContext({ colorScheme, viewport });
    const teammateContext = await browser.newContext({ colorScheme, viewport });
    const owner = await ownerContext.newPage();
    const teammate = await teammateContext.newPage();
    await installViewer(owner, BASHEER, { theme: proofTheme === "dark" ? "dark" : "light" });
    await installViewer(teammate, TEAMMATE, {
      theme: proofTheme === "dark" ? "dark" : "light",
    });
    await emitAgentMessage(owner, BASHEER_SCOUT, "Owner-view identity proof.");
    await emitAgentMessage(
      teammate,
      BASHEER_SCOUT,
      "Teammate-view identity proof.",
    );
    await waitForAnimations(owner);
    await waitForAnimations(teammate);
    await owner.screenshot({
      path: `test-results/screenshots/agent-identity-${proofTheme}-${viewport.width}-owner.png`,
    });
    await teammate.screenshot({
      path: `test-results/screenshots/agent-identity-${proofTheme}-${viewport.width}-teammate.png`,
    });

    await teammate.getByTestId("message-input").fill("@Scout");
    await expect(teammate.getByTestId("mention-autocomplete")).toBeVisible();
    await waitForAnimations(teammate);
    await teammate.screenshot({
      path: `test-results/screenshots/agent-identity-${proofTheme}-${viewport.width}-mention-picker.png`,
    });
    // The runner owns these contexts. Explicit shutdown can wait on the mock
    // relay's long-lived socket and obscure a successful visual proof.
  });
}
