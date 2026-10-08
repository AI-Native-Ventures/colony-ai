import { chromium } from "@playwright/test";
import { readFile, writeFile, appendFile } from "node:fs/promises";
const dir = process.argv[2];
const port = (await readFile(dir + "/DevToolsActivePort", "utf8")).split(
  "\n",
)[0];
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
try {
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("radiogroup").waitFor({ timeout: 90000 });
  const tree = await page.locator("body").ariaSnapshot();
  await writeFile(process.env.AI_OUT + "/connect-live-aria.yaml", tree);
  const dom = await page.getByRole("radio").evaluateAll((nodes) =>
    nodes.map((e) => ({
      role: e.getAttribute("role"),
      text: e.innerText,
      aria: e.getAttribute("aria-label"),
      checked: e.getAttribute("aria-checked"),
    })),
  );
  await writeFile(
    process.env.AI_OUT + "/connect-live-radios.json",
    JSON.stringify(dom, null, 2),
  );
  await appendFile(
    process.env.AI_PROGRESS,
    new Date().toTimeString().slice(0, 8) +
      " G1-CONNECT-DOM OBSERVED: live accessibility tree and four radio labels captured before downstream proof\n",
  );
} finally {
  await browser.close();
}
