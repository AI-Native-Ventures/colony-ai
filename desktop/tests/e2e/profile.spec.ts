import { expect, test, type Page } from "@playwright/test";
import { npubEncode } from "nostr-tools/nip19";

import {
  createMockAgentMemoryListing,
  installMockBridge,
  TEST_IDENTITIES,
} from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import {
  openAvatarProfileContext,
  openProfileMenu,
  openSettings,
  selectSettingsSection,
} from "../helpers/settings";

async function expectHomeView(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
}

async function waitForAvatarEditorToClose(page: Page) {
  await expect(page.getByTestId("profile-avatar-dialog")).toHaveCount(0);
}

function getHashSearchParam(page: Page, name: string) {
  const hash = new URL(page.url()).hash.replace(/^#/, "");
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) {
    return null;
  }
  return new URLSearchParams(hash.slice(queryStart + 1)).get(name);
}

async function expectHashSearchParam(
  page: Page,
  name: string,
  value: string | null,
) {
  await expect.poll(() => getHashSearchParam(page, name)).toBe(value);
}

async function readVisibleProfileSurface(page: Page) {
  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible();

  return panel.evaluate((element) => {
    const isVisible = (candidate: Element) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const visibleTestIds = Array.from(
      element.querySelectorAll<HTMLElement>("[data-testid]"),
    )
      .filter(isVisible)
      .map((candidate) => candidate.dataset.testid)
      .filter((value): value is string => Boolean(value))
      .filter(
        (value) =>
          (value.startsWith("user-profile-") ||
            value.startsWith("agent-config-")) &&
          !value.endsWith("resize-handle"),
      )
      .sort();
    const visibleControls = Array.from(
      element.querySelectorAll<HTMLElement>(
        'button, [role="button"], [role="tab"], [role="switch"]',
      ),
    )
      .filter(isVisible)
      .map((candidate) => ({
        label:
          candidate.getAttribute("aria-label") ??
          candidate.textContent?.replace(/\s+/g, " ").trim() ??
          "",
        testId: candidate.dataset.testid ?? null,
      }))
      .filter(({ label, testId }) => label.length > 0 || testId !== null)
      .filter(({ testId }) => !testId?.endsWith("resize-handle"))
      .sort((left, right) =>
        `${left.testId}:${left.label}`.localeCompare(
          `${right.testId}:${right.label}`,
        ),
      );

    const activityChannelLabel = element
      .querySelector<HTMLElement>(
        '[data-testid="user-profile-activity-channel-label"]',
      )
      ?.textContent?.replace(/\s+/g, " ")
      .trim();

    return {
      activityChannelLabel: activityChannelLabel ?? null,
      visibleControls,
      visibleTestIds,
    };
  });
}

async function readOwnedAgentProfileContract(page: Page) {
  const tabs = ["info", "runtime", "channels", "memories"] as const;
  const contract: Partial<
    Record<
      (typeof tabs)[number],
      Awaited<ReturnType<typeof readVisibleProfileSurface>>
    >
  > = {};

  for (const tab of tabs) {
    const trigger = page.getByTestId(`user-profile-tab-${tab}`);
    await expect(trigger).toBeVisible();
    if ((await trigger.getAttribute("data-state")) !== "active") {
      await trigger.click();
    }
    await expect(trigger).toHaveAttribute("data-state", "active");
    if (tab === "memories") {
      await expect(page.getByTestId("agent-memory-section")).toBeVisible();
    }
    await waitForAnimations(page);
    contract[tab] = await readVisibleProfileSurface(page);
  }

  await page.getByTestId("user-profile-tab-info").click();
  await expect(page.getByTestId("user-profile-tab-info")).toHaveAttribute(
    "data-state",
    "active",
  );
  return contract;
}

