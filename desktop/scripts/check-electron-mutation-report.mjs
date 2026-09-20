import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MARKER = "STAGE0_EXPECTED_MUTATION_FAILURE ";

export const MUTATION_REPORT_CASES = Object.freeze({
  "disable-rebind-fence": Object.freeze({
    file: "electron-host-feasibility.spec.ts",
    title: "reload rebinds the same helper and fences the delayed old request",
    seam: "renderer rebind generation fence",
    requiredPreconditions: Object.freeze([
      "hostReady",
      "hostStartCount",
      "visibleWindowCount",
      "hostPid",
      "generationId",
      "oldRequestPending",
    ]),
  }),
  "allow-untrusted-ipc": Object.freeze({
    file: "electron-host-feasibility.spec.ts",
    title: "packaged IPC, navigation, window, and permission guards deny",
    seam: "trusted IPC sender guard",
    requiredPreconditions: Object.freeze([
      "hostReady",
      "hostStartCount",
      "visibleWindowCount",
      "hostPid",
      "generationId",
      "subframeLoaded",
      "ipcDeniedIncremented",
    ]),
  }),
});

function reportError(message) {
  return new Error(`electron stage0 mutation report failed: ${message}`);
}

function collectSuites(suites, output = []) {
  if (!Array.isArray(suites)) return output;
  for (const suite of suites) {
    if (!suite || typeof suite !== "object") continue;
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (spec && typeof spec === "object") output.push(spec);
      }
    }
    collectSuites(suite.suites, output);
  }
  return output;
}

function collectErrorMessages(result) {
  const messages = [];
  const add = (value) => {
    if (typeof value === "string") {
      messages.push(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.message === "string") messages.push(value.message);
    if (Array.isArray(value.errors)) {
      for (const error of value.errors) add(error);
    }
    if (value.error) add(value.error);
  };
  add(result?.error);
  if (Array.isArray(result?.errors)) {
    for (const error of result.errors) add(error);
  }
  return messages;
}

function parseMarker(messages) {
  const markerPayloads = [
    ...new Set(
      messages
        .filter((message) => message.includes(MARKER))
        .map((message) => {
          const markerIndex = message.indexOf(MARKER);
          return message
            .slice(markerIndex + MARKER.length)
            .split(/\r?\n/, 1)[0]
            .trim();
        }),
    ),
  ];
  if (markerPayloads.length !== 1) {
    throw reportError(
      "selected test is missing its expected production marker",
    );
  }
  try {
    const marker = JSON.parse(markerPayloads[0]);
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
      throw new Error("marker is not an object");
    }
    return marker;
  } catch {
    throw reportError("expected production marker is not valid JSON");
  }
}

function assertPreconditions(marker, definition) {
  const preconditions = marker.preconditions;
  if (
    !preconditions ||
    typeof preconditions !== "object" ||
    Array.isArray(preconditions)
  ) {
    throw reportError("production marker is missing preconditions");
  }
  for (const key of definition.requiredPreconditions) {
    if (!(key in preconditions)) {
      throw reportError(`production marker is missing precondition ${key}`);
    }
  }
  if (preconditions.hostReady !== true) {
    throw reportError("host-ready precondition was not proven");
  }
  if (preconditions.hostStartCount !== 1) {
    throw reportError("host-start precondition was not exactly one");
  }
  if (preconditions.visibleWindowCount !== 1) {
    throw reportError("visible-window precondition was not exactly one");
  }
  if (
    !Number.isSafeInteger(preconditions.hostPid) ||
    preconditions.hostPid <= 0
  ) {
    throw reportError("helper-process precondition was not proven");
  }
  if (preconditions.generationId !== 1) {
    throw reportError(
      "initial renderer generation precondition was not proven",
    );
  }
  if (
    definition.requiredPreconditions.includes("oldRequestPending") &&
    preconditions.oldRequestPending !== true
  ) {
    throw reportError("old-request pending precondition was not proven");
  }
  if (
    definition.requiredPreconditions.includes("subframeLoaded") &&
    preconditions.subframeLoaded !== true
  ) {
    throw reportError("untrusted subframe precondition was not proven");
  }
  if (
    definition.requiredPreconditions.includes("ipcDeniedIncremented") &&
    preconditions.ipcDeniedIncremented !== true
  ) {
    throw reportError("IPC denial callback precondition was not proven");
  }
}

