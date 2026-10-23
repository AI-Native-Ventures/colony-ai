import { expect, test } from "@playwright/test";
import { installColony3Agents, COLONY3_AGENT_PUBKEYS } from "../helpers/colony3-agents-fixture";

test("debug", async ({ page }) => {
  await installColony3Agents(page);
  await page.goto("/#/agents");
  await expect(page.getByTestId("agent-directory")).toBeVisible();
  const out = await page.evaluate(async (aya) => {
    const w = window as typeof window & { __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (c: string, a?: unknown) => Promise<unknown> };
    const agents = (await w.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("list_managed_agents")) as Array<Record<string, unknown>>;
    const a = agents.find((x) => x.pubkey === aya);
    const rt = await w.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("discover_acp_providers", { force: false });
    return { aya: a && { model: a.model, model_source: a.model_source, persona_id: a.persona_id, runtime: a.runtime, agent_command: a.agent_command }, rt };
  }, COLONY3_AGENT_PUBKEYS.aya);
  console.log("DBG", JSON.stringify(out).slice(0, 4000));
});
