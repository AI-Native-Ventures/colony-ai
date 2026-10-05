// Phase B: a cofounder profile redeems an invite to A's community. Local only (COLONY_REAL_RUN=1).
// usage: node ai-b.mjs <label> <mode> <invite default|single> [reuse]
//  paste:    fresh install, new account; look for a place to paste the invite URL (no business is created)
//  deeplink: fresh install; open colony:// then buzz:// links while the app sits at the account screen,
//            then create the account and record the next screen (no business is created)
//  existing: new account WITH its own business (business 2 of max 2), then Add community: a garbage code
//            first (error text), then the real invite URL
//  rejoin:   relaunch a kept profile (arg 4 = label whose dir to reuse): state after removal, then a
//            buzz:// deep link while the app runs, then Add community with the same invite (used/removed)
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
  enterApp,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

const run = promisify(execFile);
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const [label = "B1", mode = "paste", which = "default", reuse] =
  process.argv.slice(2);
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
const profile = reuse
  ? {
      privateDir: state[reuse].privateDir,
      userDataDir: state[reuse].userDataDir,
    }
  : await newProfile(label);
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
const communityState = () =>
  page.evaluate((h) => {
    try {
      const list = JSON.parse(localStorage.getItem("buzz-communities") ?? "[]");
      return {
        has: list.some((c) => String(c.relayUrl ?? "").includes(h)),
        active:
          list.find(
            (c) => c.id === localStorage.getItem("buzz-active-community-id"),
          )?.relayUrl ?? null,
        count: list.length,
      };
    } catch {
      return { has: false, active: null, count: -1 };
    }
  }, host);
