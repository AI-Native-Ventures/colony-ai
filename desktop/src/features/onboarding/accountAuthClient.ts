export type AccountAuthRecord = {
  id: string;
  email: string;
  pubkey: string;
  hasPassword: boolean;
  googleLinked: boolean;
};

export type AccountAuthVerificationSent = { status: "verification_sent" };

/**
 * Desktop account API consumed by onboarding and the persistent claim prompt.
 * The auth feature owns transport, NIP-98 signing, OAuth, and error parsing.
 */
export type AccountAuthClient = {
  signUp(email: string, password: string): Promise<AccountAuthVerificationSent>;
  verifyEmail(email: string, code: string): Promise<AccountAuthRecord>;
  resendCode(
    email: string,
    purpose: "verify" | "reset",
  ): Promise<AccountAuthVerificationSent>;
  signIn(email: string, password: string): Promise<AccountAuthRecord>;
  signInWithGoogle(): Promise<AccountAuthRecord>;
  requestReset(email: string): Promise<AccountAuthVerificationSent>;
  confirmReset(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<AccountAuthRecord>;
  claimAccount(
    email: string,
    password: string,
  ): Promise<AccountAuthVerificationSent>;
  changePassword(newPassword: string): Promise<void>;
  getAccount(): Promise<AccountAuthRecord | null>;
};
