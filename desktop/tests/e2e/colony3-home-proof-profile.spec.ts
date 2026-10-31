import { expect, test, type Page } from "@playwright/test";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  colony3At,
  colony3Extras,
  colony3PositionOptions,
} from "../helpers/colony3Conversations";
import {
  openLerato,
  shot,
  waitForShell,
  writeCaptures,
} from "../helpers/colony3Proof";
import { installFakeCamera } from "../helpers/fakeCamera";

/**
 * Colony 3.0 profile proof: the account menu, its status dialog, presence
 * menu and community flyout (ProfilePopover), the Edit avatar dialog in each of
 * its states (EditAvatar), and the agent profile panel with its hover card
 * (ProfilePanel). Each popover or dialog is captured on its own and cropped
 * from the board where the design shows it, because the boards lay several of
 * them on one scrim and the app opens them one at a time.
 *
 * Not a regression gate: it writes PNGs and checks that each state can be
 * reached. `scripts/colony3-proof-report.mjs` lays them next to the design.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.afterAll(() => {
  writeCaptures();
});

const SELF_PUBKEY = "deadbeef".repeat(8);
const UPLOADED_PNG_DESCRIPTOR = {
  sha256: "ab".repeat(32),
  size: 4096,
  type: "image/png",
  uploaded: 1700000000,
  url: `https://relay.example.com/media/${"ab".repeat(32)}.png`,
};

async function openAccountMenu(page: Page) {
  await page.getByTestId("sidebar-profile-avatar-button").click();
  const menu = page.getByTestId("profile-popover");
  await expect(menu).toBeVisible();
  await page.waitForTimeout(400);
  return menu;
}

async function openAvatarDialog(page: Page) {
  await openAccountMenu(page);
  await page.getByTestId("profile-popover-change-photo").click();
  const dialog = page.getByTestId("profile-avatar-dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  return dialog;
}

test("ProfilePopover board: account menu", async ({ page }) => {
  await openLerato(page, { route: "/#/today" });
  await waitForShell(page);
  const menu = await openAccountMenu(page);
  await shot(
    page,
    {
      name: "ProfilePopover-menu",
      board: "ProfilePopover",
      refRect: [14, 492, 324, 384],
      title: "Account menu",
    },
    menu,
  );
});

test("ProfilePopover board: set a status", async ({ page }) => {
  await openLerato(page, { route: "/#/today" });
  await waitForShell(page);
  await openAccountMenu(page);
  await page.getByTestId("profile-popover-set-status").click();
  const dialog = page.getByTestId("set-status-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Quick statuses")).toBeVisible();
  await page.waitForTimeout(400);
  await shot(
    page,
    {
      name: "ProfilePopover-status",
      board: "ProfilePopover",
      refRect: [640, 110, 520, 617],
      title: "Set a status",
    },
    dialog,
  );
});

test("EditAvatar board: presence menu", async ({ page }) => {
  await openLerato(page, { route: "/#/today" });
  await waitForShell(page);
  await openAccountMenu(page);
  await page.getByTestId("profile-popover-presence-trigger").click();
  const presence = page.locator(".pm-presence");
  await expect(presence).toBeVisible();
  await page.waitForTimeout(400);
  await shot(
    page,
    {
      name: "EditAvatar-presence",
      board: "EditAvatar",
      refRect: [350, 500, 224, 140],
      title: "Presence menu",
    },
    presence,
  );
});

test("EditAvatar board: choose", async ({ page }) => {
  await openLerato(page, { route: "/#/today" });
  await waitForShell(page);
  const dialog = await openAvatarDialog(page);
  await expect(dialog.getByTestId("avatar-options")).toBeVisible();
  await shot(
    page,
    {
      name: "EditAvatar-choose",
      board: "EditAvatar",
      refRect: [604, 48, 476, 322],
      title: "Edit avatar: choose",
    },
    dialog,
  );
});

test("EditAvatar board: camera", async ({ page }) => {
  await installFakeCamera(page, { holdCamera: true });
  await openLerato(page, { route: "/#/today" });
  await waitForShell(page);
  const dialog = await openAvatarDialog(page);
  await dialog.getByTestId("avatar-camera-open").click();
  await expect(dialog.getByTestId("avatar-camera-preview")).toBeVisible();
  await page.waitForTimeout(400);
  await shot(
    page,
    {
      name: "EditAvatar-camera",
      board: "EditAvatar",
      refRect: [1104, 48, 312, 443],
      title: "Edit avatar: camera",
    },
    dialog,
  );
});

test("EditAvatar board: crop and saving", async ({ page }) => {
  await installFakeCamera(page);
  await openLerato(page, {
    route: "/#/today",
    mock: {
      uploadDescriptors: [UPLOADED_PNG_DESCRIPTOR],
      uploadDelayMs: 20_000,
    },
  });
  await waitForShell(page);
  const dialog = await openAvatarDialog(page);
  await dialog.getByTestId("avatar-camera-open").click();
  await expect
    .poll(() =>
      page
        .getByTestId("avatar-camera-preview")
        .evaluate((video) => (video as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0);
  await dialog.getByTestId("avatar-camera-capture").click();
  await expect(dialog.getByTestId("avatar-crop-preview")).toBeVisible();
  await expect(dialog.getByTestId("avatar-crop-zoom")).toBeVisible();
  await dialog.getByTestId("avatar-crop-zoom").fill("1.4");
  await page.waitForTimeout(400);
  await shot(
    page,
    {
      name: "EditAvatar-crop",
      board: "EditAvatar",
      refRect: [604, 390, 476, 500],
      title: "Edit avatar: crop",
    },
    dialog,
  );

  await dialog.getByTestId("avatar-save").click();
  await expect(dialog.getByTestId("avatar-saving")).toBeVisible();
  await page.waitForTimeout(400);
  await shot(
    page,
    {
      name: "EditAvatar-saving",
      board: "EditAvatar",
      refRect: [1104, 534, 312, 252],
      title: "Edit avatar: saving",
    },
    dialog,
  );
});

test("ProfilePanel board: agent profile panel", async ({ page }) => {
  await openLerato(page, {
    route: `/#/channels/${REFERENCE_CHANNEL_IDS.oliveHouse}?profile=${REFERENCE_AGENTS.mina.pubkey}`,
    mock: {
      ...colony3PositionOptions(),
      oaOwnerIsMe: true,
      managedAgents: [
        {
          name: "Mina",
          personaId: "mina-persona",
          pubkey: REFERENCE_AGENTS.mina.pubkey,
          status: "running" as const,
          channelNames: ["The Olive House"],
        },
      ],
      colony3Extras: colony3Extras({
        profiles: [
          {
            pubkey: REFERENCE_AGENTS.mina.pubkey,
            displayName: "Mina",
            isAgent: true,
            ownerPubkey: SELF_PUBKEY,
            presence: "online" as const,
            about:
              "Plans, drafts and schedules content for client channels, and asks before anything is published.",
          },
        ],
      }),
    },
  });
  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("user-profile-tab-info")).toBeVisible();
  await page.waitForTimeout(600);
  await shot(
    page,
    {
      name: "ProfilePanel-panel",
      board: "ProfilePanel",
      refRect: [1040, 0, 400, 960],
      title: "Agent profile panel",
    },
    panel,
  );
});

test("ProfilePanel board: hover card", async ({ page }) => {
  await openLerato(page, {
    route: `/#/channels/${REFERENCE_CHANNEL_IDS.oliveHouse}`,
    mock: {
      ...colony3PositionOptions(),
      oaOwnerIsMe: true,
      managedAgents: [
        {
          name: "Theo",
          personaId: "theo-persona",
          pubkey: REFERENCE_AGENTS.theo.pubkey,
          status: "running" as const,
          channelNames: ["The Olive House"],
        },
      ],
      colony3Extras: colony3Extras({
        profiles: [
          {
            pubkey: REFERENCE_AGENTS.theo.pubkey,
            displayName: "Theo",
            isAgent: true,
            ownerPubkey: SELF_PUBKEY,
            presence: "online" as const,
            about:
              "Software Engineer. Keeps publishing and client integrations running.",
          },
        ],
        messages: [
          {
            channelId: REFERENCE_CHANNEL_IDS.oliveHouse,
            id: "c3-profile-lerato",
            pubkey: SELF_PUBKEY,
            createdAt: colony3At(9, 12),
            content:
              "Let’s keep a slower spring focused on the courtyard and the new seasonal menu. Two posts a week, no more.",
          },
          {
            channelId: REFERENCE_CHANNEL_IDS.oliveHouse,
            id: "c3-profile-theo",
            pubkey: REFERENCE_AGENTS.theo.pubkey,
            createdAt: colony3At(10, 5),
            content:
              "Tuesday and Thursday posts are queued for 08:30. I’ll confirm here once the first one goes out.",
          },
        ],
      }),
    },
  });
  const theoRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Tuesday and Thursday posts are queued" });
  await expect(theoRow).toBeVisible();
  await theoRow.locator("button").first().hover();
  const card = page.getByTestId("user-profile-popover");
  await expect(card).toBeVisible();
  await page.waitForTimeout(600);
  await shot(
    page,
    {
      name: "ProfilePanel-hover",
      board: "ProfilePanel",
      refRect: [364, 386, 396, 346],
      title: "Hover card",
    },
    card,
  );
});
