import { mkdirSync } from "node:fs";
import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, type Page, test } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

/**
 * Proof captures for the office restyle (docs/superpowers/specs/
 * 2026-10-23-app-restyle-design.md). Not part of the CI suites: run it with
 * `restyle-proof.config.ts` against a `pnpm build:e2e` bundle.
 *
 * Every surface is captured at 1440x900 in each appearance variant so the
 * proof page can show the same frame across light, dark, a custom gradient
 * and two accents.
 */

const OUT = process.env.RESTYLE_PROOF_OUT ?? "test-results/restyle-proof";
const ONLY = list(process.env.RESTYLE_PROOF_VARIANTS);
const SURFACES = list(process.env.RESTYLE_PROOF_SURFACES);
const SELF = "deadbeef".repeat(8);
const COMMUNITY = "e2e-default-community";
const AYA = "a4a4".repeat(16);
const SCOUT = "d5d5".repeat(16);
const MINA = "b1b1".repeat(16);
const THREAD_ROOT = `5a1e${"0".repeat(59)}1`;
const ALICE = TEST_IDENTITIES.alice.pubkey;
const GENERAL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const ALICE_DM_ID = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";

type ProofEvent = {
  id: string;
  content: string;
  created_at: number;
  kind: number;
  pubkey: string;
  tags: string[][];
};
type ProofWindow = Window & {
  __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
    command: string,
    payload?: unknown,
  ) => Promise<unknown>;
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (
    input: Record<string, unknown>,
  ) => ProofEvent;
  __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (
    head: Record<string, unknown>,
  ) => ProofEvent;
  __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: Record<string, unknown>) => void;
};

const ASKS = [
  {
    askId: "10000000-0000-4000-8000-000000000011",
    type: "approval",
    category: "money",
    title: "Increase Olive Studio's October allowance by USD 120",
    context: "Current allowance USD 180. Proposed allowance USD 300.",
  },
  {
    askId: "10000000-0000-4000-8000-000000000012",
    type: "choice",
    category: "general",
    title: "Choose the campaign direction",
    context: "Select one direction for the next draft.",
    options: [
      { id: "customer-stories", label: "Customer stories" },
      { id: "studio-process", label: "Studio process" },
    ],
  },
  {
    askId: "10000000-0000-4000-8000-000000000013",
    type: "question",
    category: "general",
    title: "Which client requirement should we prioritise?",
    context: "Keep the launch date or add another creative round.",
  },
];

type Variant = {
  id: string;
  theme: "buzz" | "buzz-dark";
  accent?: string;
  custom?: [string, string];
};

const VARIANTS: Variant[] = [
  { id: "light", theme: "buzz" },
  { id: "dark", theme: "buzz-dark" },
  { id: "custom", theme: "buzz", custom: ["#f59e0b", "#14b8a6"] },
  { id: "accent-green", theme: "buzz", accent: "#22c55e" },
  { id: "accent-pink", theme: "buzz-dark", accent: "#ec4899" },
];

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function wants(surface: string) {
  return SURFACES.length === 0 || SURFACES.includes(surface);
}

async function seedAppearance(page: Page, variant: Variant) {
  await page.addInitScript(
    ({ variant, self, community }) => {
      const isDark = variant.theme === "buzz-dark";
      window.localStorage.setItem("buzz-theme", variant.theme);
      window.localStorage.setItem("buzz-follow-system", "false");
      if (variant.accent) {
        window.localStorage.setItem("buzz-accent-color", variant.accent);
      }
      window.localStorage.setItem(
        `colony.appearance.v1:${self}:${community}`,
        JSON.stringify({
          version: 1,
          updatedAt: 1,
          theme: variant.theme,
          accent: variant.accent ?? "#895AF6",
          followSystem: false,
          custom: Boolean(variant.custom),
          customLight: variant.custom ?? ["#895AF6", "#5A9CF6"],
          glassBackground: false,
          glassOpacity: 65,
          prominentActiveTab: false,
          messageSize: "default",
          density: "comfortable",
          linkPreview: "compact",
          threadLayout: "split",
        }),
      );
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.classList.toggle("light", !isDark);
    },
    { variant, self: SELF, community: COMMUNITY },
  );
  await page.emulateMedia({
    colorScheme: variant.theme === "buzz-dark" ? "dark" : "light",
  });
}

