import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";

/** Installation, connection adapter and authentication are distinct states. */
export function harnessDetectionStatus(
  runtime: AcpRuntimeCatalogEntry,
  ready: boolean,
): string {
  if (ready) return "Ready on this computer";
  switch (runtime.availability) {
    case "adapter_missing":
      return "Setup needed";
    case "adapter_outdated":
      return "Connection update needed";
    case "cli_missing":
      return "CLI needed";
    case "not_installed":
      return "Not installed";
    case "available":
      if (runtime.authStatus.status === "logged_out") return "Sign-in needed";
      if (runtime.authStatus.status === "config_invalid")
        return "Configuration needs attention";
      if (runtime.id === "claude" || runtime.id === "codex")
        return "Sign-in status unavailable";
      return "Authentication not checked";
  }
}

/** Name the component the existing native installer will repair. */
export function harnessInstallLabel(runtime: AcpRuntimeCatalogEntry): string {
  if (runtime.availability === "adapter_missing") return "Set up connection";
  if (runtime.availability === "adapter_outdated") return "Update connection";
  return "Install";
}
