import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeDiagnostics,
  brandingFindings,
  businessMentionVerdict,
  fileReferenceVerdict,
  personalConfigFindings,
  realEnvironment,
  realEnvSandboxPolicy,
  SETUP_NOTICE,
  cleanEnvironment,
  outsideRepo,
  redact,
  sandboxPolicy,
  teammateVerdict,
} from "./safety.mjs";
import { Evidence } from "./report.mjs";

// These exercise the report and safety seams used by the runner, not product UI.
test("launch environment drops inherited signing material, auth and mock overrides", () => {
  const actual = cleanEnvironment(
    {
      HOME: "/Users/test",
      PATH: "/bin",
      GH_TOKEN: "fixture",
      BUZZ_PRIVATE_KEY: "fixture",
      COLONY_NATIVE_HOST: "fixture",
      COLONY_ELECTRON_SMOKE: "1",
      ANTHROPIC_API_KEY: "fixture",
      CI: "1",
    },
    "/private/profile",
    "https://relay.example.com",
  );
  assert.equal(actual.HOME, "/Users/test");
  for (const key of [
    "GH_TOKEN",
    "BUZZ_PRIVATE_KEY",
    "COLONY_NATIVE_HOST",
    "COLONY_ELECTRON_SMOKE",
    "ANTHROPIC_API_KEY",
    "CI",
  ])
    assert.equal(actual[key], undefined);
  assert.equal(actual.COLONY_ELECTRON_USER_DATA, "/private/profile");
});

test("branding scan is case-insensitive, includes the symbol, and avoids ordinary substrings", () => {
  assert.deepEqual(
    brandingFindings("Colony Scout, honeycomb and pollenation"),
    [],
  );
  assert.equal(
    brandingFindings(["bUZZ", "Fizz", "Honey", "Pollen", "\u{1f41d}"].join(" "))
      .length,
    5,
  );
});

test("mention roster check rejects foreign identities and unbound persona suggestions", () => {
  const a = "a".repeat(64),
    b = "b".repeat(64),
    c = "c".repeat(64);
  assert.equal(teammateVerdict([a, b], [a, b], "").status, "PASS");
  assert.equal(teammateVerdict([c], [a, b], "").status, "FAIL");
  assert.equal(teammateVerdict(["persona-role"], [a, b], "").status, "FAIL");
  assert.equal(teammateVerdict([a], [a, b], a).status, "FAIL");
  assert.equal(teammateVerdict([], [a], "").status, "BLOCKED");
});

test("sandbox policy confines legacy stores without suppressing code-signing services", () => {
  const { policy, nativeDir } = sandboxPolicy(
    "/private/profile",
    "/private/probe",
    "/Users/test",
  );
  assert.match(policy, /deny mach-lookup/u);
  assert.match(policy, /com\.apple\.securityd/u);
  assert.match(policy, /Library\/Keychains/u);
  assert.match(policy, /Users\/test\/\.buzz/u);
  assert.doesNotMatch(policy, /security\|Security/u);
  assert.match(nativeDir, /xyz\.block\.buzz\.app\.electron\.[a-f0-9]{16}$/u);
});

test("redaction removes signing formats, authorization and common tokens", () => {
  assert.doesNotMatch(
    redact(
      `nsec1${"q".repeat(70)} Bearer fixture-token ${"a".repeat(64)} sk-fixture-credential`,
    ),
    /nsec1|fixture-token|fixture-credential|a{64}/u,
  );
});

