// Phase B: a cofounder profile (new throwaway profile) redeems an invite to A's community.
// usage: COLONY_REAL_RUN=1 node ai-b.mjs <label B1|B2|B3> <mode paste|deeplink|existing> <invite default|single>
//  paste:    fresh install, new account, paste invite URL into the invite form (WelcomeSetup / join)
//  deeplink: fresh install, new account, `open -a <app> colony://...` then `buzz://join?...` while it runs
//  existing: new account WITH its own business (business number 2), then Add community with the URL
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  APP,
  OUT,
  Rec,
  closeApp,
  createBusiness,
  instrument,
  inventory,
  launch,
  loadState,
  newProfile,
  progress,
  redact,
  saveState,
  shot,
  signUp,
  skipConnect,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

const run = promisify(execFile);
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const [label = "B1", mode = "paste", which = "default"] = process.argv.slice(2);
const rec = new Rec(label);
const state = await loadState();
const inviteUrl = state.invites?.[which];
if (!inviteUrl) throw new Error(`no ${which} invite in state`);
const code = inviteUrl.split("/").pop();
const host = new URL(inviteUrl).host;
const clean = (text) => redact(String(text ?? "").replaceAll(code, "XXXX"));
const load = await waitForLoad();
await progress(
  `[${label}] load ${load.toFixed(1)} ok, mode ${mode}, invite ${which}`,
);
const profile = await newProfile(label);
const { application, page, version } = await launch(profile);
rec.notes.version = version;
instrument(page, rec, label);
const bodyText = async (n = 600) =>
  clean(
    (
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/gu, " ")
      .slice(0, n),
  );
