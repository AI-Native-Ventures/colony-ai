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

test("appearance exposes the approved controls and named themes preserve conversation preferences", async ({
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
    "appearance-theme-default",
    "appearance-theme-custom",
    "appearance-glass",
    "appearance-prominent",
    "appearance-message-size",
    "appearance-links-rich",
    "appearance-threads-focus",
    "appearance-reset",
  ])
    await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("appearance-density")).toHaveCount(0);
  await page.getByTestId("appearance-message-size").selectOption("larger");
  await page.getByTestId("appearance-accent-violet").click();
  await page.getByTestId("appearance-open-themes").click();
  const catalog = page.getByTestId("settings-theme-catalog");
  await expect(
    catalog.getByRole("heading", { name: "Find your atmosphere." }),
  ).toBeVisible();
  await expect(catalog.locator(".d17-theme-tile")).toHaveCount(62);
  await expect(catalog.getByTestId("theme-catalog-buzz")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await catalog.getByRole("button", { name: "Light", exact: true }).click();
  await expect(catalog.getByTestId("theme-catalog-buzz-dark")).toHaveCount(0);
  await catalog
    .getByRole("searchbox", { name: "Search themes" })
    .fill("github");
  await expect(catalog.locator(".d17-theme-tile")).toHaveCount(3);
  await page.getByTestId("theme-catalog-github-light").click();
  await expect(page.getByTestId("theme-workspace-preview")).toContainText(
    "The September designs are ready for feedback.",
  );
  await expect(page.getByTestId("appearance-preview-density")).toHaveCount(0);
  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await expect
    .poll(() => appearanceSnapshot(page))
    .toMatchObject({
      theme: "github-light",
      density: "compact",
      followSystem: false,
      accent: "#895AF6",
    });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("github-light");
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
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("github-light");
});

test("theme preview cancel leaves the saved choice unchanged", async ({
  page,
}) => {
  await openAppearance(page);
  const before = await appearanceSnapshot(page);
  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await expect(page.getByTestId("theme-workspace-preview")).toContainText(
    "Campaign studio",
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");
  await page.getByRole("button", { name: "Back to themes" }).click();
  await expect(page.getByTestId("settings-theme-catalog")).toBeVisible();
  expect(await appearanceSnapshot(page)).toEqual(before);
});

test("the atomic saved theme survives failed legacy cache writes and reload", async ({
  page,
}) => {
  await openAppearance(page);
  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-github-light").click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-") && key.includes("theme"))
        throw new DOMException("Cache unavailable", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await expect
    .poll(() => appearanceSnapshot(page))
    .toMatchObject({ theme: "github-light", followSystem: false });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("github-light");
  await page.getByRole("button", { name: "Back to themes" }).click();
  await expect(page.getByTestId("theme-catalog-github-light")).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("failed theme save keeps the current theme and offers retry", async ({
  page,
}) => {
  await openAppearance(page);
  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("colony.appearance.v1:"))
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.getByTestId("theme-use").click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.getByTestId("settings-theme-preview")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");
  await expect(page.getByTestId("theme-use")).toBeEnabled();
});

test("custom colors validate, survive Default and reload, and reset can be undone", async ({
  page,
}) => {
  await openAppearance(page);
  await page.getByTestId("appearance-theme-custom").click();
  await page.getByTestId("appearance-color-hex-1").fill("#123");
  await expect(page.getByTestId("appearance-color-hex-1")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByTestId("appearance-color-hex-1").fill("#334455");
  await page.getByTestId("appearance-theme-default").click();
  await page.getByTestId("appearance-theme-custom").click();
  await expect(page.getByTestId("appearance-color-hex-1")).toHaveValue(
    "#334455",
  );
  await page.getByTestId("appearance-reset").click();
  await expect(page.getByTestId("appearance-theme-default")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Undo reset" }).click();
  await expect(page.getByTestId("appearance-theme-custom")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("appearance-apply").click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/w20-custom-appearance/);
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

test("a sidebar theme toggle supersedes an applied named theme across reload and Appearance", async ({
  page,
}) => {
  await openAppearance(page);
  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-dracula").click();
  await page.getByTestId("theme-use").click();
  await expect
    .poll(() => appearanceSnapshot(page))
    .toMatchObject({ theme: "dracula" });
  const olderSnapshot = await appearanceSnapshot(page);
  await page.getByTestId("settings-back-to-app").click();
  await page.getByTestId("sidebar-theme-toggle").click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");
  await expect
    .poll(() => appearanceSnapshot(page))
    .toMatchObject({ theme: "buzz" });
  // Simulate a failed snapshot mirror: the newer durable theme keys still win.
  await page.evaluate((snapshot) => {
    const key = Object.keys(localStorage).find(
      (candidate) =>
        candidate.startsWith("colony.appearance.v1:") &&
        !candidate.endsWith(":last-business") &&
        !candidate.endsWith(":global-conversations"),
    );
    if (!key) throw new Error("Missing Appearance snapshot");
    localStorage.setItem(key, JSON.stringify(snapshot));
  }, olderSnapshot);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");
  const outboxThemes = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("buzz-community-theme-outbox.v1:"))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.theme),
  );
  expect(outboxThemes).not.toContain("dracula");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-appearance-group").click();
  await expect(page.getByTestId("appearance-mode-light")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");
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
  await page.getByTestId("appearance-theme-custom").click();
  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("appearance-apply").click();
  await expect(page.getByTestId("appearance-theme-custom")).toHaveAttribute(
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
  await expect(page.getByTestId("appearance-theme-default")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Back to themes preserves the catalog search and filter", async ({
  page,
}) => {
  await openAppearance(page);
  await page.getByTestId("appearance-open-themes").click();
  const catalog = page.getByTestId("settings-theme-catalog");
  await catalog.getByRole("button", { name: "Light", exact: true }).click();
  await catalog
    .getByRole("searchbox", { name: "Search themes" })
    .fill("github");
  await page.getByTestId("theme-catalog-github-light").click();
  await page.getByRole("button", { name: "Back to themes" }).click();
  await expect(
    catalog.getByRole("searchbox", { name: "Search themes" }),
  ).toHaveValue("github");
  await expect(
    catalog.getByRole("button", { name: "Light", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(catalog.locator(".d17-theme-tile")).toHaveCount(3);
});

test("an unavailable unrelated theme import cannot block catalog preview or Use", async ({
  page,
}) => {
  await openAppearance(page);
  await page.route("**/assets/min-dark*.js", (route) => route.abort("failed"));
  await page.getByTestId("appearance-open-themes").click();
  await expect(page.getByTestId("settings-theme-catalog")).toHaveAttribute(
    "data-theme-catalog-ready",
    "true",
  );
  await expect(page.getByTestId("theme-catalog-min-dark")).toBeVisible();
  await page.getByTestId("theme-catalog-github-light").click();
  await expect(page.getByTestId("theme-use")).toBeEnabled();
  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await expect
    .poll(() => appearanceSnapshot(page))
    .toMatchObject({ theme: "github-light" });
});
