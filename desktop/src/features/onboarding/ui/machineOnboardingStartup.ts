import type { NativeCapability } from "@/shared/api/nativeBridge";

export type MachineOnboardingPage =
  | "account-auth"
  | "identity"
  | "identity-key-intro"
  | "identity-key-help"
  | "key-import"
  | "unsupported"
  | "backup"
  | "setup"
  | "config";

export type MachineOnboardingInitialState = {
  page: MachineOnboardingPage;
  unsupportedCapability: NativeCapability | null;
};

/** Resolve the first page and reason before the onboarding component mounts. */
export function resolveInitialMachineOnboardingState({
  identityLost,
  initialPage,
  supportsCapability,
}: {
  identityLost: boolean;
  initialPage?: MachineOnboardingPage;
  supportsCapability: (capability: NativeCapability) => boolean;
}): MachineOnboardingInitialState {
  if (identityLost && !supportsCapability("identity-import")) {
    return {
      page: "unsupported",
      unsupportedCapability: "identity-import",
    };
  }

  return {
    page: initialPage ?? "account-auth",
    unsupportedCapability: null,
  };
}
