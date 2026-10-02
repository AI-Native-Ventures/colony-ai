import { expect, test } from "@playwright/test";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { invokeMockCommand } from "../helpers/welcomeTeam";
import {
  AGENTS_CHANNEL_ID,
  createPlainWorkflow,
  installWorkflowAdminBridge,
  openAdvancedWorkflow,
  seedWorkflow,
} from "../helpers/workflows";

async function navigateToWorkflows(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("open-workflows-view").click();
  await expect(page).toHaveURL(/#\/workflows$/);
  await expect(page.getByTestId("workflows-view")).toBeVisible();
}

function workflowRow(page: import("@playwright/test").Page, name: string) {
  return page
    .locator('[data-testid^="workflow-card-"]')
    .filter({ hasText: name })
    .first();
}

async function openWorkflowDetail(
  page: import("@playwright/test").Page,
  name: string,
) {
  await workflowRow(page, name).click();
  await expect(page.getByTestId("plain-workflow-detail")).toBeVisible();
}

async function bootWithWorkflow(
  page: import("@playwright/test").Page,
  name: string,
  definition?: Record<string, unknown>,
) {
  await page.goto("/");
  const workflow = await seedWorkflow(page, name, { definition });
  await page.getByTestId("open-workflows-view").click();
  await expect(page.getByTestId("workflows-view")).toBeVisible();
  await expect(page.getByTestId(`workflow-card-${workflow.id}`)).toBeVisible();
  return workflow;
}

test.beforeEach(async ({ page }) => {
  await installWorkflowAdminBridge(page);
});

test("opens the designed empty workflow library and its two start paths", async ({
  page,
}) => {
  await navigateToWorkflows(page);

  await expect(
    page.getByText("Start with a familiar routine", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use this example" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start from scratch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create workflow" }),
  ).toBeVisible();
  await expect(page.locator('[data-testid^="workflow-card-"]')).toHaveCount(0);
});

test("publishes a scheduled routine without exposing cron or activation warnings", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  const name = `weekly_routine_${Date.now()}`;
  const { builder, workflowId } = await createPlainWorkflow(page, name);

  await expect(builder.getByTestId("plain-workflow-detail")).toContainText(
    "Johannesburg time",
  );
  await expect(builder.getByText(/cron|yaml|variable/i)).toHaveCount(0);
  await expect(
    page.getByTestId("workflow-activation-confirmation"),
  ).toHaveCount(0);
  const active = await invokeMockCommand<{
    definition: { trigger: { on: string; cron?: string } };
  }>(page, "get_workflow", { workflowId });
  expect(active.definition.trigger.on).toBe("schedule");
  expect(active.definition.trigger.cron).toBeTruthy();
  await builder.getByRole("button", { name: "Back to workflows" }).click();
  await expect(workflowRow(page, name)).toContainText("Active");
});

test("the normal flow uses plain schedule choices and names the updates channel", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await expect(
    builder.getByRole("heading", { name: "What would you like to happen?" }),
  ).toBeVisible();
  await builder.getByLabel("Give this workflow a name").fill("Plain routine");
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare and review a weekly update.");
  await builder.getByLabel("Start with").selectOption("blank");
  await builder.getByRole("button", { name: "Continue" }).click();
  await builder
    .getByRole("button", { name: "Change timing & updates" })
    .click();
  await expect(builder.getByLabel("Start")).toHaveValue("weekly");
  await builder
    .getByLabel("Where should updates appear?")
    .selectOption(AGENTS_CHANNEL_ID);
  await expect(builder.getByLabel("Where should updates appear?")).toHaveValue(
    AGENTS_CHANNEL_ID,
  );
  await expect(builder.getByLabel("Start").locator("option")).toHaveCount(3);
  await expect(builder.getByText(/cron|yaml|variable/i)).toHaveCount(0);
});

