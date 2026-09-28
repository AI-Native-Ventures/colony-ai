import { expect, test, type Page } from "@playwright/test";

import { invokeMockCommand } from "../helpers/welcomeTeam";
import {
  AGENTS_CHANNEL_ID,
  createPlainWorkflow,
  installWorkflowAdminBridge,
  openAdvancedWorkflow,
  seedWorkflow,
} from "../helpers/workflows";

async function openWorkflows(page: Page) {
  await page.goto("/");
  await page.getByTestId("open-workflows-view").click();
  await expect(page.getByTestId("workflows-view")).toBeVisible();
}

async function bootWithDefinition(
  page: Page,
  name: string,
  definition: Record<string, unknown>,
) {
  await page.goto("/");
  const workflow = await seedWorkflow(page, name, { definition });
  await page.getByTestId("open-workflows-view").click();
  await expect(page.getByTestId(`workflow-card-${workflow.id}`)).toBeVisible();
  return workflow;
}

async function expectAdvancedReadOnly(page: Page, workflowId: string) {
  await openAdvancedWorkflow(page, workflowId);
  const editor = page.getByRole("dialog", { name: "Edit workflow" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("tab", { name: "Form" })).toBeDisabled();
  await expect(editor.getByRole("tab", { name: "YAML" })).toBeDisabled();
  await expect(
    editor.getByTestId("workflow-dialog-primary-action"),
  ).toHaveCount(0);
  return editor;
}

test.beforeEach(async ({ page }) => {
  await installWorkflowAdminBridge(page);
});

test("activation review requires checking the people, timing and steps", async ({
  page,
}) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "Use this example" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await builder.getByLabel("Give this workflow a name").fill("Review gate");
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare a result, then ask a person to review it.");
  await builder.getByRole("button", { name: "Continue" }).click();
  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  await builder.getByRole("button", { name: "Review activation" }).click();
  const review = builder.getByTestId("workflow-activation-review");
  const activate = review.getByRole("button", { name: "Turn on workflow" });
  await expect(activate).toBeDisabled();
  await review
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await expect(activate).toBeEnabled();
});

test("normal workflows use plain fields while an unsupported legacy template stays unchanged", async ({
  page,
}) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await expect(builder.getByLabel("Give this workflow a name")).toBeVisible();
  await expect(builder.getByLabel("Describe the routine")).toBeVisible();
  await expect(builder.getByLabel("Start with")).toBeVisible();
  await expect(builder.getByLabel("Workflow YAML")).toHaveCount(0);
  await expect(builder.getByLabel("Advanced expression")).toHaveCount(0);
  await builder.getByRole("button", { name: "Back to workflows" }).click();

  const definition = {
    name: "Legacy template workflow",
    enabled: true,
    trigger: { on: "manual" },
    steps: [
      { id: "step_1", action: "send_message", text: "Hello {{member.name}}" },
    ],
  };
  const workflow = await seedWorkflow(page, `legacy_template_${Date.now()}`, {
    definition,
  });
  await expect(page.getByTestId(`workflow-card-${workflow.id}`)).toHaveCount(0);
  const stored = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(stored.definition).toEqual(definition);
});

