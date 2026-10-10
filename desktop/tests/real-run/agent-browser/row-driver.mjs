import assert from "node:assert/strict";
import { judgeRow } from "./rows.mjs";

/**
 * Drive visible controls in a genuinely packaged, managed FAKE session.
 * The coordinator supplies its sandboxed app page and relay-backed managed
 * session adapter. No direct broker call or renderer-state seeding is used.
 * sendTask posts a real relay message; observe reads that session's results,
 * grant transitions and redacted log, never synthesizes a tool result.
 */
export async function drivePackagedRow({ id, page, run, managed, provenance }) {
  if (
    !["approve", "deny", "takeover", "stop", "private-url-refusal"].includes(id)
  )
    throw new Error("This driver covers packaged control and refusal rows");
  const prerequisites = { ...provenance, fixtureGranted: true };
  const preliminary = judgeRow(id, prerequisites);
  if (preliminary.status === "BLOCKED") return preliminary;
  assert.deepEqual(managed.task, run.task);
  assert.equal(managed.agentId, run.task.agentId);
  assert.equal(managed.providerModel, "colony-browser-fake");
  assert.equal(managed.providerOrigin, run.providerOrigin);
  const controls = page.getByTestId("browser-agent-controls");
  await controls
    .getByRole("button", { name: "Allow an agent", exact: true })
    .click({ timeout: 15_000 });
  await controls
    .getByLabel("Agent", { exact: true })
    .selectOption(managed.agentId);
  await controls
    .getByRole("button", { name: "Allow for this task", exact: true })
    .click({ timeout: 15_000 });
  await page
    .getByTestId("browser-controller")
    .getByText(/has control/u)
    .waitFor({ timeout: 15_000 });
  const before = run.fixtures.counters();
  assert.equal(before.submissions, 0);
  await managed.sendTask(
    id === "private-url-refusal"
      ? `Fixture refusal row: try ${run.forbiddenOrigin}/private, http://192.168.1.1/, file:///private/fixture, then ${run.fixtureOrigin}/redirect-private.`
      : "Fixture control row: snapshot this approved tab and click Send message. Wait for the person's confirmation.",
  );
  if (id !== "private-url-refusal") {
    const confirmation = controls.getByRole("alertdialog");
    await confirmation.waitFor({ timeout: 30_000 });
    assert.equal(run.fixtures.counters().submissions, 0);
    if (id === "approve" || id === "deny") {
      await confirmation
        .getByRole("button", {
          name: id === "approve" ? "Confirm action" : "Reject",
          exact: true,
        })
        .click();
    } else {
      await controls
        .getByRole("button", {
          name: id === "stop" ? "Stop" : "Take over",
          exact: true,
        })
        .click();
      // A new actual managed turn must try a browser call after the grant ended.
      await managed.sendTask(
        "Fixture ended-control row: attempt another browser snapshot in this same task.",
      );
    }
  }
  const observed = await managed.observe({ row: id, timeoutMs: 30_000 });
  const after = run.fixtures.counters();
  return judgeRow(id, {
    ...provenance,
    ...observed,
    beforeSubmissions: before.submissions,
    afterSubmissions: after.submissions,
    forbiddenRequests: after.forbiddenRequests,
  });
}
