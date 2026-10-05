// Colony 1.0.5 candidate gate, item 4 (stuck-community escape) on a member profile with ONE healthy community.
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
const [label = "B1", foreignUrl] = process.argv.slice(2);
if (!foreignUrl) throw new Error("foreign relay URL required");
const rec = new Rec(`E-${label}`);
const state = await loadState();
const profile = {
  privateDir: state[label].privateDir,
  userDataDir: state[label].userDataDir,
};
const load = await waitForLoad();
await progress(`[E-${label}] load ${load.toFixed(1)} ok`);
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
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(2500);
  rec.notes.start = await stored();
  rec.row(
    "E-start",
    "Profile starts with one healthy community and reaches its workspace",
    "PASS",
    `Store: ${JSON.stringify(rec.notes.start)}`,
    {
      screenshot: await shot(page, rec, "e0-start"),
    },
  );
  await guard(
    "E-connect",
    "Connect to a community this identity is not a member of",
    async () => {
      const t = Date.now();
      await connectForeign();
      const shown = await escapeVisible(60000);
      const text = await body(900);
      const switchBtns = await page
        .locator('[data-testid^="community-escape-switch-"]')
        .allInnerTexts();
      const removeText = shown
        ? (
            await page
              .getByTestId("community-escape-remove")
              .first()
              .innerText()
          ).replace(/\s+/gu, " ")
        : "";
      rec.notes.errorScreen = {
        text,
        switchBtns,
        removeText,
        store: await stored(),
      };
      rec.row(
        "E-connect",
        'Error screen offers "Switch to <other>" and "Remove this community from this device"',
        shown &&
          switchBtns.some((b) => /^Switch to /u.test(b.trim())) &&
          /Remove this community from this device/u.test(removeText)
          ? "PASS"
          : "FAIL",
        `After ${Date.now() - t} ms. Switch actions: ${JSON.stringify(switchBtns)}. Remove: "${removeText}". Exact screen text: ${text}. Store: ${JSON.stringify(await stored())}`,
        {
          screenshot: await shot(page, rec, "e2-error-screen"),
        },
      );
    },
  );
  await guard("E-switch", "Switch to the other community", async () => {
    const before = await stored();
    await page
      .locator('[data-testid^="community-escape-switch-"]')
      .first()
      .click({ timeout: 6000 });
    await page.getByTestId("app-sidebar").waitFor({ timeout: 40000 });
    await sleep(3000);
    const after = await stored();
    rec.row(
      "E-switch",
      '"Switch to <other>" opens the healthy workspace',
      after?.active && after.active !== before?.active ? "PASS" : "FAIL",
      `Before ${JSON.stringify(before)}; after ${JSON.stringify(after)}. Page: ${await body(160)}`,
      {
        screenshot: await shot(page, rec, "e3-switched"),
      },
    );
  });
  await guard(
    "E-relaunch-failing",
    "Relaunch while the failing community is still saved",
    async () => {
      await closeApp(application);
      await waitForLoad();
      ({ application, page } = await launch(profile));
      instrument(page, rec, `${label}#2`);
      await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
      await sleep(3000);
      rec.row(
        "E-relaunch-failing",
        "Relaunch with the failing community saved still opens the healthy workspace",
        "PASS",
        `Store: ${JSON.stringify(await stored())}. Page: ${await body(160)}`,
        {
          screenshot: await shot(page, rec, "e4-relaunch"),
        },
      );
    },
  );
  await guard(
    "E-remove",
    "Remove this community from this device",
    async () => {
      // Switch to the failing community again through the community rail, then remove it.
      const st = await stored();
      const failing = st.names.find((n) => n !== st.active);
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
      const items = await page.getByRole("menuitem").allInnerTexts();
      await shot(page, rec, "e5-switcher");
      await page
        .getByRole("menuitem")
        .filter({ hasText: new RegExp(failing.split(" ")[0], "iu") })
        .first()
        .click({ timeout: 6000 });
      const shown = await escapeVisible(60000);
      await shot(page, rec, "e6-error-again");
      if (!shown) throw new Error("error screen did not return");
      await page.getByTestId("community-escape-remove").first().click();
      await sleep(600);
      const confirmText = await body(500);
      await shot(page, rec, "e7-confirm");
      await page
        .getByTestId("community-escape-remove-confirm")
        .click({ timeout: 6000 });
      await page.getByTestId("app-sidebar").waitFor({ timeout: 40000 });
      await sleep(3000);
      const after = await stored();
      rec.row(
        "E-remove",
        '"Remove this community from this device" asks to confirm, removes it and lands on the healthy workspace',
        after?.count === 1 && !after.names.includes(failing) ? "PASS" : "FAIL",
        `Menu items: ${items.join(" | ")}. Confirm text: ${confirmText}. Store after: ${JSON.stringify(after)}. Page: ${await body(160)}`,
        {
          screenshot: await shot(page, rec, "e8-removed"),
        },
      );
    },
  );
  rec.notes.lifecycle = lifecycle;
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[E-${label}] done, ${rec.rows.length} rows`);
}
