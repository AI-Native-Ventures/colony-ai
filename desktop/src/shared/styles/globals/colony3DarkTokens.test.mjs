import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import postcss from "postcss";
import {
  ACCENT_COLORS,
  DARK_ACCENT_PALETTE_FALLBACKS,
  resolveColonyAccentPalette,
} from "../../theme/colonyAccentPalette.ts";

const themePath = path.resolve("src/shared/styles/globals/theme.css");

function darkPalette() {
  const root = postcss.parse(fs.readFileSync(themePath, "utf8"), {
    from: themePath,
  });
  let darkRule;
  root.walkRules((rule) => {
    if (rule.selector === ".dark") darkRule = rule;
  });
  assert.ok(darkRule, "theme.css must define the shared .dark palette");

  const tokens = new Map();
  darkRule.walkDecls((declaration) => {
    tokens.set(declaration.prop, declaration.value.trim());
  });
  return tokens;
}

function parseHex(value) {
  const raw = value.slice(1);
  const expanded =
    raw.length === 3 ? [...raw].map((part) => part + part).join("") : raw;
  assert.equal(
    expanded.length,
    6,
    `Expected an opaque hex color, got ${value}`,
  );
  return [0, 2, 4].map(
    (offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255,
  );
}

function parseHsl(value) {
  const match = value.match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/u);
  assert.ok(match, `Expected an HSL token value, got ${value}`);
  const hue = ((Number(match[1]) % 360) + 360) % 360;
  const saturation = Number(match[2]) / 100;
  const lightness = Number(match[3]) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const channels =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return channels.map((channel) => channel + offset);
}

function resolveColor(tokens, tokenName, seen = new Set()) {
  assert.ok(
    !seen.has(tokenName),
    `Circular color token reference: ${tokenName}`,
  );
  seen.add(tokenName);
  const value = tokens.get(tokenName);
  assert.ok(value, `Missing dark color token ${tokenName}`);
  const reference = value.match(/^var\((--[\w-]+)\)$/u);
  if (reference) return resolveColor(tokens, reference[1], seen);
  if (value.startsWith("#")) return parseHex(value);
  return parseHsl(value);
}

