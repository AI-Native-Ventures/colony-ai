// Phase A2: relaunch profile A with the SAME user-data dir. Checks avatar persistence (QA3), the member
// list entry points (QA1 member list), then mints invites (QB1) and curls the landing page (QB2).
// usage: COLONY_REAL_RUN=1 node ai-a2.mjs   (through heavy.sh)
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import {
  OUT,
  Rec,
  closeApp,
  cleanUrl,
  instrument,
  inventory,
  launch,
  loadState,
  progress,
  redact,
  saveState,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

const run = promisify(execFile);
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const rec = new Rec("A2");
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("run A1 first");
const load = await waitForLoad();
await progress(
  `[A2] load ${load.toFixed(1)} ok, relaunching profile A (same dir)`,
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
const imgInfo = (testid) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    const img = el?.tagName === "IMG" ? el : el?.querySelector("img");
    return {
      present: Boolean(el),
      img: img
        ? {
            src: img.currentSrc.slice(0, 120),
            nat: [img.naturalWidth, img.naturalHeight],
            complete: img.complete,
          }
        : null,
      text: (el?.innerText ?? "").slice(0, 30),
    };
  }, testid);
try {
  await guard(
    "QA3-relaunch",
    "Relaunch profile A and reach the app",
    async () => {
      await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
      await sleep(4000);
      rec.row(
        "QA3-relaunch",
        "Relaunch with same profile dir reaches the signed-in app",
        "PASS",
        "app-sidebar visible after relaunch",
        { screenshot: await shot(page, rec, "qa3-relaunched") },
      );
      const info = await imgInfo("open-settings");
      rec.notes.sidebarAvatarAfterRelaunch = JSON.parse(
        redact(JSON.stringify(info)),
      );
      rec.row(
        "QA3-persist",
        "Avatar still shown in sidebar after relaunch",
        info.img && info.img.nat[0] > 0 ? "PASS" : "FAIL",
        JSON.stringify(info),
        {},
      );
    },
  );
  // Member list entry points.
  const entries = {};
  await guard("QA1-team", "Entry point: Team screen own row", async () => {
    await page.getByTestId("sidebar-company-team").click({ timeout: 10000 });
    await sleep(1500);
    entries.team = await inventory(page, "body", 60);
    const rows = await page
      .locator('[data-testid^="company-team-member-"]')
      .count();
    rec.row(
      "QA1-team",
      "Entry point: Team screen lists people; own profile reachable?",
      rows ? "PASS" : "NOT OBSERVED",
      `${rows} team rows. Rows are for ${rows ? "employees/agents (human owner row not guaranteed)" : "none"}`,
      { screenshot: await shot(page, rec, "qa1-team") },
    );
  });
  await guard(
    "QA1-general",
    "Entry point: general channel members",
    async () => {
      // Back to a channel
      const channel = page
        .locator('[data-testid^="channel-"]')
        .filter({ hasText: /general/iu })
        .first();
      await channel.click({ timeout: 8000 }).catch(async () => {
        await page
          .getByText(/^general$/iu)
          .first()
          .click({ timeout: 5000 });
      });
      await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
      await sleep(1200);
      entries.general = await inventory(page, "body", 80);
      rec.row(
        "QA1-general-open",
        "Opened #general",
        "PASS",
        "message-timeline visible",
        { screenshot: await shot(page, rec, "qa1-general") },
      );
    },
  );
  await writeFile(
    path.join(OUT, "entries-A2.json"),
    JSON.stringify(entries, null, 2),
  );
  // Settings > People
  await guard("QB1-people", "Open Settings > members", async () => {
    await page.getByTestId("open-settings").click({ timeout: 8000 });
    await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    const groups = await page
      .locator('[data-testid^="settings-group-"]')
      .evaluateAll((els) =>
        els.map((e) => ({
          id: e.getAttribute("data-testid"),
          text: e.innerText.trim(),
        })),
      );
    rec.notes.settingsGroups = groups;
    const people = groups.find((g) =>
      /people|member/iu.test(`${g.id} ${g.text}`),
    );
    if (!people)
      throw new Error(
        `no people/members group among: ${groups.map((g) => g.text).join(",")}`,
      );
    await page.getByTestId(people.id).click();
    await page
      .getByTestId("settings-community-members")
      .waitFor({ timeout: 15000 });
    await sleep(1200);
    entries.members = await inventory(
      page,
      '[data-testid="settings-community-members"]',
      60,
    );
    rec.row(
      "QB1-people",
      "Invite entry point: Settings > " +
        people.text +
        " shows the members card with an invite trigger",
      (await page.getByTestId("community-invite-dialog-trigger").count())
        ? "PASS"
        : "FAIL",
      `group "${people.text}" (${people.id}); trigger text: "${(
        await page
          .getByTestId("community-invite-dialog-trigger")
          .innerText()
          .catch(() => "")
      ).trim()}"`,
      { screenshot: await shot(page, rec, "qb1-members") },
    );
  });
  // Open invite dialog, read generated link and options.
  const invites = {};
  const readLink = async () => {
    const preview = page.getByTestId("invite-link-preview");
    await preview.waitFor({ timeout: 25000 });
    return (await preview.innerText()).trim();
  };
  await guard("QB1-link", "Invite dialog and link", async () => {
    const t = Date.now();
    await page.getByTestId("community-invite-dialog-trigger").click();
    await page
      .getByTestId("community-invite-dialog")
      .waitFor({ timeout: 8000 });
    const url = await readLink();
    invites.default = url;
    const shape = redact(url);
    rec.notes.inviteShape = shape;
    rec.notes.inviteDialogText = (
      await page.getByTestId("community-invite-dialog").innerText()
    )
      .replace(/\s+/gu, " ")
      .slice(0, 500);
    rec.row(
      "QB1-link",
      "Invite link generates",
      "PASS",
      `Link generated in ${Date.now() - t} ms. Shape: ${shape}`,
      { screenshot: await shot(page, rec, "qb1-invite-dialog") },
    );
    // Expiry options
    await page.getByTestId("invite-link-ttl-trigger").click();
    const ttl = await page
      .locator(
        '[data-testid^="invite-link-ttl-"]:not([data-testid$="trigger"])',
      )
      .allInnerTexts();
    rec.notes.ttlOptions = ttl;
    await shot(page, rec, "qb1-ttl-options");
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.getByTestId("invite-link-max-uses-trigger").click();
    const uses = await page
      .locator(
        '[data-testid^="invite-link-max-uses-"]:not([data-testid$="trigger"])',
      )
      .allInnerTexts();
    rec.notes.maxUsesOptions = uses;
    await shot(page, rec, "qb1-uses-options");
    rec.row(
      "QB1-options",
      "Expiry and max-uses options",
      ttl.length && uses.length ? "PASS" : "FAIL",
      `Expiry: ${ttl.join(", ")}. Max uses: ${uses.join(", ")}. Default expiry: ${(await page.getByTestId("invite-link-ttl-trigger").innerText()).trim()}`,
      {},
    );
    // Single-use invite I2: choose "1 use" (this mints a NEW invite).
    await page.getByTestId("invite-link-max-uses-1").click();
    await sleep(800);
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="invite-link-url"]')?.disabled,
      null,
      { timeout: 25000 },
    );
    invites.single = await readLink();
    rec.row(
      "QB1-single",
      "Single-use invite minted ('1 use')",
      invites.single !== invites.default ? "PASS" : "FAIL",
      `Distinct from default: ${invites.single !== invites.default}. Shape: ${redact(invites.single)}`,
      { screenshot: await shot(page, rec, "qb1-single-use") },
    );
  });
  state.invites = invites;
  await saveState(state);
  rec.notes.emailInvite =
    "Direct add form accepts a name search or a pubkey (npub/hex), not an email address (AddMemberDialog.tsx)";
  await guard("QB1-direct", "Direct add option present", async () => {
    const direct = page.getByTestId("direct-add-member-form");
    rec.row(
      "QB1-direct",
      "Invite dialog also has a direct add form (not email)",
      (await direct.count()) ? "PASS" : "FAIL",
      `placeholder: ${await page
        .getByTestId("member-pubkey-input")
        .getAttribute("placeholder")
        .catch(() => "n/a")}; role control: ${(
        await page
          .getByTestId("member-role")
          .innerText()
          .catch(() => "")
      ).trim()}`,
      {},
    );
  });
  // QB2: curl the landing page with the REAL minted code (read only GET).
  await guard("QB2-curl", "GET invite URL", async () => {
    const url = invites.default;
    const { stdout } = await run(
      "curl",
      [
        "-sS",
        "-m",
        "20",
        "-L",
        "-D",
        "-",
        "-o",
        path.join(OUT, "invite-landing.html"),
        url,
      ],
      { maxBuffer: 1 << 20 },
    );
    const status = stdout
      .split("\n")
      .filter((l) => /^HTTP\//u.test(l))
      .pop()
      ?.trim();
    const ctype = stdout
      .split("\n")
      .find((l) => /^content-type:/iu.test(l))
      ?.trim();
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(path.join(OUT, "invite-landing.html"), "utf8");
    const title = body.match(/<title>([^<]*)<\/title>/iu)?.[1];
    rec.notes.landing = { status, ctype, title, bytes: body.length };
    // Scripts load the SPA, so also record asset references.
    rec.notes.landingAssets = [...body.matchAll(/(?:src|href)="([^"]+)"/gu)]
      .map((m) => m[1])
      .slice(0, 12);
    // Redact the code in the saved copy
    await writeFile(
      path.join(OUT, "invite-landing.html"),
      redact(body.replaceAll(url.split("/").pop(), "XXXX")),
    );
    rec.row(
      "QB2-curl",
      "GET invite URL (curl)",
      status?.includes("200") ? "PASS" : "FAIL",
      `${status}; ${ctype}; <title>${title}</title>; ${body.length} bytes (raw HTML, SPA shell). Assets: ${rec.notes.landingAssets.join(", ")}`,
      {},
    );
  });
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[A2] done, ${rec.rows.length} rows`);
}
