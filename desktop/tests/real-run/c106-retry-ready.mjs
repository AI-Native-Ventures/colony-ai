import { chromium } from "@playwright/test";
import { readFile, writeFile, appendFile } from "node:fs/promises";
const port = (
  await readFile(process.argv[2] + "/DevToolsActivePort", "utf8")
).split("\n")[0];
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
try {
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await appendFile(
    process.env.AI_PROGRESS,
    new Date().toTimeString().slice(0, 8) +
      " G1-RETRY OBSERVED: live community setup Failed to connect to relay; clicked Try again at once\n",
  );
  await page.waitForTimeout(2000);
  console.log(await page.locator("body").ariaSnapshot());
} finally {
  await browser.close();
}
