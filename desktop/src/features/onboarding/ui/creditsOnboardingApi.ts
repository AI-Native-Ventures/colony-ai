export type CreditsUnavailableReason =
  | "contract-not-available"
  | "request-failed";

export type CreditsSnapshot =
  | { status: "loading" }
  | {
      status: "available";
      balanceUsdCents: number;
      packs: Array<{
        id: string;
        amountUsdCents: number;
        amountZarCents: number;
      }>;
    }
  | {
      status: "unavailable";
      reason: CreditsUnavailableReason;
    };

export type CreditsCheckoutState =
  | { status: "checkout"; reference: string; checkoutUrl: string }
  | { status: "pending"; reference: string }
  | { status: "confirmed"; reference: string; balanceUsdCents: number }
  | {
      status: "failed" | "cancelled" | "delayed" | "uncertain";
      reference: string;
    }
  | { status: "unavailable"; reason: CreditsUnavailableReason };

/** UI adapter boundary for the credits contract being implemented in W03. */
export interface CreditsOnboardingApi {
  read(communityId: string): Promise<CreditsSnapshot>;
  startCheckout(input: {
    communityId: string;
    packId: string;
  }): Promise<CreditsCheckoutState>;
  checkCheckout(input: {
    communityId: string;
    reference: string;
  }): Promise<CreditsCheckoutState>;
}

/** Used until the W03 credits service is integrated into this base. */
export const unavailableCreditsOnboardingApi: CreditsOnboardingApi = {
  async read() {
    return { status: "unavailable", reason: "contract-not-available" };
  },
  async startCheckout() {
    return { status: "unavailable", reason: "contract-not-available" };
  },
  async checkCheckout() {
    return { status: "unavailable", reason: "contract-not-available" };
  },
};
