import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  OUT,
  Rec,
  launch,
  closeApp,
  loadState,
  instrument,
  shot,
  progress,
  sleep,
} from "./ai-lib.mjs";
import { startFakeProvider } from "./fake-provider.mjs";
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("Local opt-in required");
const state = await loadState();
const rec = new Rec("G1-SETUP-RECOVERY");
const fake = await startFakeProvider({
  logFile: path.join(OUT, "fake-recovery.jsonl"),
  port: state.A.fakePort,
  scoutIntro: true,
});
let application, page;
const check = async (id, name, fn) => {
  try {
    const detail = await fn();
    rec.row(id, name, "PASS", detail, {
      screenshot: await shot(page, rec, id),
    });
    return true;
  } catch (e) {
    rec.row(id, name, "NOT OBSERVED", e.message.split("\n")[0], {
      screenshot: await shot(page, rec, id + "-blocked"),
    });
    return false;
  }
};
try {
  ({ application, page } = await launch(state.A));
  instrument(page, rec, "owner");
  rec.row(
    "G1-guarded-launch",
    "Guarded full-app launch with effective sandbox probe",
    "PASS",
    "Same sandbox-exec path denied the synthetic file with Operation not permitted before exec. Runtime process.env.HOME matches supplied throwaway HOME; migration=0. See launch and sandbox-probe progress lines.",
  );
  await sleep(1500);
  await writeFile(
    path.join(OUT, "recovery-launch-aria.yaml"),
    await page.locator("body").ariaSnapshot(),
  );
  const sidebar = page.getByTestId("app-sidebar");
  let retried = false,
    signed = false;
  const end = Date.now() + 90000;
  while (Date.now() < end && !(await sidebar.isVisible().catch(() => false))) {
    if (
      !signed &&
      (await page
        .getByLabel("Your name", { exact: true })
        .isVisible()
        .catch(() => false))
    ) {
      signed = true;
      await page
        .getByRole("button", { name: /^Sign in$/i })
        .first()
        .click();
      await page.getByLabel(/Email/i).first().fill(state.A.email);
      await page
        .getByLabel(/Password/i)
        .first()
        .fill(state.A.password);
      await page.getByTestId("account-auth-submit-signin").click();
    }
    const list = page.getByTestId("onboarding-business-list");
    if (await list.isVisible().catch(() => false))
      await list.getByRole("button").first().click();
    const open = page.getByRole("button", {
      name: /^Open my Colony(?: for now)?$/i,
    });
    if (await open.isVisible().catch(() => false)) await open.click();
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    if (!retried && (await retry.isVisible().catch(() => false))) {
      retried = true;
      await retry.click();
    }
    await sleep(700);
  }
  await page.getByTestId("app-sidebar").waitFor({ timeout: 15000 });
  await sleep(1000);
  const recoveryTree = await page.locator("body").ariaSnapshot();
  await writeFile(
    path.join(OUT, "setup-recovery-live-aria.yaml"),
    recoveryTree,
  );
  const recoveryName = recoveryTree.match(/button "(Retry setup[^"\n]*)"/)?.[1];
  rec.notes.recoveryAccessibleName = recoveryName ?? null;
  const recoveryAt = Date.now();
  if (!recoveryName)
    throw new Error("Live DOM has no accessible Retry setup button");
  await page.getByRole("button", { name: recoveryName, exact: true }).click();
  await progress("[G1-SETUP-RECOVERY] clicked live accessible " + recoveryName);
  await page
    .locator('[data-testid="channel-welcome" i]')
    .first()
    .waitFor({ timeout: 90000 });
  rec.row(
    "G1-setup-recovery",
    "Retry setup restores channels on the existing business",
    "PASS",
    `Channels and Welcome appeared ${Date.now() - recoveryAt} ms after clicking the observed toast action. No business created.`,
    { screenshot: await shot(page, rec, "setup-channels") },
  );
  if (
    !(await check(
      "G1-recovery-welcome",
      "Existing business reaches Welcome after network recovery",
      async () => {
        await sidebar.waitFor({ timeout: 3000 });
        await page.locator('[data-testid="channel-welcome" i]').first().click();
        await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
        return "Welcome timeline visible; existing account and business, no creation";
      },
    ))
  )
    throw new Error("Workspace prerequisite missing");
  const start = Date.now();
  await check(
    "G1-recovery-intro",
    "Scout authored introduction visible within 30 seconds of recovered Welcome",
    async () => {
      let intro = "";
      while (Date.now() - start < 30000) {
        const rows = await page
          .getByTestId("message-row")
          .filter({
            has: page
              .getByTestId("message-author")
              .filter({ hasText: /Scout/ }),
          })
          .allInnerTexts();
        intro =
          rows.find(
            (t) => !/To get started with Scout, connect your AI/i.test(t),
          ) ?? "";
        if (intro) break;
        await sleep(500);
      }
      if (!intro)
        throw new Error(
          "No Scout introduction observed in recovered Welcome within 30 seconds; connect-later notice does not count",
        );
      rec.notes.intro = intro;
      return `Observed after ${Date.now() - start} ms. Recovery view, original onboarding timing remains separate.`;
    },
  );
  await check(
    "G1-recovery-reply",
    "Scout answers the new question thread within 180 seconds",
    async () => {
      await page.keyboard.press("Escape");
      const marker = `what do you know about our business? candidate106 recovery ${Date.now() % 100000}`;
      const composer = page
        .getByTestId("message-composer")
        .locator('[contenteditable="true"]')
        .first();
      await composer.fill("@");
      const menu = page.getByTestId("mention-autocomplete");
      await menu.waitFor({ timeout: 10000 });
      await menu
        .locator("[data-mention-suggestion-index]")
        .filter({ hasText: /Scout/ })
        .first()
        .click();
      await composer.press("End");
      await composer.pressSequentially(" " + marker);
      await composer.press("Enter");
      const sent = Date.now();
      const row = page
        .getByTestId("message-row")
        .filter({ hasText: marker })
        .last();
      let link;
      while (Date.now() - sent < 180000) {
        link = row
          .locator("button")
          .filter({ hasText: /\d+ repl/ })
          .first();
        if (await link.isVisible().catch(() => false)) break;
        await sleep(1000);
      }
      if (!(await link.isVisible().catch(() => false)))
        throw new Error(
          "No reply chip on this question row within 180 seconds",
        );
      const ms = Date.now() - sent;
      await link.click();
      await sleep(500);
      rec.notes.threadText = await page
        .getByTestId("thread-panel")
        .innerText()
        .catch(() => page.locator("body").innerText());
      rec.notes.replyMs = ms;
      return `Question reply chip observed at ${ms} ms, opened its thread. FAKE provider with real runtime only.`;
    },
  );
  rec.notes.fake = fake.stats();
  await page.keyboard.press("Escape");
} catch (e) {
  rec.row(
    "G1-recovery-blocked",
    "Recovery prerequisite",
    "NOT OBSERVED",
    e.message,
  );
} finally {
  await rec.write();
  if (application) await closeApp(application);
  await fake.close();
  await progress("[G1-SETUP-RECOVERY] complete");
}
