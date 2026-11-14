import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_MAP_MAX_SCALE,
  COMPANY_MAP_MIN_SCALE,
  cameraForScaledPoint,
  clampCompanyMapCamera,
  clampCompanyMapScale,
} from "./companyMapCamera.ts";

const stage = { height: 790, left: 164, top: 164, width: 1400 };
const viewport = { height: 1117, left: 0, top: 0, width: 1728 };
const origin = {
  x: stage.left + stage.width / 2,
  y: stage.top + stage.height / 2,
};

function worldPoint(camera, point) {
  return {
    x: (point.x - origin.x - camera.x) / camera.scale,
    y: (point.y - origin.y - camera.y) / camera.scale,
  };
}

test("clamps map scale to the existing zoom button bounds", () => {
  assert.equal(clampCompanyMapScale(0.1), COMPANY_MAP_MIN_SCALE);
  assert.equal(clampCompanyMapScale(9), COMPANY_MAP_MAX_SCALE);
  assert.equal(clampCompanyMapScale(1.15), 1.15);
});

test("keeps the world point beneath a wheel pointer fixed while zooming", () => {
  const pointer = { x: 1280, y: 370 };
  const before = { scale: 1, x: 0, y: 0 };
  const after = cameraForScaledPoint({
    camera: before,
    origin,
    scale: 1.3,
    source: pointer,
    target: pointer,
  });

  assert.deepEqual(worldPoint(after, pointer), worldPoint(before, pointer));
});

test("moves the pinch anchor with its fingers while preserving its world point", () => {
  const start = { x: 720, y: 500 };
  const end = { x: 810, y: 540 };
  const before = { scale: 1, x: 48, y: -28 };
  const after = cameraForScaledPoint({
    camera: before,
    origin,
    scale: 1.2,
    source: start,
    target: end,
  });

  assert.deepEqual(worldPoint(after, end), worldPoint(before, start));
});

test("clamps a pan so a visible strip of the company remains in the viewport", () => {
  const clamped = clampCompanyMapCamera(
    { scale: 1, x: 10_000, y: -10_000 },
    stage,
    viewport,
  );
  const mapLeft = stage.left + clamped.x;
  const mapRight = mapLeft + stage.width * clamped.scale;
  const mapTop = stage.top + clamped.y;
  const mapBottom = mapTop + stage.height * clamped.scale;

  assert.ok(mapLeft <= viewport.left + viewport.width - 72);
  assert.ok(mapRight >= viewport.left + 72);
  assert.ok(mapTop <= viewport.top + viewport.height - 72);
  assert.ok(mapBottom >= viewport.top + 72);
});
