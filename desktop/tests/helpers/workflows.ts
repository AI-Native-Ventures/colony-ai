import { expect, type Page } from "@playwright/test";
import { stringify as stringifyYaml } from "yaml";

import { installMockBridge } from "./bridge";
import { invokeMockCommand } from "./welcomeTeam";

export const AGENTS_CHANNEL_ID = "94a444a4-c0a3-5966-ab05-530c6ddc2301";

export async function installWorkflowAdminBridge(page: Page) {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "owner",
  });
}

export type SeededWorkflow = {
  id: string;
  revision: string;
  name: string;
  definition: Record<string, unknown>;
};

export async function seedWorkflow(
  page: Page,
  name: string,
  options: {
    channelId?: string;
    definition?: Record<string, unknown>;
  } = {},
): Promise<SeededWorkflow> {
  const channelId = options.channelId ?? AGENTS_CHANNEL_ID;
  const definition =
    options.definition ?? (await supportedDefinition(page, name, channelId));
  return invokeMockCommand<SeededWorkflow>(page, "create_workflow", {
    channelId,
    yamlDefinition: stringifyYaml(definition),
  });
}

export async function supportedDefinition(
  page: Page,
  name: string,
  channelId = AGENTS_CHANNEL_ID,
) {
  const result = await invokeMockCommand<{
    members: Array<{ is_agent: boolean; pubkey: string }>;
  }>(page, "get_channel_members", { channelId });
  const agent = result.members.find((member) => member.is_agent);
  const reviewer = result.members.find((member) => !member.is_agent);
  if (!agent || !reviewer) {
    throw new Error(
      "The workflow fixture channel needs an agent and a person.",
    );
  }

  return {
    name,
    description: "A workflow fixture for editor coverage.",
    enabled: true,
    trigger: { on: "schedule", cron: "0 6 * * 1" },
    steps: [
      {
        id: "step_1",
        action: "ask_agent",
        agent_pubkey: agent.pubkey,
        instruction: "Prepare a short status update.",
        expected_result: "A status update ready for review.",
        timeout_secs: 900,
      },
      {
        id: "step_2",
        action: "request_approval",
        from: reviewer.pubkey,
        message: "Review the status update.",
      },
    ],
  };
}

export async function openAdvancedWorkflow(page: Page, workflowId: string) {
  await page.getByTestId(`workflow-card-${workflowId}`).click();
  const builder = page.getByTestId("plain-workflow-builder");
  await expect(builder).toBeVisible();
  await builder.getByRole("button", { name: "Advanced editor" }).click();
}

export async function createPlainExample(
  page: Page,
  name: string,
  description = "Prepare a result and have someone review it.",
) {
  if (page.url().includes("#/workflows/")) {
    await page.getByRole("button", { name: "Back to workflows" }).click();
  }
  const exampleButton = page.getByRole("button", { name: "Use this example" });
  if (await exampleButton.isVisible()) {
    await exampleButton.click();
  } else {
    await page.getByRole("button", { name: "Create workflow" }).click();
    await page.getByLabel("Start with").selectOption("example");
  }
  const builder = page.getByTestId("plain-workflow-builder");
  await builder.getByLabel("Give this workflow a name").fill(name);
  await builder.getByLabel("Describe the routine").fill(description);
  await builder.getByRole("button", { name: "Continue" }).click();
  return builder;
}

export async function createPlainWorkflow(
  page: Page,
  name: string,
  description?: string,
) {
  const builder = await createPlainExample(page, name, description);
  await builder.getByRole("button", { name: "Preview a sample run" }).click();
  await builder.getByRole("button", { name: "Review activation" }).click();
  const review = builder.getByTestId("workflow-activation-review");
  await review
    .getByLabel("I have reviewed the steps, people and schedule.")
    .check();
  await review.getByRole("button", { name: "Turn on workflow" }).click();
  await expect(builder.getByTestId("plain-workflow-detail")).toBeVisible();
  const workflowId = page.url().match(/#\/workflows\/([^/?]+)/)?.[1];
  if (!workflowId)
    throw new Error("The workflow route did not open after publish.");
  return { builder, workflowId };
}
