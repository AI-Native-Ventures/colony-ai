import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import {
  createSampleWorkspace,
  FILE_AGENT,
  installWorkspaceFileHost,
} from "./helpers/workspaceFileHost";

// The dock's Files tab over a real temp workspace and the real Electron file
// service: folder list, navigation, the reader, what must never be listed,
// recovery, and chat file links opening the same reader.

const dock = (page: Page) => page.getByTestId("work-area-panel");
const trigger = (page: Page) => page.getByTestId("channel-work-area-trigger");
const entry = (page: Page, name: string) =>
  dock(page).getByRole("button", { name: new RegExp(`^${name}`) });

async function boot(page: Page, root: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const calls = await installWorkspaceFileHost(page, root);
  await installMockBridge(page, {
    managedAgents: [{ pubkey: FILE_AGENT, name: "Scout", status: "running" }],
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  return calls;
}

async function emitLinkMessage(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "general",
          }) ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "Notes are in `DAY1_VIDEO_PACK.md` now.",
        pubkey,
        createdAt: Math.floor(Date.now() / 1000),
      });
    },
    { pubkey: FILE_AGENT },
  );
}

test.describe("work area Files tab", () => {
  test("lists the agent workspace, navigates folders and opens files in the reader", async ({
    page,
  }) => {
    const root = await createSampleWorkspace();
    try {
      const calls = await boot(page, root);
      await page
        .getByTestId("channel-view-tabs")
        .getByRole("button", { name: "Files", exact: true })
        .click();
      await expect(dock(page)).toBeVisible();
      await expect(
        dock(page).getByRole("tab", { name: "Files", exact: true }),
      ).toHaveAttribute("aria-selected", "true");

      // Folders first, then readable text files, with sizes.
      const list = page.getByTestId("work-area-files-list");
      await expect(list.getByRole("listitem")).toHaveText([
        /RESEARCH/,
        /DAY1_VIDEO_PACK\.md.*B/,
      ]);
      await expect(
        dock(page).getByRole("navigation", { name: "Folder path" }),
      ).toContainText("Workspace");
      // Never listed: hidden files, credential names, non-text files.
      for (const hidden of [".env", "credentials.md", "logo.png"]) {
        await expect(dock(page).getByText(hidden, { exact: true })).toHaveCount(
          0,
        );
      }
      expect(
        calls.every(({ command }) => command === "get_agent_workspace_root"),
      ).toBe(true);

      // Into a folder: breadcrumb, then back to the root by breadcrumb.
      await entry(page, "RESEARCH").click();
      const crumbs = dock(page).getByRole("navigation", {
        name: "Folder path",
      });
      await expect(crumbs.getByRole("listitem")).toHaveText([
        "Workspace",
        "/RESEARCH",
      ]);
      await expect(crumbs.locator('[aria-current="page"]')).toHaveText(
        "RESEARCH",
      );
      await expect(
        entry(page, "GROKBOT_FILM_TEARDOWN_2026-09-04\\.md"),
      ).toBeVisible();

      // Open a file: reader, read-only, with a way back to this folder.
      await entry(page, "GROKBOT_FILM_TEARDOWN_2026-09-04\\.md").click();
      await expect(
        dock(page).getByRole("heading", { name: "Film teardown" }),
      ).toBeVisible();
      await expect(
        dock(page).locator("textarea, input, [contenteditable], img, script"),
      ).toHaveCount(0);
      await page.getByTestId("work-area-files-back").click();
      await expect(
        entry(page, "GROKBOT_FILM_TEARDOWN_2026-09-04\\.md"),
      ).toBeVisible();
      await crumbs.getByRole("button", { name: "Workspace" }).click();
      await expect(entry(page, "DAY1_VIDEO_PACK\\.md")).toBeVisible();
      await expect(entry(page, "RESEARCH")).toBeVisible();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keyboard: folders and files are buttons, focus lands on the new list", async ({
    page,
  }) => {
    const root = await createSampleWorkspace();
    try {
      await boot(page, root);
      await trigger(page).click();
      await page.getByTestId("work-area-open-files").click();
      await entry(page, "RESEARCH").focus();
      await page.keyboard.press("Enter");
      await expect(
        entry(page, "GROKBOT_FILM_TEARDOWN_2026-09-04\\.md"),
      ).toBeVisible();
      // Focus is not stranded on the removed folder button.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.activeElement?.closest(
                '[data-testid="work-area-panel"]',
              ) !== null,
          ),
        )
        .toBe(true);
      // One Tab from the list lands on its first entry.
      await page.keyboard.press("Tab");
      await expect(
        entry(page, "GROKBOT_FILM_TEARDOWN_2026-09-04\\.md"),
      ).toBeFocused();
      await page.keyboard.press("Space");
      await expect(
        dock(page).getByRole("heading", { name: "Film teardown" }),
      ).toBeVisible();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a symlink out of the workspace is not listed and its folder cannot be opened", async ({
    page,
  }) => {
    const root = await createSampleWorkspace();
    const outside = path.join(os.tmpdir(), `colony-e2e-outside-${Date.now()}`);
    try {
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, "stolen.md"), "# outside");
      await symlink(outside, path.join(root, "escape-dir"));
      await symlink(
        path.join(outside, "stolen.md"),
        path.join(root, "escape.md"),
      );
      await boot(page, root);
      await trigger(page).click();
      await page.getByTestId("work-area-open-files").click();
      await expect(entry(page, "RESEARCH")).toBeVisible();
      await expect(dock(page).getByText("escape-dir")).toHaveCount(0);
      await expect(dock(page).getByText("escape.md")).toHaveCount(0);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("a folder that disappears has a recoverable error, refresh sees new files", async ({
    page,
  }) => {
    const root = await createSampleWorkspace();
    try {
      await boot(page, root);
      await trigger(page).click();
      await page.getByTestId("work-area-open-files").click();
      await entry(page, "RESEARCH").click();
      await expect(
        entry(page, "GROKBOT_FILM_TEARDOWN_2026-09-04\\.md"),
      ).toBeVisible();
      await rm(path.join(root, "RESEARCH"), { recursive: true });
      await page.getByTestId("work-area-files-refresh").click();
      await expect(dock(page).getByRole("alert")).toContainText(
        "no longer available",
      );
      await dock(page)
        .getByRole("button", { name: "Back to workspace" })
        .click();
      await expect(entry(page, "DAY1_VIDEO_PACK\\.md")).toBeVisible();
      await expect(
        dock(page).getByText("RESEARCH", { exact: true }),
      ).toHaveCount(0);
      // New work shows up on refresh.
      await writeFile(path.join(root, "NEW_NOTES.md"), "# New");
      await page.getByTestId("work-area-files-refresh").click();
      await expect(entry(page, "NEW_NOTES\\.md")).toBeVisible();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a file link in chat opens the file in the Files tab even from another tab", async ({
    page,
  }) => {
    const root = await createSampleWorkspace();
    try {
      await boot(page, root);
      await emitLinkMessage(page);
      // Start on a different tab (Canvas) with the dock open.
      await page
        .getByTestId("channel-view-tabs")
        .getByRole("button", { name: "Canvas", exact: true })
        .click();
      await expect(
        dock(page).getByRole("tab", { name: "Canvas", exact: true }),
      ).toHaveAttribute("aria-selected", "true");

      const link = page
        .getByTestId("message-row")
        .filter({ hasText: "Notes are in" })
        .getByRole("link", { name: "DAY1_VIDEO_PACK.md", exact: true });
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(
        dock(page).getByRole("tab", { name: "Files", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        dock(page).getByRole("heading", { name: "Day one video pack" }),
      ).toBeVisible();
      // Closing the dock returns focus to the link that opened it.
      await dock(page).getByRole("button", { name: "Close work area" }).click();
      await expect(dock(page)).toHaveCount(0);
      await expect(link).toBeFocused();

      // And with the dock closed, a click opens it again at the file.
      await link.click();
      await expect(
        dock(page).getByRole("heading", { name: "Day one video pack" }),
      ).toBeVisible();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("with no local agent the tab says so and invents nothing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await trigger(page).click();
    await page.getByTestId("work-area-open-files").click();
    await expect(page.getByTestId("work-area-files-no-agent")).toBeVisible();
    await expect(page.getByTestId("work-area-files-list")).toHaveCount(0);
  });
});
