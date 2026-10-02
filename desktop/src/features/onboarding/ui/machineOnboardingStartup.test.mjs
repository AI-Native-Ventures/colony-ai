import assert from "node:assert/strict";
import test from "node:test";

import { resolveInitialMachineOnboardingState } from "./machineOnboardingStartup.ts";

test("first run starts with account options", () => {
  assert.deepEqual(
    resolveInitialMachineOnboardingState({
      identityLost: false,
      supportsCapability: () => true,
    }),
    { page: "account-auth", unsupportedCapability: null },
  );
});

test("advanced onboarding can still open the existing identity path", () => {
  assert.deepEqual(
    resolveInitialMachineOnboardingState({
      identityLost: false,
      initialPage: "identity",
      supportsCapability: () => true,
    }),
    { page: "identity", unsupportedCapability: null },
  );
});

test("lost identity recovery keeps account sign in on the main path", () => {
  assert.deepEqual(
    resolveInitialMachineOnboardingState({
      identityLost: true,
      supportsCapability: () => true,
    }),
    { page: "account-auth", unsupportedCapability: null },
  );
});

test("identity recovery explains when native import is unavailable", () => {
  assert.deepEqual(
    resolveInitialMachineOnboardingState({
      identityLost: true,
      supportsCapability: () => false,
    }),
    { page: "unsupported", unsupportedCapability: "identity-import" },
  );
});
