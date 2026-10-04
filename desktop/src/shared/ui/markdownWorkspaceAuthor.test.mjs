import assert from "node:assert/strict";
import test from "node:test";
import { markdownPropsAreEqual } from "./markdownUtils.ts";

test("late agent discovery and author changes invalidate the production Markdown memo", () => {
  const prose = { content: "Read `DAY1_VIDEO_PACK.md`" };
  const agent = { ...prose, workspaceAgentPubkey: "agent-a" };
  assert.equal(markdownPropsAreEqual(prose, agent), false);
  assert.equal(markdownPropsAreEqual(agent, prose), false);
  assert.equal(
    markdownPropsAreEqual(agent, { ...agent, workspaceAgentPubkey: "agent-b" }),
    false,
  );
  assert.equal(markdownPropsAreEqual(agent, { ...agent }), true);
});
