import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FIELD_COLORS,
  FIELD_PRESETS,
  applyFieldColors,
  describeFieldColor,
  fieldColorsFromLegacyGradient,
  isDefaultFieldColors,
  parseFieldColors,
  presetForFieldColors,
  readStoredFieldColors,
  writeStoredFieldColors,
} from "./sidebarField.ts";

function styleStub() {
  const props = new Map();
  return {
    props,
    setProperty: (name, value) => props.set(name, value),
    removeProperty: (name) => props.delete(name),
  };
}

function withBrowser(run) {
  const style = styleStub();
  const data = new Map();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { documentElement: { style } };
  globalThis.window = {
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, String(value)),
    },
  };
  try {
    run({ style, data });
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

test("the default trio is rose, lilac and periwinkle, and Dawn", () => {
  assert.deepEqual(DEFAULT_FIELD_COLORS, ["#F5A4D5", "#C6B3F4", "#94B4FA"]);
  assert.equal(FIELD_PRESETS[0].id, "dawn");
  assert.deepEqual(FIELD_PRESETS[0].colors, DEFAULT_FIELD_COLORS);
  assert.deepEqual(
    FIELD_PRESETS.map((preset) => preset.label),
    ["Dawn", "Peach", "Sea"],
  );
});

test("parses only a trio of six-digit hex colours, normalised to upper case", () => {
  assert.deepEqual(parseFieldColors(["#f5a4d5", "#c6b3f4", "#94b4fa"]), [
    "#F5A4D5",
    "#C6B3F4",
    "#94B4FA",
  ]);
  assert.equal(parseFieldColors(["#f5a4d5", "#c6b3f4"]), null);
  assert.equal(parseFieldColors(["#f5a4d5", "#c6b3f4", "red"]), null);
  assert.equal(parseFieldColors(["#f5a4d5", "#c6b3f4", "#94b4f"]), null);
  assert.equal(parseFieldColors("#f5a4d5"), null);
  assert.equal(parseFieldColors(undefined), null);
});

test("finds the preset a trio matches", () => {
  assert.equal(
    presetForFieldColors(["#ffc2a6", "#f5a4d5", "#c6b3f4"])?.id,
    "peach",
  );
  assert.equal(
    presetForFieldColors(["#A3E3D3", "#9CC2F7", "#C6B3F4"])?.id,
    "sea",
  );
  assert.equal(
    presetForFieldColors(["#000000", "#111111", "#222222"]),
    undefined,
  );
  assert.equal(isDefaultFieldColors(["#f5a4d5", "#c6b3f4", "#94b4fa"]), true);
});

test("names the colours the design names and shows the hex for the rest", () => {
  assert.equal(describeFieldColor("#f5a4d5"), "Rose · #F5A4D5");
  assert.equal(describeFieldColor("#c6b3f4"), "Lilac · #C6B3F4");
  assert.equal(describeFieldColor("#94b4fa"), "Periwinkle · #94B4FA");
  assert.equal(describeFieldColor("#123456"), "#123456");
});

test("maps the old two-colour gradient onto the field", () => {
  assert.deepEqual(fieldColorsFromLegacyGradient(["#000000", "#ffffff"]), [
    "#000000",
    "#808080",
    "#FFFFFF",
  ]);
  assert.equal(fieldColorsFromLegacyGradient(["nope", "#ffffff"]), null);
});

test("applying the default removes the overrides; another trio sets them", () => {
  withBrowser(({ style }) => {
    applyFieldColors(["#A3E3D3", "#9CC2F7", "#C6B3F4"]);
    assert.equal(style.props.get("--colony-field-top"), "#A3E3D3");
    assert.equal(style.props.get("--colony-field-middle"), "#9CC2F7");
    assert.equal(style.props.get("--colony-field-bottom"), "#C6B3F4");
    assert.ok(style.props.has("--colony-rail-top"));
    applyFieldColors([...DEFAULT_FIELD_COLORS]);
    assert.equal(style.props.size, 0);
  });
});

test("reads back what was saved and falls back to the default otherwise", () => {
  withBrowser(({ data }) => {
    assert.deepEqual(readStoredFieldColors(), DEFAULT_FIELD_COLORS);
    writeStoredFieldColors(["#FFC2A6", "#F5A4D5", "#C6B3F4"]);
    assert.deepEqual(readStoredFieldColors(), [
      "#FFC2A6",
      "#F5A4D5",
      "#C6B3F4",
    ]);
    data.set("buzz-sidebar-field", "not json");
    assert.deepEqual(readStoredFieldColors(), DEFAULT_FIELD_COLORS);
  });
});
