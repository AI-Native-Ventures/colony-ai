// Generates the Colony desktop app icon set from the Colony ant mark.
//
//   pnpm --dir desktop exec node scripts/generate-app-icons.mjs
// Use --public-only to refresh dialog icons and the favicon from the committed SVG.
//
// Outputs (src-tauri/icons): colony-icon.svg, icon.png, icon.icns, icon.ico, the
// Tauri PNG sizes, and the Windows Store tiles. The result is committed; CI does
// not regenerate it. The .icns step uses macOS `iconutil`, so run this on a Mac.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const exec = promisify(execFile);
const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iconsDir = path.join(desktop, "src-tauri", "icons");

// Colony brand: deep green tile, cream ant (the landing page ink and paper).
const TILE_TOP = "#3b5a47";
const TILE_BOTTOM = "#1e2e25";
const ANT_COLOR = "#f4f2e8";

// The ant mark from site/public/refined/focused/ant.svg. Its drawn bounds are
// x 24..402 and y 67..281, so the center is (213, 174).
const ANT_BOUNDS = { width: 378, centerX: 213, centerY: 174 };
const antMark = (color) =>
  `<g fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"><path d="M198 201Q176 230 163 265 M229 211Q226 243 232 274 M259 190Q281 221 296 252 M327 114Q340 82 371 74 M343 126Q367 106 395 105"/></g><g fill="${color}"><circle cx="104" cy="172" r="80"/><circle cx="226" cy="164" r="52"/><circle cx="313" cy="148" r="46"/></g>`;

// "apple" follows the macOS icon grid (824px tile on a 1024px canvas). "full"
// fills the canvas for Windows tiles and ICO files, which are not inset.
const VARIANTS = {
  apple: { tile: 824, radius: 186, antShare: 0.64 },
  full: { tile: 992, radius: 214, antShare: 0.66 },
};

export function iconSvg(variantName) {
  const variant = VARIANTS[variantName];
  const inset = (1024 - variant.tile) / 2;
  const scale = (variant.tile * variant.antShare) / ANT_BOUNDS.width;
  const tile = `x="${inset}" y="${inset}" width="${variant.tile}" height="${variant.tile}" rx="${variant.radius}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TILE_TOP}"/><stop offset="1" stop-color="${TILE_BOTTOM}"/></linearGradient><radialGradient id="light" cx="30%" cy="16%" r="78%"><stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect ${tile} fill="url(#tile)"/><rect ${tile} fill="url(#light)"/><g transform="translate(512 512) scale(${scale.toFixed(4)}) translate(${-ANT_BOUNDS.centerX} ${-ANT_BOUNDS.centerY})">${antMark(ANT_COLOR)}</g></svg>`;
}

async function renderer() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  return {
    async png(svg, size) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      );
      return page.screenshot({ omitBackground: true, type: "png" });
    },
    close: () => browser.close(),
  };
}

// An ICO file is a small directory followed by the PNG images it indexes.
export function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, data }, index) => {
    const at = index * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, at);
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, entries, ...images.map(({ data }) => data)]);
}

async function writePublicIcons(draw, svg) {
  const publicDir = path.join(desktop, "public");
  await writeFile(path.join(publicDir, "colony-icon.svg"), `${svg.trim()}\n`);
  for (const [name, size] of [
    ["app-icon@2x.png", 112],
    ["app-icon@3x.png", 168],
  ]) {
    await writeFile(path.join(publicDir, name), await draw.png(svg, size));
  }
}

async function main() {
  if (process.argv.includes("--public-only")) {
    const svg = await readFile(path.join(iconsDir, "colony-icon.svg"), "utf8");
    const draw = await renderer();
    try {
      await writePublicIcons(draw, svg);
    } finally {
      await draw.close();
    }
    return;
  }
  const apple = iconSvg("apple");
  const full = iconSvg("full");
  const draw = await renderer();
  const write = (name, data) => writeFile(path.join(iconsDir, name), data);
  try {
    await mkdir(iconsDir, { recursive: true });
    await write("colony-icon.svg", `${apple}\n`);
    await writePublicIcons(draw, apple);

    // macOS: an iconset folder turned into icon.icns by iconutil.
    const iconset = await mkdtemp(path.join(os.tmpdir(), "colony-icons-"));
    const setDir = path.join(iconset, "icon.iconset");
    await mkdir(setDir);
    for (const base of [16, 32, 128, 256, 512]) {
      await writeFile(
        path.join(setDir, `icon_${base}x${base}.png`),
        await draw.png(apple, base),
      );
      await writeFile(
        path.join(setDir, `icon_${base}x${base}@2x.png`),
        await draw.png(apple, base * 2),
      );
    }
    await exec("iconutil", [
      "-c",
      "icns",
      setDir,
      "-o",
      path.join(iconsDir, "icon.icns"),
    ]);
    await rm(iconset, { recursive: true, force: true });

    // Linux and Tauri PNGs follow the macOS grid.
    await write("icon.png", await draw.png(apple, 1024));
    await write("32x32.png", await draw.png(apple, 32));
    await write("64x64.png", await draw.png(apple, 64));
    await write("128x128.png", await draw.png(apple, 128));
    await write("128x128@2x.png", await draw.png(apple, 256));

    // Windows: ICO plus the Store tiles, full-bleed.
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    await write(
      "icon.ico",
      packIco(
        await Promise.all(
          icoSizes.map(async (size) => ({
            size,
            data: await draw.png(full, size),
          })),
        ),
      ),
    );
    for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
      await write(`Square${size}x${size}Logo.png`, await draw.png(full, size));
    }
    await write("StoreLogo.png", await draw.png(full, 50));
  } finally {
    await draw.close();
  }
  console.log(`Wrote the Colony icon set to ${iconsDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