function luminance(rgb) {
  const [red, green, blue] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(tokens, foreground, background) {
  const first = luminance(resolveColor(tokens, foreground));
  const second = luminance(resolveColor(tokens, background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function assertContrast(tokens, foreground, background, minimum) {
  const ratio = contrast(tokens, foreground, background);
  assert.ok(
    ratio >= minimum,
    `${foreground} on ${background} is ${ratio.toFixed(2)}:1; expected ${minimum}:1 or better`,
  );
}

function colorContrast(foreground, background) {
  const rgb = (color) => (typeof color === "string" ? parseHex(color) : color);
  const first = luminance(rgb(foreground));
  const second = luminance(rgb(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mixHex(fromHex, toHex, amount) {
  const from = parseHex(fromHex).map((channel) => channel * 255);
  const to = parseHex(toHex).map((channel) => channel * 255);
  return `#${from
    .map((channel, index) =>
      Math.round(channel + (to[index] - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

test("all built-in and custom accents preserve Light and meet Dark contrast", () => {
  const tokens = darkPalette();
  const accents = [
    ...ACCENT_COLORS,
    { name: "Custom ink", value: "#121116" },
    { name: "Custom gold", value: "#e8c634" },
  ];
  const darkBackgrounds = [
    "--colony-canvas",
    "--colony-surface",
    "--colony-surface-raised",
    "--colony-pop",
    "--colony-overlay",
  ];
  const darkSurface = tokens.get("--colony-accent-foreground");

  for (const accent of accents) {
    for (const mode of ["light", "dark"]) {
      const palette = resolveColonyAccentPalette(accent.value, mode, {
        overlay: tokens.get("--colony-overlay"),
        surface: darkSurface,
      });

      if (mode === "light") {
        assert.equal(palette.accentHex, accent.value, `${accent.name} fill`);
        assert.equal(
          palette.accentSoftHex,
          mixHex(accent.value, "#ffffff", 0.9),
          `${accent.name} soft fill`,
        );
        assert.equal(
          palette.accentInkHex,
          mixHex(accent.value, "#000000", 0.15),
          `${accent.name} ink`,
        );
        assert.equal(palette.accentForegroundHex, "#fffdfa");
        continue;
      }

      for (const background of darkBackgrounds) {
        const ratio = colorContrast(
          palette.accentHex,
          resolveColor(tokens, background),
        );
        assert.ok(
          ratio >= 4.5,
          `${accent.name} Dark accent text on ${background} is ${ratio.toFixed(2)}:1`,
        );
        assert.ok(
          ratio >= 3,
          `${accent.name} Dark focus ring on ${background} is ${ratio.toFixed(2)}:1`,
        );
      }

      const buttonRatio = colorContrast(darkSurface, palette.accentHex);
      assert.ok(
        buttonRatio >= 4.5,
        `${accent.name} Dark button label on fill is ${buttonRatio.toFixed(2)}:1`,
      );

      const chipRatio = colorContrast(
        palette.accentInkHex,
        palette.accentSoftHex,
      );
      assert.ok(
        chipRatio >= 4.5,
        `${accent.name} Dark accent text on soft fill is ${chipRatio.toFixed(2)}:1`,
      );
    }
  }

  assert.equal(
    DARK_ACCENT_PALETTE_FALLBACKS.overlay,
    tokens.get("--colony-overlay"),
  );
  assert.equal(DARK_ACCENT_PALETTE_FALLBACKS.surface, darkSurface);
});

test("dark text, states and controls keep WCAG AA contrast", () => {
  const tokens = darkPalette();
  const coreSurfaces = [
    "--colony-canvas",
    "--colony-surface",
    "--colony-surface-raised",
    "--colony-pop",
    "--colony-activity-list-surface",
    "--colony-activity-row-hover",
    "--colony-activity-tools-surface",
    "--colony-agent-picker-surface",
    "--colony-onboarding-security-field",
  ];
  const discoveryTiles = [
    "--colony-discovery-tile-rose",
    "--colony-discovery-tile-amber",
    "--colony-discovery-tile-blue",
    "--colony-discovery-tile-violet",
    "--colony-discovery-tile-green",
    "--colony-discovery-tile-gold",
  ];
  const bodyText = [
    "--colony-fg",
    "--colony-fg-secondary",
    "--colony-muted",
    "--colony-faint",
    "--colony-accent",
    "--colony-accent-ink",
    "--colony-info-ink",
    "--colony-success-ink",
    "--colony-danger-ink",
    "--colony-warning-ink",
    "--colony-agent-picker-ink",
    "--colony-onboarding-security-ink",
  ];

  for (const foreground of bodyText) {
    for (const background of coreSurfaces) {
      assertContrast(tokens, foreground, background, 4.5);
    }
  }

  for (const background of [
    "--colony-field-top",
    "--colony-field-middle",
    "--colony-field-bottom",
  ]) {
    assertContrast(tokens, "--colony-sidebar-ink", background, 4.5);
    assertContrast(tokens, "--colony-sidebar-ink-soft", background, 4.5);
  }

  for (const [foreground, background] of [
    ["--colony-accent-foreground", "--colony-accent"],
    ["--colony-fg", "--colony-accent-soft"],
    ["--colony-fg", "--colony-surface-raised"],
    [
      "--colony-onboarding-security-cta-ink",
      "--colony-onboarding-security-cta",
    ],
    ["--colony-state-foreground", "--colony-accent"],
    ["--colony-info-ink", "--colony-info-bg"],
    ["--colony-success-ink", "--colony-success-bg"],
    ["--colony-danger-ink", "--colony-danger-bg"],
    ["--colony-warning-ink", "--colony-warning-surface"],
    ["--colony-warning-strong-ink", "--colony-warning-light-surface"],
    ["--colony-info-solid-foreground", "--colony-info-solid"],
    ["--colony-onboarding-danger-ink", "--colony-onboarding-danger-bg"],
    ["--colony-onboarding-success-ink", "--colony-onboarding-success-bg"],
    ["--colony-onboarding-warning", "--colony-onboarding-warning-bg"],
    ["--colony-onboarding-info", "--colony-onboarding-info-bg"],
    ["--colony-need-deep-ink", "--colony-need-bg"],
    ["--colony-danger-deepest-ink", "--colony-danger-pale-surface"],
  ]) {
    assertContrast(tokens, foreground, background, 4.5);
  }

  for (const background of discoveryTiles) {
    assertContrast(tokens, "--colony-fg", background, 3);
  }

  for (const foreground of [
    "--colony-border",
    "--colony-border-strong",
    "--colony-accent-line",
    "--colony-focus-line",
    "--colony-focus-line-strong",
  ]) {
    for (const background of coreSurfaces) {
      assertContrast(tokens, foreground, background, 3);
    }
  }

  assertContrast(
    tokens,
    "--colony-sidebar-avatar-ring",
    "--colony-sidebar-avatar",
    3,
  );
});

function isColonyThemeStylesheet(filename) {
  return (
    filename.startsWith("colony3-") ||
    filename === "agentsColony3.css" ||
    filename === "firstRun.css" ||
    filename.startsWith("Settings") ||
    filename === "TodayScreen.css" ||
    filename === "ActivityScreen.css" ||
    filename.startsWith("Team") ||
    [
      "askCompose.css",
      "askDecisions.css",
      "business-records.css",
      "company-asks.css",
    ].includes(filename) ||
    filename.startsWith("colony-work-area")
  );
}

function scopedStylesheets(directory) {
  const matches = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...scopedStylesheets(fullPath));
    else if (
      entry.name.endsWith(".css") &&
      isColonyThemeStylesheet(entry.name)
    ) {
      matches.push(fullPath);
    }
  }
  return matches;
}

test("Colony dark surfaces use central color tokens instead of raw hex", () => {
  const roots = [
    path.resolve("src/features"),
    path.resolve("src/shared/styles/globals"),
  ];
  const files = roots.flatMap(scopedStylesheets);
  assert.ok(files.length > 0, "Expected to find Colony theme stylesheets");
  const rawColors = [];

  for (const file of files) {
    const root = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
    root.walkDecls((declaration) => {
      if (
        /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/iu.test(declaration.value)
      ) {
        rawColors.push(
          `${path.relative(process.cwd(), file)}:${declaration.source.start.line}`,
        );
      }
    });
  }

  assert.deepEqual(
    rawColors,
    [],
    "Move CSS colors into the shared theme.css light and .dark token blocks",
  );
});
