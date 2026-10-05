// Renders a minted invite URL in a plain headless Chromium (read only GET) to record the
// landing page title, visible text, links and deep link targets. The code never reaches the report.
// usage: COLONY_REAL_RUN=1 node ai-landing.mjs <which: default|single>   (through heavy.sh)
import { chromium } from "@playwright/test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  OUT,
  Rec,
  loadState,
  progress,
  redact,
  waitForLoad,
} from "./ai-lib.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const which = process.argv[2] ?? "default";
const state = await loadState();
const url = state.invites?.[which];
if (!url) throw new Error(`no ${which} invite in state`);
const rec = new Rec(`landing-${which}`);
await waitForLoad();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const net = [];
  page.on("requestfailed", (r) =>
    net.push(`failed ${redact(r.url()).split("?")[0]}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400)
      net.push(`${r.status()} ${redact(r.url()).split("?")[0]}`);
  });
  const response = await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.slice(0, 1500),
    links: [...document.querySelectorAll("a")]
      .map((a) => ({
        text: a.innerText.trim().slice(0, 60),
        href: a.getAttribute("href"),
      }))
      .slice(0, 20),
    buttons: [...document.querySelectorAll("button")]
      .map((b) => b.innerText.trim().slice(0, 60))
      .slice(0, 12),
  }));
  const file = `landing-${which}.png`;
  await page.screenshot({ path: path.join(OUT, "screenshots", file) });
  const code = url.split("/").pop();
  const clean = (v) => JSON.parse(JSON.stringify(v).replaceAll(code, "XXXX"));
  const out = clean({
    status: response?.status(),
    ...info,
    net,
    finalUrlShape: redact(page.url()),
  });
  rec.notes = out;
  rec.row(
    `landing-${which}`,
    `Rendered invite landing (${which})`,
    "PASS",
    `HTTP ${out.status}; title "${out.title}"; buttons: ${out.buttons.join(" | ")}; links: ${out.links.map((l) => `${l.text}=>${redact(String(l.href))}`).join(" ; ")}`,
    { screenshot: `screenshots/${file}` },
  );
  await writeFile(
    path.join(OUT, `landing-${which}.json`),
    JSON.stringify(out, null, 2),
  );
} finally {
  await rec.write();
  await browser.close();
  await progress(`[landing-${which}] done`);
}
