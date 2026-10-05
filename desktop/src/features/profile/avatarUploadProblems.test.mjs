/**
 * Avatar dialog contract: what is accepted, what is refused, and the plain
 * wording for each failure. The file chooser `accept` attribute, the in-dialog
 * check and the relay media endpoint must agree (see avatarUploadProblems.ts).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AVATAR_ACCEPT_ATTRIBUTE,
  AVATAR_ACCEPTED_TYPES,
  AVATAR_MAX_SOURCE_BYTES,
  checkAvatarFile,
  describeAvatarFailure,
  describeCameraProblem,
} from "./avatarUploadProblems.ts";

const png = { name: "me.png", size: 1024, type: "image/png" };

test("the chooser accepts exactly the types the check accepts", () => {
  assert.equal(AVATAR_ACCEPT_ATTRIBUTE, AVATAR_ACCEPTED_TYPES.join(","));
  for (const type of AVATAR_ACCEPTED_TYPES) {
    assert.equal(checkAvatarFile({ ...png, type }), null, type);
  }
});

test("rejects unsupported types, oversized and empty files", () => {
  assert.equal(
    checkAvatarFile({ ...png, name: "a.svg", type: "image/svg+xml" })?.kind,
    "unsupported-type",
  );
  assert.equal(
    checkAvatarFile({ ...png, name: "a.gif", type: "image/gif" })?.kind,
    "unsupported-type",
  );
  assert.equal(
    checkAvatarFile({ ...png, size: AVATAR_MAX_SOURCE_BYTES + 1 })?.kind,
    "too-large",
  );
  assert.equal(
    checkAvatarFile({ ...png, size: AVATAR_MAX_SOURCE_BYTES }),
    null,
  );
  assert.equal(checkAvatarFile({ ...png, size: 0 })?.kind, "unreadable");
});

test("falls back to the extension when the system reports no type", () => {
  assert.equal(checkAvatarFile({ name: "me.WEBP", size: 10, type: "" }), null);
  assert.equal(
    checkAvatarFile({ name: "notes.txt", size: 10, type: "" })?.kind,
    "unsupported-type",
  );
});

test("states the accepted types and the limit in plain words", () => {
  const problem = checkAvatarFile({ ...png, type: "application/pdf" });
  assert.match(problem.message, /JPEG, PNG or WebP/);
  assert.match(problem.message, /20 MB/);
});

test("classifies the errors the desktop host and relay return", () => {
  const ctx = { hasCrop: true, phase: "upload" };
  const kind = (message, phase = "upload") =>
    describeAvatarFailure(new Error(message), { ...ctx, phase }).kind;

  assert.equal(kind("relay unreachable: request timed out"), "network");
  assert.equal(kind("error sending request for url"), "network");
  assert.equal(kind("relay rate-limited: retry in 12s"), "rate-limited");
  assert.equal(kind("relay returned 413 Payload Too Large"), "too-large");
  assert.equal(
    kind("relay returned 400 Bad Request: file too large"),
    "too-large",
  );
  assert.equal(
    kind("unsupported file type: image/svg+xml"),
    "unsupported-type",
  );
  assert.equal(kind("profile avatar must be an image"), "unsupported-type");
  assert.equal(
    kind("relay returned 403 Forbidden: membership required"),
    "refused",
  );
  assert.equal(kind("something odd"), "unknown");
  assert.equal(kind("anything", "prepare"), "unreadable");
});

test("failure wording never leaks raw error text and keeps the crop", () => {
  const problem = describeAvatarFailure(
    new Error("relay unreachable: connect ECONNREFUSED 10.0.0.1:443"),
    { hasCrop: true, phase: "upload" },
  );
  assert.doesNotMatch(
    `${problem.title} ${problem.message}`,
    /ECONNREFUSED|10\.0/,
  );
  assert.match(problem.message, /The crop is kept/);
  const preset = describeAvatarFailure(new Error("relay unreachable"), {
    hasCrop: false,
    phase: "publish",
  });
  assert.doesNotMatch(preset.message, /crop/);
});

test("no wording contains an em dash", () => {
  const samples = [
    checkAvatarFile({ ...png, type: "text/plain" }),
    checkAvatarFile({ ...png, size: AVATAR_MAX_SOURCE_BYTES + 1 }),
    describeAvatarFailure(new Error("x"), { hasCrop: true, phase: "publish" }),
    describeAvatarFailure(new Error("403"), { hasCrop: true, phase: "upload" }),
    describeCameraProblem({ name: "NotAllowedError" }),
    describeCameraProblem({ name: "NotFoundError" }),
    describeCameraProblem(null),
  ];
  for (const sample of samples) {
    assert.doesNotMatch(`${sample.title} ${sample.message}`, /—/);
  }
});
