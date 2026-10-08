import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  OUT,
  Rec,
  launch,
  closeApp,
  loadState,
  instrument,
  shot,
  progress,
  sleep,
} from "./ai-lib.mjs";
import { pageContext } from "./work-knowledge-page.mjs";
import { runWorkKnowledgeRows } from "./work-knowledge-rows.mjs";
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("Opt-in local only");
const state = await loadState();
let label = process.argv[2] ?? "A";
try {
  const proof = JSON.parse(
    await readFile(path.join(OUT, "phase-G1-SETUP-RECOVERY.json"), "utf8"),
  );
  if (
    label === "A" &&
    !proof.rows.some((r) => r.id === "G1-setup-recovery" && r.status === "PASS")
  )
    label = "A0";
} catch {}
const rec = new Rec("G3-WK");
rec.notes.profile = label;
const { application, page, version } = await launch(state[label]);
instrument(page, rec, "owner");
try {
  rec.notes.version = version;
  await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
  await page.keyboard.press("Escape");
  await runWorkKnowledgeRows(
    pageContext(page, { shot: (n) => shot(page, rec, n) }),
    (...args) => rec.row(...args),
    { tag: "candidate106-" + (Date.now() % 100000), withUnpin: true },
  );
  rec.row(
    "G3-admin-unpin",
    "Admin unpin",
    "NOT OBSERVED",
    "Listed gap; only author unpin is in this gate",
  );
} catch (e) {
  rec.row(
    "G3-prerequisite",
    "Work and Knowledge prerequisite",
    "NOT OBSERVED",
    e.message,
    { screenshot: await shot(page, rec, "blocked") },
  );
} finally {
  await rec.write();
  await closeApp(application);
  await progress("[G3-WK] complete");
}