async function addGenericAgent(
  page: Page,
  channelName: string,
  agentName: string,
  systemPrompt = "Watch the channel and help when asked.",
): Promise<string> {
  await page.getByTestId(`channel-${channelName}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(channelName);
  const channelId = await page
    .getByTestId(`channel-${channelName}`)
    .getAttribute("data-channel-id");
  if (!channelId) {
    throw new Error(`Channel ${channelName} is missing a data-channel-id.`);
  }

  await page.waitForFunction(() => {
    return Boolean(
      (
        window as Window & {
          __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: unknown;
        }
      ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__,
    );
  });
  return page.evaluate(
    async ({ agentName, channelId, systemPrompt }) => {
      const invoke = (
        window as Window & {
          __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
            command: string,
            payload?: Record<string, unknown>,
          ) => Promise<{ agent?: { pubkey: string }; id?: string }>;
        }
      ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      if (!invoke) {
        throw new Error("Mock bridge is not installed.");
      }

      const persona = await invoke("create_persona", {
        input: {
          displayName: agentName,
          systemPrompt,
        },
      });
      if (!persona.id) {
        throw new Error("Mock persona creation did not return an id.");
      }

      const created = await invoke("create_managed_agent", {
        input: {
          name: agentName,
          personaId: persona.id,
          spawnAfterCreate: true,
          systemPrompt,
        },
      });
      const pubkey = created.agent?.pubkey;
      if (!pubkey) {
        throw new Error("Mock managed agent creation did not return a pubkey.");
      }

      await invoke("add_channel_members", {
        channelId,
        pubkeys: [pubkey],
        role: "bot",
      });

      await (
        window as Window & {
          __BUZZ_E2E_QUERY_CLIENT__?: {
            invalidateQueries: () => Promise<void>;
          };
        }
      ).__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();

      return pubkey;
    },
    { agentName, channelId, systemPrompt },
  );
}

async function waitForMockLiveSubscription(
  page: Page,
  channelName: string,
  kind?: number,
) {
  await expect
    .poll(async () => {
      return page.evaluate(
        ({ channelName, kind }) => {
          return (
            (
              window as Window & {
                __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                  channelName: string;
                  kind?: number;
                }) => boolean;
              }
            ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName,
              kind,
            }) ?? false
          );
        },
        { channelName, kind },
      );
    })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("profile panel shows communication actions as quick action tiles", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await page.evaluate((bobPubkey) => {
    const emit = (
      window as Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          pubkey: string;
        }) => unknown;
      }
    ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    if (!emit) {
      throw new Error("Mock message emitter is unavailable.");
    }
    emit({
      channelName: "general",
      content: "Profile action tile check",
      pubkey: bobPubkey,
    });
  }, TEST_IDENTITIES.bob.pubkey);

  const messageRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Profile action tile check" });
  await expect(messageRow).toBeVisible();
  await messageRow.locator("button").first().click();

  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("user-profile-header-edit-agent")).toHaveCount(
    0,
  );
  const actionGroup = panel.getByTestId("user-profile-primary-actions");
  await expect(actionGroup).toBeVisible();
  await expect(actionGroup).toHaveClass(/grid-flow-col/);
  await expect(actionGroup).toHaveClass(/auto-cols-fr/);
  const waveAction = panel.getByTestId("user-profile-wave");
  const messageAction = panel.getByTestId("user-profile-message");
  const huddleAction = panel.getByTestId("user-profile-huddle");
  await expect(waveAction).toHaveClass(/flex-col/);
  await expect(messageAction).toHaveClass(/flex-col/);
  await expect(huddleAction).toHaveClass(/flex-col/);
  const communicationActionOrder = await actionGroup
    .locator("button[data-testid]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-testid")),
    );
  expect(communicationActionOrder).toEqual([
    "user-profile-message",
    "user-profile-huddle",
    "user-profile-wave",
  ]);
  await expect(panel.getByTestId("user-profile-copy-pubkey")).toBeVisible();

  await waveAction.click();
  await expect(page.getByTestId("chat-title")).toHaveText("bob-tyler");
  await expect(page.getByTestId("message-wave-attachment")).toBeVisible();
});

test("owned agent profile stays in parity between Agents and its DM", async ({
  page,
}) => {
  await installMockBridge(page, {
    agentMemory: createMockAgentMemoryListing(),
    oaOwnerIsMe: true,
  });
  await page.goto("/");
  const agentName = "Parity Bot";
  const agentPubkey = await addGenericAgent(
    page,
    "general",
    agentName,
    "Keep every profile entry point in sync.",
  );

  await page.getByTestId("open-agents-view").click();
  await page
    .getByRole("button", { name: `${agentName} agent profile` })
    .click();
  await page.getByTestId("user-profile-message").click();
  await expect(page.getByTestId("chat-header-dm-avatar")).toBeVisible();
  const dmChannelId = await page.evaluate(() => {
    const match = window.location.hash.match(/\/channels\/([^?]+)/);
    if (!match?.[1]) {
      throw new Error("Could not resolve the agent DM channel id.");
    }
    return decodeURIComponent(match[1]);
  });
  await page.evaluate(
    ({ dmChannelId, pubkey }) => {
      const seed = (
        window as Window & {
          __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
            agentPubkey: string;
            channelId: string;
            turnId: string;
          }) => void;
        }
      ).__BUZZ_E2E_SEED_ACTIVE_TURNS__;
      if (!seed) {
        throw new Error("Active-turn test bridge is unavailable.");
      }
      seed({
        agentPubkey: pubkey,
        channelId: "00000000-0000-0000-0000-000000000001",
        turnId: "profile-parity-other-channel",
      });
      seed({
        agentPubkey: pubkey,
        channelId: dmChannelId,
        turnId: "profile-parity-dm-channel",
      });
    },
    { dmChannelId, pubkey: agentPubkey },
  );

  await page.getByTestId("open-agents-view").click();
  await page
    .getByRole("button", { name: `${agentName} agent profile` })
    .click();
  const agentsSurface = await readOwnedAgentProfileContract(page);

  await page.getByTestId("user-profile-message").click();
  await expect(page.getByTestId("chat-header-dm-avatar")).toBeVisible();
  await page
    .getByTestId("chat-header")
    .getByRole("button", { name: `Open profile for ${agentName}` })
    .click();
  await expect(page.getByTestId("user-profile-public-key")).toContainText(
    npubEncode(agentPubkey).slice(0, 8),
  );
  const dmSurface = await readOwnedAgentProfileContract(page);

  expect(dmSurface).toEqual(agentsSurface);
});

test("keeps the saved display name after a community round trip", async ({
  page,
}) => {
  const communities = [
    {
      id: "profile-community-a",
      name: "Alpha",
      relayUrl: "ws://localhost:3000",
      addedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "profile-community-b",
      name: "Bravo",
      relayUrl: "ws://localhost:3001",
      addedAt: "2026-01-02T00:00:00.000Z",
    },
  ];
  await page.addInitScript((seed) => {
    window.localStorage.setItem("buzz-communities", JSON.stringify(seed));
    window.localStorage.setItem("buzz-active-community-id", seed[0].id);
  }, communities);
  await page.goto("/");

  const displayName = "Name that should survive switching";
  await openSettings(page, "profile");
  const nameInput = page.getByTestId("profile-display-name");
  await nameInput.fill(displayName);
  await nameInput.press("Enter");
  await expect(nameInput).toHaveValue(displayName);
  await page.getByTestId("settings-back-to-app").click();

  const communityA = page.getByTestId(
    "community-rail-button-profile-community-a",
  );
  const communityB = page.getByTestId(
    "community-rail-button-profile-community-b",
  );
  await communityB.click();
  await expect(communityB).toHaveAttribute("aria-current", "true");
  await communityA.click();
  await expect(communityA).toHaveAttribute("aria-current", "true");

  await openSettings(page, "profile");
  await expect(page.getByTestId("profile-display-name")).toHaveValue(
    displayName,
  );
});

test("updates the relay-backed profile from settings", async ({ page }) => {
  const stamp = Date.now();
  const displayName = `Tyler QA ${stamp}`;
  await page.goto("/");

  await openSettings(page, "profile");
  await expect(
    page.getByTestId("settings-profile").getByRole("heading", {
      exact: true,
      name: "Your account",
    }),
  ).toBeVisible();
  const nameInput = page.getByTestId("profile-display-name");
  await nameInput.fill(displayName);
  await nameInput.press("Enter");
  await expect(nameInput).toHaveValue(displayName);
  await expect(page.getByTestId("account-profile-email")).toHaveAttribute(
    "readonly",
    "",
  );

  await openAvatarProfileContext(page);
  await page.getByTestId("profile-avatar-edit").click();
  await expect(page.getByTestId("profile-avatar-dialog")).toBeVisible();
  await page.getByTestId("avatar-option-star").click();
  await waitForAvatarEditorToClose(page);
  await expect(page.getByTestId("profile-avatar-saved")).toHaveText(
    "Profile photo updated",
  );

  await page.getByTestId("settings-back-to-app").click();
  await expectHomeView(page);
  await expect(page.getByTestId("open-settings")).toBeVisible();

  await openSettings(page, "profile");
  await expect(page.getByTestId("profile-display-name")).toHaveValue(
    displayName,
  );
  await expect(
    page.getByTestId("settings-profile-avatar-image"),
  ).toHaveAttribute("src", /^data:image\/svg\+xml/);
});

test("saves the display name when its field is submitted", async ({ page }) => {
  await page.goto("/");

  await openSettings(page, "profile");
  const nameInput = page.getByTestId("profile-display-name");
  await expect(nameInput).toBeVisible();
  await expect(page.getByTestId("account-profile-email")).toHaveAttribute(
    "readonly",
    "",
  );

  await nameInput.fill("Save Button QA");
  await nameInput.press("Enter");
  await expect(nameInput).toHaveValue("Save Button QA");

  await nameInput.fill("");
  await nameInput.press("Enter");
  await page.getByTestId("settings-back-to-app").click();
  await openSettings(page, "profile");
  await expect(page.getByTestId("profile-display-name")).toHaveValue(
    "Save Button QA",
  );
});

test("shows the designed status after a profile photo update", async ({
  page,
}) => {
  await page.goto("/");

  await openSettings(page, "profile");
  await openAvatarProfileContext(page);
  await page.getByTestId("profile-avatar-edit").click();
  await page.getByTestId("avatar-option-flower").click();
  await waitForAvatarEditorToClose(page);
  await expect(page.getByTestId("profile-avatar-saved")).toHaveText(
    "Profile photo updated",
  );
});

test("shows the account photo row and its avatar action", async ({ page }) => {
  await page.goto("/");
  await openSettings(page, "profile");
  await openAvatarProfileContext(page);

  const details = page.getByTestId("settings-account-profile-card");
  await expect(
    details.getByRole("heading", { name: "Personal details" }),
  ).toBeVisible();
  await expect(
    details.getByText("Profile photo", { exact: true }),
  ).toBeVisible();
  await expect(details).toContainText("Shown to people in your businesses.");

  await details.getByRole("button", { name: "Edit avatar" }).click();
  await expect(page.getByTestId("profile-avatar-dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit avatar" }),
  ).toBeVisible();
  await page.getByTestId("avatar-cancel").click();
  await waitForAvatarEditorToClose(page);
});

test("offers the frozen avatar presets, upload, and camera choices", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page, "profile");
  await openAvatarProfileContext(page);
  await page.getByTestId("profile-avatar-edit").click();

  const options = page.getByTestId("avatar-options");
  await expect(options.getByTestId("avatar-option-initials")).toBeVisible();
  for (const preset of ["star", "leaf", "diamond", "sun", "flower"]) {
    await expect(options.getByTestId(`avatar-option-${preset}`)).toBeVisible();
  }
  await expect(options.getByRole("button")).toHaveCount(6);
  await expect(page.getByTestId("avatar-upload-open")).toBeVisible();
  await page.getByTestId("avatar-camera-open").click();
  await expect(page.getByTestId("avatar-camera-preview")).toBeVisible();
  await expect(
    page.getByText(/Use your camera to take a profile photo/),
  ).toBeVisible();
  await expect(page.getByTestId("avatar-camera-capture")).toBeDisabled();
  await page.getByTestId("avatar-cancel").click();
  await waitForAvatarEditorToClose(page);
});

test("validates image types in the designed avatar upload state", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page, "profile");
  await openAvatarProfileContext(page);
  await page.getByTestId("profile-avatar-edit").click();
  await page.getByTestId("avatar-upload-open").click();

  const input = page.getByTestId("avatar-file-input");
  await expect(input).toHaveAttribute(
    "accept",
    "image/jpeg,image/png,image/webp",
  );
  await input.setInputFiles({
    buffer: Buffer.from("not an image"),
    mimeType: "image/svg+xml",
    name: "avatar.svg",
  });
  const invalid = page.getByTestId("avatar-invalid");
  await expect(invalid).toContainText("Choose a smaller supported image");
  await expect(invalid).toContainText("Use JPEG, PNG or WebP, up to 5 MB.");
  await expect(page.getByTestId("avatar-crop-preview")).toHaveCount(0);
});

test("uploads, crops, and saves a local profile avatar", async ({ page }) => {
  const uploadedAvatarUrl = "https://mock.relay/media/avatar-profile.png";
  const uploadedAvatarImage = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6okAAAAASUVORK5CYII=",
    "base64",
  );
  await installMockBridge(page, {
    uploadDescriptors: [
      {
        filename: "avatar-profile.png",
        sha256: "b".repeat(64),
        size: 553432,
        type: "image/png",
        uploaded: 1_779_900_000,
        url: uploadedAvatarUrl,
      },
    ],
    uploadDelayMs: 500,
  });
  await page.route("**/media/avatar-profile.png", (route) =>
    route.fulfill({ body: uploadedAvatarImage, contentType: "image/png" }),
  );
  await page.goto("/");

  await openSettings(page, "profile");
  await openAvatarProfileContext(page);
  await page.getByTestId("profile-avatar-edit").click();
  await page.getByTestId("avatar-upload-open").click();
  await page.getByTestId("avatar-file-input").setInputFiles({
    buffer: uploadedAvatarImage,
    mimeType: "image/png",
    name: "avatar-profile.png",
  });

  const crop = page.getByTestId("avatar-crop-preview");
  await expect(crop).toBeVisible();
  await expect(page.getByTestId("avatar-crop-zoom")).toBeVisible();
  await expect(crop).toHaveAttribute("aria-valuenow", "50");
  await crop.press("ArrowRight");
  await expect(crop).toHaveAttribute("aria-valuenow", "54");
  await page.getByTestId("avatar-save").click();
  await expect(page.getByTestId("avatar-saving")).toBeVisible();
  await waitForAvatarEditorToClose(page);
  await expect(page.getByTestId("profile-avatar-saved")).toHaveText(
    "Profile photo updated",
  );

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
            .__BUZZ_E2E_COMMANDS__ ?? [],
      ),
    )
    .toEqual(
      expect.arrayContaining(["upload_media_bytes_raw", "update_profile"]),
    );
  await expect(
    page.getByTestId("account-profile-avatar-image"),
  ).toHaveAttribute("src", uploadedAvatarUrl);
});

test("opens Send feedback from the profile menu", async ({ page }) => {
  await page.goto("/");
  await openProfileMenu(page);
  await page.getByTestId("profile-popover-send-feedback").click();

  const dialog = page.getByTestId("send-feedback-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("send-feedback-title")).toHaveText(
    "Send feedback",
  );
  await expect(dialog.getByTestId("feedback-type")).toHaveValue("suggestion");
  await expect(dialog.getByTestId("feedback-message")).toBeVisible();
  await expect(dialog.getByTestId("feedback-include-logs")).not.toBeChecked();

  await dialog.getByTestId("feedback-diagnostics-toggle").click();
  await expect(
    dialog.getByTestId("feedback-diagnostics-details"),
  ).toBeVisible();
  await dialog.getByTestId("feedback-include-logs").check();
  await expect(dialog.getByTestId("feedback-include-logs")).toBeChecked();
});

test("cancel closes the feedback form without submitting it", async ({
  page,
}) => {
  await page.goto("/");
  await openProfileMenu(page);
  await page.getByTestId("profile-popover-send-feedback").click();

  const dialog = page.getByTestId("send-feedback-dialog");
  const message = dialog.getByTestId("feedback-message");
  await message.fill("Cancel this feedback draft.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("feedback-sent")).toHaveCount(0);
});

test("feedback form follows the frozen fields and consent controls", async ({
  page,
}) => {
  await page.goto("/");
  await openProfileMenu(page);
  await page.getByTestId("profile-popover-send-feedback").click();

  const dialog = page.getByTestId("send-feedback-dialog");
  await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
  await expect(dialog.getByText("Attach image", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    dialog.getByRole("button", { name: "Send feedback" }),
  ).toBeDisabled();
  await dialog
    .getByTestId("feedback-message")
    .fill("A note from the settings menu.");
  await expect(
    dialog.getByRole("button", { name: "Send feedback" }),
  ).toBeEnabled();
  await expect(dialog.getByTestId("feedback-include-logs")).not.toBeChecked();
});

test("updates presence from the profile menu", async ({ page }) => {
  await page.goto("/");

  await openProfileMenu(page);
  await expect(
    page.getByTestId("profile-popover-presence-trigger"),
  ).toContainText("Online");

  await page.getByTestId("profile-popover-presence-trigger").click();
  await page.getByTestId("profile-popover-status-away").click();
  await openProfileMenu(page);
  await expect(
    page.getByTestId("profile-popover-presence-trigger"),
  ).toContainText("Away");

  await page.getByTestId("profile-popover-presence-trigger").click();
  await page.getByTestId("profile-popover-status-offline").click();
  await openProfileMenu(page);
  await expect(
    page.getByTestId("profile-popover-presence-trigger"),
  ).toContainText("Offline");
});

test("renders agent profile ingress subviews from the Playwright mock bridge", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await installMockBridge(page, {
    agentMemory: createMockAgentMemoryListing(),
    // The viewer is the agent's verified NIP-OA owner, so archiveActions
    // grants the Archive row (canArchive gate; the relay re-verifies on submit).
    oaOwnerIsMe: true,
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  const longAgentInstruction = [
    "Watch the channel and help when asked.",
    "Summarize active decisions, call out risks plainly, and keep the tone concise.",
    "Prefer concrete next steps over broad commentary, and cite the relevant thread context when responding.",
    "Avoid catchphrases, theatrical roleplay, and unsupported guesses.",
    "When uncertainty remains, say exactly what evidence would resolve it.",
  ].join("\n\n");
  const agentPubkey = await addGenericAgent(
    page,
    "general",
    "Memory Bot",
    longAgentInstruction,
  );
  // A running process is not presence. Supply this scenario's snapshot and
  // authored kind-20001 updates through the mock relay, not the query cache.
  const emitAgentPresence = (status: "online" | "offline") =>
    page.evaluate(
      ({ pubkey, status }) => {
        const emit = (
          window as Window & {
            __BUZZ_E2E_EMIT_MOCK_PRESENCE__?: (input: {
              pubkey: string;
              status: "online" | "offline";
            }) => void;
          }
        ).__BUZZ_E2E_EMIT_MOCK_PRESENCE__;
        if (!emit) throw new Error("Mock presence emitter is unavailable.");
        emit({ pubkey, status });
      },
      { pubkey: agentPubkey, status },
    );
  await emitAgentPresence("online");

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await page.evaluate(
    ({ pubkey }) => {
      const emit = (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            pubkey: string;
          }) => unknown;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) {
        throw new Error("Mock message emitter is unavailable.");
      }
      emit({
        channelName: "general",
        content: "Memory bot check-in",
        pubkey,
      });
    },
    { pubkey: agentPubkey },
  );

  const messageRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Memory bot check-in" });
  await expect(messageRow).toBeVisible();
  await messageRow.locator("button").first().click();

  await expect(page.getByTestId("user-profile-panel")).toBeVisible();
  await expect(page.getByTestId("user-profile-message")).toBeVisible();
  await expect(page.getByTestId("user-profile-huddle")).toHaveCount(0);
  await expect(page.getByTestId("user-profile-wave")).toHaveCount(0);
  await expectHashSearchParam(page, "profile", agentPubkey);
  const agentPresenceBadge = page.getByTestId("user-profile-presence-badge");
  await expect(agentPresenceBadge).toBeVisible();
  await expect(agentPresenceBadge).toHaveAttribute("aria-label", "Online");
  const headerEditAgent = page.getByTestId("user-profile-header-edit-agent");
  await expect(headerEditAgent).toHaveText("Edit");
  await expect(headerEditAgent.locator("svg")).toHaveCount(0);
  await expect(
    page.getByTestId("user-profile-settings-menu-trigger"),
  ).toHaveCount(0);
  const closePanelButton = page.getByTestId("auxiliary-panel-close");
  const headerActionOrder = await headerEditAgent
    .locator("xpath=..")
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-testid")),
    );
  expect(headerActionOrder.at(-2)).toBe("user-profile-header-edit-agent");
  expect(headerActionOrder.at(-1)).toBe("auxiliary-panel-close");
  await headerEditAgent.click();
  await expect(page.getByTestId("persona-dialog")).toBeVisible();
  await page
    .getByTestId("persona-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(closePanelButton).toBeVisible();
  const agentEdit = page.getByTestId("user-profile-edit-agent");
  const agentEditIcon = page.getByTestId("user-profile-edit-agent-icon");
  await expect(agentEdit).toBeVisible();
  await expect(agentEditIcon).toHaveCSS("opacity", "0");
  await agentEdit.hover();
  await expect(agentEditIcon).toHaveCSS("opacity", "1");
  await expect(
    page.getByTestId("user-profile-agent-primary-action"),
  ).toHaveAttribute("aria-label", "Stop");
  await expect(page.getByTestId("user-profile-agent-restart")).toBeVisible();
  const runningAgentActionOrder = await page
    .getByTestId("user-profile-primary-actions")
    .locator("button[data-testid]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-testid")),
    );
  expect(runningAgentActionOrder).toEqual([
    "user-profile-agent-primary-action",
    "user-profile-agent-restart",
    "user-profile-message",
  ]);
  const runningAgentActionWidths = await page
    .getByTestId("user-profile-primary-actions")
    .locator("button[data-testid]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().width),
    );
  expect(
    runningAgentActionWidths.every(
      (width) => Math.abs(width - runningAgentActionWidths[0]) <= 1,
    ),
  ).toBe(true);
  const agentPrimaryAction = page.getByTestId(
    "user-profile-agent-primary-action",
  );
  await expect(agentPrimaryAction).toHaveClass(/bg-foreground/);
  await expect(agentPrimaryAction).toHaveClass(/text-background/);
  await waitForMockLiveSubscription(page, "general", 20001);
  await agentPrimaryAction.click();
  await expect(agentPrimaryAction).toHaveAttribute("aria-label", "Start agent");
  await expect(agentPresenceBadge).toHaveAttribute("aria-label", "Online");
  await emitAgentPresence("offline");
  await expect(agentPresenceBadge).toHaveAttribute("aria-label", "Offline");
  await expectHashSearchParam(page, "profile", agentPubkey);
  await expect(agentPrimaryAction).toHaveClass(/bg-foreground/);
  await expect(agentPrimaryAction).toHaveClass(/text-background/);
  await expect(page.getByTestId("user-profile-agent-restart")).toHaveCount(0);
  const stoppedAgentActionOrder = await page
    .getByTestId("user-profile-primary-actions")
    .locator("button[data-testid]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-testid")),
    );
  expect(stoppedAgentActionOrder).toEqual([
    "user-profile-agent-primary-action",
    "user-profile-message",
  ]);
  await expect(agentPrimaryAction).toBeEnabled();
  await agentPrimaryAction.click();
  await expect(agentPrimaryAction).toHaveAttribute("aria-label", "Stop");
  await waitForMockLiveSubscription(page, "general", 20001);
  await expect(agentPresenceBadge).toHaveAttribute("aria-label", "Offline");
  await emitAgentPresence("online");
  await expect(agentPresenceBadge).toHaveAttribute("aria-label", "Online");
  await expect(page.getByTestId("user-profile-agent-restart")).toBeVisible();
  await expectHashSearchParam(page, "profileTab", null);

  await expect(page.getByTestId("user-profile-tab-info")).toBeVisible();
  const profileScrollBody = page.getByTestId("user-profile-scroll-body");
  const profileHeader = page.getByTestId("user-profile-panel-header");
  const primaryActions = page.getByTestId("user-profile-primary-actions");
  const stickyHero = page.getByTestId("user-profile-sticky-hero");
  const stickyTabs = page.getByTestId("user-profile-sticky-tabs");
  const stickyChromeSurface = page.getByTestId(
    "user-profile-sticky-chrome-surface",
  );
  await expect(stickyHero).toHaveCSS("position", "sticky");
  await expect(stickyTabs).toHaveCSS("position", "sticky");
  await expect(stickyTabs).toHaveCSS("padding-top", "8px");
  await expect(profileHeader).toHaveCSS("backdrop-filter", "none");
  await expect(stickyHero).toHaveCSS("backdrop-filter", "none");
  await expect(stickyTabs).toHaveCSS("backdrop-filter", "none");
  await profileScrollBody.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(stickyChromeSurface).toHaveAttribute("data-active", "false");
  await expect(stickyChromeSurface).toHaveCSS("opacity", "0");
  await expect(primaryActions).toHaveCSS("opacity", "1");
  await expect(primaryActions).toHaveCSS("transform", "none");
  for (const removedFadeTestId of [
    "user-profile-header-blur-fade",
    "user-profile-hero-blur-fade",
    "user-profile-sticky-blur-fade",
  ]) {
    await expect(page.getByTestId(removedFadeTestId)).toHaveCount(0);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await profileScrollBody.evaluate((element) => {
    element.scrollTop = 24;
  });
  await expect(primaryActions).not.toHaveAttribute("aria-hidden", "true");
  await expect(primaryActions).toHaveCSS("opacity", "0.75");
  await expect(primaryActions).toHaveCSS("transform", "none");
  await profileScrollBody.evaluate((element) => {
    element.scrollTop = 48;
  });
  await expect(primaryActions).not.toHaveAttribute("aria-hidden", "true");
  await expect(primaryActions).toHaveCSS("opacity", "0.5");
  await expect(primaryActions).toHaveCSS("transform", "none");
  await profileScrollBody.evaluate((element) => {
    element.scrollTop = 96;
  });
  await expect(primaryActions).toHaveAttribute("aria-hidden", "true");
  await expect(primaryActions).toHaveCSS("opacity", "0");
  await expect(primaryActions).toHaveCSS("transform", "none");
  await profileScrollBody.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(primaryActions).not.toHaveAttribute("aria-hidden", "true");
  await expect(primaryActions).toHaveCSS("opacity", "1");
  await expect(primaryActions).toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const stickyOffsets = await page
    .getByTestId("user-profile-summary-scroll-layout")
    .evaluate((layout) => {
      const tabs = layout.querySelector<HTMLElement>(
        '[data-testid="user-profile-sticky-tabs"]',
      );
      return {
        heroHeight: Number.parseFloat(
          getComputedStyle(layout).getPropertyValue(
            "--buzz-profile-sticky-hero-height",
          ),
        ),
        tabsTop: tabs ? Number.parseFloat(getComputedStyle(tabs).top) : 0,
      };
    });
  expect(stickyOffsets.heroHeight).toBeGreaterThan(0);
  expect(stickyOffsets.tabsTop).toBeCloseTo(stickyOffsets.heroHeight, 0);
  await profileScrollBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByTestId("user-profile-primary-actions"),
  ).not.toBeInViewport();
  await expect(primaryActions).toHaveCSS("opacity", "0");
  await expect(stickyChromeSurface).toHaveAttribute("data-active", "true");
  await expect(stickyChromeSurface).toHaveCSS("opacity", "1");
  await expect(stickyChromeSurface).toHaveCSS("pointer-events", "none");
  await expect(stickyChromeSurface).not.toHaveCSS("backdrop-filter", "none");
  await expect(stickyHero).toBeInViewport();
  await expect(stickyTabs).toBeInViewport();
  const stickyChromeRects = await Promise.all(
    [profileHeader, stickyHero, stickyTabs].map((element) =>
      element.evaluate((node) => node.getBoundingClientRect().toJSON()),
    ),
  );
  expect(stickyChromeRects[1]?.top).toBeCloseTo(
    stickyChromeRects[0]?.bottom ?? 0,
    0,
  );
  expect(
    Math.abs(
      (stickyChromeRects[2]?.top ?? 0) - (stickyChromeRects[1]?.bottom ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  const stickySurfaceRect = await stickyChromeSurface.evaluate((node) =>
    node.getBoundingClientRect().toJSON(),
  );
  expect(stickySurfaceRect.top).toBeCloseTo(stickyChromeRects[0]?.top ?? 0, 0);
  expect(stickySurfaceRect.bottom).toBeCloseTo(
    stickyChromeRects[2]?.bottom ?? 0,
    0,
  );
  await profileScrollBody.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(stickyChromeSurface).toHaveAttribute("data-active", "false");
  await expect(stickyChromeSurface).toHaveCSS("opacity", "0");
  await expect(
    page.getByTestId("user-profile-panel").getByRole("heading", {
      exact: true,
      level: 2,
      name: "Info",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("user-profile-info-sections")).toHaveClass(
    /space-y-4/,
  );
  await expect(
    page.getByTestId("user-profile-tab-content-transition"),
  ).toHaveClass(/pt-2/);
  const infoSection = page.getByTestId("user-profile-info-section");
  await expect(
    infoSection.getByRole("heading", { exact: true, name: "Info" }),
  ).toHaveClass(/text-xs/);
  await expect(
    infoSection.getByRole("heading", { exact: true, name: "Info" }),
  ).toHaveClass(/text-muted-foreground\/70/);
  await expect(
    infoSection.locator('[data-slot="panel-section-header"]'),
  ).toHaveClass(/px-4/);
  await expect(
    infoSection
      .locator('[data-slot="panel-section-card"]')
      .getByRole("heading", { exact: true, name: "Info" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("user-profile-public-key")
      .locator('[data-slot="profile-field-icon"]'),
  ).toHaveCount(1);
  await expect(
    page
      .getByTestId("user-profile-managed-by")
      .locator('[data-slot="profile-field-icon"]'),
  ).toHaveCount(1);
  const managedByRow = page.getByTestId("user-profile-managed-by");
  const managedByActionIndicator = page.getByTestId(
    "user-profile-managed-by-action-indicator",
  );
  await expect(managedByActionIndicator).toHaveCSS("opacity", "0");
  await managedByRow.hover();
  await expect(managedByActionIndicator).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("user-profile-owner-avatar")).toHaveCount(0);
  await expect(
    page.getByTestId("user-profile-model-settings-section"),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("user-profile-agent-management-section")
      .locator('[data-slot="panel-section-header"]'),
  ).toHaveCount(0);
  const instructionRow = page.getByTestId("user-profile-agent-instruction-row");
  await expect(instructionRow).toContainText("Agent instructions");
  await expect(instructionRow).not.toContainText("View");
  await expect(
    instructionRow.locator('[data-slot="profile-ingress-icon"]'),
  ).toHaveCount(1);
  for (const rowTestId of [
    "user-profile-agent-instruction-row",
    "user-profile-public-key",
    "user-profile-managed-by",
  ]) {
    await expect(
      page.getByTestId(rowTestId).locator(":scope > span.rounded-full"),
    ).toHaveCount(0);
  }
  const publicKeyRow = page.getByTestId("user-profile-public-key");
  const publicKeyCopy = page.getByTestId("user-profile-public-key-copy-status");
  await expect(publicKeyCopy).toHaveCSS("opacity", "0");
  await publicKeyRow.hover();
  await expect(publicKeyCopy).toHaveCSS("opacity", "1");
  await publicKeyRow.click();
  await expect(publicKeyCopy).toHaveAttribute("data-copied", "true");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(npubEncode(agentPubkey));
  await expect(page.getByTestId("user-profile-agent-instruction")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("user-profile-edit-agent-row")).toHaveCount(0);
  await instructionRow.click();
  await expect(page.getByTestId("persona-dialog")).toBeVisible();
  await page
    .getByTestId("persona-dialog")
    .getByRole("button", {
      name: "Cancel",
    })
    .click();
  const managementRowOrder = await page
    .getByTestId("user-profile-agent-management-section")
    .locator("button[data-testid]")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-testid")),
    );
  expect(managementRowOrder).toEqual([
    "user-profile-duplicate-agent-row",
    "user-profile-export-agent-row",
    "user-profile-create-card-row",
    "user-profile-archive-agent-row",
    "user-profile-delete-agent-row",
  ]);
  for (const rowTestId of managementRowOrder) {
    const actionRow = page.getByTestId(rowTestId ?? "");
    await expect(
      actionRow.locator(":scope > svg[data-slot='profile-action-icon']"),
    ).toHaveCount(1);
    await expect(actionRow.locator(":scope > span.rounded-full")).toHaveCount(
      0,
    );
  }
  await page.getByTestId("user-profile-duplicate-agent-row").click();
  const duplicateDialog = page.getByTestId("persona-dialog");
  await expect(duplicateDialog).toBeVisible();
  await duplicateDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByTestId("user-profile-export-agent-row").click();
  const exportDialog = page.getByTestId("agent-snapshot-export-dialog");
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByTestId("user-profile-create-card-row").click();
  const cardMintDialog = page.getByTestId("agent-card-mint-dialog");
  await expect(cardMintDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cardMintDialog).toHaveCount(0);
  const archiveAgentRow = page.getByTestId("user-profile-archive-agent-row");
  await expect(archiveAgentRow).toHaveText(/Archive agent/);
  await archiveAgentRow.click();
  await expect(page.getByTestId("archive-confirm-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  const deleteAgentRow = page.getByTestId("user-profile-delete-agent-row");
  await expect(deleteAgentRow).toHaveText("Delete agent");
  await deleteAgentRow.click();
  await expect(page.getByTestId("agent-delete-confirm-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("user-profile-tab-memories")).toHaveText(
    "Memories",
  );
  await expect(page.getByTestId("user-profile-tab-runtime")).toHaveText(
    "Runtime",
  );
  await expect(page.getByTestId("user-profile-tab-channels")).toHaveText(
    "Channels",
  );
  await expect(page.getByTestId("user-profile-tab-list")).toHaveClass(
    /bg-muted/,
  );
  const actionBackground = await page
    .getByTestId("user-profile-agent-restart")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const segmentBackground = await page
    .getByTestId("user-profile-tab-list")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(actionBackground).toBe(segmentBackground);
  await expect(page.getByTestId("user-profile-tab-indicator")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  await expect(page.getByTestId("user-profile-runtime-status")).toHaveCount(0);
  await expect(page.getByTestId("user-profile-create-card")).toHaveCount(0);
  await expect(
    page.getByTestId("user-profile-model-settings-edit"),
  ).toHaveCount(0);
  await expect(page.getByTestId("agent-config-model-copy-status")).toHaveCount(
    0,
  );
  const tabContentTransition = page.getByTestId(
    "user-profile-tab-content-transition",
  );
  await expect(tabContentTransition).toHaveClass(/pt-2/);
  const tabMotionSamplesPromise = tabContentTransition.evaluate(
    (container) =>
      new Promise<Array<{ activeTab: string | undefined; x: number[] }>>(
        (resolve) => {
          const samples: Array<{
            activeTab: string | undefined;
            x: number[];
          }> = [];
          const startedAt = performance.now();
          const sample = () => {
            samples.push({
              activeTab: container.dataset.activeTab,
              x: Array.from(container.children).map((child) => {
                const transform = getComputedStyle(child).transform;
                return transform === "none"
                  ? 0
                  : new DOMMatrixReadOnly(transform).m41;
              }),
            });
            if (performance.now() - startedAt < 320) {
              requestAnimationFrame(sample);
            } else {
              resolve(samples);
            }
          };
          requestAnimationFrame(sample);
        },
      ),
  );
  await page.getByTestId("user-profile-tab-runtime").click();
  await expect(tabContentTransition).toHaveAttribute(
    "data-transition-direction",
    "forward",
  );
  const tabMotionSamples = await tabMotionSamplesPromise;
  expect(
    tabMotionSamples.some(
      (sample) => sample.activeTab === "runtime" && sample.x.some((x) => x > 1),
    ),
  ).toBe(true);
  expect(
    tabMotionSamples.some(
      (sample) =>
        sample.activeTab === "runtime" && sample.x.some((x) => x < -1),
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      tabContentTransition.evaluate((container) =>
        Array.from(container.children).every((child) => {
          const transform = getComputedStyle(child).transform;
          const x =
            transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
          return Math.abs(x) < 1;
        }),
      ),
    )
    .toBe(true);
  await expect(page.getByTestId("user-profile-tab-runtime")).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(
    page.getByTestId("user-profile-panel").getByRole("heading", {
      exact: true,
      level: 2,
      name: "Activity",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("user-profile-agent-status")
      .locator('[data-slot="profile-field-icon"]'),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("user-profile-model-settings-section"),
  ).toBeVisible();
  await expect(
    page.getByTestId("user-profile-panel").getByRole("heading", {
      exact: true,
      level: 2,
      name: "Agent configuration",
    }),
  ).toBeVisible();
  await expect(
    page.getByTestId("user-profile-agent-instruction-row"),
  ).toHaveCount(0);
  const modelEditRow = page.getByRole("button", { name: "Edit Model" });
  await expect(
    modelEditRow.locator('[data-slot="agent-config-field-icon"]'),
  ).toHaveCount(1);
  await expect(modelEditRow.locator(":scope > span.rounded-full")).toHaveCount(
    0,
  );
  const modelEditIndicator = page.getByTestId(
    "agent-config-model-edit-indicator",
  );
  await expect(modelEditIndicator).toHaveCSS("opacity", "0");
  await modelEditRow.hover();
  await expect(modelEditIndicator).toHaveCSS("opacity", "1");
  await modelEditRow.click();
  await expect(page.getByTestId("persona-dialog")).toBeVisible();
  await page
    .getByTestId("persona-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  const acpRow = page.getByTestId("user-profile-acp");
  await expect(acpRow.locator('[data-slot="profile-field-icon"]')).toHaveCount(
    1,
  );
  const acpCopy = page.getByTestId("user-profile-acp-copy-status");
  await expect(acpCopy).toHaveCSS("opacity", "0");
  await acpRow.hover();
  await expect(acpCopy).toHaveCSS("opacity", "1");
  const startOnLaunchRow = page.getByTestId("user-profile-start-on-launch");
  await expect(
    startOnLaunchRow.locator('[data-slot="profile-field-icon"]'),
  ).toHaveCount(1);
  const startOnLaunchToggle = page.getByTestId(
    "user-profile-start-on-launch-toggle",
  );
  const activitySection = page.getByTestId(
    "user-profile-runtime-activity-section",
  );
  await expect(
    activitySection.getByTestId("user-profile-agent-status"),
  ).toBeVisible();
  await expect(
    activitySection.getByTestId("user-profile-start-on-launch"),
  ).toBeVisible();
  const activityRowOrder = await activitySection
    .locator("[data-testid^='user-profile-']")
    .evaluateAll((rows) =>
      rows
        .map((row) => row.getAttribute("data-testid"))
        .filter((testId): testId is string => testId !== null),
    );
  expect(activityRowOrder.indexOf("user-profile-start-on-launch")).toBe(
    activityRowOrder.indexOf("user-profile-agent-status") + 1,
  );
  await expect(
    page
      .getByTestId("user-profile-agent-configuration-section")
      .getByTestId("user-profile-start-on-launch"),
  ).toHaveCount(0);
  await expect(startOnLaunchRow).not.toContainText("Yes");
  await expect(startOnLaunchRow).toBeChecked();
  await expect(startOnLaunchToggle).toHaveAttribute("data-state", "checked");
  await startOnLaunchRow.click();
  await expect(startOnLaunchRow).not.toBeChecked();
  await expect(startOnLaunchToggle).toHaveAttribute("data-state", "unchecked");
  await expectHashSearchParam(page, "profileTab", "runtime");
  const instancesSection = page.getByTestId("user-profile-instances-section");
  await expect(
    instancesSection.getByRole("heading", {
      exact: true,
      level: 2,
      name: "Instances",
    }),
  ).toHaveClass(/text-xs/);
  await expect(
    instancesSection
      .locator('[data-slot="panel-section-card"]')
      .getByRole("heading", { exact: true, name: "Instances" }),
  ).toHaveCount(0);
  const runtimeSectionHeaderOffsets = await Promise.all(
    [
      page.getByTestId("user-profile-runtime-activity-section"),
      page.getByTestId("user-profile-agent-configuration-section"),
      page.getByTestId("user-profile-model-settings-section"),
      instancesSection,
    ].map((section) =>
      section.evaluate((element) => {
        const header = element.querySelector(
          '[data-slot="panel-section-header"]',
        );
        const card = element.querySelector('[data-slot="panel-section-card"]');
        if (
          !(header instanceof HTMLElement) ||
          !(card instanceof HTMLElement)
        ) {
          throw new Error("Expected panel section header and card");
        }
        return (
          card.getBoundingClientRect().top - header.getBoundingClientRect().top
        );
      }),
    ),
  );
  expect(
    runtimeSectionHeaderOffsets.every(
      (offset) => Math.abs(offset - runtimeSectionHeaderOffsets[0]) <= 1,
    ),
  ).toBe(true);
  const instancesRow = page.getByTestId("user-profile-instances");
  await expect(instancesRow).toContainText("1 instance");
  await expect(instancesRow).toHaveClass(/min-h-16/);
  await instancesRow.click();
  await expect(
    page.getByTestId(`user-profile-instance-${agentPubkey}`),
  ).toContainText("Current");

  await expect(
    page.getByTestId("user-profile-settings-menu-trigger"),
  ).toHaveCount(0);

  const diagnosticsIngress = page.getByTestId(
    "user-profile-diagnostics-ingress",
  );
  await expect(
    diagnosticsIngress.locator('[data-slot="profile-ingress-icon"]'),
  ).toHaveCount(1);
  await expect(diagnosticsIngress).not.toContainText("View");
  await expect(
    diagnosticsIngress.locator("svg.lucide-chevron-right"),
  ).toBeVisible();
  await expect(diagnosticsIngress.locator("svg.lucide-chevron-up")).toHaveCount(
    0,
  );
  await diagnosticsIngress.click();
  await expectHashSearchParam(page, "profileView", "diagnostics");
  await expect(
    page.getByRole("heading", { level: 2, name: "Harness log" }),
  ).toBeVisible();
  await expect(page.getByTestId("user-profile-agent-status")).toHaveCount(0);
  await expect(page.getByTestId("managed-agent-log-content")).toBeVisible();
  await page.getByTestId("user-profile-panel-back").click();
  await expectHashSearchParam(page, "profileView", null);
  await expectHashSearchParam(page, "profileTab", "runtime");
  await expect(
    page.getByRole("heading", { level: 2, name: "Profile" }),
  ).toBeVisible();

  await page.getByTestId("user-profile-tab-info").click();
  await expect(
    page.getByTestId("user-profile-tab-content-transition"),
  ).toHaveAttribute("data-transition-direction", "backward");
  await expectHashSearchParam(page, "profileTab", null);
  await page.getByTestId(`user-profile-view-activity-${agentPubkey}`).click();
  await expect(page.getByTestId("agent-session-thread-panel")).toBeVisible();
  await page.getByTestId("agent-session-back").click();
  await expect(page.getByTestId("user-profile-panel")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Profile" }),
  ).toBeVisible();

  await page.getByTestId("user-profile-tab-channels").click();
  await expectHashSearchParam(page, "profileTab", "channels");
  await expect(
    page.getByTestId("user-profile-panel").getByRole("heading", {
      exact: true,
      level: 2,
      name: "Channels",
    }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("user-profile-channels-section")
      .locator('[data-slot="panel-section-header"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("user-profile-channels-list")).toContainText(
    "#general",
  );

  await page.getByTestId("user-profile-tab-memories").click();
  await expectHashSearchParam(page, "profileTab", "memories");
  await expect(
    page.getByTestId("user-profile-panel").getByRole("heading", {
      exact: true,
      level: 2,
      name: "Memories",
    }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("user-profile-memories-section")
      .locator('[data-slot="panel-section-header"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("agent-memory-section")).toBeVisible();
  await expect(page.getByTestId("agent-memory-list")).toContainText(
    "ui-density",
  );
  await page.goBack();
  await expectHashSearchParam(page, "profileTab", "channels");
  await expect(page.getByTestId("user-profile-channels-list")).toContainText(
    "#general",
  );
  await page.goForward();
  await expectHashSearchParam(page, "profileTab", "memories");
  await expect(page.getByTestId("agent-memory-section")).toBeVisible();
  await expect(page.getByTestId("agent-memory-truncated")).toContainText(
    "View all (9)",
  );
  await page.getByTestId("agent-memory-truncated").click();
  await expect(page.getByTestId("agent-memory-list")).toContainText("orphan");
});

test("an older agent message stays exact while persona navigation selects the live instance", async ({
  page,
}, testInfo) => {
  const personaId = "profile-parity-agent";
  const historicalPubkey = TEST_IDENTITIES.charlie.pubkey;
  const currentPubkey = "d".repeat(64);
  await installMockBridge(page, {
    agentMemory: createMockAgentMemoryListing(),
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Earlier Parity Agent",
        personaId,
        pubkey: historicalPubkey,
        status: "stopped",
      },
      {
        channelNames: ["agents"],
        name: "Current Parity Agent",
        personaId,
        pubkey: currentPubkey,
        status: "running",
      },
    ],
    oaOwnerIsMe: true,
    personas: [
      {
        displayName: "Parity Agent",
        id: personaId,
        isActive: true,
        systemPrompt: "Keep every profile entry point in sync.",
      },
    ],
  });
  await page.goto("/");

  await page.getByTestId("open-agents-view").click();
  await page.getByTestId(`persona-agent-row-${personaId}`).click();
  await expect(
    page.getByTestId("user-profile-agent-primary-action"),
  ).toHaveAttribute("aria-label", "Stop");

  await page.getByTestId("user-profile-tab-runtime").click();
  await page.getByTestId("user-profile-instances").click();
  await page.getByTestId(`user-profile-instance-${historicalPubkey}`).click();
  await expectHashSearchParam(page, "profile", historicalPubkey);
  await expectHashSearchParam(page, "profileTab", "runtime");
  await expect(
    page.getByTestId("user-profile-agent-primary-action"),
  ).toHaveAttribute("aria-label", "Start agent");
  await expect(
    page.getByTestId(`user-profile-instance-${historicalPubkey}`),
  ).toContainText("Current");

  const exactInstanceContract = await readOwnedAgentProfileContract(page);

  await page.getByTestId("auxiliary-panel-close").click();
  await page.getByTestId("channel-agents").click();
  const historicalMessage = page
    .getByTestId("message-row")
    .filter({ hasText: "Indexing the channel catalog now." });
  await expect(historicalMessage).toBeVisible();
  await historicalMessage.locator("button").first().click();
  await expect(
    page.getByTestId("user-profile-agent-primary-action"),
  ).toHaveAttribute("aria-label", "Start agent");
  const messageContract = await readOwnedAgentProfileContract(page);

  expect(messageContract).toEqual(exactInstanceContract);
  await page.getByTestId("user-profile-tab-info").click();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("historical-exact-instance.png"),
  });
});

test("restored Inbox deep link hides the back arrow", async ({ page }) => {
  // Charlie is a `bot` member of #agents and authors a seeded message there;
  // seeding a managed agent with the same pubkey makes that message's avatar
  // open a managed-agent profile panel with the Inbox ingress. Unlike an
  // agent created at runtime through the bridge, this seed survives
  // `page.reload()` because init scripts re-run on navigation.
  const agentPubkey = TEST_IDENTITIES.charlie.pubkey;
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Charlie",
        pubkey: agentPubkey,
        status: "running",
      },
    ],
  });
  await page.goto("/");

  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");

  const messageRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Indexing the channel catalog now." });
  await expect(messageRow).toBeVisible();
  await messageRow.locator("button").first().click();
  await expect(page.getByTestId("user-profile-panel")).toBeVisible();

  // Opened from the profile panel: a return target was captured, so the
  // header shows the back arrow.
  await page.getByTestId(`user-profile-view-activity-${agentPubkey}`).click();
  await expect(page.getByTestId("agent-session-thread-panel")).toBeVisible();
  await expect(page.getByTestId("agent-session-back")).toBeVisible();

  // A reload keeps the `agentSession` URL param but drops the in-memory
  // return target, so the restored panel hides the back arrow and close is
  // the only affordance — never a blind history pop.
  await page.reload();
  await expect(page.getByTestId("agent-session-thread-panel")).toBeVisible();
  await expect(page.getByTestId("agent-session-back")).toHaveCount(0);
  await expect(page.getByTestId("auxiliary-panel-close")).toBeVisible();
  await page.getByTestId("auxiliary-panel-close").click();
  await expect(page.getByTestId("agent-session-thread-panel")).toHaveCount(0);
});

test("declared owner sees runtime tab for a remote relay agent", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayAgents: [
      {
        pubkey:
          "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
        name: "nadia",
        agentType: "goose",
        capabilities: ["search", "summaries"],
        channelNames: ["agents"],
        respondTo: "anyone",
      },
    ],
  });
  await page.goto("/");

  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");

  const messageRow = page.getByTestId("message-row").filter({
    has: page.getByText("Indexing remotely for my owner."),
  });
  await expect(messageRow.first()).toBeVisible({ timeout: 5_000 });
  await messageRow.first().getByRole("button").first().click();

  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("tab", { name: "Runtime" })).toBeVisible();
  await panel.getByRole("tab", { name: "Runtime" }).click();

  await expect(panel.getByTestId("user-profile-runtime")).toContainText(
    "Runtime",
  );
  await expect(panel.getByTestId("user-profile-runtime")).toContainText(
    "Goose",
  );
  await expect(panel.getByTestId("user-profile-respond-to")).toContainText(
    "Anyone",
  );

  // Declared ownership grants read visibility only; local-management write UI
  // stays hidden because this relay agent is not in the managed-agents list.
  await expect(panel.getByText("Model")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: /Start|Stop|Deploy/ }),
  ).toHaveCount(0);
});

test("declared owner sees runtime tab without a relay-agent record", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");

  const messageRow = page.getByTestId("message-row").filter({
    has: page.getByText("Indexing remotely for my owner."),
  });
  await expect(messageRow.first()).toBeVisible({ timeout: 5_000 });
  await messageRow.first().getByRole("button").first().click();

  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId("user-profile-agent-type")).toHaveCount(0);
  await expect(panel.getByTestId("user-profile-capabilities")).toHaveCount(0);
  await expect(panel.getByRole("tab", { name: "Runtime" })).toBeVisible();
  await panel.getByRole("tab", { name: "Runtime" }).click();

  await expect(panel.getByTestId("user-profile-agent-profile")).toContainText(
    "Agent profile",
  );
  await expect(panel.getByTestId("user-profile-agent-profile")).toContainText(
    "Declared owner verified",
  );
  await expect(panel.getByTestId("user-profile-runtime")).toHaveCount(0);
  await expect(panel.getByTestId("user-profile-respond-to")).toHaveCount(0);
  await expect(panel.getByTestId("user-profile-runtime-preview")).toHaveCount(
    0,
  );
  await expect(
    panel.getByTestId("user-profile-runtime-preview-notice"),
  ).toHaveCount(0);
  await expect(panel.getByText("Harness log", { exact: true })).toHaveCount(0);

  // No relay/managed runtime record means no write or management affordance —
  // only the truthful NIP-OA profile signal is rendered in Runtime.
  await expect(panel.getByText("Model")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: /Start|Stop|Deploy/ }),
  ).toHaveCount(0);
});

test("non-owner agent profile shows only reported public agent data", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");

  const messageRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Indexing the channel catalog now." });
  await expect(messageRow).toBeVisible();
  await messageRow.locator("button").first().click();

  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("user-profile-agent-type")).toContainText(
    "codex",
  );
  await expect(panel.getByTestId("user-profile-capabilities")).toContainText(
    "code, reviews",
  );
  await expect(panel.getByRole("tab", { name: "Runtime" })).toHaveCount(0);
  await expect(panel.getByTestId("user-profile-runtime-preview")).toHaveCount(
    0,
  );
  await expect(
    panel.getByTestId("user-profile-runtime-preview-notice"),
  ).toHaveCount(0);
});

test("owned agent absent from relay/managed lists still renders agent framing", async ({
  page,
}) => {
  // Regression: bot-detection used to rely solely on the relay-agents registry
  // + the local managed-agents list. An owned agent deployed elsewhere can miss
  // BOTH lists, so the panel rendered it as a human (wrong archive framing).
  // The fix ORs in the kind:0 NIP-OA agent flag (same signal the archive gate
  // trusts), surfaced via the users-batch summary's `isAgent`.
  const ednaPubkey =
    "16aaadcf39011edbd887e4abefe5837170621db277e234f3f6c220d38ba75ecf";
  await installMockBridge(page, {
    // Seeded as an agent (kind:0 NIP-OA owner) but NOT as a managed agent and
    // NOT in the relay-agents registry — exactly the bug scenario.
    searchProfiles: [
      { pubkey: ednaPubkey, displayName: "Edna", isAgent: true },
    ],
  });
  await page.goto("/");

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await page.evaluate(
    ({ pubkey }) => {
      const emit = (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            pubkey: string;
          }) => unknown;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) {
        throw new Error("Mock message emitter is unavailable.");
      }
      emit({ channelName: "general", content: "Edna check-in", pubkey });
    },
    { pubkey: ednaPubkey },
  );

  const messageRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Edna check-in" });
  await expect(messageRow).toBeVisible();
  await messageRow.locator("button").first().click();

  await expect(page.getByTestId("user-profile-panel")).toBeVisible();
  // The bot indicator only renders when isBot resolves true — the assertion
  // that the OA-owner signal now drives agent framing.
  await expect(page.getByTestId("profile-bot-indicator")).toBeVisible();
});

test("renders the nine settings groups with one internal account bar", async ({
  page,
}) => {
  await page.goto("/");

  const inboxNavButton = page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Inbox" });
  await expect(inboxNavButton).toBeVisible();

  await openSettings(page);
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await expect(page.getByTestId("settings-back-to-app")).toBeVisible();
  await expect(page.getByTestId("settings-search")).toBeVisible();
  await expect(page.locator('[data-testid^="settings-group-"]')).toHaveCount(9);
  await expect(page.getByRole("tablist")).toHaveCount(1);
  await expect(page.getByTestId("settings-group-account")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Profile" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  for (const group of [
    "settings-group-appearance-group",
    "settings-group-preferences",
    "settings-group-business",
    "settings-group-agents-group",
    "settings-group-blocks-templates",
    "settings-group-administration",
    "settings-group-app-devices",
    "settings-group-storage-group",
  ]) {
    await expect(page.getByTestId(group)).toBeVisible();
  }

  await page.getByTestId("settings-group-appearance-group").click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  await expect(
    page.getByTestId("settings-appearance").getByRole("heading", {
      name: "Appearance",
      exact: true,
    }),
  ).toBeVisible();
  await expect(inboxNavButton).toHaveCount(0);

  await page.getByTestId("settings-back-to-app").click();
  await expectHomeView(page);
  await expect(inboxNavButton).toBeVisible();
});

test("notification settings drive the Inbox badge and desktop alerts", async ({
  page,
}) => {
  async function getAppBadgeCount() {
    return page.evaluate(() => {
      const win = window as Window & {
        __BUZZ_E2E_APP_BADGE_COUNT__?: number;
      };

      return win.__BUZZ_E2E_APP_BADGE_COUNT__ ?? 0;
    });
  }

  await page.goto("/");
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);

  await openSettings(page, "notifications");
  await expect(page.getByTestId("settings-notifications")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications & sounds" }),
  ).toBeVisible();
  await expect(
    page.getByText("Choose what deserves your attention.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("notifications-desktop-state")).toContainText(
    "On",
  );

  await page.getByTestId("settings-back-to-app").click();
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  // The dock badge sums unreadChannelIds.size + homeBadgeCount. Seeded test
  // channels may start with unreads, so capture the baseline after navigating
  // to general (which marks it read) but before injecting the mock mention.
  const baseline = await getAppBadgeCount();

  await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: {
        category: "mention" | "needs_action" | "activity" | "agent_activity";
        channel_id: string | null;
        channel_name: string;
        content: string;
        created_at: number;
        id: string;
        kind: number;
        pubkey: string;
        tags: string[][];
      }) => unknown;
    };

    win.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?.({
      category: "mention",
      channel_id: "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9",
      channel_name: "engineering",
      content: "Please review the rollout checklist.",
      created_at: Math.floor(Date.now() / 1000) + 5,
      id: `mock-feed-notification-${Date.now()}`,
      kind: 9,
      pubkey:
        "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260",
      tags: [
        ["e", "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9"],
        [
          "p",
          "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        ],
      ],
    });
  });

  await expect(page.getByTestId("sidebar-home-count")).toHaveText("1");
  await expect.poll(getAppBadgeCount).toBe(baseline + 1);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const win = window as Window & {
          __BUZZ_E2E_NOTIFICATIONS__?: Array<{
            body: string | null;
            title: string;
          }>;
        };

        return win.__BUZZ_E2E_NOTIFICATIONS__?.length ?? 0;
      }),
    )
    .toBe(1);

  const notifications = await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_NOTIFICATIONS__?: Array<{
        body: string | null;
        title: string;
      }>;
    };

    return win.__BUZZ_E2E_NOTIFICATIONS__ ?? [];
  });

  expect(notifications).toEqual([
    {
      body: "Please review the rollout checklist.",
      title: "bob mentioned you in #engineering",
    },
  ]);

  const clickedNotification = await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_CLICK_NOTIFICATION__?: (index: number) => boolean;
    };

    return win.__BUZZ_E2E_CLICK_NOTIFICATION__?.(0) ?? false;
  });
  expect(clickedNotification).toBe(true);

  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Please review the rollout checklist.",
  );

  await openSettings(page, "notifications");
  await page.getByTestId("notifications-home-badge-toggle").click();
  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);
  await expect.poll(getAppBadgeCount).toBe(baseline);

  await openSettings(page, "notifications");
  await page.getByTestId("notifications-home-badge-toggle").click();
  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("sidebar-home-count")).toHaveText("1");
  await expect.poll(getAppBadgeCount).toBe(baseline + 1);

  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Inbox" })
    .click();
  await expectHomeView(page);
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);
  await expect.poll(getAppBadgeCount).toBe(baseline);
});

test("desktop notification clicks open the matching forum thread", async ({
  page,
}) => {
  await page.goto("/");

  await openSettings(page, "notifications");
  await expect(page.getByTestId("notifications-desktop-state")).toContainText(
    "On",
  );
  await page.getByTestId("settings-back-to-app").click();
  await expectHomeView(page);

  await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: {
        category: "mention" | "needs_action" | "activity" | "agent_activity";
        channel_id: string | null;
        channel_name: string;
        content: string;
        created_at: number;
        id: string;
        kind: number;
        pubkey: string;
        tags: string[][];
      }) => unknown;
    };

    win.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?.({
      category: "mention",
      channel_id: "a27e1ee9-76a6-5bdf-a5d5-1d85610dad11",
      channel_name: "watercooler",
      content: "Release checklist: async feedback thread.",
      created_at: Math.floor(Date.now() / 1000) + 5,
      id: "mock-forum-release-thread",
      kind: 45001,
      pubkey:
        "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
      tags: [["h", "a27e1ee9-76a6-5bdf-a5d5-1d85610dad11"]],
    });
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const win = window as Window & {
          __BUZZ_E2E_NOTIFICATIONS__?: Array<{
            body: string | null;
            title: string;
          }>;
        };

        return win.__BUZZ_E2E_NOTIFICATIONS__?.length ?? 0;
      }),
    )
    .toBe(1);

  const clickedNotification = await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_CLICK_NOTIFICATION__?: (index: number) => boolean;
    };

    return win.__BUZZ_E2E_CLICK_NOTIFICATION__?.(0) ?? false;
  });
  expect(clickedNotification).toBe(true);

  await expect(page.getByTestId("chat-title")).toHaveText("watercooler");
  await expect(
    page.getByRole("button", { name: "Back to posts" }),
  ).toBeVisible();
  await expect(
    page.getByText("Release checklist: async feedback thread."),
  ).toBeVisible();
});

test("opens settings with the keyboard shortcut and applies a named theme", async ({
  page,
}) => {
  await page.goto("/");
  await expectHomeView(page);

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+," : "Control+,",
  );

  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("settings-group-account")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
  await page.getByTestId("settings-group-appearance-group").click();

  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("light")),
    )
    .toBe(true);

  await page.getByTestId("appearance-open-themes").click();
  await expect(page.getByTestId("settings-theme-catalog")).toBeVisible();
  await page.getByTestId("theme-catalog-github-light").click();
  await expect(page.getByTestId("settings-theme-preview")).toBeVisible();
  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("github-light");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+," : "Control+,",
  );
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expectHomeView(page);
});

test("supports webview zoom keyboard shortcuts", async ({ page }) => {
  await page.goto("/");
  await expectHomeView(page);

  const getTextScaleState = () =>
    page.evaluate(() => ({
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      storedScale: localStorage.getItem("buzz:text-scale"),
      webviewZoom: (window as Window & { __BUZZ_E2E_WEBVIEW_ZOOM__?: number })
        .__BUZZ_E2E_WEBVIEW_ZOOM__,
    }));
  const dispatchPrimaryShortcut = (
    key: string,
    code: string,
    shiftKey = false,
  ) =>
    page.evaluate(
      ({ code, key, shiftKey }) => {
        const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code,
            ctrlKey: !isMac,
            key,
            metaKey: isMac,
            shiftKey,
          }),
        );
      },
      { code, key, shiftKey },
    );

  await dispatchPrimaryShortcut("+", "Equal", true);

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "17.6px",
    storedScale: "1.1",
    webviewZoom: 1,
  });

  await dispatchPrimaryShortcut("-", "Minus");

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "16px",
    storedScale: null,
    webviewZoom: 1,
  });

  await dispatchPrimaryShortcut("+", "Equal", true);
  await dispatchPrimaryShortcut("+", "Equal", true);

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "19.2px",
    storedScale: "1.2",
    webviewZoom: 1,
  });

  await dispatchPrimaryShortcut("0", "Digit0");

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "16px",
    storedScale: null,
    webviewZoom: 1,
  });
});

test("storage clear resets composed font size and keyboard zoom across windows", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await openSettings(page, "appearance");
  await page.getByTestId("settings-inner-accessibility").click();
  await page
    .getByRole("group", { name: "Text size" })
    .getByRole("button", { name: "Larger", exact: true })
    .click();

  const dispatchZoomIn = () =>
    page.evaluate(() => {
      const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "Equal",
          ctrlKey: !isMac,
          key: "+",
          metaKey: isMac,
          shiftKey: true,
        }),
      );
    });

  for (let step = 0; step < 5; step += 1) {
    await dispatchZoomIn();
  }

  // Zoom scales the real root; the Font size preference layers a text-only
  // multiplier on top. Resolve the composed type rem through a rendered probe
  // so the CSS calc is actually evaluated (root px × 15/14 for "larger").
  const readTypographyState = () =>
    page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.fontSize = "var(--buzz-type-rem)";
      document.documentElement.appendChild(probe);
      const typeRemPx =
        Math.round(Number.parseFloat(getComputedStyle(probe).fontSize) * 100) /
        100;
      probe.remove();
      return {
        fontSize: document.documentElement.dataset.fontSize,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        typeRemPx,
        textScale: localStorage.getItem("buzz:text-scale"),
      };
    });

  await expect.poll(readTypographyState).toEqual({
    fontSize: "larger",
    rootFontSize: "24px",
    typeRemPx: 25.71,
    textScale: "1.5",
  });

  const peerPage = await context.newPage();
  await installMockBridge(peerPage);
  await peerPage.goto("/");
  await peerPage.evaluate(() => localStorage.clear());

  await expect.poll(readTypographyState).toEqual({
    fontSize: "default",
    rootFontSize: "16px",
    typeRemPx: 16,
    textScale: null,
  });

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+-" : "Control+-",
  );
  await expect.poll(readTypographyState).toEqual({
    fontSize: "default",
    rootFontSize: "14.4px",
    typeRemPx: 14.4,
    textScale: "0.9",
  });

  await peerPage.close();
});

test("maps agent defaults, harnesses and local behavior to their sections", async ({
  page,
}) => {
  await page.goto("/");

  await openSettings(page, "agent-defaults");

  const defaults = page.getByTestId("settings-global-agent-config");
  await expect(defaults).toBeVisible();
  await expect(
    defaults.getByRole("heading", { name: "Agent defaults" }),
  ).toBeVisible();
  await expect(
    defaults.locator('[data-slot="settings-section-card"]'),
  ).toHaveCSS("border-radius", "12px");

  await page.getByTestId("settings-inner-harnesses").click();
  const harnesses = page.getByTestId("settings-harnesses");
  await expect(harnesses).toBeVisible();
  await expect(
    harnesses.getByRole("heading", { name: "Available harnesses" }),
  ).toBeVisible();

  await page.getByTestId("settings-group-app-devices").click();
  await page.getByTestId("settings-inner-app").click();
  const appPreferences = page.getByTestId("settings-app-preferences");
  const addressedAgents = appPreferences.getByTestId(
    "settings-keep-addressed-agents",
  );
  await expect(
    addressedAgents.getByRole("switch", {
      name: "Keep addressed agents selected",
    }),
  ).toBeVisible();
  await expect(
    appPreferences.getByTestId("agents-preferences-card"),
  ).toBeVisible();
});

test("settings subtitles share the Appearance secondary color", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page, "appearance");

  const settingsView = page.getByTestId("settings-view");
  const appearancePanel = page.getByTestId("settings-appearance");
  const secondaryColor = await appearancePanel
    .locator(".ap-heading p")
    .evaluate((element) => getComputedStyle(element).color);

  for (const section of [
    "profile",
    "appearance",
    "notifications",
    "voice",
    "shortcuts",
    "custom-emoji",
    "local-archive",
    "channel-templates",
    "agents",
    "experimental",
    "mobile",
    "updates",
  ]) {
    await selectSettingsSection(page, section);
    const subtitles =
      section === "appearance"
        ? appearancePanel.locator(".ap-heading p:visible")
        : settingsView.locator("[data-settings-subcopy]:visible");
    await expect(subtitles.first()).toBeVisible();
    const colors = await subtitles.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).color),
    );
    expect(new Set(colors), `${section} subtitle colors`).toEqual(
      new Set([secondaryColor]),
    );
  }
});
