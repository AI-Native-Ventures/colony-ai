import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILT_IN_ROLES,
  buildRoleCatalog,
  builtInRoleInput,
  findRolePersona,
  isBuiltInRoleId,
  materializeBuiltInRole,
  roleKey,
} from "./builtInRoles.ts";

const RISKS = new Set(["low", "medium", "high"]);

function persona(overrides = {}) {
  return {
    id: "persona-1",
    displayName: "Bookkeeper",
    isActive: true,
    isBuiltIn: false,
    companyRole: {
      job: "Invoices and reconciliation",
      skills: ["Invoicing"],
      tools: [{ name: "Money records", risk: "medium" }],
      workerMenu: ["buzz-agent"],
    },
    ...overrides,
  };
}

function role(name) {
  const found = BUILT_IN_ROLES.find(
    (candidate) => candidate.displayName === name,
  );
  assert.ok(found, `${name} is a built-in role`);
  return found;
}

test("built-in roles are valid, distinct role packs in plain words", () => {
  const catalog = buildRoleCatalog([]);
  assert.equal(catalog.length, BUILT_IN_ROLES.length);
  assert.equal(
    new Set(BUILT_IN_ROLES.map((entry) => entry.id)).size,
    BUILT_IN_ROLES.length,
  );
  assert.equal(
    new Set(BUILT_IN_ROLES.map((entry) => roleKey(entry.displayName))).size,
    BUILT_IN_ROLES.length,
  );
  for (const entry of BUILT_IN_ROLES) {
    assert.ok(isBuiltInRoleId(entry.id));
    assert.ok(entry.companyRole.skills.length > 0, entry.displayName);
    assert.ok(entry.companyRole.tools.length > 0, entry.displayName);
    assert.ok(entry.companyRole.workerMenu.length > 0, entry.displayName);
    assert.ok(entry.systemPrompt.length > 80, entry.displayName);
    assert.ok(entry.description.length <= 280, entry.displayName);
    for (const tool of entry.companyRole.tools) {
      assert.ok(RISKS.has(tool.risk), `${entry.displayName}: ${tool.name}`);
    }
    // The worker menu holds runtime ids ("buzz-agent"), which are never shown.
    const { workerMenu: _runtimeIds, ...visibleRole } = entry.companyRole;
    const text = JSON.stringify({ ...entry, companyRole: visibleRole });
    assert.equal(
      text.includes("—"),
      false,
      `${entry.displayName} has an em dash`,
    );
    assert.equal(/buzz/i.test(text), false, `${entry.displayName} says Buzz`);
  }
  assert.deepEqual(
    BUILT_IN_ROLES.slice(0, 3).map((entry) => entry.displayName),
    ["Hospitality researcher", "Social media manager", "Bookkeeper"],
  );
  assert.deepEqual(BUILT_IN_ROLES.map((entry) => entry.displayName).sort(), [
    "Bookkeeper",
    "Business development",
    "Chief of Staff",
    "Hospitality researcher",
    "Social media manager",
    "Writer",
  ]);
});

test("every built-in role talks like a person in chat", () => {
  for (const entry of BUILT_IN_ROLES) {
    assert.match(
      entry.systemPrompt,
      /one to three short sentences/,
      entry.displayName,
    );
    assert.match(entry.systemPrompt, /at most one question/, entry.displayName);
    assert.match(
      entry.systemPrompt,
      /one short message per request/,
      entry.displayName,
    );
    assert.match(
      entry.systemPrompt,
      /never a progress update/,
      entry.displayName,
    );
    assert.match(entry.systemPrompt, /at most 50 words/, entry.displayName);
    assert.match(
      entry.systemPrompt,
      /a doc fence for prose/,
      entry.displayName,
    );
    assert.doesNotMatch(
      entry.systemPrompt,
      /under 40 words/,
      entry.displayName,
    );
    assert.equal(
      entry.systemPrompt.includes("\u2014"),
      false,
      entry.displayName,
    );
  }
});