async function shot(page: Page, variant: Variant, name: string) {
  // Park the pointer in the gap between the sidebar and the card so no
  // hover popover or action bar sits in the frame.
  await page.mouse.move(264, 450);
  await page.waitForTimeout(400);
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}--${variant.id}.png` });
}

async function openChannel(page: Page, name: string) {
  await page.getByTestId(`channel-${name}`).first().click();
  await expect(page.getByTestId("message-timeline")).toBeVisible();
  await page.waitForFunction(
    (channelName) =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }) ??
      false,
    name,
    { timeout: 10_000 },
  );
}

async function emit(
  page: Page,
  message: {
    channelName: string;
    content: string;
    pubkey: string;
    id?: string;
    parentEventId?: string;
  },
) {
  await page.evaluate(
    (m) => window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.(m),
    message,
  );
}

async function start(page: Page, variant: Variant, sidebarShell: boolean) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedAppearance(page, variant);
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceSidebarShell: sidebarShell,
  });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

for (const variant of VARIANTS) {
  if (ONLY.length > 0 && !ONLY.includes(variant.id)) continue;

  test(`office restyle proof: channels ${variant.id}`, async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, variant, false);
    await openChannel(page, "Sales");
    await emit(page, {
      channelName: "Sales",
      content:
        "I drafted intro notes for the three strongest leads. Want me to send the Olive House one today?",
      id: THREAD_ROOT,
      pubkey: AYA,
    });
    for (const [pubkey, content] of [
      [SELF, "Yes, start with The Olive House."],
      [SCOUT, "I'll keep this thread updated as it moves."],
      [AYA, "Sent. I'll report their reply here."],
    ]) {
      await emit(page, {
        channelName: "Sales",
        content,
        parentEventId: THREAD_ROOT,
        pubkey,
      });
    }
    await page.waitForTimeout(800);
    if (wants("private-channel")) await shot(page, variant, "private-channel");

    if (wants("composer-focused")) {
      await page.getByTestId("message-input").first().click();
      await page.keyboard.type("Let's send Nandi the shortlist");
      await shot(page, variant, "composer-focused");
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
    }

    if (wants("thread-open")) {
      await page
        .locator(
          `[data-testid="message-thread-summary"][data-thread-head-id="${THREAD_ROOT}"]`,
        )
        .click();
      await expect(
        page.getByTestId("message-thread-replies").first(),
      ).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, variant, "thread-open");
      await page.keyboard.press("Escape");
    }

    if (wants("public-channel")) {
      await openChannel(page, "Marketing");
      await page.waitForTimeout(500);
      await shot(page, variant, "public-channel");
    }
  });

  test(`office restyle proof: sidebar and DM ${variant.id}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await start(page, variant, true);
    await openChannel(page, "Mina");
    for (const [pubkey, content] of [
      [MINA, "Hi Lerato, the Olive House captions are ready for your review."],
      [SELF, "Thanks Mina. Keep the first slide simple."],
      [MINA, "Done. I moved the product detail to slide two."],
    ]) {
      await emit(page, { channelName: "Mina", content, pubkey });
    }
    await page.waitForTimeout(800);
    if (wants("direct-message")) await shot(page, variant, "direct-message");
    if (wants("sidebar")) {
      await page.mouse.move(264, 450);
      await page.waitForTimeout(400);
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/sidebar--${variant.id}.png`,
        clip: { x: 0, y: 0, width: 360, height: 900 },
      });
    }
    if (wants("appearance")) {
      await page.goto("/#/settings?section=appearance");
      await expect(page.getByTestId("settings-appearance")).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, variant, "appearance");
    }
  });

  test(`office restyle proof: today and activity ${variant.id}`, async ({
    page,
  }) => {
    test.skip(!wants("today") && !wants("activity"));
    test.setTimeout(120_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedAppearance(page, variant);
    const relaySecret = generateSecretKey();
    await installMockBridge(page, {
      relaySelf: getPublicKey(relaySecret),
      companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    });
    await page.goto("/#/today");
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await page.waitForFunction(() => {
      const bridge = window as ProofWindow;
      return (
        typeof bridge.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__ === "function" &&
        typeof bridge.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function"
      );
    });
    await seedAsks(page);
    if (wants("today")) {
      await page.goto("/#/");
      await page.goto("/#/today");
      await expect(
        page.getByTestId(`today-ask-${ASKS[0].askId}`),
      ).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, variant, "today");
    }
    if (wants("activity")) {
      await page.goto("/#/");
      await seedActivity(page);
      const first = page.getByTestId("home-inbox-item-proof-activity-1");
      await expect(first).toBeVisible();
      await first.click();
      await expect(page.getByTestId("home-inbox-detail")).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, variant, "activity");
    }
  });
}

async function seedAsks(page: Page) {
  await page.evaluate(
    async ({ asks, askerPubkey }) => {
      const bridge = window as ProofWindow;
      const invoke = bridge.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emitMessage = bridge.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const publishHead = bridge.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
      if (!invoke || !emitMessage || !publishHead)
        throw new Error("The mock relay ask seam is unavailable.");
      const identity = (await invoke("get_identity", {})) as { pubkey: string };
      const now = Math.floor(Date.now() / 1_000);
      for (const fixture of asks) {
        const root = emitMessage({
          channelName: "general",
          content: `# Campaign direction\n${fixture.context}`,
          pubkey: askerPubkey,
        });
        const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
        if (!channelId) throw new Error("The seeded thread has no channel.");
        const ask = {
          schemaVersion: 1,
          askId: fixture.askId,
          type: fixture.type,
          category: fixture.category,
          title: fixture.title,
          threadRootEventId: root.id,
          addresseePubkey: identity.pubkey,
          decideBy: new Date((now + 3_600) * 1_000).toISOString(),
          ...("options" in fixture ? { options: fixture.options } : {}),
        };
        publishHead({
          channelId,
          askId: fixture.askId,
          threadRootEventId: root.id,
          content: JSON.stringify({
            schemaVersion: 1,
            askId: fixture.askId,
            status: "open",
            askerPubkey,
            createdAt: new Date(now * 1_000).toISOString(),
            ask,
            resolution: null,
            cancellation: null,
            sourceActionEventId: "b".repeat(64),
          }),
        });
        emitMessage({
          channelName: "general",
          content: JSON.stringify({
            schemaVersion: 1,
            askId: fixture.askId,
            action: "create",
            ask,
          }),
          kind: 47032,
          parentEventId: root.id,
          pubkey: askerPubkey,
          extraTags: [["d", `channel:${channelId}:ask:${fixture.askId}`]],
        });
      }
    },
    { asks: ASKS, askerPubkey: ALICE },
  );
}

