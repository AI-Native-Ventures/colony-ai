export const STAGE0_BUILD_FLAVOR = "instrumented";
export const STAGE0_APP_NAME = "Buzz Stage0 Instrumented";
export const STAGE0_APP_ID = "xyz.ainative.ventures.colony.stage0.instrumented";
export const STAGE0_USER_DATA_SUFFIX = "instrumented";
export const STAGE0_PACKAGE_NAME = "colony-stage0-instrumented";
export const STAGE0_INSTRUMENTATION_ENABLED = true;
export const STAGE0_TEST = Object.freeze({
  mutationEnv: "COLONY_STAGE0_TEST_MUTATION",
  mutationNames: Object.freeze(["disable-rebind-fence", "allow-untrusted-ipc"]),
  disableRebindMutation: "disable-rebind-fence",
  allowUntrustedIpcMutation: "allow-untrusted-ipc",
  hostModeEnv: "COLONY_STAGE0_HOST_MODE",
  hostModeMissing: "missing",
  faultEnv: "COLONY_STAGE0_FAULT",
  subframeEnabled: true,
  subframePreload: "test-subframe-preload.cjs",
  subframePreloadId: "colony-stage0-test-subframe",
  subframeFixtureHash: "#stage0-test-subframe",
  stateGlobal: "__COLONY_STAGE0_TEST_STATE__",
  killGlobal: "__COLONY_STAGE0_TEST_KILL__",
});
