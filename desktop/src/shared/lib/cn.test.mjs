import assert from "node:assert/strict";
import test from "node:test";

import { cn } from "./cn.ts";

test("a named font-size token does not drop the text colour beside it", () => {
  assert.equal(
    cn("bg-colony-fg text-colony-surface", "h-11 px-5 text-control"),
    "bg-colony-fg text-colony-surface h-11 px-5 text-control",
  );
  assert.equal(
    cn("text-colony-surface", "text-menu"),
    "text-colony-surface text-menu",
  );
});

test("a later text colour still replaces an earlier one", () => {
  assert.equal(
    cn("text-colony-fg", "text-colony-surface"),
    "text-colony-surface",
  );
});

test("a later font size still replaces an earlier one", () => {
  assert.equal(cn("text-sm", "text-control"), "text-control");
  assert.equal(cn("text-control", "text-menu"), "text-menu");
});
