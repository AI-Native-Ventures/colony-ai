// Colony 1.0.5 candidate gate, invited newcomers (items 1, 2, 3). Local only (COLONY_REAL_RUN=1).
// usage: node c105-b.mjs <label> <mode> <invite default|single> [reuse-label]
//  url:        fresh install, paste the invite URL under "Have an invite link?", create the account, expect
//              the invite scene, press Join, send a message. NEVER creates a business.
//  code:       same, but only the bare code plus the workspace address.
//  bz-account: buzz://join delivered to the running app at the Account screen (second-instance argv), quit and
//              relaunch the SAME profile, create the account, quit and relaunch at the invite scene, Join.
//  colony-cold: colony://join passed as launch argv (cold start), quit and relaunch, create account, Join.
//  scheme-account: colony://join at the Account screen only (no account is created).
//  bz-cold:    buzz://join passed as launch argv (cold start) only (no account is created).
//  used:       paste a used single-use invite, create the account, press Join, expect the failure scene, quit
//              and relaunch the SAME profile and record what the user can reach.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Rec,
  closeApp,
  instrument,
  inventory,
  launch,
  loadState,
  newProfile,
  progress,
  redact,
  saveState,
  sendDeepLink,
  shot,
  signUp,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

promisify(execFile);
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const [label = "B1", mode = "url", which = "default", reuse] =
  process.argv.slice(2);
const rec = new Rec(label);
rec.notes.mode = mode;
const state = await loadState();
const inviteUrl = state.invites?.[which];
if (!inviteUrl) throw new Error(`no ${which} invite in state`);
const code = inviteUrl.split("/").pop();
const host = new URL(inviteUrl).host;
const relayWs = `wss://${host}`;
const clean = (text) => redact(String(text ?? "").replaceAll(code, "XXXX"));

let launchN = 0;
let application;
let page;
let bizSeen = [];
let bizTimer;
let launchedAt = 0;
const profile = reuse
  ? {
      privateDir: state[reuse].privateDir,
      userDataDir: state[reuse].userDataDir,
    }
  : await newProfile(label);
