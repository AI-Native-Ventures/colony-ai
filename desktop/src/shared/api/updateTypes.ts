export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "unavailable" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent?: number }
  | { state: "installing" }
  | { state: "ready"; version?: string }
  | { state: "error"; message: string; releaseUrl?: string }
  | { state: "manual-required"; version: string; releaseUrl: string };