test("keyboard users can reorder steps at wide and narrow widths", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  await page.getByRole("button", { name: "Use this example" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await builder.getByLabel("Give this workflow a name").fill("Keyboard order");
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare a result and request review.");
  await builder.getByRole("button", { name: "Continue" }).click();
  const steps = builder.locator("main ol > li");
  await expect(steps).toHaveCount(2);

  for (const width of [760, 1280]) {
    await page.setViewportSize({ width, height: 820 });
    await builder.getByRole("button", { name: "Move step 1 down" }).focus();
    await page.keyboard.press("Enter");
    await expect(steps.nth(0)).toContainText("Review the content plan");
    await expect(steps.nth(1)).toContainText(
      "Prepare next week’s content plan",
    );
    await builder.getByRole("button", { name: "Move step 2 up" }).focus();
    await page.keyboard.press("Enter");
    await expect(steps.nth(0)).toContainText(
      "Prepare next week’s content plan",
    );
  }
});

test("requires a name before a blank workflow can move to its steps", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  await page.getByRole("button", { name: "Start from scratch" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare a result and ask for review.");
  await builder.getByRole("button", { name: "Continue" }).click();
  await expect(builder.getByRole("alert")).toContainText(
    "Give this workflow a name.",
  );
  await expect(
    builder.getByRole("heading", { name: "What would you like to happen?" }),
  ).toBeVisible();
});

test("workflow list rows retain their summary across responsive widths", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  const names = [
    "Notify reviewers when source files change",
    "Post the daily standup reminder to the team",
    "Request approval before deployment",
  ];
  for (const name of names) await createPlainWorkflow(page, name);

  for (const viewport of [
    { width: 800, height: 720, name: "narrow" },
    { width: 1024, height: 720, name: "medium" },
    { width: 1280, height: 720, name: "wide" },
  ]) {
    await page.getByRole("button", { name: "Back to workflows" }).click();
    await page.setViewportSize(viewport);
    await expect(workflowRow(page, names[0])).toContainText("2 steps");
    await expect(workflowRow(page, names[0])).toContainText("#general");
    await page.screenshot({
      animations: "disabled",
      path: `test-results/workflow-list-${viewport.name}.png`,
    });
    if (viewport.name !== "wide") {
      await workflowRow(page, names[0]).click();
      await expect(page.getByTestId("plain-workflow-detail")).toBeVisible();
    }
  }
});

test("a legacy channel-event workflow is visible in the list and read-only in Advanced", async ({
  page,
}) => {
  const workflow = await bootWithWorkflow(
    page,
    `event_workflow_${Date.now()}`,
    {
      name: "Notify reviewers when source files change",
      enabled: false,
      trigger: { on: "diff_posted" },
      steps: [
        { id: "step_1", action: "post_message", text: "Notify reviewers" },
      ],
    },
  );
  const storedBeforeOpen = await invokeMockCommand<{
    channel_id: string | null;
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(storedBeforeOpen.definition).toEqual(workflow.definition);
  await expect(page.getByTestId(`workflow-card-${workflow.id}`)).toContainText(
    workflow.name,
  );
  await openAdvancedWorkflow(page, workflow.id);
  const advanced = page.getByRole("dialog", { name: "Edit workflow" });
  await expect(advanced).toBeVisible();
  await expect(advanced.getByRole("tab", { name: "Form" })).toBeDisabled();
  await expect(advanced.getByRole("tab", { name: "YAML" })).toBeDisabled();
  await expect(
    advanced.getByTestId("workflow-dialog-primary-action"),
  ).toHaveCount(0);
  await expect(advanced.getByText(/Step 1: Post Message/)).toHaveCount(0);
  const storedAfterOpen = await invokeMockCommand<{
    channel_id: string | null;
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(storedAfterOpen).toEqual(storedBeforeOpen);
});

test("pausing and resuming a workflow happens from its plain overview", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  const name = `pause_workflow_${Date.now()}`;
  const { builder } = await createPlainWorkflow(page, name);
  await expect(builder.getByText("Active", { exact: true })).toBeVisible();
  await builder.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    builder.getByRole("heading", { name: "Pause this workflow?" }),
  ).toBeVisible();
  await builder.getByRole("button", { name: "Pause workflow" }).click();
  await expect(builder.getByText("Paused", { exact: true })).toBeVisible();
  await builder.getByRole("button", { name: "Review & turn on" }).click();
  const review = builder.getByTestId("workflow-activation-review");
  await review
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await review
    .getByRole("button", { name: /Turn on workflow|Save and turn on/ })
    .click();
  await expect(builder.getByTestId("plain-workflow-detail")).toContainText(
    "Active",
  );
});

test("a rejected pause keeps the active workflow visible with its retry path", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  const name = `pause_error_${Date.now()}`;
  const { builder } = await createPlainWorkflow(page, name);
  await builder.getByRole("button", { name: "Pause", exact: true }).click();
  await page.evaluate(() => {
    window.__BUZZ_E2E__ ??= {};
    window.__BUZZ_E2E__.mock ??= {};
    window.__BUZZ_E2E__.mock.workflowStatusError = "relay refused the update";
  });
  await builder.getByRole("button", { name: "Pause workflow" }).click();
  await expect(builder.getByRole("alert")).toContainText(
    "relay refused the update",
  );
  const activeBeforeRetry = await invokeMockCommand<{
    status: string;
  }>(page, "get_workflow", {
    workflowId: new URL(page.url()).hash.match(/workflows\/([^?]+)/)?.[1] ?? "",
  });
  expect(activeBeforeRetry.status).toBe("active");
  await page.evaluate(() => {
    if (window.__BUZZ_E2E__?.mock) {
      delete window.__BUZZ_E2E__.mock.workflowStatusError;
    }
  });
  await builder.getByRole("button", { name: "Pause workflow" }).click();
  await expect(builder.getByText("Paused", { exact: true })).toBeVisible();
});

