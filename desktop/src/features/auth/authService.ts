import {
  AuthApiError,
  createAuthApi,
  type AuthAccount,
  type AuthApi,
  type AuthApiOptions,
  type AuthSession,
  type SignRelayEvent,
  type VerificationSent,
} from "./authApi";

export { AuthApiError } from "./authApi";
export type { AuthAccount, VerificationSent } from "./authApi";

/** Operations exposed to onboarding and persistent account prompts. */
export type AuthService = {
  signUp(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<VerificationSent>;
  verifyEmail(email: string, code: string): Promise<AuthAccount>;
  resendCode(
    email: string,
    purpose: "verify" | "reset",
  ): Promise<VerificationSent>;
  signIn(email: string, password: string): Promise<AuthAccount>;
  signInWithGoogle(): Promise<AuthAccount>;
  requestReset(email: string): Promise<VerificationSent>;
  checkResetCode(email: string, code: string): Promise<void>;
  confirmReset(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<AuthAccount>;
  claimAccount(email: string, password: string): Promise<VerificationSent>;
  changePassword(newPassword: string): Promise<void>;
  getAccount(): Promise<AuthAccount | null>;
  deleteAccount(): Promise<void>;
};

export type AuthServiceDeps = {
  getRelayHttpUrl: () => Promise<string>;
  signRelayEvent: SignRelayEvent;
  getIdentity: () => Promise<{ pubkey: string }>;
  getNsec: () => Promise<string>;
  importIdentity: (nsec: string) => Promise<{ pubkey: string }>;
  googleSignIn?: () => Promise<string>;
  fetcher?: AuthApiOptions["fetcher"];
};

type CachedAccount = {
  scope: string;
  account: AuthAccount | null;
};

function safeIdentityError(error: unknown): AuthApiError {
  return error instanceof AuthApiError
    ? error
    : new AuthApiError("identity_unavailable");
}

function cacheScope(baseUrl: string, pubkey: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new AuthApiError("invalid_relay_url");
  }
  return `${base.origin + base.pathname.replace(/\/+$/, "")}|${pubkey.toLowerCase()}`;
}

function copyAccount(account: AuthAccount | null): AuthAccount | null {
  return account ? { ...account } : null;
}

/**
 * Build the service consumed by onboarding and persistent account prompts.
 * Session nsecs are cleared from the response object and local variable after
 * they reach the existing native identity import path.
 */
export function createAuthService(deps: AuthServiceDeps): AuthService {
  let cachedAccount: CachedAccount | null = null;
  let cacheGeneration = 0;

  function invalidateAccountCache(): void {
    cachedAccount = null;
    cacheGeneration += 1;
  }

  async function apiFor(baseUrl?: string): Promise<{
    api: AuthApi;
    baseUrl: string;
  }> {
    let relayUrl = baseUrl;
    if (!relayUrl) {
      try {
        relayUrl = await deps.getRelayHttpUrl();
      } catch {
        throw new AuthApiError("network_error");
      }
    }
    const options: AuthApiOptions = {
      baseUrl: relayUrl,
      signRelayEvent: deps.signRelayEvent,
      fetcher: deps.fetcher,
    };
    return { api: createAuthApi(options), baseUrl: relayUrl };
  }

  async function currentPubkey(): Promise<string> {
    try {
      const identity = await deps.getIdentity();
      if (!identity.pubkey) throw new Error("Identity unavailable");
      return identity.pubkey;
    } catch (error) {
      throw safeIdentityError(error);
    }
  }

  async function consumeSession(session: AuthSession): Promise<AuthAccount> {
    let nsec = session.nsec;
    session.nsec = "";
    try {
      let imported: { pubkey: string };
      try {
        imported = await deps.importIdentity(nsec);
      } catch {
        throw new AuthApiError("identity_import_failed");
      }
      if (
        imported.pubkey.toLowerCase() !== session.account.pubkey.toLowerCase()
      ) {
        throw new AuthApiError("identity_import_failed");
      }
      invalidateAccountCache();
      return { ...session.account };
    } finally {
      nsec = "";
    }
  }

  async function sessionRequest(
    request: (api: AuthApi) => Promise<AuthSession>,
  ): Promise<AuthAccount> {
    const { api } = await apiFor();
    return consumeSession(await request(api));
  }

  return {
    async signUp(email, password, displayName) {
      const { api } = await apiFor();
      return displayName === undefined
        ? api.signUp(email.trim(), password)
        : api.signUp(email.trim(), password, displayName);
    },

    async verifyEmail(email, code) {
      return sessionRequest((api) => api.verifyEmail(email.trim(), code));
    },

    async resendCode(email, purpose) {
      const { api } = await apiFor();
      return api.resendCode(email.trim(), purpose);
    },

    async signIn(email, password) {
      return sessionRequest((api) => api.signIn(email.trim(), password));
    },

    async signInWithGoogle() {
      if (!deps.googleSignIn) {
        throw new AuthApiError("google_sign_in_unavailable");
      }
      let idToken = "";
      try {
        idToken = await deps.googleSignIn();
        if (!idToken) throw new AuthApiError("google_sign_in_failed");
        const { api } = await apiFor();
        return await consumeSession(await api.signInWithGoogle(idToken));
      } catch (error) {
        if (error instanceof AuthApiError) throw error;
        throw new AuthApiError("google_sign_in_failed");
      } finally {
        idToken = "";
      }
    },

    async requestReset(email) {
      const { api } = await apiFor();
      return api.requestReset(email.trim());
    },

    async checkResetCode(email, code) {
      const { api } = await apiFor();
      return api.checkResetCode(email.trim(), code);
    },

    async confirmReset(email, code, newPassword) {
      return sessionRequest((api) =>
        api.confirmReset(email.trim(), code, newPassword),
      );
    },

    async claimAccount(email, password) {
      const expectedPubkey = await currentPubkey();
      let nsec = "";
      try {
        nsec = await deps.getNsec();
        if (!nsec) throw new AuthApiError("identity_unavailable");
        const { api } = await apiFor();
        return await api.claimAccount(
          email.trim(),
          password,
          nsec,
          expectedPubkey,
        );
      } catch (error) {
        throw safeIdentityError(error);
      } finally {
        nsec = "";
      }
    },

    async changePassword(newPassword) {
      const expectedPubkey = await currentPubkey();
      const { api } = await apiFor();
      await api.changePassword(newPassword, expectedPubkey);
      invalidateAccountCache();
    },

    async getAccount() {
      const expectedPubkey = await currentPubkey();
      const { api, baseUrl } = await apiFor();
      const scope = cacheScope(baseUrl, expectedPubkey);
      if (cachedAccount?.scope === scope) {
        return copyAccount(cachedAccount.account);
      }
      const requestGeneration = cacheGeneration;

      let account: AuthAccount | null;
      try {
        account = await api.getAccount(expectedPubkey);
      } catch (error) {
        if (
          error instanceof AuthApiError &&
          error.code === "account_not_found"
        ) {
          account = null;
        } else {
          throw error;
        }
      }
      if (
        account &&
        account.pubkey.toLowerCase() !== expectedPubkey.toLowerCase()
      ) {
        throw new AuthApiError("invalid_response");
      }

      const currentAfterRequest = await currentPubkey();
      if (currentAfterRequest.toLowerCase() !== expectedPubkey.toLowerCase()) {
        throw new AuthApiError("identity_changed");
      }
      if (requestGeneration !== cacheGeneration) {
        throw new AuthApiError("account_state_changed");
      }
      cachedAccount = { scope, account: copyAccount(account) };
      return copyAccount(account);
    },

    async deleteAccount() {
      const expectedPubkey = await currentPubkey();
      const { api } = await apiFor();
      await api.deleteAccount(expectedPubkey);
      invalidateAccountCache();
    },
  };
}

async function googleSignInFromNativeHost(): Promise<string> {
  const clientId = import.meta.env?.COLONY_GOOGLE_DESKTOP_CLIENT_ID?.trim();
  if (!clientId) throw new AuthApiError("google_sign_in_unavailable");
  try {
    const { requireNativeCapability } = await import(
      "@/shared/api/nativeBridge"
    );
    const { invokeTauri } = await import("@/shared/api/tauri");
    requireNativeCapability("google-oauth");
    const token = await invokeTauri<string>("google_desktop_sign_in", {
      clientId,
    });
    if (!token) throw new AuthApiError("google_sign_in_failed");
    return token;
  } catch (error) {
    if (error instanceof AuthApiError) throw error;
    throw new AuthApiError("google_sign_in_failed");
  }
}

const runtimeService = createAuthService({
  async getRelayHttpUrl() {
    const { getRelayHttpUrl } = await import("@/shared/api/tauri");
    return getRelayHttpUrl();
  },
  async signRelayEvent(input) {
    const { signRelayEvent } = await import("@/shared/api/tauri");
    return signRelayEvent(input);
  },
  async getIdentity() {
    const { getIdentity } = await import("@/shared/api/tauriIdentity");
    return getIdentity();
  },
  async getNsec() {
    const { getNsec } = await import("@/shared/api/tauriIdentity");
    return getNsec();
  },
  async importIdentity(nsec) {
    const { importIdentity } = await import("@/shared/api/tauriIdentity");
    return importIdentity(nsec);
  },
  googleSignIn: googleSignInFromNativeHost,
});

/** Shared service instance used by the desktop UI. */
export const authService = runtimeService;
