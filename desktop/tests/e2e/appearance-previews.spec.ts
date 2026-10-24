import { expect, test, type Page } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

async function openAppearance(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("buzz-theme"))
      localStorage.setItem("buzz-theme", "buzz");
  });
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-appearance-group").click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  await waitForAnimations(page);
}

function appearanceSnapshot(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (candidate) =>
        candidate.startsWith("colony.appearance.v1:") &&
        !candidate.endsWith(":last-business") &&
        !candidate.endsWith(":global-conversations"),
    );
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  });
}

test("message size follows the shared token ramp in previews and conversations", async ({
  page,
}) => {
  await openAppearance(page);
  const baseline = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.fontSize = "var(--text-sm)";
    document.body.append(probe);
    const pixels = Number.parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return pixels;
  });
  const step = await page.evaluate(
    () =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) /
      16,
  );
  for (const [size, pixels] of [
    ["smaller", baseline - step],
    ["default", baseline],
    ["larger", baseline + step],
  ] as const) {
    await page.getByTestId("appearance-message-size").selectOption(size);
    await expect(
      page
        .getByTestId("appearance-live-preview")
        .locator(".ap-demo-message p")
        .first(),
    ).toHaveCSS("font-size", `${(pixels * 0.73).toFixed(2)}px`);
    await page.getByTestId("settings-back-to-app").click();
    await page.getByTestId("channel-general").click();
    await expect(
      page.locator('[data-testid="message-body"] .text-message').first(),
    ).toHaveCSS("font-size", `${pixels}px`);
    await openSettings(page, "appearance");
  }
  await page.getByTestId("settings-back-to-app").click();
  await page.reload();
  await expect(
    page.locator('[data-testid="message-body"] .text-message').first(),
  ).toHaveCSS("font-size", `${baseline + step}px`);
});

test("appearance exposes the approved controls and keeps conversation preferences across a reload", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("buzz.appearance.conversationDensity", "compact"),
  );
  await openAppearance(page);
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  for (const id of [
    "appearance-mode-system",
    "appearance-mode-light",
    "appearance-mode-dark",
    "appearance-field",
    "appearance-field-preset-dawn",
    "appearance-field-preset-peach",
    "appearance-field-preset-sea",
    "appearance-field-top",
    "appearance-field-middle",
    "appearance-field-bottom",
    "appearance-glass",
    "appearance-prominent",
    "appearance-message-size",
    "appearance-links-rich",
    "appearance-threads-focus",
    "appearance-reset",
  ])
    await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("appearance-density")).toHaveCount(0);
  await expect(page.getByTestId("appearance-open-themes")).toHaveCount(0);
  await page.getByTestId("appearance-message-size").selectOption("larger");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-conversation-density",
    "compact",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue(
          "--conversation-message-font-size",
        ),
      ),
    )
    .toBe("calc(var(--text-sm) + 1rem / 16)");
});

test("sidebar colours are chosen from a preset or by slot, survive reload, and reset can be undone", async ({
  page,
}) => {
  await openAppearance(page);
  const names = page.locator(
    '[data-testid^="appearance-field-"][data-testid$="-name"]',
  );
  await expect(names).toHaveText([
    "Rose · #F5A4D5",
    "Lilac · #C6B3F4",
    "Periwinkle · #94B4FA",
  ]);
  await expect(
    page.getByTestId("appearance-field-preset-dawn"),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("appearance-field-preset-peach").click();
  await expect(names).toHaveText([
    "Peach · #FFC2A6",
    "Rose · #F5A4D5",
    "Lilac · #C6B3F4",
  ]);
  await page.getByTestId("appearance-field-middle").fill("#334455");
  await expect(page.getByTestId("appearance-field-middle-name")).toHaveText(
    "#334455",
  );
  // A hand-picked trio matches no preset.
  for (const id of ["dawn", "peach", "sea"])
    await expect(
      page.getByTestId(`appearance-field-preset-${id}`),
    ).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("appearance-apply").click();
  await expect(page.getByTestId("appearance-apply-status")).toHaveText(
    "Applied",
  );
  await expect
    .poll(() => appearanceSnapshot(page))
    .toMatchObject({ field: ["#FFC2A6", "#334455", "#C6B3F4"] });
  await page.reload();
  await expect(page.getByTestId("appearance-field-middle-name")).toHaveText(
    "#334455",
  );
  await page.getByTestId("appearance-reset").click();
  await expect(
    page.getByTestId("appearance-field-preset-dawn"),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Undo reset" }).click();
  await expect(page.getByTestId("appearance-field-middle-name")).toHaveText(
    "#334455",
  );
});

test("appearance controls remain usable at a narrow desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 840, height: 900 });
  await openAppearance(page);
  await expect(page.getByTestId("appearance-density")).toHaveCount(0);
  await page.getByTestId("appearance-message-size").selectOption("larger");
  await expect(page.getByTestId("appearance-message-size")).toHaveValue(
    "larger",
  );
});

test("the person's sidebar colours survive the light/dark switch and a reload", async ({
  page,
}) => {
  const rootTop = () =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--colony-field-top"),
    );
  await openAppearance(page);
  await page.getByTestId("appearance-field-preset-peach").click();
  await page.getByTestId("appearance-apply").click();
  await expect(page.getByTestId("appearance-apply-status")).toHaveText(
    "Applied",
  );
  await expect.poll(rootTop).toBe("#FFC2A6");
  // It travels with the person's synced theme choice, like the accent does.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("buzz-community-theme.v1:"))
          .map((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.field),
      ),
    )
    .toContainEqual(["#FFC2A6", "#F5A4D5", "#C6B3F4"]);

  // Light/dark switch in the profile menu.
  await page.getByTestId("settings-back-to-app").click();
  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.getByTestId("sidebar-theme-toggle").click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz-dark");
  await expect.poll(rootTop).toBe("#FFC2A6");

  await page.reload();
  await expect.poll(rootTop).toBe("#FFC2A6");
});

test("channel preferences supersede stale Appearance conversation fields on reload and theme change", async ({
  page,
}) => {
  await openAppearance(page);
  await page.getByTestId("appearance-links-compact").click();
  await page.getByTestId("appearance-threads-split").click();
  await page.getByTestId("appearance-message-size").selectOption("larger");
  await page.evaluate(() => {
    localStorage.setItem("buzz.appearance.conversationDensity", "spacious");
    localStorage.setItem("buzz.appearance.linkPreviewStyle", "rich");
    localStorage.setItem("buzz.channels.threadViewMode", "focus");
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-conversation-density",
    "spacious",
  );
  await expect(page.getByTestId("appearance-links-rich")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("appearance-threads-focus")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("appearance-mode-dark").click();
  await expect(page.getByTestId("appearance-links-rich")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("appearance-threads-focus")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-conversation-density",
    "spacious",
  );
});

test("Appearance write failure retains the draft for retry and leaves the live theme unchanged", async ({
  page,
}) => {
  await openAppearance(page);
  const before = await appearanceSnapshot(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("colony.appearance.v1:"))
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.getByTestId("appearance-field-preset-sea").click();
  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("appearance-apply").click();
  await expect(page.getByTestId("appearance-field-preset-sea")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("settings-appearance")).toContainText(
    "Unable to save locally",
  );
  expect(await appearanceSnapshot(page)).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("buzz-theme"))).toBe(
    "buzz",
  );
  await page.getByTestId("appearance-cancel").click();
  await expect(
    page.getByTestId("appearance-field-preset-dawn"),
  ).toHaveAttribute("aria-pressed", "true");
});
