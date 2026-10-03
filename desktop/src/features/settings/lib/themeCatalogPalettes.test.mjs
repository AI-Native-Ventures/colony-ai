import reference from "../../../../tests/visual/fixtures/r17-theme-palettes.json" with {
  type: "json",
};
import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTAX_THEMES,
  extractThemeInfo,
  loadThemeData,
} from "@/shared/theme/theme-loader";
import { THEME_CATALOG_PALETTES } from "./themeCatalogPalettes.ts";

function normalize(color) {
  // Applied workspace CSS uses RGB and drops theme JSON alpha.
  const value = color.toLowerCase().slice(0, 7);
  return /^#[0-9a-f]{3}$/.test(value)
    ? `#${value
        .slice(1)
        .split("")
        .map((digit) => digit + digit)
        .join("")}`
    : value;
}

test("every frozen catalog palette matches its applied workspace background and foreground", async () => {
  assert.deepEqual(
    Object.keys(THEME_CATALOG_PALETTES).sort(),
    [...SYNTAX_THEMES].sort(),
  );
  assert.deepEqual(THEME_CATALOG_PALETTES, reference);
  for (const name of SYNTAX_THEMES) {
    const info = extractThemeInfo(name, await loadThemeData(name));
    const palette = THEME_CATALOG_PALETTES[name];
    assert.equal(
      normalize(palette.background),
      normalize(info.bg),
      `${name} background`,
    );
    assert.equal(
      normalize(palette.foreground),
      normalize(info.fg),
      `${name} foreground`,
    );
    assert.match(palette.accent, /^#[0-9a-f]{6}$/i, `${name} reply accent`);
  }
});