test("schedule choices map to the engine without showing cron", async ({
  page,
}) => {
  await openWorkflows(page);
  const name = `daily_schedule_${Date.now()}`;
  const { builder, workflowId } = await createPlainWorkflow(page, name);
  const activeBeforeTiming = await invokeMockCommand<{
    definition: { trigger: { cron: string } };
    revision: string;
  }>(page, "get_workflow", { workflowId });
  const savesBeforeTiming = await page.evaluate(
    () =>
      (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (call) => call.command === "save_workflow_draft",
      ).length,
  );
  await builder.getByRole("button", { name: "Edit workflow" }).click();
  await builder
    .getByRole("button", { name: "Change timing & updates" })
    .click();
  await builder.getByLabel("Start").selectOption("daily");
  await builder.getByLabel("Time").fill("09:15");
  await builder
    .getByLabel("Where should updates appear?")
    .selectOption(AGENTS_CHANNEL_ID);
  await builder.getByRole("button", { name: "Save timing" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
            (call) => call.command === "save_workflow_draft",
          ).length,
      ),
    )
    .toBe(savesBeforeTiming + 1);
  await expect(
    builder.getByRole("button", { name: "Preview a sample run" }),
  ).toBeVisible();
  await expect(builder.getByText(/cron|yaml/i)).toHaveCount(0);
  const savedDraft = await invokeMockCommand<{
    definition: { trigger: { cron: string } };
    channel_id: string;
  }>(page, "get_workflow_draft", { workflowId });
  expect(savedDraft.definition.trigger.cron).toBe("15 7 * * *");
  expect(savedDraft.channel_id).toBe(AGENTS_CHANNEL_ID);
  const activeBeforePublish = await invokeMockCommand<{
    revision: string;
    definition: { trigger: { cron: string } };
  }>(page, "get_workflow", { workflowId });
  expect(activeBeforePublish.revision).toBe(activeBeforeTiming.revision);
  expect(activeBeforePublish.definition.trigger.cron).toBe(
    activeBeforeTiming.definition.trigger.cron,
  );
  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  await builder.getByRole("button", { name: "Review activation" }).click();
  const review = builder.getByTestId("workflow-activation-review");
  await review
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await review.getByRole("button", { name: "Save and turn on" }).click();
  await expect(builder.getByRole("alert")).toContainText(
    "Choose people and agents who belong to the selected channel",
  );
  const stillActive = await invokeMockCommand<{
    revision: string;
  }>(page, "get_workflow", { workflowId });
  expect(stillActive.revision).toBe(activeBeforeTiming.revision);

  const channelMembers = await invokeMockCommand<{
    members: Array<{ is_agent: boolean; pubkey: string }>;
  }>(page, "get_channel_members", { channelId: AGENTS_CHANNEL_ID });
  const agent = channelMembers.members.find((member) => member.is_agent);
  const reviewer = channelMembers.members.find((member) => !member.is_agent);
  expect(agent).toBeTruthy();
  expect(reviewer).toBeTruthy();
  await builder.getByRole("button", { name: "Edit steps" }).click();
  await builder.getByRole("button", { name: "Edit step 1" }).click();
  const agentSelector = builder.getByLabel("Who is responsible?");
  const agentOptions = await agentSelector
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(agentOptions).toContain(agent?.pubkey);
  await agentSelector.selectOption(agent?.pubkey ?? "");
  await builder.getByRole("button", { name: "Save step" }).click();
  await builder.getByRole("button", { name: "Edit step 2" }).click();
  const reviewerSelector = builder.getByLabel("Who is responsible?");
  const reviewerOptions = await reviewerSelector
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(reviewerOptions).toContain(reviewer?.pubkey);
  await reviewerSelector.selectOption(reviewer?.pubkey ?? "");
  await builder.getByRole("button", { name: "Save step" }).click();
  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  await builder.getByRole("button", { name: "Review activation" }).click();
  await builder
    .getByTestId("workflow-activation-review")
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await builder
    .getByTestId("workflow-activation-review")
    .getByRole("button", { name: "Save and turn on" })
    .click();
  const active = await invokeMockCommand<{
    channel_id: string;
    definition: { trigger: { on: string; cron: string } };
    revision: string;
  }>(page, "get_workflow", { workflowId });
  expect(active.revision).not.toBe(activeBeforeTiming.revision);
  expect(active.channel_id).toBe(AGENTS_CHANNEL_ID);
  expect(active.definition.trigger).toEqual({
    on: "schedule",
    cron: "15 7 * * *",
  });
  await expect(builder.getByTestId("plain-workflow-detail")).toContainText(
    "Every day at 09:15 · Johannesburg time",
  );
});

