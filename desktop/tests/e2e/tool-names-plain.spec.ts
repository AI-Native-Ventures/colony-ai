import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { KIND_TYPING_INDICATOR } from "../../src/shared/constants/kinds";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

// Agents on the bundled Colony Agent runtime name their tools
// `buzz-dev-mcp__shell` and friends. The session panel showed that id, and the
// transcript live region announced "Permission requested - buzz-dev-mcp__shell".
// People now see and hear plain words; the raw command stays behind the
// expandable details.

const AGENT = TEST_IDENTITIES.alice.pubkey;
const AGENTS_CHANNEL_ID = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const SHELL_ID = "buzz-dev-mcp__shell";
const READ_FILE_ID = "buzz-dev-mcp__read_file";
const UNKNOWN_ID = "acme-crm__lookup_contact";
const COMMAND = "ls -la /tmp/colony-demo";

// Nothing a person can see or hear may carry the old name, a double
// underscore id or a server prefix.
const FORBIDDEN = /buzz|__|dev-mcp|acme-crm/i;

const proof = process.env.TOOL_NAMES_PROOF_DIR;

test.use({ viewport: { width: 1440, height: 900 } });

async function capture(page: Page, name: string) {
  if (!proof) return;
  await mkdir(proof, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: `${proof}/${name}.png` });
}

function observerEvent(seq: number, payload: Record<string, unknown>) {
  return {
    seq,
    timestamp: new Date().toISOString(),
    kind: "acp_read",
    agentIndex: 0,
    channelId: AGENTS_CHANNEL_ID,
    sessionId: "session-tools",
    turnId: "turn-tools",
    payload,
  };
}

function toolCall(
  seq: number,
  toolCallId: string,
  title: string,
  kind: string,
  rawInput: Record<string, unknown>,
) {
  return observerEvent(seq, {
    method: "session/update",
    params: {
      sessionId: "session-tools",
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title,
        kind,
        status: "completed",
        rawInput,
      },
    },
  });
}

function permissionRequest(seq: number, title: string) {
  return observerEvent(seq, {
    method: "session/request_permission",
    id: 41,
    params: {
      title,
      toolCallId: "call-shell",
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    },
  });
}

// Rendered text plus everything announced or shown on hover: title,
// aria-label, aria-description and alt on every descendant.
async function visibleTextAndNames(scope: Locator) {
  return scope.evaluate((root) => {
    const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
    const names = nodes.flatMap((node) =>
      ["title", "aria-label", "aria-description", "alt"].flatMap((attr) => {
        const value = node.getAttribute(attr);
        return value ? [value] : [];
      }),
    );
    return [
      (root as HTMLElement).innerText,
      root.textContent ?? "",
      ...names,
    ].join("\n");
  });
}

async function openSessionPanel(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");
  await expect
    .poll(() =>
      page.evaluate(
        ({ kind }) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "agents",
            kind,
          }) ?? false,
        { kind: KIND_TYPING_INDICATOR },
      ),
    )
    .toBe(true);
  await page.evaluate((pubkey) => {
    window.__BUZZ_E2E_EMIT_MOCK_TYPING__?.({ channelName: "agents", pubkey });
  }, AGENT);
  await expect(page.getByTestId("bot-activity-composer-trigger")).toBeVisible();

  await page.evaluate(
    ({ pubkey, events }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey: pubkey,
        events,
      });
    },
    {
      pubkey: AGENT,
      events: [
        toolCall(1, "call-shell", SHELL_ID, "execute", { command: COMMAND }),
        permissionRequest(2, SHELL_ID),
        toolCall(3, "call-read", READ_FILE_ID, "read", {
          path: "/tmp/colony-demo/notes.txt",
        }),
        toolCall(4, "call-unknown", UNKNOWN_ID, "other", {}),
      ],
    },
  );

  await page.getByTestId("bot-activity-composer-trigger").click();
  await page
    .getByTestId(`bot-activity-composer-item-${AGENT}`)
    .click({ force: true });
  const panel = page.getByTestId("agent-session-thread-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("agent session shows plain tool names", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
  });

  test("permission request and live region say plain words only", async ({
    page,
  }) => {
    const panel = await openSessionPanel(page);

    const permission = panel.getByTestId("transcript-permission-item").first();
    await expect(permission).toBeVisible();
    await expect(permission).toContainText("Permission requested");
    await expect(permission).toContainText("Run a command");

    // The transcript is the polite live region screen readers announce from.
    const live = panel.locator('[role="log"][aria-live="polite"]').first();
    await expect(live).toContainText("Permission requested");
    await expect(live).toContainText("Run a command");
    const announced = await live.evaluate((node) => node.textContent ?? "");
    expect(announced).not.toMatch(FORBIDDEN);

    expect(await visibleTextAndNames(permission)).not.toMatch(FORBIDDEN);
    await capture(page, "session-panel-default");
  });

  test("the whole default transcript carries no raw tool id", async ({
    page,
  }) => {
    const panel = await openSessionPanel(page);
    const live = panel.locator('[role="log"][aria-live="polite"]').first();
    await expect(live.getByTestId("transcript-permission-item")).toBeVisible();

    const toolRows = live.getByTestId("transcript-tool-item");
    await expect(toolRows.first()).toBeVisible();
    expect(await visibleTextAndNames(live)).not.toMatch(FORBIDDEN);
    expect(await live.getAttribute("aria-label")).not.toMatch(FORBIDDEN);

    // Plain wording for the call that carries a command and the unknown tool.
    await expect(live).toContainText("Running a command");
    await expect(live).toContainText("Ran a tool");
  });

  test("the raw command is still behind the expandable details", async ({
    page,
  }) => {
    const panel = await openSessionPanel(page);
    const live = panel.locator('[role="log"][aria-live="polite"]').first();
    const shellRow = live.getByTestId("transcript-tool-item").first();
    await expect(shellRow).toBeVisible();
    // Closed: the command is not rendered.
    expect(await visibleTextAndNames(shellRow)).not.toContain(COMMAND);

    await shellRow.locator("summary").click();
    await expect(shellRow).toContainText(COMMAND);
    await capture(page, "session-panel-details-open");
  });
});
