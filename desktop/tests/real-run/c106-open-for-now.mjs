import { chromium } from "@playwright/test";
import { readFile, appendFile } from "node:fs/promises";
const port = (
  await readFile(process.argv[2] + "/DevToolsActivePort", "utf8")
).split("\n")[0];
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
try {
  const page = browser.contexts()[0].pages()[0];
  await page
    .getByRole("button", { name: "Open my Colony for now", exact: true })
    .click();
  await appendFile(
    process.env.AI_PROGRESS,
    new Date().toTimeString().slice(0, 8) +
      " G1-OPEN-FOR-NOW OBSERVED: clicked observed Open my Colony for now after repeated setup relay error; first-run connected proof remains unproven\n",
  );
} finally {
  await browser.close();
}