const lifecycle = [];
const startApp = async (extraArgs = []) => {
  const load = await waitForLoad();
  launchN += 1;
  await progress(
    `[${label}] launch ${launchN} load ${load.toFixed(1)} mode ${mode} invite ${which}`,
  );
  const started = await launch({ ...profile, extraArgs });
  application = started.application;
  page = started.page;
  launchedAt = Date.now();
  rec.notes.version = started.version;
  application.process().on("exit", (exitCode, signal) =>
    lifecycle.push({
      launch: launchN,
      sinceLaunchMs: Date.now() - launchedAt,
      exitCode,
      signal,
    }),
  );
  instrument(page, rec, `${label}#${launchN}`);
  // Every non-GET request and anything that looks like community creation, URL path only.
  page.on("request", (request) => {
    const url = request.url();
    if (/^(data|blob|file):/u.test(url)) return;
    if (
      request.method() !== "GET" ||
      /communit|create|provision/iu.test(new URL(url).pathname)
    )
      rec.network.push({
        tag: `${label}#${launchN}`,
        kind: "request",
        method: request.method(),
        url: clean(`${new URL(url).origin}${new URL(url).pathname}`),
      });
  });
  // Poll for any business form: the invited newcomer must never see one.
  bizSeen = [];
  bizTimer = setInterval(async () => {
    try {
      const hit = await page.evaluate(() => {
        const t = document.body?.innerText ?? "";
        return /Business name|Read website|What does your business do/iu.test(t)
          ? t.replace(/\s+/gu, " ").slice(0, 160)
          : null;
      });
      if (hit && bizSeen.length < 3)
        bizSeen.push({ atMs: Date.now() - launchedAt, launch: launchN, hit });
    } catch {
      /* page gone */
    }
  }, 400);
  return started;
};
const stopApp = async () => {
  clearInterval(bizTimer);
  await closeApp(application);
};
const bodyText = async (n = 500) =>
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
const gate = () => page.getByTestId("machine-onboarding-gate");
const hasInviteBrand = async () => {
  const brand = page.getByTestId("invite-brand").first();
  return (await brand.isVisible().catch(() => false))
    ? clean((await brand.innerText()).replace(/\s+/gu, " "))
    : null;
};
// Wait until one of: invite brand on the Account screen, pending-invite gate, invite scene, or timeout.
const waitInviteSignal = async (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const brand = await hasInviteBrand();
    if (brand) return { kind: "account-invite-brand", text: brand };
    if (
      await page
        .getByTestId("pending-invite-gate")
        .isVisible()
        .catch(() => false)
    )
      return { kind: "pending-invite-gate", text: await bodyText(200) };
    if (
      await page
        .getByText(/You.re invited/u)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return { kind: "invite-scene", text: await bodyText(300) };
    await sleep(400);
  }
  return { kind: "none", text: await bodyText(300) };
};
// The invite scene: exact strings from the task brief.
const readInviteScene = async (email, tag) => {
  await page
    .getByText(/You.re invited/u)
    .first()
    .waitFor({ timeout: 30000 });
  const text = await bodyText(700);
  const join = await page
    .getByTestId("invite-join")
    .innerText()
    .catch(() => "");
  const checks = {
    heading: /You.re invited\./u.test(text),
    joinButton: /^Join\s+\S+/u.test(join.trim()),
    memberNotice: email
      ? text.includes(`You’ll join as a team member using ${email}`) ||
        text.includes(`You'll join as a team member using ${email}`)
      : /You.ll join as a team member/u.test(text),
    noBusinessFormNow: !/Business name|Read website/u.test(text),
  };
  rec.notes[`${tag}Scene`] = { text, join, checks };
  return { text, join, checks };
};
const pressJoin = async () => {
  const joinBtn = page.getByTestId("invite-join");
  await joinBtn.waitFor({ timeout: 20000 });
  // Policy consent, if the workspace asks for it.
  for (const box of await page
    .locator('input[type="checkbox"],[role="checkbox"]')
    .all())
    await box.click().catch(() => undefined);
  await sleep(500);
  await joinBtn.click({ timeout: 8000 });
};
// Track every distinct screen (first 90 chars of text) until the sidebar or a failure scene shows.
const waitJoined = async (ms) => {
  const end = Date.now() + ms;
  const trail = [];
  while (Date.now() < end) {
    const text = await bodyText(120);
    if (!trail.length || trail[trail.length - 1] !== text.slice(0, 90))
      trail.push(text.slice(0, 90));
    if (
      await page
        .getByTestId("invite-failed")
        .isVisible()
        .catch(() => false)
    )
      return { ok: false, failed: true, trail };
    if (
      await page
        .getByTestId("app-sidebar")
        .isVisible()
        .catch(() => false)
    )
      return { ok: true, trail };
    await sleep(500);
  }
  return { ok: false, failed: false, trail };
};
const memberChecks = async (tag) => {
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
    `${tag}-general`,
    "Open #general and send a message",
    async () => {
      await page
        .getByText(/^general$/iu)
        .first()
        .click({ timeout: 10000 });
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
              return i
                ? { nat: [i.naturalWidth, i.naturalHeight], ok: i.complete }
                : "none";
            })(),
          })),
      );
      rec.notes[`${tag}Rows`] = JSON.parse(clean(JSON.stringify(rows)));
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
        `${tag}-send`,
        "Send a message in the inviter's #general",
        seen ? "PASS" : "FAIL",
        `${seen ? "Own message visible in timeline" : "Own message NOT visible after 2.5 s"}. Rows seen before sending: ${JSON.stringify(rec.notes[`${tag}Rows`]).slice(0, 600)}`,
        { screenshot: await shot(page, rec, `${tag}-general-sent`) },
      );
    },
  );
  await guard(`${tag}-role`, "Member sees its real role caption", async () => {
    await page.getByTestId("open-settings").click({ timeout: 8000 });
    await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    await sleep(900);
    const caption = clean(
      await page
        .getByTestId("settings-profile-avatar-context")
        .innerText()
        .catch(() => ""),
    );
    rec.notes[`${tag}Caption`] = caption;
    const flat = caption.replace(/\s+/gu, " ");
    rec.row(
      `${tag}-role`,
      'Plain member footer caption reads "Member", not "Workspace owner"',
      /\bMember\b/u.test(flat) && !/Workspace owner/u.test(flat)
        ? "PASS"
        : "FAIL",
      `Settings footer text: "${flat}"`,
      { screenshot: await shot(page, rec, `${tag}-role-caption`) },
    );
  });
};
const createCalls = () =>
  rec.network.filter(
    (n) =>
      n.kind === "request" &&
      /create-?communit|communities|provision/iu.test(n.url) &&
      n.method !== "GET",
  );
