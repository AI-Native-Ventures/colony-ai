import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";

import { createWorkspaceFileService } from "../../../electron/workspace-files.mjs";

export const FILE_AGENT = "a".repeat(64);

const COMMANDS = [
  "resolve_agent_workspace_file",
  "read_agent_workspace_file",
  "list_agent_workspace_files",
];

/** A real temp workspace with a few Markdown files, owned by the caller. */
export async function createSampleWorkspace() {
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
  // Things the listing must never show.
  await writeFile(path.join(root, ".env"), "SECRET=1");
  await writeFile(path.join(root, "credentials.md"), "# not for listing");
  await writeFile(path.join(root, "logo.png"), "not text");
  return root;
}

/**
 * Answers the workspace file commands from the real Electron service over a
 * real directory, and lets every other command fall through to the mock
 * bridge. Call it BEFORE `installMockBridge`.
 */
export async function installWorkspaceFileHost(page: Page, root: string) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const service = createWorkspaceFileService({
    invoke: async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command !== "get_agent_workspace_root") {
        throw new Error(`unexpected host command ${command}`);
      }
      return root;
    },
  });
  await page.exposeFunction(
    "__FILE_HOST__",
    (command: string, args: Record<string, unknown>) =>
      command === "read_agent_workspace_file"
        ? service.read(args)
        : command === "list_agent_workspace_files"
          ? service.list(args)
          : service.resolve(args),
  );
  await page.addInitScript((commands) => {
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
          if (commands.includes(command)) return w.__FILE_HOST__(command, args);
          if (!inner) throw new Error("Mock bridge not installed");
          return inner(command, args, options);
        },
      set: (next) => {
        inner = next;
      },
    });
    w.__TAURI_INTERNALS__ = internals;
  }, COMMANDS);
  return calls;
}
