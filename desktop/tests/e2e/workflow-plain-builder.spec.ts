import { expect, test, type Page } from "@playwright/test";

import { invokeMockCommand } from "../helpers/welcomeTeam";
import { installWorkflowAdminBridge } from "../helpers/workflows";

type LoggedCommand = {
  command: string;
  payload: unknown;
};

type MockWorkflowRecord = {
  definition: {
    steps: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  revision: string;
  status: "active" | "disabled" | "archived";
};

async function readCommandLog(page: Page): Promise<LoggedCommand[]> {
  return page.evaluate(() => {
    return (
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: LoggedCommand[];
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? []
    );
  });
}

async function finishActivation(builder: ReturnType<Page["getByTestId"]>) {
  await builder.getByRole("button", { name: "Review activation" }).click();
  const review = builder.getByTestId("workflow-activation-review");
  await expect(review).toBeVisible();
  const publish = review.getByRole("button", {
    name: /Turn on workflow|Save and turn on/,
  });
  await expect(publish).toBeDisabled();
  await review
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await expect(publish).toBeEnabled();
  await publish.click();
}

test.beforeEach(async ({ page }) => {
  await installWorkflowAdminBridge(page);
});

test("creates, previews, publishes, pauses, and edits a workflow draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("open-workflows-view").click();
  await expect(page.getByTestId("workflows-view")).toBeVisible();
  await page.getByRole("button", { name: "Use this example" }).click();

  const builder = page.getByTestId("plain-workflow-builder");
  await expect(
    builder.getByRole("heading", {
      name: "What would you like to happen?",
    }),
  ).toBeVisible();
  await expect(builder.getByLabel("Start with")).toHaveValue("example");

  const workflowName = `weekly_plan_${Date.now()}`;
  await builder.getByLabel("Give this workflow a name").fill(workflowName);
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare a content plan and have a channel member review it.");
  await builder.getByRole("button", { name: "Continue" }).click();

  const stepRows = builder.locator("main ol > li");
  await expect(stepRows).toHaveCount(2);
  await expect(stepRows.nth(0)).toContainText(
    "Prepare next week’s content plan",
  );
  await expect(stepRows.nth(1)).toContainText("Review the content plan");
  await expect(
    builder.getByRole("button", { name: /^View .+ profile$/ }),
  ).toHaveCount(2);
  await expect(stepRows.nth(0)).toContainText("AI agent");
  await expect(stepRows.nth(1)).toContainText("Human");

  const firstStepDown = builder.getByRole("button", {
    name: "Move step 1 down",
  });
  await firstStepDown.focus();
  await page.keyboard.press("Enter");
  await expect(stepRows.nth(0)).toContainText("Review the content plan");
  await expect(stepRows.nth(1)).toContainText(
    "Prepare next week’s content plan",
  );

  await builder.getByRole("button", { name: "Edit step 2" }).click();
  await builder
    .getByLabel("What should they do?")
    .fill("Prepare the updated weekly content plan.");
  await builder.getByRole("button", { name: "Save step" }).click();
  await expect(stepRows.nth(1)).toContainText(
    "Prepare the updated weekly content plan.",
  );

  await builder.getByRole("button", { name: "Add a step" }).click();
  await builder.getByLabel("Step name").fill("Check the final plan");
  await builder
    .getByLabel("What should they do?")
    .fill("Check that the plan is ready for review.");
  await builder
    .getByLabel("What should be ready when they finish?")
    .fill("A final content plan.");
  await builder.getByRole("button", { name: "Save step" }).click();
  await expect(stepRows).toHaveCount(3);

  await builder.getByRole("button", { name: "Remove step 3" }).click();
  await expect(
    builder.getByRole("heading", { name: "Remove this step?" }),
  ).toBeVisible();
  await expect(builder).toContainText(
    "Only the draft changes. You can add a step again before activating.",
  );
  await builder.getByRole("button", { name: "Remove step" }).click();
  await expect(stepRows).toHaveCount(2);
  await expect(
    builder.getByRole("button", { name: "Remove step 3" }),
  ).toHaveCount(0);

  const commandsBeforePreview = await readCommandLog(page);
  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  const preview = builder.getByTestId("workflow-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(
    "Preview only. No messages, approvals, agent requests or webhooks are sent.",
  );
  await expect(preview).toContainText(
    "Changes requested: no revision action is currently supported",
  );
  await expect(preview).toContainText("Step failure: stop the run as failed");
  await expect(preview).toContainText(
    "No reply before timeout: stop the run as timed out",
  );

  const commandsAfterPreview = await readCommandLog(page);
  const previewCommands = commandsAfterPreview.slice(
    commandsBeforePreview.length,
  );
  expect(
    previewCommands.some(({ command }) => command === "preview_workflow"),
  ).toBe(true);
  const sideEffectCommands = new Set([
    "create_workflow",
    "publish_workflow_draft",
    "trigger_workflow",
    "send_channel_message",
    "send_dm",
    "request_approval",
    "send_webhook",
  ]);
  expect(
    previewCommands.filter(({ command }) => sideEffectCommands.has(command)),
  ).toEqual([]);

  await finishActivation(builder);
  const detail = page.getByTestId("plain-workflow-detail");
  await expect(
    builder.getByRole("heading", { name: workflowName }),
  ).toBeVisible();
  await expect(detail.getByText("Active", { exact: true })).toBeVisible();
  const workflowIdMatch = page.url().match(/#\/workflows\/([^/?]+)/);
  expect(workflowIdMatch?.[1]).toBeTruthy();
  const workflowId = workflowIdMatch?.[1] ?? "";
  const activeBeforeEdit = await invokeMockCommand<MockWorkflowRecord>(
    page,
    "get_workflow",
    { workflowId },
  );
  const activeRevision = activeBeforeEdit.revision;
  const activeInstruction = String(
    activeBeforeEdit.definition.steps[1].instruction,
  );

  await detail.getByRole("button", { name: "Pause" }).click();
  await expect(
    builder.getByRole("heading", { name: "Pause this workflow?" }),
  ).toBeVisible();
  await builder.getByRole("button", { name: "Pause workflow" }).click();
  await expect(detail.getByText("Paused", { exact: true })).toBeVisible();
  const paused = await invokeMockCommand<MockWorkflowRecord>(
    page,
    "get_workflow",
    { workflowId },
  );
  expect(paused.revision).toBe(activeRevision);
  expect(paused.status).toBe("disabled");

  await detail.getByRole("button", { name: "Edit workflow" }).click();
  await builder.getByRole("button", { name: "Edit step 2" }).click();
  await builder
    .getByLabel("What should they do?")
    .fill("Prepare a revised content plan for review.");
  await builder.getByRole("button", { name: "Save step" }).click();
  await expect(builder).toContainText("The active version stays in place");

  const activeAfterDraftSave = await invokeMockCommand<MockWorkflowRecord>(
    page,
    "get_workflow",
    { workflowId },
  );
  expect(activeAfterDraftSave.revision).toBe(activeRevision);
  expect(activeAfterDraftSave.definition.steps[1].instruction).toBe(
    activeInstruction,
  );
  const savedDraft = await invokeMockCommand<{
    definition: { steps: Array<Record<string, unknown>> };
  } | null>(page, "get_workflow_draft", { workflowId });
  expect(savedDraft?.definition.steps[1].instruction).toBe(
    "Prepare a revised content plan for review.",
  );

  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  await finishActivation(builder);
  const activeAfterPublish = await invokeMockCommand<MockWorkflowRecord>(
    page,
    "get_workflow",
    { workflowId },
  );
  expect(activeAfterPublish.revision).not.toBe(activeRevision);
  expect(activeAfterPublish.definition.steps[1].instruction).toBe(
    "Prepare a revised content plan for review.",
  );
});
