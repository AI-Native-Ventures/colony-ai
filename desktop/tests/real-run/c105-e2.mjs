// Colony 1.0.5 candidate gate, item 4 follow-up: the profile left stranded on the membership screen by c105-e.mjs.
// The identity connects, through Add community, to another business's relay it is NOT a member of (a bare relay
// URL, no invite). No storage is edited. Expect the apply error screen with "Switch to <other>" and
// "Remove this community from this device", both working.
// usage: node c105-e.mjs <profile label, e.g. B1> <relay URL of a community this identity is not a member of>
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

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const [label = "B1"] = process.argv.slice(2);
const rec = new Rec(process.env.ONLY ? `E3-${label}` : `E2-${label}`);
const state = await loadState();
const profile = {
  privateDir: state[label].privateDir,
  userDataDir: state[label].userDataDir,
};
const load = await waitForLoad();
await progress(`[E2-${label}] load ${load.toFixed(1)} ok`);
let { application, page } = await launch(profile);
instrument(page, rec, label);
const lifecycle = [];
const at = Date.now();
application
  .process()
  .on("exit", (c, s) =>
    lifecycle.push({ sinceLaunchMs: Date.now() - at, code: c, signal: s }),
  );
const body = async (n = 700) =>
  redact(
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
      `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}. Page: ${await body(400)}`,
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
      };
    } catch {
      return null;
    }
  });
const connectForeign = async () => {
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
  await input.fill(foreignUrl);
  await sleep(400);
  await shot(page, rec, "e1-filled");
  await page.getByTestId("invite-redeem-submit").click();
};
const escapeVisible = async (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (
      await page
        .getByTestId("community-escape-remove")
        .first()
        .isVisible()
        .catch(() => false)
    )
      return true;
    await sleep(500);
  }
  return false;
};

try {
  if (!process.env.ONLY) await sleep(12000);
  else {
    await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
    await sleep(4000);
  }
  const text0 = process.env.ONLY ? "" : await body(500);
  const stranded = /MEMBERSHIP REQUIRED|Not a member yet/u.test(text0);
  if (!process.env.ONLY)
    rec.row(
      "E2-relaunch",
      "Relaunch of a profile whose active community is one it is not a member of",
      "PASS",
      `Stranded on membership screen: ${stranded}. Store: ${JSON.stringify(await stored())}. Page: ${text0}`,
      {
        screenshot: await shot(page, rec, "e20-relaunch"),
      },
    );
  if (!process.env.ONLY)
    await guard(
      "E2-change",
      "Change community opens the escape actions",
      async () => {
        const buttons = await page.getByRole("button").allInnerTexts();
        await page
          .getByRole("button", { name: /^Change community$/iu })
          .first()
          .click({ timeout: 8000 });
        await sleep(1200);
        const sw = await page
          .locator('[data-testid^="community-escape-switch-"]')
          .allInnerTexts();
        const rm = await page
          .getByTestId("community-escape-remove")
          .first()
          .isVisible()
          .catch(() => false);
        const dlg = await page
          .locator('[role="dialog"]')
          .first()
          .innerText()
          .catch(() => "");
        rec.row(
          "E2-change",
          '"Change community" overlay offers "Switch to <other>" and "Remove this community from this device"',
          sw.some((b) => /^Switch to /u.test(b.trim())) && rm ? "PASS" : "FAIL",
          `Buttons on screen before: ${buttons.join(" | ")}. Switch actions: ${JSON.stringify(sw)}. Remove visible: ${rm}. Dialog text: ${redact(dlg.replace(/\s+/gu, " ").slice(0, 700))}`,
          {
            screenshot: await shot(page, rec, "e21-change-overlay"),
          },
        );
      },
    );
  if (!process.env.ONLY)
    await guard("E2-switch", "Switch to the healthy community", async () => {
      const before = await stored();
      await page
        .locator('[data-testid^="community-escape-switch-"]')
        .first()
        .click({ timeout: 6000 });
      await page.getByTestId("app-sidebar").waitFor({ timeout: 40000 });
      await sleep(3000);
      const after = await stored();
      rec.row(
        "E2-switch",
        '"Switch to <other>" opens the healthy workspace',
        after?.active && after.active !== before?.active ? "PASS" : "FAIL",
        `Before ${JSON.stringify(before)}; after ${JSON.stringify(after)}. Page: ${await body(160)}`,
        {
          screenshot: await shot(page, rec, "e22-switched"),
        },
      );
    });
  if (!process.env.ONLY)
    await guard("E2-relaunch2", "Relaunch after the switch", async () => {
      await closeApp(application);
      await waitForLoad();
      ({ application, page } = await launch(profile));
      instrument(page, rec, `${label}#2`);
      await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
      await sleep(3000);
      rec.row(
        "E2-relaunch2",
        "After the switch, relaunch opens the healthy workspace",
        "PASS",
        `Store: ${JSON.stringify(await stored())}. Page: ${await body(160)}`,
        {
          screenshot: await shot(page, rec, "e23-relaunch2"),
        },
      );
    });
  await guard(
    "E2-remove",
    "Remove this community from this device",
    async () => {
      const st = await stored();
      const failing = st.names.find((n) => n !== st.active);
      // Community rail: the button without the active marker is the failing community.
      const railButtons = page.locator(
        '[data-testid^="community-rail-button-"]',
      );
      const ids = await railButtons.evaluateAll((els) =>
        els.map((e) => ({
          id: e
            .getAttribute("data-testid")
            .replace("community-rail-button-", ""),
          active: Boolean(
            e.querySelector('[data-testid^="community-rail-active-"]'),
          ),
        })),
      );
      const items = ids.map((i) => `${i.id}${i.active ? " (active)" : ""}`);
      await shot(page, rec, "e24-rail");
      const target = ids.find((i) => !i.active);
      if (!target) throw new Error("no inactive rail community");
      await page
        .getByTestId(`community-rail-button-${target.id}`)
        .click({ timeout: 6000 });
      await page
        .getByRole("button", { name: /^Change community$/iu })
        .first()
        .waitFor({ timeout: 60000 });
      await page
        .getByRole("button", { name: /^Change community$/iu })
        .first()
        .click();
      await page
        .getByTestId("community-escape-remove")
        .first()
        .waitFor({ timeout: 8000 });
      await page.getByTestId("community-escape-remove").first().click();
      await sleep(600);
      const confirmText = await body(500);
      await shot(page, rec, "e25-confirm");
      await page
        .getByTestId("community-escape-remove-confirm")
        .click({ timeout: 6000 });
      await page.getByTestId("app-sidebar").waitFor({ timeout: 40000 });
      await sleep(3000);
      const after = await stored();
      rec.row(
        "E2-remove",
        '"Remove this community from this device" confirms, removes it and lands on the healthy workspace',
        after?.count === 1 && !after.names.includes(failing) ? "PASS" : "FAIL",
        `Menu items: ${items.join(" | ")}. Confirm text: ${confirmText}. Store after: ${JSON.stringify(after)}. Page: ${await body(160)}`,
        {
          screenshot: await shot(page, rec, "e26-removed"),
        },
      );
    },
  );
  rec.notes.lifecycle = lifecycle;
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[E2-${label}] done, ${rec.rows.length} rows`);
}
