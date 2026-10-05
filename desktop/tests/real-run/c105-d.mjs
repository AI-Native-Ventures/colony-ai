// Colony 1.0.5 candidate gate, existing user D (own business) relaunched with the SAME profile (items 3, 4, 5).
// usage: node c105-d.mjs addcommunity   bad code via Add community, quit, relaunch, real invite, member checks
//        node c105-d.mjs escape         after the owner removed D: membership failure, "Switch to" and "Remove"
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Rec,
  closeApp,
  instrument,
  launch,
  loadState,
  progress,
  redact,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

promisify(execFile);
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const [mode = "addcommunity"] = process.argv.slice(2);
const rec = new Rec(`D-${mode}`);
const state = await loadState();
if (!state.D?.userDataDir) throw new Error("no profile D in state");
const inviteUrl = state.invites?.default;
const code = inviteUrl.split("/").pop();
const host = new URL(inviteUrl).host;
const clean = (t) => redact(String(t ?? "").replaceAll(code, "XXXX"));
const profile = {
  privateDir: state.D.privateDir,
  userDataDir: state.D.userDataDir,
};
let application;
let page;
let launchN = 0;
const lifecycle = [];
const start = async () => {
  const load = await waitForLoad();
  launchN += 1;
  await progress(`[D-${mode}] launch ${launchN} load ${load.toFixed(1)}`);
  const s = await launch(profile);
  application = s.application;
  page = s.page;
  rec.notes.version = s.version;
  const at = Date.now();
  application.process().on("exit", (c, sg) =>
    lifecycle.push({
      launch: launchN,
      sinceLaunchMs: Date.now() - at,
      code: c,
      signal: sg,
    }),
  );
  instrument(page, rec, `D#${launchN}`);
  page.on("request", (request) => {
    const url = request.url();
    if (/^(data|blob|file):/u.test(url)) return;
    const u = new URL(url);
    if (
      request.method() !== "GET" ||
      /communit|create|provision/iu.test(u.pathname)
    )
      rec.network.push({
        tag: `D#${launchN}`,
        kind: "request",
        method: request.method(),
        url: clean(`${u.origin}${u.pathname}`),
      });
  });
};
const body = async (n = 500) =>
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
const guard = async (id, label, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(
      id,
      label,
      "FAIL",
      `Step threw ${error.name}: ${clean(error.message).split("\n")[0]}. Page: ${await body(300)}`,
      {
        screenshot: await shot(page, rec, `${id}-error`),
      },
    );
    return undefined;
  }
};
const stored = () =>
  page.evaluate(() => {
    try {
      const list = JSON.parse(localStorage.getItem("buzz-communities") ?? "[]");
      const active = localStorage.getItem("buzz-active-community-id");
      return {
        count: list.length,
        active: list.find((c) => c.id === active)?.name ?? null,
        names: list.map((c) => c.name),
        txn: Boolean(
          localStorage.getItem("buzz-community-onboarding-transaction.v1"),
        ),
      };
    } catch {
      return null;
    }
  });
const reach = async () => ({
  sidebar: await page
    .getByTestId("app-sidebar")
    .isVisible()
    .catch(() => false),
  failureScene: await page
    .getByTestId("onboarding-scene-community-entry-error")
    .isVisible()
    .catch(() => false),
  flow: await page
    .getByTestId("community-onboarding-flow")
    .isVisible()
    .catch(() => false),
  denied: await page
    .getByTestId("membership-denied")
    .isVisible()
    .catch(() => false),
  inviteFailed: await page
    .getByTestId("invite-failed")
    .isVisible()
    .catch(() => false),
});
const addCommunity = async (text, tag) => {
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
  await page
    .getByRole("menuitem", { name: /add (a )?community/iu })
    .first()
    .click({ timeout: 8000 });
  await page.getByTestId("add-community-dialog").waitFor({ timeout: 8000 });
  await sleep(500);
  await page.getByTestId("add-community-join").click({ timeout: 6000 });
  await sleep(600);
  const input = page.getByTestId("invite-redeem-input").first();
  await input.waitFor({ timeout: 8000 });
  await input.fill(text);
  await sleep(400);
  await shot(page, rec, `${tag}-filled`);
  await page.getByTestId("invite-redeem-submit").click();
  await sleep(2500);
  const policy = await body(400);
  if (/18 years|Terms of Service|Privacy Policy/iu.test(policy)) {
    for (const box of await page
      .locator('input[type="checkbox"],[role="checkbox"]')
      .all())
      await box.click().catch(() => undefined);
    await sleep(400);
    await page
      .getByTestId("invite-redeem-submit")
      .click()
      .catch(() => undefined);
  }
};
// Poll screens for ms, recording each distinct one; press the Join confirmation if it shows.
const watchOutcome = async (ms, pressJoin) => {
  const end = Date.now() + ms;
  const trail = [];
  let joinPressed = false;
  while (Date.now() < end) {
    const text = await body(160);
    if (!trail.length || trail[trail.length - 1] !== text.slice(0, 100))
      trail.push(text.slice(0, 100));
    if (
      pressJoin &&
      !joinPressed &&
      (await page
        .getByTestId("invite-join")
        .isVisible()
        .catch(() => false))
    ) {
      for (const box of await page
        .locator('input[type="checkbox"],[role="checkbox"]')
        .all())
        await box.click().catch(() => undefined);
      await shot(page, rec, "join-confirmation");
      await page
        .getByTestId("invite-join")
        .click()
        .catch(() => undefined);
      joinPressed = true;
    }
    const r = await reach();
    if (r.failureScene || r.inviteFailed || r.denied)
      return { kind: "failure", r, trail, joinPressed };
    if (
      r.sidebar &&
      !r.flow &&
      trail.length > 1 &&
      !(await page
        .getByTestId("invite-join")
        .isVisible()
        .catch(() => false))
    )
      return { kind: "app", r, trail, joinPressed };
    await sleep(600);
  }
  return { kind: "timeout", r: await reach(), trail, joinPressed };
};

