import assert from "node:assert/strict";
import test from "node:test";

import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions.ts";
import {
  COMPANY_MAP_CENTER,
  COMPANY_MAP_LAYOUT,
  COMPANY_MAP_SIZE,
  buildCompanyMapLayout,
} from "./companyMapLayout.ts";

test("the measured layout includes every app part and current app job once", () => {
  const layout = buildCompanyMapLayout();
  assert.deepEqual(
    layout.parts.map((part) => part.functionId),
    FUNCTION_ORDER,
  );
  assert.deepEqual(
    layout.jobs.map((job) => `${job.functionId}:${job.name}`).sort(),
    FUNCTION_ORDER.flatMap((functionId) =>
      FUNCTION_DETAILS[functionId].subFunctions.map(
        (name) => `${functionId}:${name}`,
      ),
    ).sort(),
  );
  assert.equal(
    new Set(layout.jobs.map((job) => `${job.functionId}:${job.name}`)).size,
    layout.jobs.length,
  );
});

test("the company hub and arm distances match the board measurements", () => {
  assert.deepEqual(COMPANY_MAP_CENTER, { x: 700, y: 395 });
  assert.deepEqual(COMPANY_MAP_SIZE, { width: 1400, height: 790 });
  assert.deepEqual(
    Object.fromEntries(
      COMPANY_MAP_LAYOUT.parts.map(({ functionId, point }) => [
        functionId,
        point.x,
      ]),
    ),
    {
      sales: 980,
      operations: 420,
      customer_success: 420,
      finance: 980,
      brand: 420,
    },
  );
  assert.equal(COMPANY_MAP_LAYOUT.jobs[0]?.point.x, 1180);
  assert.equal(COMPANY_MAP_LAYOUT.jobs[1]?.point.x, 1180);
  assert.equal(
    COMPANY_MAP_LAYOUT.jobs.find((job) => job.functionId === "operations")
      ?.point.x,
    220,
  );
});
