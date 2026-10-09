import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { browserAgentEnabled } from "./feature-flag.mjs";

test("release default is on; 0 kills browser authority and invalid values fail closed", () => {
  assert.equal(browserAgentEnabled({}), true);
  assert.equal(browserAgentEnabled({ COLONY_BROWSER_AGENT: "1" }), true);
  for (const value of ["0", "", "false", "true", "01", "1 "])
    assert.equal(
      browserAgentEnabled({ COLONY_BROWSER_AGENT: value }),
      false,
      value,
    );
});

test("main's early containment switch and host boot use the shared production flag", async () => {
  const source = await readFile(
    new URL("../main.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /if \(browserAgentEnabled\(\)\)\s+app\.commandLine\.appendSwitch\("disable-quic"\)/u,
  );
  assert.match(
    source,
    /enabled: browserTabEnabled && browserAgentEnabled\(\)/u,
  );
  assert.doesNotMatch(source, /process\.env\.COLONY_BROWSER_AGENT/u);
});
