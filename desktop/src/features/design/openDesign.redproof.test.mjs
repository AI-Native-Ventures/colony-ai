import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(
  new URL(
    "../../../src-tauri/src/managed_agents/nest_skill.md",
    import.meta.url,
  ),
);

test("Open Design is the default design engine for every Colony user", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(
    skill,
    /Open Design is the default design engine for every Colony user/u,
    "intended red proof: the current product contract is missing on main",
  );
});
