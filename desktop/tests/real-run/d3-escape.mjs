// Delta gate D3: a removed member relaunches and must see the community escape screen (PR 247), not raw relay text and not an
// empty shell. DOM read from desktop/src (community-apply-error, community-escape-*) and tests/e2e/removed-member-escape.spec.ts.
//   node d3-escape.mjs <profile label> one            one community: Retry stays on the screen, Remove lands on first-run join
//   node d3-escape.mjs <profile label> two <invite>   two communities (the second joined by invite): Switch works, then A re-invites
//                                                    through the deep link and Retry returns to the removed community's workspace
import {
  Rec,
  closeApp,
  instrument,
  launch,
  loadState,
  progress,
  redact,
  sendDeepLink,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";
import { readFile } from "node:fs/promises";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI) throw new Error("COLONY_REAL_RUN=1 required");
const [label, mode = "one", secondInviteFile] = process.argv.slice(2);
const rec = new Rec(`D3-${label}-${mode}`);
const state = await loadState();
const profile = { privateDir: state[label].privateDir, userDataDir: state[label].userDataDir };
// Same pattern as the product e2e spec (removed-member-escape.spec.ts RAW_RELAY_TEXT) plus the wrapper text seen after Retry.
const RAW = /relay returned \d{3}|owned-agent query failed|403 Forbidden/iu;
await waitForLoad();
await progress(`[D3-${label}-${mode}] relaunching profile ${label}`);
let { application, page, version } = await launch(profile);
instrument(page, rec, label);
const body = async (n = 700) => redact((await page.locator("body").innerText().catch(() => "")).replace(/\s+/gu, " ").slice(0, n));
const stored = () =>
  page.evaluate(() => {
    try {
      const list = JSON.parse(localStorage.getItem("buzz-communities") ?? "null");
      const active = localStorage.getItem("buzz-active-community-id");
      return { count: list?.length ?? 0, active: list?.find((c) => c.id === active)?.name ?? null, items: (list ?? []).map((c) => ({ id: c.id, name: c.name })) };
    } catch {
      return null;
    }
  });
