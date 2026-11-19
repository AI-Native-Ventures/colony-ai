import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHireProposal,
  formFromProposal,
  localConfigurationFromForm,
} from "./hireConfigureDraft.ts";

const HIRE_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const CHANNEL_ID = "c1d4ba1a-e078-42ef-b896-00be34a94f11";

const proposal = {
  hireId: HIRE_ID,
  rolePack: {
    personaId: "researcher",
    title: "Hospitality researcher",
    job: "Research hospitality accounts.",
    skills: ["Research"],
    tools: [{ name: "Web search", risk: "low" }],
    workerMenu: ["buzz-agent"],
  },
  displayName: "Mina",
  title: "Hospitality researcher",
  introductionChannelId: CHANNEL_ID,
  runtimeId: "buzz-agent",
  providerId: "openai",
  modelId: "gpt-5.5",
  weeklyAllowance: "8.00",
};

test("configure forms keep local setup outside the relay proposal", () => {
  const form = formFromProposal(proposal, {
    channelIds: [CHANNEL_ID],
    respondTo: "anyone",
    effortLevel: "high",
  });

  assert.deepEqual(localConfigurationFromForm(form), {
    channelIds: [CHANNEL_ID],
    respondTo: "anyone",
    effortLevel: "high",
  });
  assert.deepEqual(
    buildHireProposal(HIRE_ID, proposal.rolePack, form),
    proposal,
  );
});
