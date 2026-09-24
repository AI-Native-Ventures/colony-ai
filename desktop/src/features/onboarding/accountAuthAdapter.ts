import { authService } from "../auth/authService";
import type { AccountAuthClient } from "./accountAuthClient";

export type AccountAuthTestCall = {
  method: keyof AccountAuthClient;
  route: string;
  email?: string;
  purpose?: "verify" | "reset";
};

declare global {
  interface Window {
    __BUZZ_E2E_ACCOUNT_AUTH_CLIENT__?: AccountAuthClient;
    __BUZZ_E2E_ACCOUNT_AUTH_CALLS__?: AccountAuthTestCall[];
    __BUZZ_E2E_QUEUE_ACCOUNT_AUTH_ERROR__?: (
      method: keyof AccountAuthClient,
      error: Record<string, unknown>,
    ) => void;
    __BUZZ_E2E_SET_ACCOUNT_LINKED__?: (linked: boolean, email?: string) => void;
  }
}

/**
 * Returns the shared account service; Playwright injects a typed mock here.
 */
export function getAccountAuthClient(): AccountAuthClient {
  if (
    typeof window !== "undefined" &&
    window.__BUZZ_E2E_ACCOUNT_AUTH_CLIENT__
  ) {
    return window.__BUZZ_E2E_ACCOUNT_AUTH_CLIENT__;
  }
  return authService;
}