// Joined = A's host is stored, active, no onboarding scene covers the app, sidebar visible.
const joined = async (timeoutMs) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const st = await communityState();
    const errorEl = page.getByTestId("onboarding-scene-community-entry-error");
    if (await errorEl.isVisible().catch(() => false))
      return {
        ok: false,
        error: clean(
          (await errorEl.innerText().catch(() => ""))
            .replace(/\s+/gu, " ")
            .slice(0, 300),
        ),
        st,
      };
    const denied = page.getByTestId("membership-denied");
    if (await denied.isVisible().catch(() => false))
      return {
        ok: false,
        error: `membership-denied: ${clean((await denied.innerText().catch(() => "")).replace(/\s+/gu, " ").slice(0, 300))}`,
        st,
      };
    const flow = await page
      .getByTestId("community-onboarding-flow")
      .isVisible()
      .catch(() => false);
    if (
      st.has &&
      st.active?.includes(host) &&
      !flow &&
      (await page
        .getByTestId("app-sidebar")
        .isVisible()
        .catch(() => false))
    )
      return { ok: true, st };
    await sleep(700);
  }
  return {
    ok: false,
    error: `timeout, page: ${await bodyText(250)}`,
    st: await communityState(),
  };
};
const openApp = async (url) => {
  // Always target the published bundle explicitly: plain `open buzz://` resolves to the installed
  // /Applications/Colony.app (the owner's real app), which this test must never touch.
  const pat = "Colony-1.0.4-published/Colony.app/Contents/MacOS/Colony";
  const owner = (
    await run("pgrep", [
      "-f",
      "^/Applications/Colony.app/Contents/MacOS/",
    ]).catch(() => ({ stdout: "" }))
  ).stdout.trim();
  if (owner)
    throw new Error(
      "the installed /Applications/Colony.app is running; refusing to send a deep link",
    );
  const count = async () =>
    (await run("pgrep", ["-f", pat]).catch(() => ({ stdout: "" }))).stdout
      .split("\n")
      .filter(Boolean).length;
  const before = await count();
  await run("open", ["-a", APP, url]);
  await sleep(1500);
  return { mainProcsBefore: before, mainProcsAfter: await count() };
};
// Open Add community from the profile menu, choose Join, paste text, submit.
const addCommunityRedeem = async (text, tag) => {
  await page
    .getByTestId("sidebar-profile-avatar-button")
    .click({ timeout: 8000 });
  await sleep(700);
  await page
    .locator(
      '[data-testid="profile-popover"] [data-testid="community-switcher"]',
    )
    .first()
    .click({ timeout: 8000 });
  await sleep(600);
  const item = page
    .getByRole("menuitem", { name: /add (a )?community/iu })
    .first();
  await item.click({ timeout: 8000 });
  await page.getByTestId("add-community-dialog").waitFor({ timeout: 8000 });
  await sleep(500);
  await shot(page, rec, `${tag}-dialog`);
  await page.getByTestId("add-community-join").click({ timeout: 6000 });
  await sleep(600);
  const input = page.getByTestId("invite-redeem-input").first();
  await input.waitFor({ timeout: 8000 });
  rec.notes[`${tag}Labels`] = clean(
    (await page.getByTestId("add-community-dialog").innerText())
      .replace(/\s+/gu, " ")
      .slice(0, 300),
  );
  await input.fill(text);
  await sleep(400);
  await shot(page, rec, `${tag}-filled`);
  await page.getByTestId("invite-redeem-submit").click();
  await sleep(2500);
  const policy = await bodyText(400);
  if (/18 years|Terms of Service|Privacy Policy/iu.test(policy)) {
    rec.notes[`${tag}Policy`] = policy;
    for (const box of await page
      .locator('input[type="checkbox"],[role="checkbox"]')
      .all())
      await box.click().catch(() => undefined);
    await sleep(400);
    await shot(page, rec, `${tag}-policy`);
    await page
      .getByTestId("invite-redeem-submit")
      .click()
      .catch(() => undefined);
  }
};
const memberChecks = async () => {
  await sleep(2500);
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
    "Open #general of A's community and send a message",
    async () => {
      const general = page.getByText(/^general$/iu).first();
      await general.click({ timeout: 10000 });
      await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
      await sleep(1500);
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
              .slice(0, 70),
            avatar: (() => {
              const i = row.querySelector(
                '[data-testid="message-avatar"] img, img',
              );
              return i ? { nat: [i.naturalWidth, i.naturalHeight] } : "none";
            })(),
          })),
      );
      rec.notes.generalRows = JSON.parse(clean(JSON.stringify(rows)));
      const msg = `hello from ${label} ${Date.now() % 100000}`;
      await page
        .locator(
          '[data-testid="message-composer"] [contenteditable="true"], [data-testid="message-composer"] textarea',
        )
        .first()
        .click();
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
        "Send a message in A's #general",
        seen ? "PASS" : "FAIL",
        `${seen ? `Own message visible in timeline` : "Own message not visible after 2.5 s"}. Recent rows seen before sending: ${JSON.stringify(rec.notes.generalRows).slice(0, 500)}`,
        { screenshot: await shot(page, rec, "general-sent") },
      );
    },
  );
  await guard(`${label}-members`, "B's own settings view", async () => {
    await page.getByTestId("open-settings").click({ timeout: 8000 });
    await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    await sleep(800);
    rec.notes.settingsFooterText = clean(
      await page
        .getByTestId("settings-profile-avatar-context")
        .innerText()
        .catch(() => ""),
    );
    const groups = await page
      .locator('[data-testid^="settings-group-"]')
      .evaluateAll((els) => els.map((e) => e.innerText.trim()));
    rec.notes.settingsGroups = groups;
    let membersText = "no People group reachable";
    const biz = page.getByTestId("settings-group-business");
    if (await biz.count()) {
      await biz.click();
      await sleep(600);
      const tab = page.getByTestId("settings-inner-people");
      if (await tab.count()) {
        await tab.click();
        await sleep(1500);
        membersText = clean(
          (
            await page
              .locator('[data-testid="settings-panel-people"]')
              .innerText()
              .catch(() => "")
          )
            .replace(/\s+/gu, " ")
            .slice(0, 400),
        );
      }
    }
    rec.notes.membersView = membersText;
    rec.row(
      `${label}-members`,
      "Member's view of People settings and footer caption",
      "PASS",
      `Footer caption under own name: "${rec.notes.settingsFooterText}". Groups: ${groups.join(", ")}. People panel: ${membersText}`,
      { screenshot: await shot(page, rec, "members-view") },
    );
  });
};
try {
  const t0 = Date.now();
  if (mode === "addcommunity") {
    await page
      .getByTestId("app-sidebar")
      .or(page.getByTestId("onboarding-scene-community-entry-error"))
      .or(page.getByTestId("community-onboarding-flow"))
      .first()
      .waitFor({ timeout: 40000 })
      .catch(() => undefined);
    await sleep(3000);
    rec.notes.relaunchPage = await bodyText(300);
    rec.row(
      `${label}-relaunch`,
      "Relaunch B3 profile (own business) and reach the app",
      "PASS",
      `Page: ${await bodyText(200)}`,
      { screenshot: await shot(page, rec, "relaunch") },
    );
    // Clear a persisted failed onboarding transaction from the earlier invalid-code run, if any.
    for (let i = 0; i < 3; i++) {
      const stuck =
        (await page
          .getByTestId("onboarding-scene-community-entry-error")
          .isVisible()
          .catch(() => false)) ||
        (await page
          .getByTestId("community-onboarding-flow")
          .isVisible()
          .catch(() => false));
      if (!stuck) break;
      rec.notes.stuckScene = `relaunch landed on the failed-community scene: ${await bodyText(200)}`;
      await shot(page, rec, `stuck-${i}`);
      // The failed transaction survives relaunch and has no way out except retrying the same bad code.
      // Test-only cleanup so the real invite can still be exercised (disclosed in the report).
      rec.row(
        `${label}-stuck`,
        "After a bad invite, relaunch returns to the failed-community scene",
        "FAIL",
        `Relaunch with a persisted failed claim shows: ${await bodyText(260)}. Buttons: Try again, Change community. Cleared test-side by removing localStorage key buzz-community-onboarding-transaction.v1 and reloading.`,
        { screenshot: await shot(page, rec, "stuck-final") },
      );
      await page.evaluate(() =>
        localStorage.removeItem("buzz-community-onboarding-transaction.v1"),
      );
      await page.reload();
      await sleep(6000);
    }
    if (!process.env.SKIP_INVALID)
      await guard(
        `${label}-invalid`,
        "Add community with an invalid code",
        async () => {
          await addCommunityRedeem(
            `https://${host}/invite/v2.not-a-real-code-0000000000000000000000000`,
            "invalid",
          );
          const result = await joined(25000);
          rec.row(
            `${label}-invalid`,
            "Invalid invite code: error shown to the user",
            !result.ok && result.error ? "PASS" : "FAIL",
            `Exact visible text: ${result.error ?? "none"}`,
            { screenshot: await shot(page, rec, "invalid-result") },
          );
          await page
            .getByRole("button", { name: /change community|cancel|back/iu })
            .first()
            .click({ timeout: 4000 })
            .catch(() => undefined);
          await sleep(1200);
        },
      );
    const t = Date.now();
    await guard(
      `${label}-redeem`,
      "Redeem pasted invite URL via Add community",
      async () => {
        await addCommunityRedeem(inviteUrl, "redeem");
        const result = await joined(70000);
        rec.row(
          `${label}-redeem`,
          `Add community with the real invite URL (${which})`,
          result.ok ? "PASS" : "FAIL",
          `${result.ok ? "Joined A's community" : `Not joined: ${result.error}`} in ${Date.now() - t} ms. Stored: ${JSON.stringify(result.st)}`,
          { screenshot: await shot(page, rec, "redeem-result") },
        );
        if (result.ok) await memberChecks();
      },
    );
  } else if (mode === "rejoin") {
    // Relaunch of a kept profile. Record what B sees now, then try the buzz:// deep link and the Add community path.
    await page
      .getByTestId("app-sidebar")
      .waitFor({ timeout: 60000 })
      .catch(() => undefined);
    await sleep(4000);
    const st = await communityState();
    rec.row(
      `${label}-relaunch`,
      "Relaunch kept profile: state after owner removal",
      "PASS",
      `A's community stored: ${st.has}, active: ${redact(String(st.active))}. Page: ${await bodyText(300)}`,
      { screenshot: await shot(page, rec, "relaunch-state") },
    );
    const t = Date.now();
    const bz = await openApp(`buzz://join?relay=wss://${host}&code=${code}`);
    const result = await joined(60000);
    rec.row(
      `${label}-deeplink`,
      `buzz://join deep link to the running app (${which})`,
      result.ok ? "PASS" : "FAIL",
      `${result.ok ? "Joined" : `Not joined: ${result.error}`} after ${Date.now() - t} ms. Procs ${bz.mainProcsBefore}/${bz.mainProcsAfter}`,
      { screenshot: await shot(page, rec, "deeplink-result") },
    );
    if (!result.ok) {
      // Dismiss and retry through Add community to compare.
      await page
        .getByRole("button", { name: /change community|cancel|back/iu })
        .first()
        .click({ timeout: 4000 })
        .catch(() => undefined);
    }
    if (result.ok) await memberChecks();
  } else {
    const inbox =
      mode === "deeplink"
        ? undefined
        : await guard(`${label}-account`, "Create account", () =>
            signUp(page, rec, `Smoke ${label}`),
          );
    if (mode === "deeplink") {
      // Account screen first, deep links while the app sits there.
      await page
        .getByTestId("machine-onboarding-gate")
        .waitFor({ timeout: 30000 });
      const colony = await openApp(
        `colony://join?relay=wss://${host}&code=${code}`,
      );
      await sleep(5000);
      rec.row(
        `${label}-colony-scheme`,
        "colony://join?... sent to the running app",
        "NOT OBSERVED",
        `No reaction expected: colony:// is not a registered deep link scheme (tauri.conf.json: buzz only; deep-links.mjs isDeepLinkUrl). Procs ${colony.mainProcsBefore}/${colony.mainProcsAfter}. Page after 5 s: ${await bodyText(220)}`,
        { screenshot: await shot(page, rec, "colony-scheme") },
      );
      const bz = await openApp(`buzz://join?relay=wss://${host}&code=${code}`);
      await sleep(5000);
      const text = await bodyText(400);
      const gate = await page
        .getByTestId("pending-invite-continue")
        .isVisible()
        .catch(() => false);
      rec.notes.deepLinkProcs = bz;
      rec.row(
        `${label}-deeplink-gate`,
        "buzz://join sent while the app is at the Account screen",
        gate || /community link|once setup/iu.test(text) ? "PASS" : "FAIL",
        `Pending-invite gate visible: ${gate}. Page: ${text}`,
        { screenshot: await shot(page, rec, "deeplink-gate") },
      );
      if (gate)
        await page
          .getByTestId("pending-invite-continue")
          .click()
          .catch(() => undefined);
      await sleep(800);
    }
    const acct =
      mode === "deeplink"
        ? await guard(`${label}-account`, "Create account", () =>
            signUp(page, rec, `Smoke ${label}`),
          )
        : inbox;
    if (!acct) throw new Error("no account");
    state[label] = {
      email: acct.email,
      password: acct.password,
      userDataDir: profile.userDataDir,
      privateDir: profile.privateDir,
      name: `Smoke ${label}`,
      mode,
    };
    await saveState(state);
    await sleep(3000);
    const text = await bodyText(500);
    const controls = (await inventory(page, "body", 40))
      .map((i) => i.testid ?? i.text ?? i.aria)
      .filter(Boolean);
    rec.notes.afterVerifyControls = controls;
    rec.row(
      `${label}-account`,
      "Fresh install: create account and verify",
      "PASS",
      `Verified in ${Date.now() - t0} ms. Screen after verify: ${text}. Controls: ${controls.join(" | ")}`,
      { screenshot: await shot(page, rec, "after-verify") },
    );

    if (mode === "paste" || mode === "deeplink") {
      // Is there any way to reach the invite form from here?
      const joinish = await page
        .getByText(
          /invite|join (a|an|with)|already have a community|have an invite/iu,
        )
        .count();
      const formVisible = await page
        .getByTestId("invite-redeem-input")
        .first()
        .isVisible()
        .catch(() => false);
      const businessForm = await page
        .getByLabel("Business name", { exact: true })
        .isVisible()
        .catch(() => false);
      rec.row(
        `${label}-redeem`,
        mode === "paste"
          ? "Fresh install: paste the invite URL somewhere (WelcomeSetup or Add community)"
          : "Fresh install: deep link outcome after account creation",
        formVisible ? "PASS" : "FAIL",
        `Invite input visible: ${formVisible}. Business-name form visible: ${businessForm}. Join/invite wording on screen: ${joinish} matches. No business was created (limit). Page: ${text}`,
        { screenshot: await shot(page, rec, "after-verify-wall") },
      );
      if (formVisible && mode === "paste") {
        await page.getByTestId("invite-redeem-input").first().fill(inviteUrl);
        await page.getByTestId("invite-redeem-submit").click();
        const result = await joined(60000);
        rec.row(
          `${label}-redeem-result`,
          "Paste invite URL result",
          result.ok ? "PASS" : "FAIL",
          `${result.ok ? "Joined" : result.error}`,
          { screenshot: await shot(page, rec, "redeem-result") },
        );
        if (result.ok) await memberChecks();
      }
    }
    if (mode === "existing") {
      const tb = Date.now();
      const biz = `Avatar invite ${acct.email.split("@")[0].replace("colony-launch-check-", "")}`;
      await createBusiness(page, biz).catch(async (e) => {
        rec.row(
          `${label}-business`,
          "Create own business (2 of max 2)",
          "FAIL",
          `${e.name}. Page: ${await bodyText(300)}`,
          { screenshot: await shot(page, rec, "business-fail") },
        );
        throw e;
      });
      await enterApp(page);
      state[label].business = biz;
      await saveState(state);
      rec.row(
        `${label}-business`,
        "Create own business and open app",
        "PASS",
        `done in ${Date.now() - tb} ms`,
        { screenshot: await shot(page, rec, "own-app") },
      );
      await sleep(3000);
      // 1) garbage code on A's host: error text
      await guard(
        `${label}-invalid`,
        "Add community with an invalid code",
        async () => {
          await addCommunityRedeem(
            `https://${host}/invite/v2.not-a-real-code-0000000000000000000000000`,
            "invalid",
          );
          const result = await joined(25000);
          rec.row(
            `${label}-invalid`,
            "Invalid invite code: error shown to the user",
            !result.ok && result.error ? "PASS" : "FAIL",
            `Exact visible text: ${result.error ?? "none"}`,
            { screenshot: await shot(page, rec, "invalid-result") },
          );
          await page
            .getByRole("button", { name: /change community|cancel|back/iu })
            .first()
            .click({ timeout: 4000 })
            .catch(() => undefined);
          await sleep(1200);
        },
      );
      // 2) the real invite URL
      const t = Date.now();
      await guard(
        `${label}-redeem`,
        "Redeem pasted invite URL via Add community",
        async () => {
          await addCommunityRedeem(inviteUrl, "redeem");
          const result = await joined(70000);
          rec.row(
            `${label}-redeem`,
            `Add community with the real invite URL (${which})`,
            result.ok ? "PASS" : "FAIL",
            `${result.ok ? "Joined A's community" : `Not joined: ${result.error}`} in ${Date.now() - t} ms. Stored: ${JSON.stringify(result.st)}`,
            { screenshot: await shot(page, rec, "redeem-result") },
          );
          if (result.ok) await memberChecks();
        },
      );
    }
  }
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[${label}] done, ${rec.rows.length} rows`);
}
