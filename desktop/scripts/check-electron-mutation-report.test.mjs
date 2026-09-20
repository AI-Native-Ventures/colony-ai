import assert from "node:assert/strict";
import test from "node:test";

import {
  MUTATION_REPORT_CASES,
  readMutationReport,
  validateMutationReport,
} from "./check-electron-mutation-report.mjs";

const markerFor = (mutation) => {
  const definition = MUTATION_REPORT_CASES[mutation];
  const preconditions = {
    hostReady: true,
    hostStartCount: 1,
    visibleWindowCount: 1,
    hostPid: 12345,
    generationId: 1,
    oldRequestPending: mutation === "disable-rebind-fence",
    subframeLoaded: mutation === "allow-untrusted-ipc",
    ipcDeniedIncremented: mutation === "allow-untrusted-ipc",
  };
  return `STAGE0_EXPECTED_MUTATION_FAILURE ${JSON.stringify({
    version: 1,
    mutation,
    seam: definition.seam,
    expectedOutcome: "production-seam-failed",
    preconditions,
  })}`;
};

const reportFor = (mutation, overrides = {}) => {
  const definition = MUTATION_REPORT_CASES[mutation];
  return {
    config: { version: 1 },
    errors: [],
    suites: [
      {
        title: "",
        specs: [
          {
            file: `tests/${definition.file}`,
            title: definition.title,
            tests: [
              {
                expectedStatus: "passed",
                results: [
                  {
                    status: "failed",
                    error: { message: markerFor(mutation) },
                  },
                ],
              },
            ],
            ...overrides,
          },
        ],
      },
    ],
  };
};

test("accepts exactly one expected production-seam failure", () => {
  const result = validateMutationReport(
    reportFor("disable-rebind-fence"),
    "disable-rebind-fence",
  );
  assert.deepEqual(result, {
    mutation: "disable-rebind-fence",
    testTitle: MUTATION_REPORT_CASES["disable-rebind-fence"].title,
    outcome: "production-seam-failed",
  });
});

test("deduplicates the reporter error and stack copies of one marker", () => {
  const report = reportFor("allow-untrusted-ipc");
  const marker = report.suites[0].specs[0].tests[0].results[0].error.message;
  report.suites[0].specs[0].tests[0].results[0].errors = [
    { message: `${marker}\n    at packaged assertion` },
  ];
  const result = validateMutationReport(report, "allow-untrusted-ipc");
  assert.equal(result.outcome, "production-seam-failed");
});

test("rejects a launch or worker failure without the production marker", () => {
  const report = reportFor("disable-rebind-fence");
  report.suites[0].specs[0].tests[0].results[0].error.message =
    "browserType.launch: executable was not found";
  assert.throws(
    () => validateMutationReport(report, "disable-rebind-fence"),
    /expected production marker/,
  );
});

test("rejects discovery with no selected runnable test", () => {
  const report = reportFor("disable-rebind-fence");
  report.suites[0].specs = [];
  assert.throws(
    () => validateMutationReport(report, "disable-rebind-fence"),
    /exactly one runnable selected test/,
  );
});

test("rejects a report with a missing marker entry", () => {
  const report = reportFor("disable-rebind-fence");
  report.suites[0].specs[0].tests[0].results[0].error = undefined;
  assert.throws(
    () => validateMutationReport(report, "disable-rebind-fence"),
    /expected production marker/,
  );
});

test("rejects a missing report file", () => {
  assert.throws(
    () => readMutationReport(`/tmp/colony-stage0-missing-${process.pid}.json`),
    /report file is missing/,
  );
});

test("rejects a wrong selected test", () => {
  const report = reportFor("disable-rebind-fence");
  report.suites[0].specs[0].title = "a different test";
  assert.throws(
    () => validateMutationReport(report, "disable-rebind-fence"),
    /selected test title/,
  );
});

test("rejects an extra unexpected failure and an unexpected pass", () => {
  const extra = reportFor("disable-rebind-fence");
  extra.suites[0].specs.push({
    file: "desktop/tests/other.spec.ts",
    title: "unexpected extra test",
    tests: [{ expectedStatus: "passed", results: [{ status: "failed" }] }],
  });
  assert.throws(
    () => validateMutationReport(extra, "disable-rebind-fence"),
    /exactly one runnable selected test/,
  );

  const pass = reportFor("disable-rebind-fence");
  pass.suites[0].specs[0].tests[0].results[0].status = "passed";
  assert.throws(
    () => validateMutationReport(pass, "disable-rebind-fence"),
    /failed result/,
  );

  const extraError = reportFor("disable-rebind-fence");
  extraError.suites[0].specs[0].tests[0].results[0].errors = [
    { message: "teardown failed after the expected marker" },
  ];
  assert.throws(
    () => validateMutationReport(extraError, "disable-rebind-fence"),
    /unexpected additional error/,
  );
});
