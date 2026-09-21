import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// The mock identity's own pre-seeded message in #general (authored by
// DEFAULT_MOCK_IDENTITY.pubkey in e2eBridge.ts). Editing/deleting one's own
// message is exactly Sam's workflow: "delete a message by clearing its edit."
const OWN_MESSAGE_ID = "mock-general-welcome";
const RENDERED_ORIGINAL_CONTENT = "Welcome to general";

type EmptyEditDiagnostic = {
  events: Array<{
    kind: "armed" | "mutation" | "keydown";
    alertDialogCount: number;
    editTargetCount: number;
    inputEmpty: boolean | null;
    inputTextLength: number | null;
    activeTestId: string | null;
    activeRole: string | null;
    key?: string;
    defaultPrevented?: boolean;
    isComposing?: boolean;
  }>;
  commandNames: string[];
};

// Test-only and bounded: observe the actual keyboard/DOM seam without adding
// production logging or changing the action sequence. Text is represented only
// by length and emptiness.
async function armEmptyEditDiagnostic(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    type TraceState = {
      events: EmptyEditDiagnostic["events"];
      cleanup: () => void;
    };
    type DiagnosticWindow = Window & {
      __PR13_EMPTY_EDIT_DIAGNOSTIC__?: TraceState;
    };
    const diagnosticWindow = window as DiagnosticWindow;
    diagnosticWindow.__PR13_EMPTY_EDIT_DIAGNOSTIC__?.cleanup();
    const events: EmptyEditDiagnostic["events"] = [];
    const snapshot = (
      kind: "armed" | "mutation" | "keydown",
      event?: KeyboardEvent,
    ) => {
      if (events.length >= 48) return;
      const input = document.querySelector<HTMLElement>(
        '[data-testid="message-input"]',
      );
      const active = document.activeElement as HTMLElement | null;
      const inputText = input?.textContent ?? null;
      const eventRecord: EmptyEditDiagnostic["events"][number] = {
        kind,
        alertDialogCount: document.querySelectorAll('[role="alertdialog"]')
          .length,
        editTargetCount: document.querySelectorAll(
          '[data-testid="edit-target"]',
        ).length,
        inputEmpty: inputText === null ? null : inputText.length === 0,
        inputTextLength: inputText?.length ?? null,
        activeTestId: active?.dataset.testid ?? null,
        activeRole: active?.getAttribute("role") ?? null,
      };
      if (event) {
        eventRecord.key = event.key;
        eventRecord.defaultPrevented = event.defaultPrevented;
        eventRecord.isComposing = event.isComposing;
      }
      events.push(eventRecord);
    };
    const input = document.querySelector<HTMLElement>(
      '[data-testid="message-input"]',
    );
    if (!input) throw new Error("empty-edit diagnostic input not found");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") snapshot("keydown", event);
    };
    input.addEventListener("keydown", onKeyDown);
    let lastMutationSignature: string | null = null;
    const observer = new MutationObserver(() => {
      const currentInput = document.querySelector<HTMLElement>(
        '[data-testid="message-input"]',
      );
      const inputText = currentInput?.textContent ?? null;
      const signature = [
        document.querySelectorAll('[role="alertdialog"]').length,
        document.querySelectorAll('[data-testid="edit-target"]').length,
        inputText?.length ?? -1,
        document.activeElement instanceof HTMLElement
          ? (document.activeElement.dataset.testid ?? "")
          : "",
      ].join(":");
      if (signature === lastMutationSignature) return;
      lastMutationSignature = signature;
      snapshot("mutation");
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-hidden", "data-state", "data-testid", "role"],
      childList: true,
      subtree: true,
    });
    diagnosticWindow.__PR13_EMPTY_EDIT_DIAGNOSTIC__ = {
      events,
      cleanup: () => {
        input.removeEventListener("keydown", onKeyDown);
        observer.disconnect();
      },
    };
    snapshot("armed");
  });
}

