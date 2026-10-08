// Attach to the already guarded candidate, never launches an app.
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const port = (
  await readFile(process.argv[2] + "/DevToolsActivePort", "utf8")
).split("\n")[0];
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
try {
  let page;
  for (const p of browser.contexts()[0].pages())
    if (
      await p
        .getByTestId("app-sidebar")
        .isVisible()
        .catch(() => false)
    ) {
      page = p;
      break;
    }
  if (!page) throw new Error("Guarded main app page not found");
  await page.getByTestId("message-thread-summary-surface").last().click();
  console.log(
    (await page.getByTestId("message-thread-panel").innerText()).slice(0, 400),
  );
} finally {
  await browser.close();
}