const guard = async (id, name, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(id, name, "FAIL", `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}. Page: ${await body(500)}`, { screenshot: await shot(page, rec, `${id}-error`) });
    return undefined;
  }
};
const screen = () => page.getByTestId("community-apply-error");
const waitScreen = async (ms) => screen().waitFor({ timeout: ms }).then(() => true, () => false);
const describeScreen = async () => ({
  message: redact((await page.getByTestId("community-apply-error-message").innerText().catch(() => "")).replace(/\s+/gu, " ")),
  buttons: (await screen().locator("button").allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean),
  switchList: await page.getByTestId("community-escape-switch").count().catch(() => 0),
  rawVisible: RAW.test(await page.locator("body").innerText().catch(() => "")),
  sidebarAvatar: await page.getByTestId("sidebar-profile-avatar-button").count().catch(() => 0),
});
try {
  rec.row(`D3-version`, "App reports version 1.0.5", version === "1.0.5" ? "PASS" : "FAIL", `app.getVersion() = ${version}`);
  if (mode === "retry2") {
    // Delta gate 2 (PR 250): Retry twice while still refused, read the Details line after each Retry, then Remove and a re-invite.
    const FORBIDDEN = /relay returned|relay owned-agent query failed|\b403\b|Forbidden|owned-agent/iu;
    const detailsText = async () => redact((await page.getByTestId("community-apply-error-details").innerText().catch(() => "(no details line)")).replace(/\s+/gu, " "));
    await guard("R1b-screen", "Removed member sees the escape screen", async () => {
      const appeared = await waitScreen(90000);
      const d = appeared ? await describeScreen() : null;
      const details = appeared ? await detailsText() : "";
      rec.row(
        "R1b-screen",
        "Removed member with ONE community sees the escape screen, plain message, no raw relay text",
        appeared && !d.rawVisible && !FORBIDDEN.test(details) && /not a member/iu.test(d.message) ? "PASS" : "FAIL",
        appeared ? `Message: "${d.message}". Buttons: ${d.buttons.join(" | ")}. Details line before any Retry: "${details}". Raw relay text visible: ${d.rawVisible}. Store: ${JSON.stringify(await stored())}` : `Escape screen never appeared in 90 s. Page: ${await body(600)}`,
        { screenshot: await shot(page, rec, "r1b-screen") },
      );
    });
    for (const n of [1, 2]) {
      await guard(`R1b-retry-${n}`, `Retry ${n}`, async () => {
        await screen().getByRole("button", { name: "Retry" }).click({ timeout: 8000 });
        // Sample the Details line and the page every second for 12 s: a flash of raw text counts.
        const seen = new Set();
        let rawSeen = false;
        for (let i = 0; i < 12; i += 1) {
          await sleep(1000);
          const t = await detailsText();
          if (t) seen.add(t);
          if (FORBIDDEN.test(t) || RAW.test(await page.locator("body").innerText().catch(() => ""))) rawSeen = true;
        }
        const still = await screen().isVisible().catch(() => false);
        rec.row(
          `R1b-retry-${n}`,
          `After Retry ${n} (still refused) the Details line has no 'relay returned' and no 'relay owned-agent query failed'`,
          still && !rawSeen ? "PASS" : "FAIL",
          `Escape screen still visible: ${still}. Raw text seen in any of 12 samples: ${rawSeen}. Details line texts seen: ${[...seen].map((t) => `"${t}"`).join(" ; ") || "(none)"}. Message: "${(await describeScreen()).message}"`,
          { screenshot: await shot(page, rec, `r1b-retry-${n}`) },
        );
      });
    }
    await guard("R1b-remove", "Remove this community from this device lands on Join or create", async () => {
      await screen().getByRole("button", { name: /^Remove this community from this device/ }).click({ timeout: 8000 });
      await screen().getByTestId("community-escape-remove-confirm").click({ timeout: 8000 });
      const join = await page.getByText("Join or create a community").waitFor({ timeout: 30000 }).then(() => true, () => false);
      const choice = await page.getByTestId("community-choice-join").isVisible().catch(() => false);
      rec.row("R1b-remove", "Remove this community from this device lands on Join or create a community", join && choice && !(await screen().count()) ? "PASS" : "FAIL", `Join or create text: ${join}. Join choice visible: ${choice}. Escape screen gone: ${!(await screen().count())}. Store: ${JSON.stringify(await stored())}. Page: ${await body(300)}`, { screenshot: await shot(page, rec, "r1b-removed") });
    });
    await guard("R1b-reinvite", "A re-invite lets the member back in", async () => {
      const inv = state.invites.default;
      const code = inv.split("/").pop();
      const relayWs = `wss://${new URL(inv).host}`;
      const sent = await sendDeepLink(profile, `colony://join?relay=${relayWs}&code=${code}`);
      let joined = false;
      const end = Date.now() + 90000;
      while (Date.now() < end) {
        const join = page.getByTestId("invite-join");
        if (await join.isVisible().catch(() => false)) {
          for (const box of await page.locator('input[type="checkbox"],[role="checkbox"]').all()) await box.click().catch(() => undefined);
          await join.click().catch(() => undefined);
        }
        if ((await page.getByTestId("app-sidebar").isVisible().catch(() => false)) && !(await screen().count())) { joined = true; break; }
        await sleep(1500);
      }
      rec.row("R1b-reinvite", "A re-invite lets the member back in: the workspace opens, no escape screen", joined ? "PASS" : "FAIL", `Deep link: ${sent.method}, exited ${sent.exited}. Workspace reached: ${joined}. Store: ${JSON.stringify(await stored())}. Page: ${await body(300)}`, { screenshot: await shot(page, rec, "r1b-rejoined") });
    });
  } else if (mode === "one") {
    await guard("D3-screen", "Removed member with ONE community sees the escape screen, not raw text, not an empty shell", async () => {
      const appeared = await waitScreen(90000);
      const d = appeared ? await describeScreen() : null;
      const shell = await page.getByTestId("app-sidebar").isVisible().catch(() => false);
      rec.row(
        "D3-screen",
        "Removed member with ONE community sees the escape screen, not raw text, not an empty shell",
        appeared && !d.rawVisible && !d.sidebarAvatar && d.switchList === 0 && /not a member/iu.test(d.message) ? "PASS" : "FAIL",
        appeared ? `Message: "${d.message}". Buttons: ${d.buttons.join(" | ")}. Switch list present: ${d.switchList}. Raw relay text visible: ${d.rawVisible}. Workspace avatar present: ${d.sidebarAvatar}. Store: ${JSON.stringify(await stored())}` : `Escape screen never appeared in 90 s. Sidebar visible: ${shell}. Page: ${await body(600)}`,
        { screenshot: await shot(page, rec, "d3-one-screen") },
      );
    });
    await guard("D3-retry-refused", "Retry while still refused keeps the escape screen", async () => {
      await screen().getByRole("button", { name: "Retry" }).click({ timeout: 8000 });
      await sleep(6000);
      const still = await screen().isVisible().catch(() => false);
      const rawAfterRetry = RAW.test(await page.locator("body").innerText().catch(() => ""));
      rec.row("D3-retry-refused", "Retry while still refused keeps the escape screen, without raw relay text", still && !rawAfterRetry ? "PASS" : "FAIL", `Escape screen still visible: ${still}. Raw relay text (relay returned NNN) visible after Retry: ${rawAfterRetry}. Details line: ${redact(await page.getByTestId("community-apply-error-details").innerText().catch(() => "(none)"))}. Page: ${await body(400)}`, { screenshot: await shot(page, rec, "d3-one-retry") });
    });
    await guard("D3-remove", "Remove this community from this device works with one community and lands on the join or create screen", async () => {
      await screen().getByRole("button", { name: /^Remove this community from this device/ }).click({ timeout: 8000 });
      await screen().getByTestId("community-escape-remove-confirm").click({ timeout: 8000 });
      const join = await page.getByText("Join or create a community").waitFor({ timeout: 30000 }).then(() => true, () => false);
      const choice = await page.getByTestId("community-choice-join").isVisible().catch(() => false);
      const st = await stored();
      rec.row("D3-remove", "Remove this community from this device works with one community and lands on the join or create screen", join && choice && !(await screen().count()) ? "PASS" : "FAIL", `Join or create text: ${join}. Join choice visible: ${choice}. Escape screen gone: ${!(await screen().count())}. Store: ${JSON.stringify(st)}. Page: ${await body(300)}`, { screenshot: await shot(page, rec, "d3-one-removed") });
    });
    await guard("D3-relaunch", "Relaunch after Remove is not stranded", async () => {
      await closeApp(application);
      await waitForLoad();
      ({ application, page } = await launch(profile));
      instrument(page, rec, `${label}#2`);
      await sleep(10000);
      const text = await body(400);
      const join = /Join or create a community|Let.s get you started|Create an account|Have an invite/iu.test(text);
      rec.row("D3-relaunch", "Relaunch after Remove is not stranded", join && !RAW.test(text) ? "PASS" : "FAIL", `Page: ${text}`, { screenshot: await shot(page, rec, "d3-one-relaunch") });
    });
  } else {
    const second = JSON.parse(await readFile(secondInviteFile, "utf8"));
    await guard("D3-two-start", "Profile has two communities", async () => {
      await page.getByTestId("app-sidebar").waitFor({ timeout: 90000 });
      await sleep(3000);
      const st = await stored();
      rec.row("D3-two-start", "Profile has two communities, the second joined by invite", st?.count === 2 ? "PASS" : "FAIL", `Store: ${JSON.stringify(st)}. Active: ${st?.active}`, { screenshot: await shot(page, rec, "d3-two-start") });
    });
    const st0 = await stored();
    const removedName = rec.notes.removedName ?? null;
    await guard("D3-two-screen", "Switching to the community the member was removed from shows the escape screen with a Switch action", async () => {
      // The removed community is the one whose workspace is refused: open each non-active community from the rail until the screen shows.
      const others = (st0?.items ?? []).filter((c) => c.name !== st0.active);
      let appeared = false;
      for (const c of others) {
        await page.getByTestId(`community-rail-button-${c.id}`).click({ timeout: 8000 }).catch(() => undefined);
        appeared = await waitScreen(40000);
        if (appeared) { rec.notes.removedCommunity = c; break; }
      }
      const d = appeared ? await describeScreen() : null;
      rec.row(
        "D3-two-screen",
        "Switching to the community the member was removed from shows the escape screen with a Switch action",
        appeared && !d.rawVisible && d.switchList >= 1 && /Switch to another community or remove this one/u.test(d.message) ? "PASS" : "FAIL",
        appeared ? `Message: "${d.message}". Buttons: ${d.buttons.join(" | ")}. Raw text visible: ${d.rawVisible}. Store: ${JSON.stringify(await stored())}` : `Escape screen never appeared. Page: ${await body(500)}`,
        { screenshot: await shot(page, rec, "d3-two-screen") },
      );
    });
    await guard("D3-two-switch", "Switch to the other community works", async () => {
      const before = await stored();
      await screen().getByRole("button", { name: /^Switch to / }).first().click({ timeout: 8000 });
      await page.getByTestId("sidebar-profile-avatar-button").waitFor({ timeout: 40000 });
      await sleep(2500);
      const after = await stored();
      rec.row("D3-two-switch", "Switch to the other community works", (await screen().count()) === 0 && !RAW.test(await page.locator("body").innerText().catch(() => "")) && after?.active !== before?.active ? "PASS" : "FAIL", `Before ${JSON.stringify(before)}. After ${JSON.stringify(after)}. Page: ${await body(250)}`, { screenshot: await shot(page, rec, "d3-two-switched") });
    });
    await guard("D3-two-retry", "A re-invites the member, Retry returns to the workspace", async () => {
      const removed = rec.notes.removedCommunity;
      if (!removed) throw new Error("no removed community recorded");
      await page.getByTestId(`community-rail-button-${removed.id}`).click({ timeout: 8000 });
      if (!(await waitScreen(40000))) throw new Error("escape screen did not come back");
      // A re-invites: deliver the default invite of the removed community to this running instance as a deep link.
      const inv = state.invites?.default;
      const code = inv.split("/").pop();
      const relayWs = `wss://${new URL(inv).host}`;
      const sent = await sendDeepLink(profile, `colony://join?relay=${relayWs}&code=${code}`);
      let joined = false;
      const end = Date.now() + 60000;
      while (Date.now() < end) {
        const join = page.getByTestId("invite-join");
        if (await join.isVisible().catch(() => false)) {
          for (const box of await page.locator('input[type="checkbox"],[role="checkbox"]').all()) await box.click().catch(() => undefined);
          await join.click().catch(() => undefined);
        }
        if ((await page.getByTestId("app-sidebar").isVisible().catch(() => false)) && !(await screen().count())) { joined = true; break; }
        await sleep(1500);
      }
      const afterJoin = await body(300);
      let viaRetry = false;
      if (!joined && (await screen().count())) {
        await screen().getByRole("button", { name: "Retry" }).click({ timeout: 8000 });
        viaRetry = await page.getByTestId("app-sidebar").waitFor({ timeout: 40000 }).then(() => true, () => false);
      }
      rec.row("D3-two-retry", "A re-invites the member, Retry returns to the workspace", joined || viaRetry ? "PASS" : "FAIL", `Deep link: ${sent.method}, exited ${sent.exited}. Reached the workspace by the join itself: ${joined}; by Retry afterwards: ${viaRetry}. After join: ${afterJoin}. Store: ${JSON.stringify(await stored())}`, { screenshot: await shot(page, rec, "d3-two-retry") });
    });
  }
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[D3-${label}-${mode}] done, ${rec.rows.length} rows`);
  void secondInviteFile;
}
