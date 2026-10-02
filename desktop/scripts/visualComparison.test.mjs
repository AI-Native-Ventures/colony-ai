import assert from "node:assert/strict";
import test from "node:test";

import { compareImages } from "./visualComparison.mjs";

test("comparison images preserve each source row and blend matching pixels", () => {
  const reference = {
    width: 2,
    height: 2,
    pixels: new Uint8Array([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
    ]),
  };
  const app = {
    width: 2,
    height: 2,
    pixels: new Uint8Array([
      110, 120, 130, 255, 140, 150, 160, 255, 170, 180, 190, 255, 200, 210, 220,
      255,
    ]),
  };

  const result = compareImages(reference, app);

  assert.equal(result.sideBySide.width, 4);
  assert.equal(result.sideBySide.height, 2);
  assert.deepEqual(
    Array.from(result.sideBySide.pixels),
    [
      10, 20, 30, 255, 40, 50, 60, 255, 110, 120, 130, 255, 140, 150, 160, 255,
      70, 80, 90, 255, 100, 110, 120, 255, 170, 180, 190, 255, 200, 210, 220,
      255,
    ],
  );
  assert.deepEqual(
    Array.from(result.overlay.pixels),
    [
      60, 70, 80, 255, 90, 100, 110, 255, 120, 130, 140, 255, 150, 160, 170,
      255,
    ],
  );
  assert.equal(result.changedPixels, 4);
  assert.equal(result.changedPixelRatio, 1);
  assert.equal(result.meanAbsoluteChannelDelta, 100);
});

test("comparison rejects mismatched dimensions", () => {
  assert.throws(
    () =>
      compareImages(
        { width: 1, height: 1, pixels: new Uint8Array(4) },
        { width: 2, height: 1, pixels: new Uint8Array(8) },
      ),
    /matching dimensions/,
  );
});
