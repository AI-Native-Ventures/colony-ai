#!/usr/bin/env node
// Compare an app screenshot with a Colony 3.0 design reference PNG.
//
//   node scripts/colony3-compare.mjs <reference.png> <app.png> <outPrefix> [--crop x,y,w,h] [--scale n]
//
// Writes <outPrefix>-side.png (reference left, app right), <outPrefix>-overlay.png
// (50 percent blend) and <outPrefix>-heat.png (5x channel difference), and
// prints the difference metrics as JSON. `--crop` limits the comparison to one
// region of both images, for boards where only part of the screen is in scope;
// `--scale` enlarges the written images by a whole factor for close reading.
import { readFileSync, writeFileSync } from "node:fs";
import UPNG from "upng-js";

import { compareImages } from "./visualComparison.mjs";

const [, , referencePath, appPath, outPrefix, ...rest] = process.argv;
if (!referencePath || !appPath || !outPrefix) {
  console.error(
    "usage: colony3-compare.mjs <reference.png> <app.png> <outPrefix> [--crop x,y,w,h]",
  );
  process.exit(2);
}

function decode(path) {
  const buffer = readFileSync(path);
  const png = UPNG.decode(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  );
  const rgba = new Uint8Array(UPNG.toRGBA8(png)[0]);
  return { width: png.width, height: png.height, pixels: rgba };
}

function crop(image, [x, y, w, h]) {
  const pixels = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    pixels.set(image.pixels.subarray(from, from + w * 4), row * w * 4);
  }
  return { width: w, height: h, pixels };
}

function encode(path, image) {
  writeFileSync(
    path,
    Buffer.from(
      UPNG.encode([image.pixels.buffer], image.width, image.height, 0),
    ),
  );
}

let reference = decode(referencePath);
let app = decode(appPath);
const cropIndex = rest.indexOf("--crop");
if (cropIndex !== -1) {
  const region = rest[cropIndex + 1].split(",").map(Number);
  reference = crop(reference, region);
  app = crop(app, region);
}
if (reference.width !== app.width || reference.height !== app.height) {
  const width = Math.min(reference.width, app.width);
  const height = Math.min(reference.height, app.height);
  console.error(
    `size mismatch: reference ${reference.width}x${reference.height}, app ${app.width}x${app.height}; comparing ${width}x${height}`,
  );
  reference = crop(reference, [0, 0, width, height]);
  app = crop(app, [0, 0, width, height]);
}

function enlarge(image, factor) {
  if (factor <= 1) return image;
  const width = image.width * factor;
  const height = image.height * factor;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from =
        (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      pixels.set(image.pixels.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
}

const scaleIndex = rest.indexOf("--scale");
const factor = scaleIndex === -1 ? 1 : Number(rest[scaleIndex + 1]);
const result = compareImages(reference, app);
encode(`${outPrefix}-side.png`, enlarge(result.sideBySide, factor));
encode(`${outPrefix}-overlay.png`, enlarge(result.overlay, factor));
encode(`${outPrefix}-heat.png`, enlarge(result.heatmap, factor));
console.log(
  JSON.stringify(
    {
      size: `${reference.width}x${reference.height}`,
      changedPixelRatio: Number(result.changedPixelRatio.toFixed(4)),
      meanAbsoluteChannelDelta: Number(
        result.meanAbsoluteChannelDelta.toFixed(3),
      ),
      largestDiffRegions: result.largestDiffRegions.slice(0, 5),
    },
    null,
    1,
  ),
);
