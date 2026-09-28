import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { invokeMockCommand } from "../helpers/welcomeTeam";
import {
  installWorkflowAdminBridge,
  openAdvancedWorkflow,
  seedWorkflow,
} from "../helpers/workflows";

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

async function openReadOnlyEditor(page: Page, workflowId: string) {
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

test("reaction trigger values remain visible and read-only", async ({
  page,
}) => {
  const definition = {
    name: "Reaction trigger fixture",
    enabled: true,
    trigger: { on: "reaction_added", emoji: "🚀" },
    steps: [{ id: "step_1", action: "send_message", text: "Notify" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `reaction_trigger_${Date.now()}`,
    definition,
  );
  const editor = await openReadOnlyEditor(page, workflow.id);
  const triggerNode = editor.getByRole("button", {
    name: "Trigger: Reaction added",
  });
  const pickerButton = editor.getByRole("button", {
    name: /Selected reaction emoji: 🚀/,
  });
  await expect(triggerNode).toBeDisabled();
  await expect(pickerButton).toBeDisabled();
  await expect(pickerButton).toContainText("🚀");
  await expect(
    editor.getByRole("button", { name: "Clear trigger emoji" }),
  ).toBeDisabled();
  await expect(page.locator("em-emoji-picker")).toHaveCount(0);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("legacy add-reaction steps keep their configured emoji in the disabled sequence", async ({
  page,
}) => {
  const definition = {
    name: "Reaction step fixture",
    enabled: true,
    trigger: { on: "manual" },
    steps: [{ id: "step_1", action: "add_reaction", emoji: "✅" }],
  };
  const workflow = await bootWithDefinition(
    page,
    `reaction_step_${Date.now()}`,
    definition,
  );
  const editor = await openReadOnlyEditor(page, workflow.id);
  const yaml = editor.getByRole("textbox", { name: "Workflow YAML" });
  await expect(yaml).toBeDisabled();
  await expect(yaml).toHaveValue(/action: add_reaction[\s\S]*emoji: ✅/);
  await expect(page.locator("em-emoji-picker")).toHaveCount(0);
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual(definition);
});

test("a saved reaction filter cannot be cleared from the read-only editor", async ({
  page,
}) => {
  const workflow = await bootWithDefinition(
    page,
    `reaction_filter_${Date.now()}`,
    {
      name: "Reaction filter fixture",
      enabled: true,
      trigger: { on: "reaction_added", emoji: "🚀" },
      steps: [{ id: "step_1", action: "send_message", text: "Notify" }],
    },
  );
  const editor = await openReadOnlyEditor(page, workflow.id);
  const triggerNode = editor.getByRole("button", {
    name: "Trigger: Reaction added",
  });
  const pickerButton = editor.getByRole("button", {
    name: /Selected reaction emoji: 🚀/,
  });
  await expect(triggerNode).toBeDisabled();
  await expect(pickerButton).toBeDisabled();
  await expect(pickerButton).toContainText("🚀");
  await expect(page.locator("em-emoji-picker")).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Clear trigger emoji" }),
  ).toBeDisabled();
  const after = await invokeMockCommand<{
    definition: Record<string, unknown>;
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition).toEqual({
    name: "Reaction filter fixture",
    enabled: true,
    trigger: { on: "reaction_added", emoji: "🚀" },
    steps: [{ id: "step_1", action: "send_message", text: "Notify" }],
  });
});

test("legacy shortcode values remain visible without being converted", async ({
  page,
}) => {
  const workflow = await bootWithDefinition(
    page,
    `reaction_shortcode_${Date.now()}`,
    {
      name: "Reaction shortcode fixture",
      enabled: true,
      trigger: { on: "reaction_added", emoji: "thumbsup" },
      steps: [{ id: "step_1", action: "send_message", text: "Notify" }],
    },
  );
  const editor = await openReadOnlyEditor(page, workflow.id);
  const pickerButton = editor.getByRole("button", {
    name: /Selected reaction emoji: thumbsup/,
  });
  await expect(pickerButton).toBeDisabled();
  await expect(pickerButton).toContainText("thumbsup");
  const after = await invokeMockCommand<{
    definition: { trigger: { emoji: string } };
  }>(page, "get_workflow", { workflowId: workflow.id });
  expect(after.definition.trigger.emoji).toBe("thumbsup");
});

test("a saved reaction workflow opens with its disabled selected value", async ({
  page,
}) => {
  const workflow = await bootWithDefinition(
    page,
    `saved_reaction_${Date.now()}`,
    {
      name: "Saved reaction fixture",
      enabled: true,
      trigger: { on: "reaction_added", emoji: "🚀" },
      steps: [{ id: "step_1", action: "send_message", text: "Notify" }],
    },
  );
  const editor = await openReadOnlyEditor(page, workflow.id);
  const pickerButton = editor.getByRole("button", {
    name: /Selected reaction emoji: 🚀/,
  });
  await expect(pickerButton).toBeDisabled();
  await expect(pickerButton).toContainText("🚀");
});

test("reaction controls remain within the viewport at narrow width", async ({
  page,
}) => {
  const workflow = await bootWithDefinition(
    page,
    `narrow_reaction_${Date.now()}`,
    {
      name: "Narrow reaction fixture",
      enabled: true,
      trigger: { on: "reaction_added", emoji: "🚀" },
      steps: [{ id: "step_1", action: "send_message", text: "Notify" }],
    },
  );
  const editor = await openReadOnlyEditor(page, workflow.id);
  await page.setViewportSize({ width: 800, height: 720 });
  await waitForAnimations(page);
  const pickerButton = editor.getByRole("button", {
    name: /Selected reaction emoji: 🚀/,
  });
  const box = await pickerButton.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(800);
  }
  await expect(pickerButton).toBeDisabled();
});
