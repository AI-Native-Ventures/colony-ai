import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import {
  advance,
  AGENT_PUBKEY,
  endHarness,
  indicator,
  lastMessageId,
  mentionScout,
  openGeneral,
  pageNowSeconds,
  reactAsAgent,
  readCommands,
  readStartCalls,
  scout,
  SECOND,
} from "../helpers/mentionWake";

/**
 * GATE-304 (26 Oct, published 3.0.4): Scout was started for a mention sent 2 s
 * after Welcome opened, and the app stopped it 5.5 s later. Nothing started it
 * again and the conversation said nothing for six minutes: no reply, no
 * "hasn't picked this up yet", no Try again.
 *
 * These specs pin what the person must see whoever ends the harness: an agent
 * woken for a mention that is gone before it answered is started again, and
 * when it cannot stay up the conversation says so with a way to try again.
 */

test.use({ viewport: { width: 1280, height: 720 } });

test.describe("an agent woken for a mention whose harness is gone before it answers", () => {
  test("is started again on its own, reaching back to the mention", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents: [scout("stopped")] });
    await openGeneral(page);

    const sentAt = await pageNowSeconds(page);
    await mentionScout(page, "are you there?");
    await advance(page, 3 * SECOND);
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");
    expect(await readStartCalls(page)).toHaveLength(1);

    // Whoever stopped it, the harness is gone and the mention is unanswered.
    await endHarness(page);
    await advance(page, 30 * SECOND, SECOND);

    await expect
      .poll(async () => (await readStartCalls(page)).length)
      .toBeGreaterThan(1);
    const again = (await readStartCalls(page))[1];
    expect(again.replayFloorUnix).toBeGreaterThan(sentAt - 5);
    expect(again.replayFloorUnix).toBeLessThanOrEqual(sentAt + 2);
  });
});

test.describe("GATE-304: the harness queued the mention and was stopped before it answered", () => {
  test("the mention is handed back to the harness, then the agent is started again from it", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents: [scout("stopped")] });
    await openGeneral(page);

    const sentAt = await pageNowSeconds(page);
    await mentionScout(page, "are you there?");
    await advance(page, 3 * SECOND);
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");
    expect(await readStartCalls(page)).toHaveLength(1);

    // The harness queued the mention (the 👀 it reacts with) and was stopped
    // 5.5 s after it started, before it answered.
    const mentionId = await lastMessageId(page);
    await reactAsAgent(page, mentionId, "👀");
    await endHarness(page);
    await advance(page, 30 * SECOND, SECOND);

    await expect
      .poll(async () => (await readStartCalls(page)).length)
      .toBeGreaterThan(1);
    const commands = await readCommands(page, [
      "start_managed_agent",
      "release_wake_events",
    ]);
    const names = commands.map((entry) => entry.command);
    // Handed back before the agent starts again, never after.
    const release = names.indexOf("release_wake_events");
    expect(release).toBeGreaterThan(0);
    expect(names[release + 1]).toBe("start_managed_agent");
    expect(commands[release].payload).toMatchObject({
      pubkey: AGENT_PUBKEY,
      eventIds: [mentionId],
    });
    const again = (await readStartCalls(page))[1];
    expect(again.replayFloorUnix).toBeLessThanOrEqual(sentAt + 2);
    expect(again.replayFloorUnix).toBeGreaterThan(sentAt - 5);
    // Not silent: the conversation says the agent is starting.
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");
  });

  test("a harness that keeps going away is not started for ever: the conversation says so, with Try again", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents: [scout("stopped")] });
    await openGeneral(page);

    await mentionScout(page, "are you there?");
    await advance(page, 3 * SECOND);
    const mentionId = await lastMessageId(page);
    await reactAsAgent(page, mentionId, "👀");
    // Every harness that starts is gone a second later.
    await page.evaluate((pubkey) => {
      window.setInterval(() => {
        void (
          window as Window & {
            __BUZZ_E2E_END_MANAGED_AGENT__?: (pubkey: string) => Promise<void>;
          }
        ).__BUZZ_E2E_END_MANAGED_AGENT__?.(pubkey);
      }, 1000);
    }, AGENT_PUBKEY);

    await advance(page, 8 * 60 * SECOND, 5 * SECOND);

    // The first start, plus a bounded number of automatic restarts.
    const starts = await readStartCalls(page);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.length).toBeLessThanOrEqual(4);
    await expect(indicator(page)).toHaveAttribute("data-state", "stalled");
    await expect(
      indicator(page).getByTestId("agent-working-indicator-label"),
    ).toHaveText("Scout keeps stopping before it answers.");
    await expect(
      indicator(page).getByRole("button", { name: "Try starting Scout again" }),
    ).toBeVisible();
  });

  test("a turn that began and was lost is not run again on its own: it says so and waits for Try again", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents: [scout("stopped")] });
    await openGeneral(page);

    await mentionScout(page, "are you there?");
    await advance(page, 3 * SECOND);
    const mentionId = await lastMessageId(page);
    // 💬: the turn began, so the model may have acted on the mention.
    await reactAsAgent(page, mentionId, "💬");
    await endHarness(page);
    await advance(page, 30 * SECOND, SECOND);

    expect(await readStartCalls(page)).toHaveLength(1);
    expect(await readCommands(page, ["release_wake_events"])).toHaveLength(0);
    await expect(indicator(page)).toHaveAttribute("data-state", "stalled");
    await expect(
      indicator(page).getByTestId("agent-working-indicator-label"),
    ).toHaveText("Scout stopped while working on this.");

    // The person decides: Try again hands it back and starts the agent.
    await indicator(page)
      .getByRole("button", { name: "Try starting Scout again" })
      .click();
    await expect.poll(async () => (await readStartCalls(page)).length).toBe(2);
    const names = (
      await readCommands(page, ["release_wake_events", "start_managed_agent"])
    ).map((entry) => entry.command);
    expect(names.slice(-2)).toEqual([
      "release_wake_events",
      "start_managed_agent",
    ]);
  });
});