async function readEmptyEditDiagnostic(
  page: import("@playwright/test").Page,
): Promise<EmptyEditDiagnostic> {
  return page.evaluate(() => {
    type DiagnosticWindow = Window & {
      __PR13_EMPTY_EDIT_DIAGNOSTIC__?: {
        events: EmptyEditDiagnostic["events"];
        cleanup: () => void;
      };
    };
    const diagnosticWindow = window as DiagnosticWindow;
    const diagnostic = diagnosticWindow.__PR13_EMPTY_EDIT_DIAGNOSTIC__;
    diagnostic?.cleanup();
    const commands = (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
      .__BUZZ_E2E_COMMANDS__;
    return {
      events: diagnostic?.events ?? [],
      commandNames: (commands ?? []).slice(-24),
    };
  });
}

async function expectEmptyEditDialog(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
) {
  const dialog = page.getByRole("alertdialog");
  try {
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    const diagnostic = await readEmptyEditDiagnostic(page);
    await testInfo.attach("empty-edit-delete-diagnostic", {
      body: Buffer.from(JSON.stringify(diagnostic, null, 2), "utf8"),
      contentType: "application/json",
    });
    throw error;
  }
  await readEmptyEditDiagnostic(page);
  return dialog;
}

// Open the more-actions menu for a message row and wait for the menu to mount.
async function openMoreActionsMenu(
  page: import("@playwright/test").Page,
  messageId: string,
) {
  const row = page.locator(`[data-message-id="${messageId}"]`);
  await row.hover();
  await page.getByTestId(`more-actions-${messageId}`).click();
  await expect(page.locator('[role="menuitem"]').first()).toBeVisible({
    timeout: 5_000,
  });
}

// Enter edit mode for a message, clear it to empty, and submit — the gesture
// that triggers the empty-edit delete confirmation.
async function submitEmptyEdit(
  page: import("@playwright/test").Page,
  messageId: string,
) {
  await openMoreActionsMenu(page, messageId);
  await page.getByTestId(`edit-message-${messageId}`).click();
  await expect(page.getByTestId("edit-target")).toBeVisible({ timeout: 5_000 });
  // Edit mode sets the editor content via Tiptap's async transaction pipeline;
  // wait for it to populate before we clear it.
  const input = page.getByTestId("message-input");
  await expect(input).not.toBeEmpty({ timeout: 5_000 });
  await input.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect(input).toBeEmpty();
  await armEmptyEditDiagnostic(page);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
});

test("clearing an edit to empty prompts to delete, then deletes on confirm", async ({
  page,
}, testInfo) => {
  const row = page.locator(`[data-message-id="${OWN_MESSAGE_ID}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });

  await submitEmptyEdit(page, OWN_MESSAGE_ID);

  // The same "Delete message?" confirmation the Delete menu action shows — an
  // empty edit is routed through it, not silently deleted.
  const dialog = await expectEmptyEditDialog(page, testInfo);
  await expect(dialog).toContainText("Delete message?");
  // Edit mode stays active while the dialog is open — it exits only on confirm.
  await expect(page.getByTestId("edit-target")).toBeVisible();

  // Confirm → the message row is removed and edit mode has exited.
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  await expect(page.getByTestId("edit-target")).toBeHidden();
  await expect(row).toBeHidden({ timeout: 5_000 });
});

test("cancelling the empty-edit delete keeps the message", async ({
  page,
}, testInfo) => {
  const row = page.locator(`[data-message-id="${OWN_MESSAGE_ID}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });

  await submitEmptyEdit(page, OWN_MESSAGE_ID);

  const dialog = await expectEmptyEditDialog(page, testInfo);

  // Cancel → nothing is deleted, the original message survives, and the user is
  // left in edit mode (the editing session is preserved, not discarded).
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  await expect(page.getByTestId("edit-target")).toBeVisible();
  await expect(row).toBeVisible();
  await expect(page.getByTestId("message-timeline")).toContainText(
    RENDERED_ORIGINAL_CONTENT,
  );
  await expect(row.getByLabel("Open channel general")).toBeVisible();
});

test("a non-empty edit still edits and never deletes", async ({ page }) => {
  const row = page.locator(`[data-message-id="${OWN_MESSAGE_ID}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });

  await openMoreActionsMenu(page, OWN_MESSAGE_ID);
  await page.getByTestId(`edit-message-${OWN_MESSAGE_ID}`).click();
  await expect(page.getByTestId("edit-target")).toBeVisible({ timeout: 5_000 });
  const input = page.getByTestId("message-input");
  await expect(input).not.toBeEmpty({ timeout: 5_000 });
  const editedContent = `Edited, not deleted ${Date.now()}`;

  await input.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(editedContent);
  await page.keyboard.press("Enter");

  // No delete confirmation, edit mode exits, the row survives with new text.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByTestId("edit-target")).toBeHidden({ timeout: 10_000 });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("message-timeline")).toContainText(
    editedContent,
  );
  await expect(page.getByTestId("message-timeline")).not.toContainText(
    RENDERED_ORIGINAL_CONTENT,
  );
});
