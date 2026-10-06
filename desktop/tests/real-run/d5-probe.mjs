// Delta gate D5 diagnostic: relaunch the fake-model profile through the ai-lib launcher (real-env sandbox policy, HOME = privateDir/home,
// a link to the profile's fresh HOME) and see whether "Failed to connect to relay" persists. usage: node d5-probe.mjs <private dir>
import { symlink, lstat } from "node:fs/promises";
import path from "node:path";
import { Rec, closeApp, launch, progress, redact, shot, sleep } from "./ai-lib.mjs";
const privateDir = process.argv[2];
const homeLink = path.join(privateDir, "home");
const target = process.argv[3];
if (target) await symlink(target, homeLink).catch(() => undefined);
await lstat(homeLink);
const rec = new Rec("D5PROBE");
const { application, page, version } = await launch({ privateDir, userDataDir: path.join(privateDir, "user-data") });
try {
  await sleep(20000);
  const text = async () => redact((await page.locator("body").innerText().catch(() => "")).replace(/\s+/gu, " ").slice(0, 400));
  await progress(`[D5PROBE] ${version} after 20 s: ${await text()}`);
  const again = page.getByRole("button", { name: /^Try again/iu }).first();
  if (await again.isVisible().catch(() => false)) {
    await again.click();
    await sleep(25000);
    await progress(`[D5PROBE] after Try again: ${await text()}`);
  }
  await shot(page, rec, "probe");
} finally {
  await rec.write();
  await closeApp(application);
}
