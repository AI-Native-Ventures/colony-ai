import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// The relay behind "Colony" refuses this sign-in with the same text the real
// desktop backend returns when the identity is not a member.
const MEMBERSHIP_ERROR =
  "current identity is not a member of the business community";

const COLONY = {
  id: "community-colony",
  name: "Colony",
  relayUrl: "ws://localhost:3000",
  addedAt: "2026-01-01T00:00:00.000Z",
};
const COLONY_AI = {
  id: "community-colony-ai",
  name: "Colony AI",
  relayUrl: "ws://localhost:3001",
  addedAt: "2026-01-02T00:00:00.000Z",
};

// Seeds before the bridge is installed: React reads storage on mount, and the
// bridge is what triggers the mount.
async function seedCommunities(
  page: Page,
  communities: Array<Record<string, unknown>>,
  activeId: string,
) {
  await page.addInitScript(
    ({ list, active }) => {
      window.localStorage.setItem("buzz-communities", JSON.stringify(list));
      window.localStorage.setItem("buzz-active-community-id", active);
    },
    { list: communities, active: activeId },
  );
}

async function openWithFailingColony(
  page: Page,
  communities: Array<Record<string, unknown>>,
  options: { autoConnectDefaultRelay?: boolean } = {},
) {
  await seedCommunities(page, communities, COLONY.id);
  await installMockBridge(
    page,
    { applyCommunityErrorByRelayUrl: { [COLONY.relayUrl]: MEMBERSHIP_ERROR } },
    { skipCommunitySeed: true, ...options },
  );
  await page.goto("/");
  await expect(page.getByTestId("community-apply-error")).toBeVisible();
}

function readStorage(page: Page, key: string) {
  return page.evaluate((storageKey) => {
    return window.localStorage.getItem(storageKey);
  }, key);
}

test.describe("community connection error screen", () => {
  test("explains the membership error and switches to the other community by keyboard", async ({
    page,
  }) => {
    await openWithFailingColony(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");

    // Plain copy with the community name; the raw text stays in a details line.
    await expect(
      screen.getByTestId("community-apply-error-message"),
    ).toHaveText(
      "This sign-in is not a member of Colony. Switch to another community or remove this one.",
    );
    await expect(
      screen.getByTestId("community-apply-error-details"),
    ).toContainText(MEMBERSHIP_ERROR);
    await expect(screen).not.toContainText(/buzz/i);

    const switchButton = screen.getByRole("button", {
      name: "Switch to Colony AI",
    });
    const retry = screen.getByRole("button", { name: "Retry" });
    const edit = screen.getByRole("button", { name: /^Edit this community/ });
    const remove = screen.getByRole("button", {
      name: /^Remove this community from this device/,
    });

    // The switch action is the first action and holds focus on arrival.
    await expect(switchButton).toBeFocused();
    await expect(
      screen.getByRole("button", { name: "Change community" }),
    ).toHaveCount(0);

    // It sits above the destructive option, and Tab walks the actions in order.
    const switchBox = await switchButton.boundingBox();
    const removeBox = await remove.boundingBox();
    expect(switchBox).not.toBeNull();
    expect(removeBox).not.toBeNull();
    expect(switchBox?.y ?? 0).toBeLessThan(removeBox?.y ?? 0);
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(edit).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(remove).toBeFocused();

    // Edit keeps the existing overlay, which closes on Escape.
    await edit.click();
    await expect(page.getByTestId("community-change-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("community-change-overlay")).toHaveCount(0);

    await switchButton.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
    await expect(
      page.getByTestId(`community-rail-button-${COLONY_AI.id}`),
    ).toHaveAttribute("aria-current", "true");
    await expect
      .poll(() => readStorage(page, "buzz-active-community-id"))
      .toBe(COLONY_AI.id);
  });

  test("switches with the pointer and keeps Retry on the screen", async ({
    page,
  }) => {
    await openWithFailingColony(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");

    await screen.getByRole("button", { name: "Retry" }).click();
    // Retry runs the apply again; the same refusal brings the screen back.
    await expect(screen).toBeVisible();
    await expect(
      screen.getByTestId("community-apply-error-message"),
    ).toContainText("not a member of Colony");

    await screen.getByRole("button", { name: "Switch to Colony AI" }).click();
    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
    await expect(
      page.getByTestId(`community-rail-button-${COLONY_AI.id}`),
    ).toHaveAttribute("aria-current", "true");
  });

  test("removes the failing community after an inline confirm and lands on the other one", async ({
    page,
  }) => {
    await openWithFailingColony(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");
    const remove = screen.getByRole("button", {
      name: /^Remove this community from this device/,
    });

    // Space opens the inline confirm, and focus moves to the safe choice.
    await remove.focus();
    await page.keyboard.press("Space");
    const panel = screen.getByTestId("community-escape-remove-confirm-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Remove Colony from this device?");
    await expect(
      screen.getByTestId("community-escape-remove-keep"),
    ).toBeFocused();

    // Escape cancels, returns focus to the trigger, and nothing was removed.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(remove).toBeFocused();
    expect(await readStorage(page, "buzz-communities")).toContain(COLONY.id);

    // The destructive button is reachable by keyboard and confirms with Enter.
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      screen.getByTestId("community-escape-remove-confirm"),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
    await expect(
      page.getByTestId("sidebar-profile-avatar-button"),
    ).toBeVisible();
    await expect
      .poll(() => readStorage(page, "buzz-active-community-id"))
      .toBe(COLONY_AI.id);
    await expect
      .poll(async () => {
        const raw = await readStorage(page, "buzz-communities");
        return (JSON.parse(raw ?? "[]") as Array<{ id: string }>).map(
          (community) => community.id,
        );
      })
      .toEqual([COLONY_AI.id]);
  });

  test("removing the only community lands on first-run setup, not an error", async ({
    page,
  }) => {
    await openWithFailingColony(page, [COLONY], {
      autoConnectDefaultRelay: true,
    });
    const screen = page.getByTestId("community-apply-error");

    // No other community: no empty switch list, and the copy does not point at one.
    await expect(screen.getByTestId("community-escape-switch")).toHaveCount(0);
    await expect(
      screen.getByTestId("community-apply-error-message"),
    ).toHaveText(
      "This sign-in is not a member of Colony. Remove it from this device, or ask for an invitation.",
    );
    await expect(screen.getByRole("button", { name: "Retry" })).toBeFocused();

    await screen
      .getByRole("button", { name: /^Remove this community from this device/ })
      .click();
    await screen.getByTestId("community-escape-remove-confirm").click();

    await expect(page.getByText("Join or create a community")).toBeVisible();
    await expect(page.getByTestId("community-choice-join")).toBeVisible();
    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
    await expect.poll(() => readStorage(page, "buzz-communities")).toBeNull();
    // Keeps a default-relay build from reconnecting the removed community.
    await expect
      .poll(() => readStorage(page, "buzz-community-discovery-after-leave"))
      .toBe("1");
  });
});
