import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const port = (
  await readFile(process.argv[2] + "/DevToolsActivePort", "utf8")
).split("\n")[0];
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
try {
  const page = browser.contexts()[0].pages()[0];
  const tree = await page.locator("body").ariaSnapshot();
  await writeFile(
    process.env.AI_OUT + "/live-" + (process.argv[3] ?? "dom") + ".yaml",
    tree,
  );
  console.log(tree);
} finally {
  await browser.close();
}