test("a stale publish keeps the draft and the newer active version", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  const name = `stale_publish_${Date.now()}`;
  const { builder, workflowId } = await createPlainWorkflow(page, name);
  await builder.getByRole("button", { name: "Edit workflow" }).click();
  await builder
    .getByRole("button", { name: "Edit name & description" })
    .click();
  await builder
    .getByLabel("Describe the routine")
    .fill("A local draft that conflicts with a remote update.");
  await builder.getByRole("button", { name: "Continue" }).click();

  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  const current = await invokeMockCommand<{
    definition: Record<string, unknown>;
    revision: string;
  }>(page, "get_workflow", { workflowId });
  const remoteDefinition = {
    ...current.definition,
    description: "A newer active version from another editor.",
  };
  await invokeMockCommand(page, "update_workflow", {
    expectedRevision: current.revision,
    workflowId,
    yamlDefinition: JSON.stringify(remoteDefinition),
  });
  await builder.getByRole("button", { name: "Review activation" }).click();
  const review = builder.getByTestId("workflow-activation-review");
  await review
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await review.getByRole("button", { name: "Save and turn on" }).click();
  await expect(builder.getByRole("alert")).toContainText(
    "active workflow changed since it was loaded",
  );
  await expect(builder.getByRole("alert")).toContainText(
    "Your draft is still here.",
  );
  const active = await invokeMockCommand<{
    definition: { description: string };
  }>(page, "get_workflow", { workflowId });
  expect(active.definition.description).toBe(
    "A newer active version from another editor.",
  );
  const draft = await invokeMockCommand<{
    definition: { description: string };
  }>(page, "get_workflow_draft", { workflowId });
  expect(draft.definition.description).toBe(
    "A local draft that conflicts with a remote update.",
  );
});

test("the Advanced editor saves a draft without changing its active version", async ({
  page,
}) => {
  const workflow = await bootWithWorkflow(page, `advanced_draft_${Date.now()}`);
  await openAdvancedWorkflow(page, workflow.id);
  const editor = page.getByRole("dialog", { name: "Edit workflow" });
  await expect(editor).toBeVisible();
  await editor.getByRole("tab", { name: "YAML" }).click();
  const yamlEditor = editor.getByRole("textbox", { name: "Workflow YAML" });
  const definition = parseYaml(await yamlEditor.inputValue()) as Record<
    string,
    unknown
  >;
  definition.description = "Advanced editor draft retained for review.";
  await yamlEditor.fill(stringifyYaml(definition));
  await editor.getByTestId("workflow-dialog-primary-action").click();
  await expect(page).toHaveURL(new RegExp(`#\\/workflows\\/${workflow.id}`));
  await expect(page.getByTestId("plain-workflow-builder")).toBeVisible();

  const active = await invokeMockCommand<{
    definition: { description: string };
  }>(page, "get_workflow", { workflowId: workflow.id });
  const draft = await invokeMockCommand<{
    definition: { description: string };
  }>(page, "get_workflow_draft", { workflowId: workflow.id });
  expect(active.definition.description).toBe(
    "A workflow fixture for editor coverage.",
  );
  expect(draft.definition.description).toBe(
    "Advanced editor draft retained for review.",
  );
});

test("normal workflow details keep editing in the plain flow", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  const name = `normal_detail_${Date.now()}`;
  await createPlainWorkflow(page, name);
  await page.getByRole("button", { name: "Back to workflows" }).click();
  await openWorkflowDetail(page, name);
  await expect(
    page.getByRole("button", { name: "Edit workflow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Advanced editor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workflow actions" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Duplicate" })).toHaveCount(0);
});

test("the plain create route closes back to the workflows list", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  await page.getByRole("button", { name: "Create workflow" }).click();
  await expect(page).toHaveURL(/view=plain-new/);
  await page.getByRole("button", { name: "Back to workflows" }).click();
  await expect(page).toHaveURL(/#\/workflows$/);
  await page.goto("/#/workflows?view=plain-new&starting=blank");
  await expect(page.getByTestId("plain-workflow-builder")).toBeVisible();
  await page.getByRole("button", { name: "Back to workflows" }).click();
  await expect(page).toHaveURL(/#\/workflows$/);
});

test("opening a workflow row keeps its detail route and run history surface", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  const name = `detail_route_${Date.now()}`;
  await createPlainWorkflow(page, name);
  await page.getByRole("button", { name: "Back to workflows" }).click();
  await workflowRow(page, name).click();
  await expect(page).toHaveURL(/#\/workflows\/[^?]+/);
  await expect(
    page.getByTestId("plain-workflow-builder").getByRole("heading", { name }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Run history" }),
  ).toBeVisible();
  await expect(page.getByText("No runs yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workflows" })).toHaveCount(0);
});

test("missing workflow routes keep their unavailable retry and close actions", async ({
  page,
}) => {
  await navigateToWorkflows(page);
  await page.goto("/#/workflows/missing-workflow?view=edit");

  const unavailable = page.getByRole("dialog", {
    name: "Workflow unavailable",
  });
  await expect(unavailable).toBeVisible();
  await expect(
    unavailable.getByRole("button", { name: "Retry" }),
  ).toBeVisible();
  await unavailable.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/#\/workflows$/);
});
