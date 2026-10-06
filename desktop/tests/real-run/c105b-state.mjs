// Colony 1.0.5 second candidate gate: register the first-run account as profile A in the private state file.
// usage: AI_STATE=... node c105b-state.mjs <first-run results.json>
// Only public identifiers (smoke email, business name) and local paths are copied. No password exists:
// run.mjs keeps mailbox credentials in memory, and profile A relaunches from its signed-in user-data dir.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadState, saveState } from "./ai-lib.mjs";

const results = JSON.parse(await readFile(process.argv[2], "utf8"));
const userDataDir = results.privateProfile?.userDataDir;
if (!userDataDir || !results.smokeAccount)
  throw new Error("results.json has no smoke account or profile dir");
const state = await loadState();
state.A = {
  email: results.smokeAccount,
  business: results.smokeBusinessName,
  userDataDir,
  privateDir: path.dirname(userDataDir),
  name: "Launch smoke",
};
await saveState(state);
console.log(`profile A registered: ${state.A.email}, business ${state.A.business}`);
