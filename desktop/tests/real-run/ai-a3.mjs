// Phase A3 (and A4): relaunch profile A after cofounders joined. Members list (names, roles, avatars), B's
// messages in #general, invite dialog has no revoke or list control, then remove a member by name.
// usage: node ai-a3.mjs <phaseLabel A3|A4> <memberLabel to remove, e.g. B3 | none>
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  OUT,
  Rec,
  closeApp,
  instrument,
  inventory,
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
const [phase = "A3", removeLabel = "none"] = process.argv.slice(2);
const rec = new Rec(phase);
const state = await loadState();
const load = await waitForLoad();
await progress(
  `[${phase}] load ${load.toFixed(1)} ok, relaunching A, remove=${removeLabel}`,
);
const { application, page, version } = await launch({
  privateDir: state.A.privateDir,
  userDataDir: state.A.userDataDir,
});
rec.notes.version = version;
instrument(page, rec, "A");
const guard = async (id, label, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(
      id,
      label,
      "FAIL",
      `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`,
      { screenshot: await shot(page, rec, `${id}-error`) },
    );
    return undefined;
  }
};
try {
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await sleep(6000);
  await guard(
    `${phase}-messages`,
    "A sees cofounder messages in #general",
    async () => {
      await page
        .getByText(/^general$/iu)
        .first()
        .click({ timeout: 8000 });
      await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
      await sleep(2500);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="message-row"]')]
          .slice(-20)
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
              const i = row.querySelector("img");
              return i
                ? {
                    nat: [i.naturalWidth, i.naturalHeight],
                    kind: i.currentSrc.startsWith("data:") ? "data" : "url",
                  }
                : "none";
            })(),
          })),
      );
      rec.notes.generalRows = rows;
      const fromB = rows.filter((r) => /hello from B/u.test(r.body ?? ""));
      rec.row(
        `${phase}-messages`,
        "A sees cofounder messages in #general",
        fromB.length ? "PASS" : "FAIL",
        fromB.length
          ? `Cofounder messages seen: ${JSON.stringify(fromB)}`
          : `No 'hello from B' message in the last ${rows.length} rows: ${JSON.stringify(rows).slice(0, 600)}`,
        { screenshot: await shot(page, rec, "general") },
      );
    },
  );
  const people = async () => {
    await page.getByTestId("open-settings").click({ timeout: 8000 });
    await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    await page.getByTestId("settings-group-business").click();
    await sleep(500);
    await page.getByTestId("settings-inner-people").click();
    await page
      .getByTestId("settings-community-members")
      .waitFor({ timeout: 15000 });
    await sleep(2500);
  };
  const readMembers = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="relay-member-row-"]')].map(
        (row) => ({
          name: row
            .querySelector('[data-testid^="relay-member-name-"]')
            ?.textContent?.trim()
            .slice(0, 40),
          meta: row
            .querySelector("[data-settings-subcopy]")
            ?.textContent?.replace(/\s+/gu, " ")
            .trim()
            .slice(0, 80),
          avatar: row.querySelector("img") ? "image" : "initials/fallback",
        }),
      ),
    );
  await guard(`${phase}-members`, "A's members list", async () => {
    await people();
    const members = await readMembers();
    rec.notes.members = members;
    const names =
      state &&
      Object.keys(state)
        .filter((k) => /^B\d/u.test(k))
        .map((k) => state[k].name);
    const missing = names.filter((n) => !members.some((m) => m.name === n));
    rec.row(
      `${phase}-members`,
      "Members list names, roles and avatars",
      members.length > 1 ? "PASS" : "FAIL",
      `Rows: ${JSON.stringify(members)}. Expected cofounder names present (those that completed a join are expected): ${names.join(", ")}; not found by exact name: ${missing.join(", ") || "none"}`,
      { screenshot: await shot(page, rec, "members") },
    );
  });
  await guard(
    `${phase}-revoke`,
    "Invite dialog: revoke or list invites?",
    async () => {
      await page.getByTestId("community-invite-dialog-trigger").click();
      await page
        .getByTestId("community-invite-dialog")
        .waitFor({ timeout: 8000 });
      await sleep(1500);
      const inv = await inventory(
        page,
        '[data-testid="community-invite-dialog"]',
        60,
      );
      const revoke = inv.filter((i) =>
        /revoke|cancel invite|delete invite|active invites|manage invites/iu.test(
          `${i.testid ?? ""} ${i.aria ?? ""} ${i.text ?? ""}`,
        ),
      );
      rec.row(
        `${phase}-revoke`,
        "A can revoke or list previously minted invites (UI)",
        revoke.length ? "PASS" : "FAIL",
        revoke.length
          ? JSON.stringify(revoke)
          : `No revoke or list control. Dialog controls: ${inv
              .map((i) => i.testid ?? i.text ?? i.aria)
              .filter(Boolean)
              .join(
                " | ",
              )}. Relay exposes only POST /api/invites, /api/invites/claim, /api/invites/accept-policy (router.rs:127-143)`,
        { screenshot: await shot(page, rec, "invite-dialog") },
      );
      await page.keyboard.press("Escape");
      await sleep(600);
    },
  );
  if (removeLabel !== "none" && state[removeLabel]) {
    await guard(`${phase}-remove`, "A removes the cofounder", async () => {
      const name = state[removeLabel].name;
      const row = page
        .locator('[data-testid^="relay-member-row-"]')
        .filter({ hasText: name })
        .first();
      await row.waitFor({ timeout: 8000 });
      await shot(page, rec, "before-remove");
      await row.locator('[data-testid^="relay-member-actions-"]').click();
      await sleep(400);
      await page
        .getByRole("menuitem", { name: /remove from community/iu })
        .click();
      await sleep(1500);
      const toasts = await page
        .locator("[data-sonner-toast]")
        .allInnerTexts()
        .catch(() => []);
      await sleep(2500);
      const still = await page
        .locator('[data-testid^="relay-member-row-"]')
        .filter({ hasText: name })
        .count();
      rec.row(
        `${phase}-remove`,
        `Remove ${removeLabel} from the community (no confirm dialog expected)`,
        still === 0 ? "PASS" : "FAIL",
        `Toasts: ${toasts.join(" | ") || "none"}. Rows still named ${name}: ${still}. Members now: ${JSON.stringify(await readMembers())}`,
        { screenshot: await shot(page, rec, "after-remove") },
      );
    });
  } else
    rec.row(
      `${phase}-remove`,
      "A removes a cofounder",
      "NOT OBSERVED",
      "No joined cofounder to remove in this phase",
      {},
    );
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[${phase}] done, ${rec.rows.length} rows`);
}
