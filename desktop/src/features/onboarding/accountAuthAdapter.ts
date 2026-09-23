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

const accountAuthUnavailable: AccountAuthClient = {
  async signUp() {
    throw new Error("Account service unavailable");
  },
  async verifyEmail() {
    throw new Error("Account service unavailable");
  },
  async resendCode() {
    throw new Error("Account service unavailable");
  },
  async signIn() {
    throw new Error("Account service unavailable");
  },
  async signInWithGoogle() {
    throw new Error("Account service unavailable");
  },
  async requestReset() {
    throw new Error("Account service unavailable");
  },
  async confirmReset() {
    throw new Error("Account service unavailable");
  },
  async claimAccount() {
    throw new Error("Account service unavailable");
  },
  async changePassword() {
    throw new Error("Account service unavailable");
  },
  async getAccount() {
    throw new Error("Account service unavailable");
  },
};

/**
 * Local seam for the account UI. The auth feature replaces the production
 * fallback once its client module lands; Playwright injects a typed mock here.
 */
export function getAccountAuthClient(): AccountAuthClient {
  if (
    typeof window !== "undefined" &&
    window.__BUZZ_E2E_ACCOUNT_AUTH_CLIENT__
  ) {
    return window.__BUZZ_E2E_ACCOUNT_AUTH_CLIENT__;
  }
  return accountAuthUnavailable;
}
