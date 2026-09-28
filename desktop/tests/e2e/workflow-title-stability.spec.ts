import { expect, test, type Page } from "@playwright/test";

import { invokeMockCommand } from "../helpers/welcomeTeam";
import {
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

async function seedAndOpenWorkflows(page: Page, name: string) {
  await page.goto("/");
  const workflow = await seedWorkflow(page, name);
  await page.getByTestId("open-workflows-view").click();
  await expect(page.getByTestId(`workflow-card-${workflow.id}`)).toBeVisible();
  return workflow;
}

test.beforeEach(async ({ page }) => {
  await installWorkflowAdminBridge(page);
});

test("a chosen name stays visible through steps, preview and activation review", async ({
  page,
}) => {
  const name = `weekly_name_${Date.now()}`;
  await openWorkflows(page);
  await page.getByRole("button", { name: "Use this example" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await builder.getByLabel("Give this workflow a name").fill(name);
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare a result and ask a person to review it.");
  await builder.getByRole("button", { name: "Continue" }).click();
  await expect(builder.getByRole("heading", { level: 1, name })).toBeVisible();
  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  await expect(
    builder.getByRole("heading", {
      level: 1,
      name: "Walk through a sample run",
    }),
  ).toBeVisible();
  const workflowId = await page.evaluate(() => {
    const lastSave = [...(window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [])]
      .reverse()
      .find((call) => call.command === "save_workflow_draft");
    return (
      (lastSave?.payload as { workflowId?: string } | undefined)?.workflowId ??
      ""
    );
  });
  expect(workflowId).toBeTruthy();
  const draft = await invokeMockCommand<{
    definition: { name: string };
  }>(page, "get_workflow_draft", { workflowId });
  expect(draft.definition.name).toBe(name);
  await builder.getByRole("button", { name: "Review activation" }).click();
  await expect(
    builder.getByTestId("workflow-activation-review").getByRole("heading", {
      name,
    }),
  ).toBeVisible();
});

test("a workflow rename in its draft is preserved through publish", async ({
  page,
}) => {
  const initialName = `initial_${Date.now()}`;
  const updatedName = `renamed_${Date.now()}`;
  await openWorkflows(page);
  await page.getByRole("button", { name: "Use this example" }).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await builder.getByLabel("Give this workflow a name").fill(initialName);
  await builder
    .getByLabel("Describe the routine")
    .fill("Prepare a result and ask for review.");
  await builder.getByRole("button", { name: "Continue" }).click();
  await builder
    .getByRole("button", { name: "Edit name & description" })
    .click();
  await builder.getByLabel("Give this workflow a name").fill(updatedName);
  await builder.getByRole("button", { name: "Continue" }).click();
  await expect(
    builder.getByRole("heading", { level: 1, name: updatedName }),
  ).toBeVisible();
  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  await builder.getByRole("button", { name: "Review activation" }).click();
  const review = builder.getByTestId("workflow-activation-review");
  await expect(
    review.getByRole("heading", { level: 2, name: updatedName }),
  ).toBeVisible();
  await review
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await review.getByRole("button", { name: "Turn on workflow" }).click();
  await expect(
    builder.getByRole("heading", { level: 1, name: updatedName }),
  ).toBeVisible();
});

test("the saved workflow name stays visible in Advanced form and YAML views", async ({
  page,
}) => {
  const name = `advanced_title_${Date.now()}`;
  const workflow = await seedAndOpenWorkflows(page, name);
  await openAdvancedWorkflow(page, workflow.id);
  const editor = page.getByRole("dialog", { name: "Edit workflow" });
  const nameButton = editor.getByRole("button", { name: "Edit workflow name" });
  await expect(nameButton).toBeVisible();
  await expect(editor.getByText(name, { exact: true })).toBeVisible();
  await editor.getByRole("tab", { name: "YAML" }).click();
  const yamlEditor = editor.getByRole("textbox", { name: "Workflow YAML" });
  await expect(yamlEditor).toContainText(`name: ${name}`);
  await editor.getByRole("tab", { name: "Form" }).click();
  await expect(editor.getByText(name, { exact: true })).toBeVisible();
});

test("Advanced name edits remain drafts until the user publishes them", async ({
  page,
}) => {
  const originalName = `active_name_${Date.now()}`;
  const workflow = await seedAndOpenWorkflows(page, originalName);
  await openAdvancedWorkflow(page, workflow.id);
  const editor = page.getByRole("dialog", { name: "Edit workflow" });
  await editor.getByRole("button", { name: "Edit workflow name" }).click();
  const nameInput = editor.getByRole("textbox", { name: "Workflow name" });
  const draftName = `${originalName}_draft`;
  await nameInput.fill(draftName);
  await editor.getByRole("button", { name: "Save workflow name" }).click();
  await editor.getByTestId("workflow-dialog-primary-action").click();
  const active = await invokeMockCommand<{
    name: string;
  }>(page, "get_workflow", { workflowId: workflow.id });
  const draft = await invokeMockCommand<{
    name: string;
  }>(page, "get_workflow_draft", { workflowId: workflow.id });
  expect(active.name).toBe(originalName);
  expect(draft.name).toBe(draftName);
});

test("normal workflow details keep their saved name and omit duplicate actions", async ({
  page,
}) => {
  await openWorkflows(page);
  const name = `detail_title_${Date.now()}`;
  await createPlainWorkflow(page, name);
  await page.getByRole("button", { name: "Back to workflows" }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  const detail = page.getByTestId("plain-workflow-detail");
  await expect(
    page
      .getByTestId("plain-workflow-builder")
      .getByRole("heading", { level: 1, name }),
  ).toBeVisible();
  await expect(detail).toContainText("Active");
  await expect(page.getByRole("button", { name: "Duplicate" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Workflow actions" }),
  ).toHaveCount(0);
});
