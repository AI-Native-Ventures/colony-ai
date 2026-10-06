import { chromium } from "@playwright/test";
const [port, ...names] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0];
for (const name of names) {
  const b = page.getByRole("button", { name: new RegExp(name, "i") }).first();
  if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 8000 }); console.log("clicked", name); }
}
await new Promise((r) => setTimeout(r, 6000));
console.log((await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400));
await browser.close();