test("failed operations remain failed and locator arguments never enter the report", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "colony-report-test-"));
  try {
    const evidence = new Evidence(folder, {
      mode: "Contract test",
      scope: "No app run.",
    });
    const privateArgument = "private-locator-argument";
    assert.equal(
      await evidence.step("Account", null, async () => {
        throw new Error(privateArgument);
      }),
      false,
    );
    const json = await readFile(path.join(folder, "results.json"), "utf8");
    assert.ok(!json.includes(privateArgument));
    assert.equal(JSON.parse(json).rows[0].status, "FAIL");
    assert.equal(JSON.parse(json).rows[1].status, "BLOCKED");
    assert.doesNotMatch(
      await readFile(path.join(folder, "index.html"), "utf8"),
      /undefined/u,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("artifacts cannot be written inside the checkout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-path-test-"));
  try {
    const child = path.join(root, "child");
    await mkdir(child);
    assert.throws(() => outsideRepo(child, root), /outside/u);
    assert.equal(outsideRepo(root, child), await realpath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file references pass only as plain text unless real opening was observed", () => {
  assert.equal(fileReferenceVerdict(["notes.md"], []).status, "PASS");
  assert.equal(fileReferenceVerdict([], []).status, "BLOCKED");
  assert.equal(
    fileReferenceVerdict(["notes.md"], [{ tag: "a", href: "#" }]).status,
    "FAIL",
  );
  assert.equal(
    fileReferenceVerdict(["notes.md"], [{ tag: "a", href: "file:///notes.md" }])
      .status,
    "BLOCKED",
  );
  assert.equal(
    fileReferenceVerdict(["notes.md"], [{ tag: "button", href: null }]).status,
    "BLOCKED",
  );
});

test("debug tracing is rejected before automation can fill secret fields", () => {
  assert.throws(() => assertSafeDiagnostics({ DEBUG: "pw:api" }), /Disable/u);
  assert.throws(() => assertSafeDiagnostics({ PWDEBUG: "1" }), /Disable/u);
  assert.doesNotThrow(() => assertSafeDiagnostics({}));
});

test("real environment keeps the real HOME but pins the throwaway profile and drops secrets", () => {
  const actual = realEnvironment(
    {
      HOME: "/Users/test",
      PATH: "/bin",
      COLONY_ELECTRON_USER_DATA:
        "/Users/test/Library/Application Support/Colony Electron",
      ANTHROPIC_API_KEY: "fixture",
      CLAUDE_CODE_OAUTH_TOKEN: "fixture",
      GH_TOKEN: "fixture",
    },
    "/tmp/throwaway",
    "https://relay.example",
  );
  assert.equal(actual.HOME, "/Users/test");
  // Without this the packaged main process falls back to the owner's real profile.
  assert.equal(actual.COLONY_ELECTRON_USER_DATA, "/tmp/throwaway");
  assert.equal(actual.BUZZ_RELAY_URL, "https://relay.example");
  assert.equal(actual.ANTHROPIC_API_KEY, undefined);
  assert.equal(actual.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(actual.GH_TOKEN, undefined);
});

test("personal configuration terms are flagged only when present", () => {
  assert.deepEqual(
    personalConfigFindings("I'm Scout, your chief of staff at Acme."),
    [],
  );
  assert.deepEqual(
    personalConfigFindings("Per your gstack and ADHD mode rules, Basheer"),
    ["gstack", "adhd", "basheer"],
  );
});

test("business answers must mention the typed name or website host", () => {
  const name = "Launch smoke ab12";
  assert.equal(
    businessMentionVerdict(
      "You run Launch smoke AB12.",
      name,
      "https://www.example.com",
    ).status,
    "PASS",
  );
  assert.equal(
    businessMentionVerdict(
      "See example.com for details.",
      name,
      "https://www.example.com",
    ).hits[0],
    "website:example.com",
  );
  assert.equal(
    businessMentionVerdict("I know nothing yet.", name, "https://example.com")
      .status,
    "FAIL",
  );
});

test("the setup notice pattern matches the shipped wording and not intros", () => {
  assert.ok(
    SETUP_NOTICE.test(
      "To get started with Scout, connect your AI in Settings > Agents > Defaults.",
    ),
  );
  assert.ok(
    !SETUP_NOTICE.test("Hi, I'm Scout. I will be your chief of staff."),
  );
});

test("real-env policy blocks the keychain service for the app but not Claude sign-in or the real home", () => {
  const policy = realEnvSandboxPolicy("/Users/test", "/tmp/probe");
  assert.match(policy, /\(deny mach-lookup[^)]*com\.apple\.securityd/u);
  assert.match(
    policy,
    /\(allow process-exec \(literal "\/usr\/bin\/security"\) \(with no-sandbox\)\)/u,
  );
  assert.match(policy, /Colony Electron"/u);
  assert.match(policy, /\/tmp\/probe/u);
  // The real nest and Claude config stay reachable: HOME is deliberately real.
  assert.doesNotMatch(policy, /\/Users\/test\/\.buzz/u);
  assert.doesNotMatch(policy, /\/Users\/test\/\.claude/u);
});