export function validateMutationReport(report, mutation) {
  const definition = MUTATION_REPORT_CASES[mutation];
  if (!definition) throw reportError(`unsupported mutation ${mutation}`);
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw reportError("report is not an object");
  }
  if (Array.isArray(report.errors) && report.errors.length > 0) {
    throw reportError("report contains a global runner error");
  }

  const specs = collectSuites(report.suites);
  const runnableSpecs = specs.filter(
    (spec) => Array.isArray(spec.tests) && spec.tests.length > 0,
  );
  if (runnableSpecs.length !== 1) {
    throw reportError("expected exactly one runnable selected test");
  }
  const [spec] = runnableSpecs;
  if (spec.title !== definition.title) {
    throw reportError(
      `selected test title is not ${JSON.stringify(definition.title)}`,
    );
  }
  const specFile =
    typeof spec.file === "string" ? spec.file.replaceAll("\\", "/") : "";
  if (
    specFile !== `tests/${definition.file}` &&
    !specFile.endsWith(`/tests/${definition.file}`)
  ) {
    throw reportError("selected test file is not the expected production spec");
  }
  if (spec.tests.length !== 1) {
    throw reportError("selected test has an unexpected project count");
  }
  const [testResult] = spec.tests;
  if (testResult.expectedStatus !== "passed") {
    throw reportError(
      "selected test has an unexpected expected-status setting",
    );
  }
  if (!Array.isArray(testResult.results) || testResult.results.length !== 1) {
    throw reportError("selected test has an unexpected retry or result count");
  }
  const [result] = testResult.results;
  if (result?.status !== "failed") {
    throw reportError(
      "selected test did not produce the required failed result",
    );
  }
  const errorMessages = collectErrorMessages(result);
  if (!errorMessages.some((message) => message.includes(MARKER))) {
    throw reportError(
      "selected test is missing its expected production marker",
    );
  }
  if (errorMessages.some((message) => !message.includes(MARKER))) {
    throw reportError("selected test contains an unexpected additional error");
  }
  const marker = parseMarker(errorMessages);
  if (marker.version !== 1) throw reportError("unsupported marker version");
  if (marker.mutation !== mutation) {
    throw reportError(
      "production marker mutation does not match the selected lane",
    );
  }
  if (marker.seam !== definition.seam) {
    throw reportError(
      "production marker seam does not match the selected lane",
    );
  }
  if (marker.expectedOutcome !== "production-seam-failed") {
    throw reportError(
      "production marker outcome is not the expected seam failure",
    );
  }
  assertPreconditions(marker, definition);
  return {
    mutation,
    testTitle: definition.title,
    outcome: marker.expectedOutcome,
  };
}

export function readMutationReport(reportPath) {
  if (typeof reportPath !== "string" || reportPath.length === 0) {
    throw reportError("report path is required");
  }
  if (!existsSync(reportPath)) {
    throw reportError("report file is missing");
  }
  try {
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    throw reportError("report file is not valid JSON");
  }
}

function main() {
  const reportPath = process.argv[2];
  const mutationArgument = process.argv.find((value) =>
    value.startsWith("--mutation="),
  );
  const mutation = mutationArgument?.slice("--mutation=".length);
  if (!mutation) throw reportError("--mutation is required");
  const result = validateMutationReport(
    readMutationReport(reportPath),
    mutation,
  );
  console.log(
    JSON.stringify({ electron_stage0_mutation_guard: "passed", ...result }),
  );
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