async function seedActivity(page: Page) {
  await page.evaluate(
    ({ items }) => {
      const bridge = window as ProofWindow;
      const emitMessage = bridge.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const pushFeedItem = bridge.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__;
      if (!emitMessage || !pushFeedItem)
        throw new Error("The mock feed seam is unavailable.");
      const now = Math.floor(Date.now() / 1_000);
      items.forEach((item, index) => {
        const event = emitMessage({
          channelName: item.channelName,
          content: item.content,
          createdAt: now - (items.length - index) * 60,
          id: item.id,
          pubkey: item.pubkey,
        });
        pushFeedItem({
          category: item.category,
          channel_id: item.channelId,
          channel_name: item.channelName,
          channel_type: null,
          content: event.content,
          created_at: event.created_at,
          id: event.id,
          kind: event.kind,
          pubkey: event.pubkey,
          tags: event.tags,
        });
      });
    },
    {
      items: [
        {
          id: "proof-activity-1",
          category: "mention",
          channelId: GENERAL_ID,
          channelName: "general",
          content:
            "@tyler the Olive House shortlist is ready. Can you pick the two strongest leads today?",
          pubkey: ALICE,
        },
        {
          id: "proof-activity-2",
          category: "activity",
          channelId: ALICE_DM_ID,
          channelName: "alice-tyler",
          content: "I moved the product detail to slide two.",
          pubkey: ALICE,
        },
      ],
    },
  );
}