const guard = async (id, name, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(
      id,
      name,
      "FAIL",
      `Step threw ${error.name}: ${clean(error.message).split("\n")[0]}. Page: ${await bodyText(300)}`,
      { screenshot: await shot(page, rec, `${id}-error`) },
    );
    return undefined;
  }
};
const joined = async (timeoutMs) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (
      await page
        .getByTestId("app-sidebar")
        .isVisible()
        .catch(() => false)
    )
      return true;
    await sleep(500);
  }
  return false;
};
const openApp = async (url) => {
  // Always target the published bundle explicitly so LaunchServices cannot route to another installed app.
  const before = (
    await run("pgrep", ["-fl", "Colony.app/Contents/MacOS/Colony"]).catch(
      () => ({ stdout: "" }),
    )
  ).stdout
    .split("\n")
    .filter(Boolean).length;
  await run("open", ["-a", APP, url]);
  await sleep(1500);
  const after = (
    await run("pgrep", ["-fl", "Colony.app/Contents/MacOS/Colony"]).catch(
      () => ({ stdout: "" }),
    )
  ).stdout
    .split("\n")
    .filter(Boolean).length;
  return { mainProcsBefore: before, mainProcsAfter: after };
};
try {
  const t0 = Date.now();
  const inbox = await guard(`${label}-account`, "Create account", () =>
    signUp(page, rec, `Smoke ${label}`),
  );
  if (!inbox) throw new Error("no account");
  state[label] = {
    email: inbox.email,
    password: inbox.password,
    userDataDir: profile.userDataDir,
    privateDir: profile.privateDir,
    name: `Smoke ${label}`,
    mode,
  };
  await saveState(state);
  await sleep(2500);
  const afterVerify = await inventory(page, "body", 40);
  rec.notes.afterVerifyControls = afterVerify
    .map((i) => i.testid ?? i.text ?? i.aria)
    .filter(Boolean);
  rec.row(
    `${label}-account`,
    "Fresh install: create account and verify",
    "PASS",
    `Account ${inbox.email} verified in ${Date.now() - t0} ms. Screen after verify: ${await bodyText(300)}`,
    { screenshot: await shot(page, rec, "after-verify") },
  );

  if (mode === "existing") {
    const tb = Date.now();
    await createBusiness(
      page,
      `Avatar invite ${inbox.email.split("@")[0].replace("colony-launch-check-", "")}`,
    ).catch(async (e) => {
      rec.row(
        `${label}-business`,
        "Create own business (business 2 of max 2)",
        "FAIL",
        `${e.name}. Page: ${await bodyText(300)}`,
        { screenshot: await shot(page, rec, "business-fail") },
      );
      throw e;
    });
    await skipConnect(page);
    rec.row(
      `${label}-business`,
      "Create own business and open app",
      "PASS",
      `done in ${Date.now() - tb} ms`,
      { screenshot: await shot(page, rec, "own-app") },
    );
    await sleep(3000);
    // Add community from the community switcher
    await guard(`${label}-add`, "Open Add community", async () => {
      const inv = await inventory(page, '[data-testid="app-sidebar"]', 60);
      rec.notes.sidebarControls = inv
        .map((i) => i.testid ?? i.text ?? i.aria)
        .filter(Boolean)
        .slice(0, 40);
      const switcher = page
        .locator(
          '[data-testid*="community-switch"],[data-testid*="community-menu"],[data-testid*="workspace-switch"]',
        )
        .first();
      if (await switcher.count()) await switcher.click();
      else
        await page
          .getByRole("button", { name: /community|workspace|switch/iu })
          .first()
          .click({ timeout: 8000 });
      await sleep(800);
      await shot(page, rec, "switcher-open");
      const add = page
        .getByRole("menuitem", { name: /add (a )?community|join/iu })
        .or(page.getByText(/add (a )?community|join (a )?community/iu))
        .first();
      await add.click({ timeout: 8000 });
      await sleep(1000);
      rec.row(
        `${label}-add`,
        "Open Add community",
        "PASS",
        `dialog: ${await bodyText(300)}`,
        { screenshot: await shot(page, rec, "add-community") },
      );
    });
  }

  if (mode === "deeplink") {
    // 1) colony:// scheme
    const colony = await openApp(
      `colony://join?relay=wss://${host}&code=${code}`,
    );
    await sleep(8000);
    rec.row(
      `${label}-colony-scheme`,
      "colony://join?... opened with the app running",
      "NOT OBSERVED",
      `colony:// is not a registered external scheme (tauri.conf.json schemes: buzz only). Processes before/after: ${colony.mainProcsBefore}/${colony.mainProcsAfter}. Page after 8 s: ${await bodyText(250)}`,
      { screenshot: await shot(page, rec, "colony-scheme") },
    );
    // 2) buzz:// scheme
    const t = Date.now();
    const bz = await openApp(`buzz://join?relay=wss://${host}&code=${code}`);
    rec.notes.deepLinkProcs = bz;
    const ok = await joined(45000);
    const text = await bodyText(400);
    rec.row(
      `${label}-deeplink`,
      "buzz://join?relay=...&code=... delivered to the running app",
      ok ? "PASS" : "FAIL",
      `${ok ? "Joined, app sidebar visible" : "No app sidebar after 45 s"} after ${Date.now() - t} ms. Procs before/after open: ${bz.mainProcsBefore}/${bz.mainProcsAfter}. Page: ${text}`,
      { screenshot: await shot(page, rec, "deeplink-result") },
    );
  } else {
    // paste or existing: use the invite form
    const t = Date.now();
    await guard(
      `${label}-redeem`,
      "Redeem by pasting the invite URL",
      async () => {
        const join = page.getByTestId("community-choice-join");
        if (await join.isVisible().catch(() => false)) await join.click();
        else {
          const alt = page
            .getByRole("button", { name: /invite|join/iu })
            .or(
              page.getByText(
                /have an invite|join with an invite|join a community/iu,
              ),
            )
            .first();
          if (await alt.isVisible().catch(() => false)) await alt.click();
        }
        await sleep(800);
        rec.notes.redeemScreenControls = (await inventory(page, "body", 40))
          .map((i) => i.testid ?? i.text ?? i.aria)
          .filter(Boolean);
        const input = page.getByTestId("invite-redeem-input").first();
        await input.waitFor({ timeout: 10000 });
        await input.fill(inviteUrl);
        await sleep(400);
        await shot(page, rec, "invite-filled");
        await page.getByTestId("invite-redeem-submit").click();
        // Policy gates may appear (age and terms): tick them if present, record text.
        await sleep(2500);
        const policy = await bodyText(500);
        if (/18 years|Terms of Service|Privacy Policy/iu.test(policy)) {
          rec.notes.policyScreen = policy;
          for (const box of await page
            .locator('input[type="checkbox"],[role="checkbox"]')
            .all())
            await box.click().catch(() => undefined);
          await sleep(400);
          await shot(page, rec, "policy");
          await page
            .getByTestId("invite-redeem-submit")
            .click()
            .catch(() => undefined);
        }
        const ok = await joined(45000);
        rec.row(
          `${label}-redeem`,
          `Redeem pasted invite URL (${which})`,
          ok ? "PASS" : "FAIL",
          `${ok ? "Joined: app sidebar visible" : "No app sidebar after 45 s"} after ${Date.now() - t} ms. Page: ${await bodyText(400)}`,
          { screenshot: await shot(page, rec, "redeem-result") },
        );
      },
    );
  }

  // Membership proof: open general, send a message.
  if (
    await page
      .getByTestId("app-sidebar")
      .isVisible()
      .catch(() => false)
  ) {
    await sleep(3000);
    rec.notes.communities = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("buzz-communities") ?? "[]").map(
          (c) => ({ name: c.name, relayUrl: c.relayUrl }),
        );
      } catch {
        return null;
      }
    });
    await guard(
      `${label}-general`,
      "Open #general in A's community",
      async () => {
        // Make sure A's community is the active one (existing mode keeps own business active unless switched).
        const general = page.getByText(/^general$/iu).first();
        await general.click({ timeout: 10000 });
        await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
        await sleep(1500);
        const header = await bodyText(200);
        rec.row(
          `${label}-general`,
          "Open #general",
          "PASS",
          `timeline visible. Page head: ${header}`,
          { screenshot: await shot(page, rec, "general") },
        );
        // Does the timeline show A's earlier message with an avatar?
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="message-row"]')]
            .slice(-12)
            .map((row) => ({
              author: row
                .querySelector('[data-testid="message-author"]')
                ?.textContent?.trim()
                .slice(0, 40),
              body: row
                .querySelector('[data-testid="message-body"]')
                ?.textContent?.trim()
                .slice(0, 60),
              img: (() => {
                const i = row.querySelector("img");
                return i
                  ? {
                      src: i.currentSrc.slice(0, 90),
                      nat: [i.naturalWidth, i.naturalHeight],
                    }
                  : null;
              })(),
            })),
        );
        rec.notes.generalRows = JSON.parse(clean(JSON.stringify(rows)));
        const msg = `hello from ${label} ${Date.now() % 100000}`;
        const composer = page.getByTestId("message-composer");
        await composer.click();
        await page.keyboard.type(msg);
        await page.keyboard.press("Enter");
        await sleep(2500);
        const seen = await page
          .getByTestId("message-timeline")
          .innerText()
          .then((t) => t.includes(msg))
          .catch(() => false);
        rec.notes.sentMessage = msg;
        rec.row(
          `${label}-send`,
          "Send a message in #general",
          seen ? "PASS" : "FAIL",
          seen
            ? `Own message "${msg}" visible in timeline`
            : "Own message not visible in timeline after 2.5 s",
          { screenshot: await shot(page, rec, "sent") },
        );
      },
    );
    await guard(
      `${label}-members`,
      "B's own view of members and A",
      async () => {
        await page.getByTestId("open-settings").click({ timeout: 8000 });
        const foot = await inventory(
          page,
          '[data-testid="profile-popover"]',
          30,
        );
        rec.notes.popover = foot
          .map((i) => i.testid ?? i.text ?? i.aria)
          .filter(Boolean);
        await page
          .getByTestId("profile-popover-settings")
          .click({ timeout: 8000 });
        await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
        const groups = await page
          .locator('[data-testid^="settings-group-"]')
          .evaluateAll((els) => els.map((e) => e.innerText.trim()));
        rec.notes.settingsGroups = groups;
        rec.notes.settingsFooterText = clean(
          await page
            .getByTestId("settings-profile-avatar-context")
            .innerText()
            .catch(() => ""),
        );
        const people = page
          .locator('[data-testid^="settings-group-"]')
          .filter({ hasText: /people|member/iu })
          .first();
        let membersText = "no People/Members group for this role";
        if (await people.count()) {
          await people.click();
          await page
            .getByTestId("settings-community-members")
            .waitFor({ timeout: 10000 })
            .catch(() => undefined);
          await sleep(1500);
          membersText = clean(
            (
              await page
                .getByTestId("settings-community-members")
                .innerText()
                .catch(() => "")
            )
              .replace(/\s+/gu, " ")
              .slice(0, 500),
          );
        }
        rec.notes.membersView = membersText;
        rec.row(
          `${label}-members`,
          "B sees members list",
          membersText.startsWith("no People") ? "NOT OBSERVED" : "PASS",
          `Settings groups: ${groups.join(", ")}. Footer caption: ${rec.notes.settingsFooterText}. Members: ${membersText}`,
          { screenshot: await shot(page, rec, "members") },
        );
      },
    );
  } else {
    rec.row(
      `${label}-general`,
      "Open #general / send message",
      "NOT OBSERVED",
      "B never reached the app, so membership and messaging were not testable",
      {},
    );
  }
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[${label}] done, ${rec.rows.length} rows`);
}