test("custom cron schedules remain unchanged in read-only Advanced", async ({
  page,
}) => {
  const definition = {
    name: "Custom schedule workflow",
    enabled: true,
    trigger: { on: "schedule", cron: "5 9 * * 2-4" },
    steps: [{ id: "step_1", action: "send_message", text: "Review" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `custom_cron_${Date.now()}`,
    definition,
  );
  await expectAdvancedReadOnly(page, workflow.id);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("message-text conditions remain unchanged in read-only Advanced", async ({
  page,
}) => {
  const definition = {
    name: "Message condition workflow",
    enabled: true,
    trigger: {
      on: "message_posted",
      filter: 'str_contains(trigger_text, "deploy")',
    },
    steps: [{ id: "step_1", action: "send_message", text: "Review" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `message_condition_${Date.now()}`,
    definition,
  );
  await expectAdvancedReadOnly(page, workflow.id);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("webhook workflows stay unchanged in read-only Advanced", async ({
  page,
}) => {
  const definition = {
    name: "Webhook workflow",
    enabled: true,
    trigger: { on: "webhook", secret: "synthetic-webhook-secret" },
    steps: [{ id: "step_1", action: "send_message", text: "Webhook received" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `webhook_${Date.now()}`,
    definition,
  );
  await expectAdvancedReadOnly(page, workflow.id);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("workflow rows show a stable schedule, step count and channel summary", async ({
  page,
}) => {
  await openWorkflows(page);
  const name = `summary_${Date.now()}`;
  const { builder, workflowId } = await createPlainWorkflow(page, name);
  await expect(builder.getByTestId("plain-workflow-detail")).toContainText(
    "Every Monday at 08:00 · Johannesburg time",
  );
  await builder.getByRole("button", { name: "Back to workflows" }).click();
  const row = page.getByTestId(`workflow-card-${workflowId}`);
  await expect(row).toContainText("Schedule");
  await expect(row).toContainText("2 steps");
  await expect(row).toContainText("#general");
  await expect(row).toContainText("Active");
});

test("the workflow list uses a single batched workflow read", async ({
  page,
}) => {
  await page.goto("/");
  const names = [
    "Batch summary one",
    "Batch summary two",
    "Batch summary three",
  ];
  for (const name of names) await seedWorkflow(page, name);
  await page.getByTestId("open-workflows-view").click();
  for (const name of names) {
    await expect(page.getByTestId("workflows-view")).toContainText(name);
  }
  const listReads = await page.evaluate(
    () =>
      (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (call) => call.command === "get_channels_workflows",
      ).length,
  );
  expect(listReads).toBe(1);
});

test("people selectors are limited to members of the selected channel", async ({
  page,
}) => {
  await openWorkflows(page);
  const { workflowId } = await createPlainWorkflow(
    page,
    `member_selector_${Date.now()}`,
  );
  const workflow = await invokeMockCommand<{
    channel_id: string;
  }>(page, "get_workflow", { workflowId });
  const channelMembers = await invokeMockCommand<{
    members: Array<{ is_agent: boolean; pubkey: string }>;
  }>(page, "get_channel_members", { channelId: workflow.channel_id });
  await page.getByRole("button", { name: "Edit workflow" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await builder.getByRole("button", { name: "Edit step 1" }).click();
  const responsible = builder.getByLabel("Who is responsible?");
  const actualValues = await responsible
    .locator("option")
    .evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .filter(Boolean),
    );
  const agents = channelMembers.members
    .filter((member) => member.is_agent)
    .map((member) => member.pubkey);
  expect(actualValues).toEqual(agents);
  expect(agents).toContain(await responsible.inputValue());
});

test("legacy author and reaction filters remain unchanged when opened", async ({
  page,
}) => {
  const definition = {
    name: "Legacy author and reaction filters",
    enabled: true,
    trigger: {
      on: "reaction_added",
      author: "member-key",
      emoji: "🚀",
      message_id: "event-123",
    },
    steps: [{ id: "step_1", action: "add_reaction", emoji: "✅" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `legacy_author_reaction_${Date.now()}`,
    definition,
  );
  await expectAdvancedReadOnly(page, workflow.id);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("Escape leaves the plain schedule fields available without opening technical filters", async ({
  page,
}) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await builder.getByLabel("Give this workflow a name").fill("Keyboard fields");
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare a result for review.");
  await builder.getByRole("button", { name: "Continue" }).click();
  await builder
    .getByRole("button", { name: "Change timing & updates" })
    .click();
  await page.keyboard.press("Escape");
  await expect(builder.getByLabel("Start")).toBeVisible();
  await expect(builder.getByLabel("Message text")).toHaveCount(0);
  await expect(builder.getByLabel("Advanced expression")).toHaveCount(0);
});

test("author and message filters stay unchanged in read-only Advanced", async ({
  page,
}) => {
  const definition = {
    name: "Author filter workflow",
    enabled: true,
    trigger: {
      on: "message_posted",
      filter: 'author == "member" && str_contains(trigger_text, "deploy")',
    },
    steps: [{ id: "step_1", action: "send_message", text: "Review" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `author_filter_${Date.now()}`,
    definition,
  );
  await expectAdvancedReadOnly(page, workflow.id);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("schedule definitions with step conditions stay unchanged", async ({
  page,
}) => {
  const definition = {
    name: "Conditional schedule workflow",
    enabled: true,
    trigger: { on: "schedule", cron: "0 6 * * 1" },
    steps: [
      {
        id: "step_1",
        action: "send_message",
        text: "Prepare the update.",
        if: 'trigger_text == "deploy"',
      },
    ],
  };
  const workflow = await bootWithDefinition(
    page,
    `conditional_step_${Date.now()}`,
    definition,
  );
  await expectAdvancedReadOnly(page, workflow.id);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("advanced and malformed-shape definitions are not rewritten by opening the editor", async ({
  page,
}) => {
  const definition = {
    name: "Extra settings workflow",
    enabled: true,
    trigger: { on: "manual" },
    execution: { max_retries: 4 },
    steps: [{ id: "step_1", action: "send_message", text: "Keep this" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `extra_settings_${Date.now()}`,
    definition,
  );
  await expectAdvancedReadOnly(page, workflow.id);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});