try {
  await start();
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(3000);
  rec.notes.initialStore = await stored();
  if (mode === "addcommunity") {
    rec.row(
      "D-reach",
      "Relaunch profile D (own business) reaches its workspace",
      "PASS",
      `Store: ${JSON.stringify(rec.notes.initialStore)}. Page: ${await body(160)}`,
      {
        screenshot: await shot(page, rec, "d-01-start"),
      },
    );
    await guard("D-bad", "Add community with a bad code", async () => {
      const t = Date.now();
      await addCommunity(
        `https://${host}/invite/v2.not-a-real-code-0000000000000000000000000`,
        "bad",
      );
      const out = await watchOutcome(30000, true);
      const text = await body(700);
      rec.notes.badOutcome = { kind: out.kind, trail: out.trail, text };
      rec.row(
        "D-bad",
        "Bad code via Add community: what the user sees",
        out.kind === "timeout" ? "NOT OBSERVED" : "PASS",
        `After ${Date.now() - t} ms outcome ${out.kind}. Reach: ${JSON.stringify(out.r)}. Exact text: ${text}. Store: ${JSON.stringify(await stored())}`,
        {
          screenshot: await shot(page, rec, "d-02-bad-result"),
        },
      );
    });
    await guard(
      "D-relaunch",
      "Quit and relaunch after the bad code",
      async () => {
        await closeApp(application);
        await start();
        await page.locator("body").waitFor({ timeout: 20000 });
        await sleep(12000);
        const r = await reach();
        const text = await body(600);
        const st = await stored();
        const ownName = state.D.business ?? "";
        const rawError = /invite_invalid|isn.t ready yet|Try again/u.test(text);
        rec.row(
          "D-relaunch",
          "Relaunch after a bad code: own workspace reachable, nothing cleared test-side",
          r.sidebar && !r.failureScene && !r.flow && !rawError
            ? "PASS"
            : "FAIL",
          `Reach: ${JSON.stringify(r)}. Raw error text: ${rawError}. Store: ${JSON.stringify(st)}. Business: ${ownName}. Page: ${text}`,
          {
            screenshot: await shot(page, rec, "d-03-relaunch"),
          },
        );
      },
    );
    await guard(
      "D-redeem",
      "Redeem the real invite via Add community",
      async () => {
        if (
          !(await page
            .getByTestId("app-sidebar")
            .isVisible()
            .catch(() => false))
        )
          throw new Error("workspace not reachable, cannot continue");
        const t = Date.now();
        await addCommunity(inviteUrl, "redeem");
        const out = await watchOutcome(60000, true);
        const st = await stored();
        rec.notes.redeemOutcome = { kind: out.kind, trail: out.trail };
        rec.row(
          "D-redeem",
          "Existing user joins the inviter's workspace via Add community",
          out.kind === "app" && st?.count === 2 ? "PASS" : "FAIL",
          `Outcome ${out.kind} after ${Date.now() - t} ms, Join confirmation pressed: ${out.joinPressed}. Screens: ${JSON.stringify(out.trail)}. Store: ${JSON.stringify(st)}`,
          {
            screenshot: await shot(page, rec, "d-04-redeemed"),
          },
        );
        if (out.kind === "app") {
          await page
            .getByText(/^general$/iu)
            .first()
            .click({ timeout: 8000 });
          await page
            .getByTestId("message-timeline")
            .waitFor({ timeout: 15000 });
          await sleep(1500);
          const msg = `hello from D ${Date.now() % 100000}`;
          await page
            .locator(
              '[data-testid="message-composer"] [contenteditable="true"]',
            )
            .first()
            .click();
          await page.keyboard.type(msg);
          await page.keyboard.press("Enter");
          await sleep(2500);
          const seen = await page
            .getByTestId("message-timeline")
            .innerText()
            .then((t2) => t2.includes(msg))
            .catch(() => false);
          rec.row(
            "D-send",
            "Existing user sends a message in the inviter's #general",
            seen ? "PASS" : "FAIL",
            `Own message visible: ${seen}`,
            {
              screenshot: await shot(page, rec, "d-05-sent"),
            },
          );
          await page.getByTestId("open-settings").click({ timeout: 8000 });
          await page
            .getByTestId("profile-popover-settings")
            .click({ timeout: 8000 });
          await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
          await sleep(900);
          const caption = clean(
            (
              await page
                .getByTestId("settings-profile-avatar-context")
                .innerText()
                .catch(() => "")
            ).replace(/\s+/gu, " "),
          );
          rec.row(
            "D-role",
            "Caption in the inviter's workspace reads Member for a joined member",
            /\bMember\b/u.test(caption) && !/Workspace owner/u.test(caption)
              ? "PASS"
              : "FAIL",
            `Settings footer text: "${caption}" (active community: ${(await stored())?.active})`,
            {
              screenshot: await shot(page, rec, "d-06-role"),
            },
          );
        }
      },
    );
  }
  if (mode === "escape") {
    // The owner removed D from the inviter's workspace. D's active community is now one it cannot enter.
    await sleep(8000);
    const r = await reach();
    const st = await stored();
    const text = await body(900);
    const switchBtn = page
      .locator('[data-testid^="community-escape-switch-"]')
      .first();
    const removeBtn = page.getByTestId("community-escape-remove").first();
    const hasSwitch = await switchBtn.isVisible().catch(() => false);
    const hasRemove = await removeBtn.isVisible().catch(() => false);
    const switchLabel = hasSwitch ? (await switchBtn.innerText()).trim() : "";
    rec.row(
      "D-fail-screen",
      "Active community fails the membership check: error screen with both escapes",
      hasSwitch && hasRemove ? "PASS" : "FAIL",
      `Reach: ${JSON.stringify(r)}. Store: ${JSON.stringify(st)}. Switch button: ${hasSwitch} ("${switchLabel}"). Remove button: ${hasRemove}. Exact text: ${text}`,
      {
        screenshot: await shot(page, rec, "e-01-fail-screen"),
      },
    );
    await guard("D-switch", "Switch to the other community", async () => {
      await switchBtn.click({ timeout: 6000 });
      await page.getByTestId("app-sidebar").waitFor({ timeout: 40000 });
      await sleep(3000);
      const after = await stored();
      rec.row(
        "D-switch",
        '"Switch to <other>" works: own workspace opens',
        after?.active && after.active !== st?.active ? "PASS" : "FAIL",
        `Active before: ${st?.active}; after: ${after?.active}. Page: ${await body(160)}`,
        {
          screenshot: await shot(page, rec, "e-02-switched"),
        },
      );
    });
    await guard(
      "D-remove",
      "Remove this community from this device",
      async () => {
        // Go back to the failing community, then remove it.
        await page
          .getByTestId("sidebar-profile-avatar-button")
          .click({ timeout: 8000 });
        await sleep(600);
        await page
          .locator(
            '[data-testid="profile-popover"] [data-testid="community-switcher"]',
          )
          .first()
          .click({ timeout: 8000 });
        await sleep(700);
        await shot(page, rec, "e-03-switcher");
        const items = await page.getByRole("menuitem").allInnerTexts();
        const target = page
          .getByRole("menuitem")
          .filter({
            hasText: new RegExp(
              (st?.active ?? "Launch Smoke").split(" ")[0],
              "iu",
            ),
          })
          .first();
        await target.click({ timeout: 6000 });
        await page
          .getByTestId("community-escape-remove")
          .first()
          .waitFor({ timeout: 40000 });
        await shot(page, rec, "e-04-fail-again");
        await page.getByTestId("community-escape-remove").first().click();
        await sleep(600);
        await shot(page, rec, "e-05-confirm");
        await page
          .getByTestId("community-escape-remove-confirm")
          .click({ timeout: 6000 });
        await page.getByTestId("app-sidebar").waitFor({ timeout: 40000 });
        await sleep(3000);
        const after = await stored();
        rec.row(
          "D-remove",
          '"Remove this community from this device" works',
          after?.count === 1 && !after.names.includes(st?.active)
            ? "PASS"
            : "FAIL",
          `Menu items seen: ${items.join(" | ")}. Store after: ${JSON.stringify(after)}. Page: ${await body(160)}`,
          {
            screenshot: await shot(page, rec, "e-06-removed"),
          },
        );
      },
    );
    await guard("D-relaunch-after", "Relaunch after the escape", async () => {
      await closeApp(application);
      await start();
      await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
      await sleep(3000);
      rec.row(
        "D-relaunch-after",
        "Relaunch after removal: own workspace opens",
        "PASS",
        `Store: ${JSON.stringify(await stored())}. Page: ${await body(160)}`,
        {
          screenshot: await shot(page, rec, "e-07-relaunch"),
        },
      );
    });
  }
  rec.notes.createCalls = rec.network.filter(
    (n) => n.kind === "request" && /create-?communit/iu.test(n.url),
  );
} finally {
  rec.notes.lifecycle = lifecycle;
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  if (application) await closeApp(application);
  await progress(`[D-${mode}] done, ${rec.rows.length} rows`);
}
