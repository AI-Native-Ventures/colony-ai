import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** Error normalized from a rejected Tauri invocation with its wire payload. */
export class TauriInvokeError extends Error {
  readonly payload: unknown;

  constructor(message: string, payload: unknown) {
    super(message);
    this.name = "TauriInvokeError";
    this.payload = payload;
  }
}

function toTauriError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new TauriInvokeError(error, error);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new TauriInvokeError(error.message, error);
  }

  try {
    return new TauriInvokeError(JSON.stringify(error), error);
  } catch {
    return new TauriInvokeError("Unknown Tauri error", error);
  }
}

/** Invoke an existing Tauri command while preserving its normalized error payload. */
export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    // HTTP backoff lives in Rust. Do not apply its separate ApiCalls quota
    // to the WebSocket gate, but preserve the failure for the caller.
    throw toTauriError(error);
  }
}
