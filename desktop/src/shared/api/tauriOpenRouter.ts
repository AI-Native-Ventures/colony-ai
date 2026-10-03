import { invokeTauri } from "./tauri";

export type OpenRouterModel = {
  id: string;
  name: string;
  free: boolean;
  context: number;
};
export type OpenRouterConnection = {
  status: "connected" | "limit" | "linked";
  usage: number | null;
  freeUsed: number | null;
  limit: number | null;
  limitRemaining: number | null;
  freeRemaining: number | null;
  freeLimit: number | null;
  freeTier: boolean | null;
  metadataWarning?: string | null;
  models: OpenRouterModel[];
  model: string;
  failedRestarts: number;
  testResult?: string;
};
export type OpenRouterOutcome =
  | OpenRouterConnection
  | { status: "unlinked" | "cancelled" }
  | { status: "error" | "reauth" | "unmanaged"; message: string };

/** Native commands return only account/model metadata, never the provider key. */
export const connectOpenRouter = () =>
  invokeTauri<OpenRouterOutcome>("connect_openrouter");
export const cancelOpenRouter = () => invokeTauri<boolean>("cancel_openrouter");
export const getOpenRouterConnection = () =>
  invokeTauri<OpenRouterOutcome>("get_openrouter_connection");
export const selectOpenRouterModel = (model: string) =>
  invokeTauri<OpenRouterOutcome>("select_openrouter_model", { model });
export const testOpenRouterConnection = () =>
  invokeTauri<OpenRouterOutcome>("test_openrouter_connection");
