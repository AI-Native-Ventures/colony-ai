import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceFileService } from "../../electron/workspace-files.mjs";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const AGENT = "a".repeat(64);
const ARTIFACTS =
  process.env.COLONY_FILE_LINK_ARTIFACTS ?? "test-results/workspace-files";
const MESSAGE =
  "# Scout deliverables\n\n- Read `RESEARCH/GROKBOT_FILM_TEARDOWN_2026-09-04.md`\n- Day one: `DAY1_VIDEO_PACK.md`\n- Missing: `missing.md`\n- Host: `colony-ai.colony.ainative.ventures`\n\nUse `draft` for the next step.\n\n```js\nconst complete = true;\n```";

async function setup(page: Page) {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-e2e-files-"));
  await mkdir(path.join(root, "RESEARCH"));
  await writeFile(
    path.join(root, "RESEARCH/GROKBOT_FILM_TEARDOWN_2026-09-04.md"),
    "# Film teardown\n\n- Opening shot\n- Sound design\n\n**Read-only research**\n\n![Remote image](https://must-not-fetch.invalid/image.png)\n<script>window.fileScriptRan = true</script>",
  );
  await writeFile(
    path.join(root, "DAY1_VIDEO_PACK.md"),
    "# Day one video pack\n\n1. Record\n2. Review",
  );
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const service = createWorkspaceFileService({
    invoke: async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      expect(command).toBe("get_agent_workspace_root");
      expect(args.agentPubkey).toBe(AGENT);
      expect(typeof args.expectedRelayUrl).toBe("string");
      return root;
    },
  });
  await page.exposeFunction(
    "__FILE_HOST__",
    (command: string, args: Record<string, unknown>) =>
      command === "read_agent_workspace_file"
        ? service.read(args)
        : service.resolve(args),
  );
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __FILE_HOST__: (
        command: string,
        args: Record<string, unknown>,
      ) => Promise<unknown>;
      __TAURI_INTERNALS__?: Record<string, unknown>;
      isTauri?: boolean;
    };
    w.isTauri = true;
    const internals: Record<string, unknown> = {};
    let inner:
      | ((
          command: string,
          args: Record<string, unknown>,
          options: unknown,
        ) => unknown)
      | null = null;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get:
        () =>
        (command: string, args: Record<string, unknown>, options: unknown) => {
          if (
            [
              "resolve_agent_workspace_file",
              "read_agent_workspace_file",
            ].includes(command)
          )
            return w.__FILE_HOST__(command, args);
          if (!inner) throw new Error("Mock bridge not installed");
          return inner(command, args, options);
        },
      set: (next) => {
        inner = next;
      },
    });
    w.__TAURI_INTERNALS__ = internals;
  });
  await installMockBridge(page, {
    managedAgents: [{ pubkey: AGENT, name: "Scout", status: "running" }],
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
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
    ({ content, pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content,
        pubkey,
        createdAt: Math.floor(Date.now() / 1000),
      });
    },
    { content: MESSAGE, pubkey: AGENT },
  );
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "Scout deliverables" });
  await expect(
    row.getByRole("link", { name: "DAY1_VIDEO_PACK.md", exact: true }),
  ).toBeVisible();
  return { root, row, calls };
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`existing files open read-only Markdown, unresolved references are plain at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const { root, row, calls } = await setup(page);
    try {
      await expect(
        row.getByRole("heading", { name: "Scout deliverables" }),
      ).toBeVisible();
      await expect(row.locator("li")).toHaveCount(4);
      for (const missing of [
        "missing.md",
        "colony-ai.colony.ainative.ventures",
      ]) {
        await expect(row.getByText(missing, { exact: true })).toBeVisible();
        await expect(
          row.locator("a, code").filter({ hasText: missing }),
        ).toHaveCount(0);
      }
      await expect(
        row.locator("code").filter({ hasText: "draft" }),
      ).toBeVisible();
      await expect(
        row.locator("code").filter({ hasText: "const complete" }),
      ).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        path: `${ARTIFACTS}/${testInfo.project.name}-message-${viewport.width}.png`,
      });
      await row
        .getByRole("link", {
          name: "RESEARCH/GROKBOT_FILM_TEARDOWN_2026-09-04.md",
          exact: true,
        })
        .focus();
      await page.keyboard.press("Enter");
      const viewer = page.getByRole("dialog", {
        name: "Work area",
        exact: true,
      });
      await expect(viewer.getByRole("tab", { name: "Files" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(
        viewer.getByRole("heading", { name: "Film teardown" }),
      ).toBeVisible();
      await expect(viewer.locator("article li")).toHaveCount(2);
      await expect(
        viewer.getByText("Read-only research", { exact: true }),
      ).toBeVisible();
      await expect(
        viewer.locator("textarea, input, [contenteditable], img, script"),
      ).toHaveCount(0);
      expect(
        calls.some(
          ({ args }) => args.agentPubkey === AGENT && args.expectedRelayUrl,
        ),
      ).toBe(true);
      await waitForAnimations(page);
      await page.screenshot({
        path: `${ARTIFACTS}/${testInfo.project.name}-files-${viewport.width}.png`,
      });
      await viewer.getByRole("button", { name: "Close", exact: true }).click();
      await expect(viewer).not.toBeVisible();
      await page
        .getByTestId("channel-view-tabs")
        .getByRole("button", { name: "Files", exact: true })
        .click();
      await expect(
        viewer.getByRole("heading", { name: "Film teardown" }),
      ).toBeVisible();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("a deleted file has a recoverable error, retry reads current content", async ({
  page,
}) => {
  const { root, row } = await setup(page);
  try {
    await rm(path.join(root, "DAY1_VIDEO_PACK.md"));
    await row
      .getByRole("link", { name: "DAY1_VIDEO_PACK.md", exact: true })
      .click();
    const viewer = page.getByRole("dialog", { name: "Work area", exact: true });
    await expect(viewer.getByRole("alert")).toContainText(
      "no longer available",
    );
    await writeFile(
      path.join(root, "DAY1_VIDEO_PACK.md"),
      "# Restored file\nCurrent content",
    );
    await viewer.getByRole("button", { name: "Try again" }).click();
    await expect(
      viewer.getByRole("heading", { name: "Restored file" }),
    ).toBeVisible();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`Files can open empty, and thread file references open the same reader at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const { root, row } = await setup(page);
    try {
      await page
        .getByTestId("channel-view-tabs")
        .getByRole("button", { name: "Files", exact: true })
        .click();
      const viewer = page.getByRole("dialog", {
        name: "Work area",
        exact: true,
      });
      await expect(viewer).toContainText("Choose a file link");
      await viewer.getByRole("button", { name: "Close", exact: true }).click();
      await row.hover();
      await row.getByRole("button", { name: "Reply", exact: true }).click();
      const thread = page.getByTestId("message-thread-panel");
      await expect(thread).toBeVisible();
      await expect(
        thread.getByRole("link", { name: "DAY1_VIDEO_PACK.md", exact: true }),
      ).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        path: `${ARTIFACTS}/${testInfo.project.name}-thread-${viewport.width}.png`,
      });
      await thread
        .getByRole("link", { name: "DAY1_VIDEO_PACK.md", exact: true })
        .click();
      await expect(
        viewer.getByRole("heading", { name: "Day one video pack" }),
      ).toBeVisible();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
