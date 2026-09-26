import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const targetEventId = "b".repeat(64);
const channelId = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

test("failed enforcement keeps the report open and shows the designed failure", async ({
  page,
}) => {
  await installMockBridge(page, {
    deleteMessageError: "Permission denied.",
    relayRequiresMembership: true,
    relayRole: "owner",
  });

  let reportReads = 0;
  await page.route("**/moderation/reports**", async (route) => {
    reportReads += 1;
    await route.fulfill({
      contentType: "application/json",
      json:
        reportReads === 1
          ? [
              {
                id: "report-row-1",
                report_event_id: "report-event-1",
                reporter_pubkey: "a".repeat(64),
                target_kind: "event",
                target: targetEventId,
                channel_id: channelId,
                report_type: "spam",
                note: "Repeated unsolicited advertising",
                status: "open",
                resolved_by: null,
                resolved_at: null,
                action_id: null,
                created_at: "2026-09-26T07:00:00.000Z",
              },
            ]
          : [],
    });
  });
  await page.route("**/moderation/audit**", (route) =>
    route.fulfill({ contentType: "application/json", json: [] }),
  );

  await page.goto("/#/settings?section=moderation");

  const group = page.locator('[data-testid^="moderation-group-"]');
  await expect(group).toBeVisible();
  await group.getByTestId("moderation-resolve-trigger").click();
  await page.getByTestId("moderation-resolve-delete").click();

  const actionForm = page.getByTestId("moderation-action-form");
  await expect(actionForm).toBeVisible();
  await expect(
    actionForm.getByRole("heading", { name: "Moderation failed" }),
  ).toBeVisible();
  await expect(
    actionForm.getByText("Reported message", { exact: true }),
  ).toBeVisible();
  await expect(actionForm.getByLabel("Reason for action")).toHaveValue("");
  await expect(actionForm.getByLabel("Action", { exact: true })).toHaveValue(
    "delete",
  );

  const failure = actionForm.getByTestId("moderation-action-failed");
  await expect(failure).toContainText("Moderation action failed");
  await expect(failure).toContainText(
    "The content remains unchanged. Retry after checking your permissions.",
  );

  await actionForm
    .getByLabel("Reason for action")
    .fill("The message contains repeated advertising.");
  await actionForm.getByTestId("moderation-confirm-action").click();
  await expect(actionForm.getByLabel("Reason for action")).toHaveValue(
    "The message contains repeated advertising.",
  );
  await expect(failure).toBeVisible();
  await expect(page.getByText("Report resolved", { exact: true })).toHaveCount(
    0,
  );
  await expect.poll(() => reportReads).toBe(1);

  const actionEvidence = await page.evaluate(() => {
    const commands =
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? [];
    const sends = commands.filter(
      (entry) => entry.command === "plugin:websocket|send",
    );
    return {
      deleteMessageCalled: commands.some(
        (entry) => entry.command === "delete_message",
      ),
      resolvePublished: sends.some((entry) => {
        const message = (
          entry.payload as { message?: { data?: string } } | undefined
        )?.message?.data;
        if (!message) return false;
        try {
          const frame = JSON.parse(message) as [string, { kind?: number }];
          return frame[0] === "EVENT" && frame[1]?.kind === 9044;
        } catch {
          return false;
        }
      }),
    };
  });
  expect(actionEvidence.deleteMessageCalled).toBe(true);
  expect(actionEvidence.resolvePublished).toBe(false);
});
