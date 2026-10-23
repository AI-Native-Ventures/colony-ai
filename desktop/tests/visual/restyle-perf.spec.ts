import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * Long-channel style cost for the office restyle, run against a develop
 * bundle and a restyle bundle with the same fixture (see
 * `restyle-proof.config.ts`). Not a pass/fail test: it appends one JSON line
 * of Chromium CDP metrics per run to `RESTYLE_PERF_OUT`.
 *
 * The run seeds a busy channel, then drives a wheel scroll up and down
 * through it and streams incoming messages, which is the work the
 * `data-colony-office` scope must not make more expensive.
 */

const ROWS = Number(process.env.RESTYLE_PERF_ROWS ?? 400);
const INCOMING = Number(process.env.RESTYLE_PERF_INCOMING ?? 40);
const LABEL = process.env.RESTYLE_PERF_LABEL ?? "run";
const OUT =
  process.env.RESTYLE_PERF_OUT ?? "test-results/restyle-perf/metrics.jsonl";

type Metrics = Record<string, number>;

const NAMES = [
  "RecalcStyleCount",
  "RecalcStyleDuration",
  "LayoutCount",
  "LayoutDuration",
  "ScriptDuration",
  "TaskDuration",
];

test("long channel: scroll and incoming messages", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockBridge(page, { referenceWorkspace: true });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("channel-Sales").first().click();
  await page.waitForFunction(
    () =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: "Sales",
      }) ?? false,
  );
  await page.evaluate((rows) => {
    const people = ["a4a4".repeat(16), "deadbeef".repeat(8), "d5d5".repeat(16)];
    for (let i = 0; i < rows; i += 1) {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Sales",
        content: `Busy row ${i}: checking the shortlist, the captions and the next delivery.\nSecond line ${i}.`,
        pubkey: people[i % people.length],
      });
    }
  }, ROWS);
  await page.waitForTimeout(2500);

  const timeline = page.getByTestId("message-timeline").first();
  const box = await timeline.boundingBox();
  if (!box) throw new Error("timeline not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const read = async (): Promise<Metrics> => {
    const { metrics } = (await client.send("Performance.getMetrics")) as {
      metrics: Array<{ name: string; value: number }>;
    };
    return Object.fromEntries(
      NAMES.map((name) => [
        name,
        metrics.find((metric) => metric.name === name)?.value ?? 0,
      ]),
    );
  };

  const before = await read();
  const started = Date.now();
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(25);
  }
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(25);
  }
  for (let i = 0; i < INCOMING; i += 1) {
    await page.evaluate((index) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Sales",
        content: `Incoming ${index}: the Olive House replied.`,
        pubkey: "a4a4".repeat(16),
      });
    }, i);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  const after = await read();

  const delta = Object.fromEntries(
    NAMES.map((name) => {
      const value = after[name] - before[name];
      return [
        name,
        name.endsWith("Duration") ? Math.round(value * 10000) / 10 : value,
      ];
    }),
  );
  mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
  appendFileSync(
    OUT,
    `${JSON.stringify({ label: LABEL, rows: ROWS, incoming: INCOMING, wallMs: Date.now() - started, ...delta })}\n`,
  );
});