const noBusinessRow = (id) =>
  rec.row(
    id,
    "No business form at any point (polled every 400 ms across all launches)",
    bizSeen.length ? "FAIL" : "PASS",
    bizSeen.length
      ? `Business form text seen: ${JSON.stringify(bizSeen)}`
      : `Never seen in ${launchN} launch(es). Non-GET community/create requests from the renderer: ${createCalls().length}.`,
    {},
  );

try {
  const t0 = Date.now();
  await startApp(
    mode === "colony-cold" || mode === "bz-cold" ? [deepUrl()] : [],
  );
  await guard(`${label}-gate`, "Account screen opens", async () => {
    await gate().waitFor({ timeout: 40000 });
    rec.row(
      `${label}-gate`,
      "Account screen opens",
      "PASS",
      `In ${Date.now() - t0} ms. Text: ${await bodyText(300)}`,
      { screenshot: await shot(page, rec, "01-account-screen") },
    );
  });

  if (mode === "url" || mode === "code" || mode === "used") {
    await guard(
      `${label}-have-invite`,
      'Find "Have an invite link?"',
      async () => {
        const entry = page.getByTestId("have-invite-link");
        await entry.waitFor({ timeout: 10000 });
        const visibleText = (await entry.innerText()).trim();
        const googleOnScreen = /Continue with Google/iu.test(
          await bodyText(900),
        );
        await entry.click();
        await page.locator("#invite-link").waitFor({ timeout: 10000 });
        rec.row(
          `${label}-have-invite`,
          'Account screen offers "Have an invite link?" and opens the invite step',
          visibleText === "Have an invite link?" ? "PASS" : "FAIL",
          `Entry text "${visibleText}". Continue with Google also on this screen: ${googleOnScreen}. Invite step: ${await bodyText(300)}`,
          { screenshot: await shot(page, rec, "02-invite-step") },
        );
      },
    );
    await guard(`${label}-paste`, `Paste invite (${mode})`, async () => {
      if (mode === "code") {
        await page.locator("#invite-link").fill(code);
        await page.locator("#invite-address").waitFor({ timeout: 5000 });
        await page.locator("#invite-address").fill(host);
      } else await page.locator("#invite-link").fill(inviteUrl);
      await sleep(400);
      await shot(page, rec, "03-invite-filled");
      await page.getByTestId("invite-link-continue").click();
      const signal = await waitInviteSignal(10000);
      rec.row(
        `${label}-paste`,
        mode === "code"
          ? "Bare code plus workspace address accepted"
          : "Invite URL accepted and held for sign-up",
        signal.kind === "none" ? "FAIL" : "PASS",
        `Signal: ${signal.kind}. ${signal.text}`,
        { screenshot: await shot(page, rec, "04-after-continue") },
      );
    });
  }

  if (mode === "scheme-account" || mode === "bz-account") {
    await guard(
      `${label}-deeplink`,
      "Deep link delivered to the running instance",
      async () => {
        const scheme = mode === "bz-account" ? "buzz" : "colony";
        const sent = await sendDeepLink(
          profile,
          `${scheme}://join?relay=${relayWs}&code=${code}`,
        );
        const signal = await waitInviteSignal(15000);
        const procs = (
          await promisify(execFile)("pgrep", [
            "-fc",
            profile.userDataDir,
          ]).catch(() => ({ stdout: "?" }))
        ).stdout.trim();
        rec.row(
          `${label}-deeplink`,
          `${scheme}://join while the app sits on the Account screen`,
          signal.kind === "none" ? "FAIL" : "PASS",
          `Method: ${sent.method}, second process exited: ${sent.exited} (code ${sent.code}) after ${sent.ms} ms; processes for this profile: ${procs}. Signal: ${signal.kind}. Page: ${signal.text}`,
          { screenshot: await shot(page, rec, "04-after-deeplink") },
        );
        if (signal.kind === "pending-invite-gate") {
          await page
            .getByTestId("pending-invite-continue")
            .click()
            .catch(() => undefined);
          await sleep(800);
          await shot(page, rec, "05-after-gate-continue");
        }
      },
    );
  }

  if (mode === "colony-cold") {
    await guard(
      `${label}-cold`,
      "Cold start with a colony:// link",
      async () => {
        const signal = await waitInviteSignal(12000);
        rec.row(
          `${label}-cold`,
          "colony://join passed at launch (cold start)",
          signal.kind === "none" ? "FAIL" : "PASS",
          `Signal: ${signal.kind}. ${signal.text}`,
          { screenshot: await shot(page, rec, "04-cold-start-link") },
        );
      },
    );
  }
  if (mode === "bz-cold") {
    await guard(`${label}-cold`, "Cold start with a buzz:// link", async () => {
      const signal = await waitInviteSignal(12000);
      rec.row(
        `${label}-cold`,
        "buzz://join passed at launch (cold start)",
        signal.kind === "none" ? "FAIL" : "PASS",
        `Signal: ${signal.kind}. ${signal.text}`,
        { screenshot: await shot(page, rec, "04-cold-start-link") },
      );
    });
  }

  // Quit and relaunch the SAME profile before sign-up: the invite must survive.
  if (mode === "bz-account" || mode === "colony-cold") {
    await guard(
      `${label}-relaunch1`,
      "Quit and relaunch before sign-up: invite survives",
      async () => {
        await stopApp();
        await startApp();
        await gate().waitFor({ timeout: 40000 });
        const signal = await waitInviteSignal(10000);
        rec.row(
          `${label}-relaunch1`,
          "Quit and relaunch the same profile in the middle of sign-up: invite still pending",
          signal.kind === "none" ? "FAIL" : "PASS",
          `Signal: ${signal.kind}. ${signal.text}`,
          { screenshot: await shot(page, rec, "05-relaunch-before-signup") },
        );
      },
    );
  }

  if (mode === "resume") {
    // Relaunched profile with a verified account and a pending invite: sign in, expect the invite scene, Join.
    const creds = state[reuse];
    const signal = await waitInviteSignal(10000);
    rec.row(
      `${label}-resume-start`,
      "Relaunch of a profile that stopped at the invite scene",
      "PASS",
      `Lands on: ${signal.kind}. ${signal.text}`,
      {
        screenshot: await shot(page, rec, "05-resume-start"),
      },
    );
    await guard(
      `${label}-signin`,
      "Sign in again and reach the invite scene",
      async () => {
        const link = page
          .getByRole("button", { name: /^Sign in$/iu })
          .or(page.getByRole("link", { name: /^Sign in$/iu }))
          .or(page.getByText(/^Sign in$/u))
          .first();
        await link.click({ timeout: 8000 });
        await page
          .getByTestId("account-auth-submit-signin")
          .waitFor({ timeout: 8000 });
        await sleep(500);
        await page.getByLabel(/Email/iu).first().fill(creds.email);
        await page
          .getByLabel(/Password/iu)
          .first()
          .fill(creds.password);
        await shot(page, rec, "06-signin-form");
        const ts = Date.now();
        await page.getByTestId("account-auth-submit-signin").click();
        const scene = await readInviteScene(creds.email, "resume");
        const ok =
          scene.checks.heading &&
          scene.checks.joinButton &&
          scene.checks.memberNotice &&
          scene.checks.noBusinessFormNow;
        rec.row(
          `${label}-signin`,
          "After sign-in the invite scene is shown again",
          ok ? "PASS" : "FAIL",
          `Scene ${Date.now() - ts} ms after sign-in. Checks ${JSON.stringify(scene.checks)}. Text: ${scene.text}`,
          {
            screenshot: await shot(page, rec, "07-scene-after-signin"),
          },
        );
        const t = Date.now();
        await pressJoin();
        const result = await waitJoined(70000);
        rec.row(
          `${label}-join`,
          "Press Join and land in the workspace as a member",
          result.ok ? "PASS" : "FAIL",
          `${result.ok ? "Sidebar visible" : `Not joined: ${await bodyText(300)}`} after ${Date.now() - t} ms. Screens: ${JSON.stringify(result.trail)}`,
          {
            screenshot: await shot(page, rec, "08-after-join"),
          },
        );
        if (result.ok) await memberChecks(label);
      },
    );
    noBusinessRow(`${label}-nobiz`);
  } else if (mode === "scheme-account" || mode === "bz-cold") {
    noBusinessRow(`${label}-nobiz`);
  } else {
    let inbox;
    inbox = await guard(
      `${label}-account`,
      "Create account and verify",
      async () => {
        const ts = Date.now();
        const made = await signUp(page, rec, `Smoke ${label}`);
        state[label] = {
          email: made.email,
          password: made.password,
          userDataDir: profile.userDataDir,
          privateDir: profile.privateDir,
          name: `Smoke ${label}`,
          mode,
          invite: which,
        };
        await saveState(state);
        rec.notes.accountSignupMs = Date.now() - ts;
        return made;
      },
    );
    if (inbox) {
      await guard(
        `${label}-scene`,
        "Invite scene after account creation",
        async () => {
          const ts = Date.now();
          const scene = await readInviteScene(inbox.email, "first");
          const ok =
            scene.checks.heading &&
            scene.checks.joinButton &&
            scene.checks.memberNotice &&
            scene.checks.noBusinessFormNow;
          rec.row(
            `${label}-scene`,
            'Invite scene shows "You\'re invited.", "Join <Business>", member notice with the email',
            ok ? "PASS" : "FAIL",
            `Scene reached ${Date.now() - ts} ms after verification submit. Checks: ${JSON.stringify(scene.checks)}. Join button: "${scene.join}". Text: ${scene.text}`,
            { screenshot: await shot(page, rec, "06-invite-scene") },
          );
        },
      );

      if (mode === "bz-account") {
        await guard(
          `${label}-relaunch2`,
          "Quit and relaunch at the invite scene",
          async () => {
            await stopApp();
            await startApp();
            await page.locator("body").waitFor({ timeout: 20000 });
            const signal = await waitInviteSignal(25000);
            rec.row(
              `${label}-relaunch2`,
              "Quit and relaunch the same profile at the invite scene: invite still offered",
              signal.kind === "invite-scene" ? "PASS" : "FAIL",
              `Signal after relaunch: ${signal.kind}. ${signal.text}`,
              { screenshot: await shot(page, rec, "07-relaunch-at-scene") },
            );
          },
        );
      }

      if (mode === "used") {
        await guard(
          `${label}-join-used`,
          "Press Join with a used code",
          async () => {
            const ts = Date.now();
            await pressJoin();
            const result = await waitJoined(30000);
            const text = await bodyText(600);
            const buttons = await page
              .locator('[data-testid="invite-failed"] button')
              .allInnerTexts()
              .catch(() => []);
            rec.notes.usedFailure = { text, buttons };
            rec.row(
              `${label}-join-used`,
              'Used code: plain failure wording with "Try a different link" and "Create my own business instead"',
              result.failed &&
                /That invite didn.t work/u.test(text) &&
                buttons.some((b) => /Try a different link/u.test(b)) &&
                buttons.some((b) => /Create my own business instead/u.test(b))
                ? "PASS"
                : "FAIL",
              `After ${Date.now() - ts} ms. Failure scene: ${result.failed}. Buttons: ${buttons.join(" | ")}. Exact text: ${text}`,
              { screenshot: await shot(page, rec, "08-failure-scene") },
            );
          },
        );
        await guard(
          `${label}-relaunch-failed`,
          "Quit and relaunch after a failed claim",
          async () => {
            await stopApp();
            await startApp();
            await page.locator("body").waitFor({ timeout: 20000 });
            await sleep(9000);
            const text = await bodyText(600);
            const failureScene = await page
              .getByTestId("invite-failed")
              .isVisible()
              .catch(() => false);
            const raw = /invite_invalid|isn.t ready yet|Try again/u.test(text);
            const reachable = {
              sidebar: await page
                .getByTestId("app-sidebar")
                .isVisible()
                .catch(() => false),
              accountGate: await gate()
                .isVisible()
                .catch(() => false),
              inviteLinkEntry: await page
                .getByTestId("have-invite-link")
                .isVisible()
                .catch(() => false),
              businessForm: await page
                .getByLabel("Business name", { exact: true })
                .isVisible()
                .catch(() => false),
              signIn: await page
                .getByRole("button", { name: /^Sign in$/iu })
                .first()
                .isVisible()
                .catch(() => false),
            };
            rec.notes.relaunchAfterFailure = { text, reachable };
            rec.row(
              `${label}-relaunch-failed`,
              "Relaunch the same profile after a failed claim: no persisted failure screen",
              !failureScene && !raw && Object.values(reachable).some(Boolean)
                ? "PASS"
                : "FAIL",
              `Failure scene visible: ${failureScene}. Raw error text visible: ${raw}. Reachable: ${JSON.stringify(reachable)}. Page: ${text}`,
              {
                screenshot: await shot(page, rec, "09-relaunch-after-failure"),
              },
            );
          },
        );
      } else {
        const t = Date.now();
        await guard(`${label}-join`, "Press Join", async () => {
          await pressJoin();
          const result = await waitJoined(70000);
          rec.notes.joinTrail = result.trail;
          rec.row(
            `${label}-join`,
            "Press Join and land in the workspace as a member",
            result.ok ? "PASS" : "FAIL",
            `${result.ok ? "Sidebar visible" : result.failed ? `Failure scene: ${await bodyText(300)}` : `Timeout: ${await bodyText(300)}`} after ${Date.now() - t} ms. Screens in between: ${JSON.stringify(result.trail)}`,
            { screenshot: await shot(page, rec, "10-after-join") },
          );
          if (result.ok) await memberChecks(label);
        });
      }
    }
    noBusinessRow(`${label}-nobiz`);
  }
  rec.notes.lifecycle = lifecycle;
  rec.notes.createCalls = createCalls();
} finally {
  rec.notes.endedAt = new Date().toISOString();
  rec.notes.lifecycle = lifecycle;
  await rec.write();
  await stopApp().catch(() => undefined);
  await progress(`[${label}] done, ${rec.rows.length} rows`);
}

function deepUrl() {
  const scheme = mode === "bz-cold" ? "buzz" : "colony";
  return `${scheme}://join?relay=${relayWs}&code=${code}`;
}
void inventory;
void path;
void readFile;