test("the catalog lists the business's own roles first, then the built-ins it lacks", () => {
  const own = persona({ id: "mine", displayName: "  bookkeeper  " });
  const custom = persona({
    id: "custom",
    displayName: "Event planner",
    companyRole: { ...persona().companyRole, job: "Events" },
  });
  const catalog = buildRoleCatalog([custom, own]);
  assert.deepEqual(
    catalog.slice(0, 2).map((entry) => entry.persona.id),
    ["custom", "mine"],
  );
  assert.equal(catalog[0].builtIn, null);
  const rest = catalog.slice(2);
  assert.equal(rest.length, BUILT_IN_ROLES.length - 1);
  assert.ok(rest.every((entry) => entry.builtIn !== null));
  assert.equal(
    rest.some((entry) => roleKey(entry.persona.displayName) === "bookkeeper"),
    false,
    "a built-in the business already has is not listed twice",
  );
  assert.ok(rest.every((entry) => isBuiltInRoleId(entry.persona.id)));
});

test("only a usable role pack stands in for a built-in", () => {
  const bookkeeper = role("Bookkeeper");
  assert.equal(findRolePersona([], bookkeeper), null);
  assert.equal(
    findRolePersona([persona({ isActive: false })], bookkeeper),
    null,
    "an inactive persona is not a role pack",
  );
  assert.equal(
    findRolePersona([persona({ companyRole: null })], bookkeeper),
    null,
    "a persona with no role is not a role pack",
  );
  assert.equal(
    findRolePersona([persona({ displayName: "Cook" })], bookkeeper),
    null,
  );
  assert.equal(findRolePersona([persona()], bookkeeper)?.id, "persona-1");
  const catalog = buildRoleCatalog([persona({ isActive: false })]);
  assert.ok(
    catalog.some((entry) => entry.builtIn?.id === bookkeeper.id),
    "the built-in stays on offer",
  );
});

test("a built-in role becomes one persona, however often it is used", async () => {
  const bookkeeper = role("Bookkeeper");
  const store = [];
  let creations = 0;
  const deps = {
    listPersonas: async () => [...store],
    createPersona: async (input) => {
      creations += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const created = persona({
        id: `created-${creations}`,
        displayName: input.displayName,
        companyRole: input.companyRole,
      });
      store.push(created);
      return created;
    },
  };

  const [first, second] = await Promise.all([
    materializeBuiltInRole(bookkeeper, deps),
    materializeBuiltInRole(bookkeeper, deps),
  ]);
  assert.equal(creations, 1, "a double click creates one persona");
  assert.equal(first, "created-1");
  assert.equal(second, "created-1");

  assert.equal(await materializeBuiltInRole(bookkeeper, deps), "created-1");
  assert.equal(creations, 1, "a second hire reuses the persona");

  const writer = role("Writer");
  assert.equal(await materializeBuiltInRole(writer, deps), "created-2");
  assert.equal(store.length, 2);
});

test("an existing persona is reused and a failed creation can be retried", async () => {
  const bookkeeper = role("Bookkeeper");
  let creations = 0;
  const existing = persona({ id: "already-there" });
  assert.equal(
    await materializeBuiltInRole(bookkeeper, {
      listPersonas: async () => [existing],
      createPersona: async () => {
        creations += 1;
        throw new Error("must not create");
      },
    }),
    "already-there",
  );
  assert.equal(creations, 0);

  let attempts = 0;
  const flaky = {
    listPersonas: async () => [],
    createPersona: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("write failed");
      return persona({ id: "after-retry" });
    },
  };
  await assert.rejects(
    materializeBuiltInRole(bookkeeper, flaky),
    /write failed/,
  );
  assert.equal(await materializeBuiltInRole(bookkeeper, flaky), "after-retry");
  assert.equal(attempts, 2);
});

test("a persona is created from a copy of the role, not the role itself", () => {
  const social = role("Social media manager");
  const input = builtInRoleInput(social);
  assert.equal(input.displayName, "Social media manager");
  assert.equal(input.systemPrompt, social.systemPrompt);
  assert.deepEqual(input.companyRole, social.companyRole);
  assert.notEqual(input.companyRole.tools, social.companyRole.tools);
  assert.notEqual(input.companyRole.skills, social.companyRole.skills);
  assert.equal("id" in input, false, "the backend picks the persona id");
  assert.equal("runtime" in input, false, "the worker is chosen at hire");
});
