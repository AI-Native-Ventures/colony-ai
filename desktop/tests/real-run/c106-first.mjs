import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  OUT,
  Rec,
  newProfile,
  launch,
  closeApp,
  signUp,
  createBusiness,
  saveState,
  loadState,
  shot,
  sleep,
  instrument,
  progress,
} from "./ai-lib.mjs";
import { startFakeProvider } from "./fake-provider.mjs";
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("Local opt-in required");
const resume = process.argv.includes("resume");
const state = await loadState();
const rec = new Rec(
  resume ? "G1-RESUME" : state.A?.email ? "G1-FIRST2" : "G1-FIRST",
);
if (
  !resume &&
  (state.C?.business || [state.A, state.A0].filter((p) => p?.email).length >= 2)
)
  throw new Error(
    "Original business allowance is spent; use existing profiles only",
  );
const p = resume ? state.A : await newProfile("106-owner");
const fake = await startFakeProvider({
  logFile: path.join(OUT, "fake-provider.jsonl"),
  port: resume ? state.A.fakePort : 0,
});
const home = path.join(p.privateDir, "home");
const hash = createHash("sha256")
  .update(p.userDataDir)
  .digest("hex")
  .slice(0, 16);
const config = path.join(
  home,
  "Library",
  "Application Support",
  `xyz.block.buzz.app.electron.${hash}`,
  "agents",
  "global-agent-config.json",
);
await mkdir(path.dirname(config), { recursive: true, mode: 0o700 });
await writeFile(
  config,
  JSON.stringify({
    env_vars: { OPENAI_COMPAT_BASE_URL: fake.url },
    provider: "openai",
    model: "fake-model",
    preferred_runtime: "buzz-agent",
  }),
  { mode: 0o600 },
);
if (!resume && state.A?.email) {
  state.A0 = state.A;
  state.A = {};
}
state.A = {
  ...state.A,
  ...p,
  home,
  fakePort: Number(new URL(fake.url).port),
  name: "Candidate 106 Owner",
};
await saveState(state);
const { application, page, version } = await launch(p);
instrument(page, rec, "owner");
const check = async (id, label, fn) => {
  try {
    const detail = await fn();
    rec.row(id, label, "PASS", detail, {
      screenshot: await shot(page, rec, id),
    });
    return true;
  } catch (e) {
    rec.row(id, label, "FAIL", e.message.split("\n")[0], {
      screenshot: await shot(page, rec, id + "-error"),
    });
    await rec.write();
    return false;
  }
};
try {
  await check(
    "G1-version",
    "Packaged version and expected PR branding",
    async () => {
      if (version !== "1.0.6") throw new Error(`app.getVersion()=${version}`);
      const info = await application.evaluate(
        ({ app, BrowserWindow, Menu }) => ({
          version: app.getVersion(),
          packaged: app.isPackaged,
          name: app.name,
          titles: BrowserWindow.getAllWindows().map((w) => w.getTitle()),
          menus: Menu.getApplicationMenu()?.items.map((i) => ({
            label: i.label,
            items: i.submenu?.items.map((j) => j.label),
          })),
        }),
      );
      rec.notes.packaging = info;
      return JSON.stringify(info);
    },
  );
  if (!resume) {
    await page
      .getByTestId("machine-onboarding-gate")
      .waitFor({ timeout: 30000 });
    await check("G1-google", "Account has Continue with Google", async () => {
      if (
        !(await page
          .getByRole("button", { name: /Continue with Google/i })
          .isVisible())
      )
        throw new Error("Google control absent");
      return "Control visible; no Google login opened";
    });
    const signed = await check(
      "G1-account",
      "New disposable account and email verification",
      async () => {
        const inbox = await signUp(page, rec, state.A.name);
        state.A.email = inbox.email;
        state.A.password = inbox.password;
        await saveState(state);
        return `Verified ${inbox.email}`;
      },
    );
    if (!signed) throw new Error("Account prerequisite failed");
    const business = `Candidate 106 ${state.A.email.split("@")[0].replace("colony-launch-check-", "")}`;
    if (
      !(await check(
        "G1-business",
        "Business form, website read, one new business",
        async () => {
          await createBusiness(page, business);
          state.A.business = business;
          state.A.createdAt = new Date().toISOString();
          await saveState(state);
          return `Created ${business} at ${state.A.createdAt}`;
        },
      ))
    )
      throw new Error("Business prerequisite failed");
  } else {
    const biz = `Candidate 106 ${state.A.email.split("@")[0].replace("colony-launch-check-", "")}`;
    state.A.business = biz;
    await saveState(state);
    await sleep(3000);
    await shot(page, rec, "resume-start");
    if (
      await page
        .getByLabel("Your name", { exact: true })
        .isVisible()
        .catch(() => false)
    ) {
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
      await sleep(4000);
    }
    const list = page.getByTestId("onboarding-business-list");
    await list
      .or(page.getByRole("radio", { name: /Bring your own key/i }))
      .first()
      .waitFor({ timeout: 30000 });
    if (await list.isVisible().catch(() => false))
      await list.getByRole("button").first().click();
    await page
      .getByRole("radio", { name: /Bring your own key/i })
      .waitFor({ timeout: 45000 });
    rec.row(
      "G1-business-correction",
      "Business reached Connect",
      "PASS",
      "Earlier selector was stale: screenshot proves Connect was reached. Resumed the same account and business, no new creation.",
      { screenshot: await shot(page, rec, "resumed-connect") },
    );
  }
  rec.notes.accounts = [{ email: state.A.email, business: state.A.business }];
  await check("G5-connect-off", "No ChatGPT surface on Connect", async () => {
    const t = await page.locator("body").innerText();
    if (/ChatGPT/i.test(t)) throw new Error("ChatGPT visible");
    return "COLONY_CHATGPT_PLAN unset, no ChatGPT visible on Connect";
  });
  if (
    !(await check(
      "G1-connect",
      "Connect through local FAKE provider only",
      async () => {
        await page.getByRole("radio", { name: /Bring your own key/i }).click();
        await page
          .getByTestId("onboarding-provider-key")
          .fill("fake-gate-key-not-a-credential");
        await page.getByRole("button", { name: /^Check key/i }).click();
        await page
          .getByText(/AI connected and saved as your default/i)
          .waitFor({ timeout: 60000 });
        return `FAKE provider checked at loopback port ${state.A.fakePort}; no credentials or real provider`;
      },
    ))
  )
    throw new Error("Connect prerequisite failed");
  const welcomeAt = Date.now();
  await check("G1-welcome", "Open my Colony reaches Welcome", async () => {
    const end = Date.now() + 120000;
    while (Date.now() < end) {
      if (
        await page
          .getByTestId("app-sidebar")
          .isVisible()
          .catch(() => false)
      )
        break;
      const open = page.getByRole("button", {
        name: "Open my Colony",
        exact: true,
      });
      if (await open.isVisible().catch(() => false)) await open.click();
      const list = page.getByTestId("onboarding-business-list");
      if (await list.isVisible().catch(() => false))
        await list.getByRole("button").first().click();
      await sleep(500);
    }
    await page.getByTestId("app-sidebar").waitFor({ timeout: 5000 });
    await page.locator('[data-testid="channel-welcome" i]').first().click();
    await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
    state.A.welcomeAt = new Date().toISOString();
    await saveState(state);
    return "Real workspace and Welcome timeline visible";
  });
  const introStart = Date.now();
  await check(
    "G1-intro",
    "Scout intro within 30 seconds of Welcome",
    async () => {
      await page
        .getByTestId("message-author")
        .filter({ hasText: /Scout/ })
        .first()
        .waitFor({ timeout: 30000 });
      const elapsed = Date.now() - introStart;
      rec.notes.introMs = elapsed;
      return `Scout authored message visible ${elapsed} ms after Welcome timeline reached`;
    },
  );
  await page.keyboard.press("Escape");
  await check(
    "G1-reply",
    "Scout replies in the question thread within 180 seconds",
    async () => {
      const marker = `what do you know about our business? candidate106 ${Date.now() % 100000}`;
      const composer = page
        .getByTestId("message-composer")
        .locator('[contenteditable="true"]')
        .first();
      await composer.fill("@");
      const menu = page.getByTestId("mention-autocomplete");
      await menu.waitFor({ timeout: 15000 });
      await menu
        .locator("[data-mention-suggestion-index]")
        .filter({ hasText: /Scout/ })
        .first()
        .click();
      await composer.press("End");
      await composer.pressSequentially(" " + marker);
      await composer.press("Enter");
      const start = Date.now();
      let chip;
      while (Date.now() - start < 180000) {
        chip = page
          .getByTestId("message-row")
          .filter({ hasText: marker })
          .last()
          .getByRole("button", { name: /\d+ repl/ });
        if (await chip.count()) break;
        await sleep(1000);
      }
      const row = page
        .getByTestId("message-row")
        .filter({ hasText: marker })
        .last();
      rec.notes.questionRow = await row.innerText();
      const reply = row
        .locator("button")
        .filter({ hasText: /\d+ repl/ })
        .first();
      await reply.waitFor({ timeout: 1000 });
      await reply.click();
      await sleep(1000);
      const text = await page.locator("body").innerText();
      rec.notes.replyVisible = text.slice(-6000);
      if (!text.includes("Scout"))
        throw new Error("Thread has no Scout author");
      rec.notes.replyMs = Date.now() - start;
      return `Question thread opened after ${rec.notes.replyMs} ms; FAKE provider runtime and real tools only`;
    },
  );
  await page.keyboard.press("Escape");
  rec.notes.communityHost = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("buzz-communities") ?? "[]").map((c) => ({
      name: c.name,
      relayUrl: c.relayUrl,
    })),
  );
  state.A.communities = rec.notes.communityHost;
  await saveState(state);
} catch (e) {
  rec.notes.stoppedText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  rec.row("G1-prerequisite", "First run stopped", "NOT OBSERVED", e.message, {
    screenshot: await shot(page, rec, "stopped"),
  });
} finally {
  rec.notes.fakeSummary = fake.stats();
  await rec.write();
  await closeApp(application);
  await fake.close();
  await progress("[G1-FIRST] complete");
}
