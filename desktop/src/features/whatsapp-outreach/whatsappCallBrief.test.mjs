import assert from "node:assert/strict";
import test from "node:test";

import {
  callAssigneeName,
  callBriefChange,
  callBriefDraftFor,
  callCloserLabel,
  contactAwaitsCallFrom,
  normalizeCallLink,
  parseWhatsAppCallBrief,
  parseWhatsAppCallClosers,
  safeCallLink,
} from "./whatsappCallBrief.ts";

const ZAINA = "ab".repeat(32);
const BASHEER = "cd".repeat(32);

test("a call link is only ever an http or https address", () => {
  // GUARD: the link is rendered as a clickable address. Anything a relay or a person hands
  // over that is not a plain web address must never reach an href.
  assert.equal(
    safeCallLink("https://preview.example/acme"),
    "https://preview.example/acme",
  );
  assert.equal(safeCallLink("http://localhost:3000"), "http://localhost:3000");
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "mailto:someone@example.com",
    "preview.example/acme",
    "https://preview.example/a b",
    "",
    null,
    42,
  ]) {
    assert.equal(safeCallLink(bad), null, String(bad));
  }
});

test("a contact's call brief is read leniently and never keeps an unsafe link", () => {
  assert.deepEqual(
    parseWhatsAppCallBrief({
      link: "https://preview.example/acme",
      note: "  Wants the booking page first.  ",
      assigneePubkey: ZAINA.toUpperCase(),
      updatedBy: BASHEER,
      updatedAt: "2026-11-28T10:00:00+00:00",
    }),
    {
      link: "https://preview.example/acme",
      note: "Wants the booking page first.",
      assigneePubkey: ZAINA,
      updatedBy: BASHEER,
      updatedAt: "2026-11-28T10:00:00+00:00",
    },
  );
  // An unsafe link is dropped, the rest of the brief stays.
  assert.equal(
    parseWhatsAppCallBrief({ link: "javascript:alert(1)", note: "Call me" })
      .link,
    null,
  );
  // Nothing set, an older relay, or a shape that is not a brief: no brief, no error.
  for (const empty of [
    undefined,
    null,
    "brief",
    [],
    {},
    { link: null, note: "  ", assigneePubkey: "not-a-key" },
  ]) {
    assert.equal(parseWhatsAppCallBrief(empty), null);
  }
});

test("the people a call can go to are read once each, with a role and a name", () => {
  assert.deepEqual(
    parseWhatsAppCallClosers({
      closers: [
        { pubkey: BASHEER, role: "owner", name: "Basheer" },
        { pubkey: ZAINA, role: "admin", name: "  " },
        { pubkey: ZAINA, role: "admin", name: "Zaina again" },
        { pubkey: "short", role: "admin", name: "No key" },
        { pubkey: "ef".repeat(32), role: "something new", name: null },
        null,
      ],
    }),
    [
      { pubkey: BASHEER, role: "owner", name: "Basheer" },
      { pubkey: ZAINA, role: "admin", name: null },
      { pubkey: "ef".repeat(32), role: "member", name: null },
    ],
  );
  assert.throws(() => parseWhatsAppCallClosers({}), /unreadable list/u);
  assert.throws(() => parseWhatsAppCallClosers(null), /unreadable list/u);
  // A person without a name is described by role. A key is never shown.
  assert.equal(
    callCloserLabel({ pubkey: BASHEER, role: "owner", name: "Basheer" }),
    "Basheer",
  );
  for (const role of ["owner", "admin", "member"]) {
    const label = callCloserLabel({ pubkey: ZAINA, role, name: null });
    assert.ok(!label.includes(ZAINA.slice(0, 6)), label);
  }
});

test("a typed link gets https when the person left it out, and a bare word is refused", () => {
  assert.deepEqual(normalizeCallLink("   "), { ok: true, link: null });
  assert.deepEqual(normalizeCallLink(" preview.example/acme "), {
    ok: true,
    link: "https://preview.example/acme",
  });
  assert.deepEqual(normalizeCallLink("http://localhost:3000/demo"), {
    ok: true,
    link: "http://localhost:3000/demo",
  });
  for (const bad of [
    "preview",
    "javascript:alert(1)",
    "my preview site",
    `https://preview.example/${"a".repeat(2000)}`,
  ]) {
    assert.equal(normalizeCallLink(bad).ok, false, bad);
  }
});

test("only the fields a person changed are sent, and clearing sends null", () => {
  // GUARD: two people editing different fields of one brief must not undo each other, so an
  // untouched field is absent from the change (the relay then leaves it alone).
  const stored = parseWhatsAppCallBrief({
    link: "https://preview.example/acme",
    note: "Wants the booking page first.",
    assigneePubkey: ZAINA,
  });
  const draft = callBriefDraftFor(stored);
  assert.deepEqual(draft, {
    link: "https://preview.example/acme",
    note: "Wants the booking page first.",
    assigneePubkey: ZAINA,
  });
  assert.deepEqual(callBriefChange(stored, draft), { ok: true, change: null });
  assert.deepEqual(
    callBriefChange(stored, { ...draft, note: "Call after 2pm." }),
    { ok: true, change: { note: "Call after 2pm." } },
  );
  assert.deepEqual(
    callBriefChange(stored, { link: "", note: "  ", assigneePubkey: "" }),
    { ok: true, change: { link: null, note: null, assignee: null } },
  );
  // A first brief: every filled field is new.
  assert.deepEqual(
    callBriefChange(null, {
      link: "preview.example/acme",
      note: "",
      assigneePubkey: ZAINA,
    }),
    {
      ok: true,
      change: { link: "https://preview.example/acme", assignee: ZAINA },
    },
  );
  assert.deepEqual(callBriefChange(null, callBriefDraftFor(null)), {
    ok: true,
    change: null,
  });
  // A bad link stops the whole change: nothing is sent.
  assert.equal(
    callBriefChange(stored, { ...draft, link: "not a link" }).ok,
    false,
  );
  assert.equal(
    callBriefChange(stored, { ...draft, note: "x".repeat(2001) }).ok,
    false,
  );
});

test("who has the call is named, and a call waits for the right person", () => {
  const closers = [{ pubkey: ZAINA, role: "admin", name: "Zaina" }];
  const brief = parseWhatsAppCallBrief({ assigneePubkey: ZAINA });
  assert.equal(callAssigneeName(brief, closers, BASHEER), "Zaina");
  assert.equal(callAssigneeName(brief, closers, ZAINA.toUpperCase()), "you");
  // The list is still loading or no longer names them: the lead never looks unassigned.
  assert.equal(callAssigneeName(brief, undefined, BASHEER), "a teammate");
  assert.equal(callAssigneeName(null, closers, BASHEER), null);

  const ready = { stage: "ready_to_call", callBrief: brief };
  assert.equal(contactAwaitsCallFrom(ready, ZAINA), true);
  assert.equal(contactAwaitsCallFrom(ready, BASHEER), false);
  assert.equal(contactAwaitsCallFrom(ready, null), false);
  // Nobody has it yet: it waits for whoever looks.
  const open = { stage: "ready_to_call", callBrief: null };
  assert.equal(contactAwaitsCallFrom(open, BASHEER), true);
  assert.equal(contactAwaitsCallFrom(open, undefined), true);
  // A lead that only asked for a call waits for everyone, as before.
  assert.equal(contactAwaitsCallFrom({ stage: "wants_call" }, BASHEER), true);
  assert.equal(contactAwaitsCallFrom({ stage: "call_booked" }, ZAINA), false);
});
