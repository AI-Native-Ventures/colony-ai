await launchApp({});
const page = S.page;
const H = G;
await sleep(3000);
const inbox = await signUp(page, rec, "Candidate 107 Intro Owner");
H.email = inbox.email; H.password = inbox.password; H.accountAt = new Date().toISOString(); await saveState(state);
await page.getByLabel("Business name", { exact: true }).waitFor({ timeout: 60000 });
const name = "Candidate 107 Intro Co";
await page.getByLabel("Business name", { exact: true }).fill(name);
await page.getByLabel("Website", { exact: false }).fill("https://example.com");
await page.getByRole("button", { name: "Read website", exact: true }).click();
const description = page.getByLabel("What does your business do?");
let end = Date.now() + 40000;
while (Date.now() < end && !(await description.inputValue().catch(() => "")).trim()) await sleep(500);
if (!(await description.inputValue().catch(() => "")).trim()) await description.fill("A small test company used only for a release check.");
H.businessName = name; H.businessAt = new Date().toISOString(); await saveState(state);
await page.getByRole("button", { name: /^Continue$/i }).click();
await page.getByRole("button", { name: "Skip for now", exact: true }).waitFor({ timeout: 90000 });
await page.getByRole("button", { name: "Skip for now", exact: true }).click();
const sidebar = page.getByTestId("app-sidebar");
end = Date.now() + 120000; const trail = [];
while (Date.now() < end) {
  if (await sidebar.isVisible().catch(() => false)) break;
  const t = await page.evaluate(() => document.body.innerText).catch(() => "");
  if (/Try again/.test(t) && /isn’t ready|Failed to connect/.test(t)) { trail.push("retry"); await page.getByRole("button", { name: "Try again", exact: true }).click().catch(() => {}); await sleep(3000); }
  const open = page.getByRole("button", { name: "Open my Colony", exact: true });
  if (await open.isVisible().catch(() => false)) { trail.push("open"); await open.click().catch(() => {}); }
  await sleep(700);
}
H.appAt = new Date().toISOString(); await saveState(state);
await sleep(3000);
await shot(page, rec, "I-app-entered");
return { email: H.email, trail, sidebar: await sidebar.isVisible() };
