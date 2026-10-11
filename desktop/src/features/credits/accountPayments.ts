import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";

export type CreditPack = {
  id: string;
  name: string;
  chargeMinorUnits: number;
  chargeCurrency: "USD" | "ZAR";
  grantUsdCents: number;
};
export type CreditIntent = {
  reference: string;
  idempotencyKey: string;
  packId: string;
  status: "pending" | "paid" | "delayed" | "failed" | "cancelled" | "uncertain";
  grantNanousd: string;
  createdAt: string;
};
export type CreditSnapshot = {
  enabled: boolean;
  provider: "stripe" | "payfast";
  policyUrls: { terms: string; acceptableUse: string };
  packs: CreditPack[];
  balanceUsdCents: number;
  intents: CreditIntent[];
};
export type Checkout = {
  reference: string;
  status: CreditIntent["status"];
  idempotencyKey: string;
  authorizationUrl: string | null;
  authorizationMethod: "GET" | "POST" | null;
  authorizationFields: Array<{ name: string; value: string }>;
};
export class PaymentRequestError extends Error {
  readonly code: string;
  readonly reference?: string;
  constructor(code: string, reference?: string) {
    super(
      code === "email_unverified"
        ? "Verify your account email before buying credits."
        : code === "account_not_found"
          ? "Sign in to a Colony account to buy credits."
          : "The payment service could not confirm this request. Check your payment before trying again.",
    );
    this.code = code;
    this.reference = reference;
  }
}
async function request<T>(
  path: string,
  body?: Record<string, unknown>,
  signed = true,
  httpBase?: string,
): Promise<T> {
  const url = `${(httpBase ?? (await getRelayHttpUrl())).replace(/\/+$/, "")}/api/payments${path}`;
  const method = body ? "POST" : "GET";
  const serialized = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {};
  if (serialized) headers["Content-Type"] = "application/json";
  if (signed) {
    const tags = [
      ["u", url],
      ["method", method],
      ["nonce", crypto.randomUUID()],
    ];
    if (serialized) {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serialized),
      );
      tags.push([
        "payload",
        Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      ]);
    }
    headers.Authorization = `Nostr ${btoa(JSON.stringify(await signRelayEvent({ kind: 27235, content: "", tags })))}`;
  }
  const response = await fetch(url, {
    method,
    headers,
    body: serialized,
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new PaymentRequestError(result.error, result.reference);
  return result as T;
}

export async function readCredits(): Promise<CreditSnapshot> {
  const base = await getRelayHttpUrl();
  const [catalog, history] = await Promise.all([
    request<
      Pick<CreditSnapshot, "packs" | "provider" | "enabled" | "policyUrls">
    >("/packs", undefined, false, base),
    request<{ paymentIntents: CreditIntent[] }>(
      "/history",
      undefined,
      true,
      base,
    ),
  ]);
  // Read after history so a paid intent cannot be paired with a pre-grant balance.
  const balance = await request<{ balanceUsdCents: number }>(
    "/balance",
    undefined,
    true,
    base,
  );
  return {
    ...catalog,
    balanceUsdCents: balance.balanceUsdCents,
    intents: history.paymentIntents,
  };
}
export function startCreditCheckout(
  packId: string,
  idempotencyKey: string,
): Promise<Checkout> {
  return request("/checkout", { packId, idempotencyKey });
}
export function checkCreditPayment(reference: string): Promise<CreditIntent> {
  return request(`/intents/${encodeURIComponent(reference)}`);
}
export function formatCreditMoney(
  cents: number,
  currency: string = "USD",
): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}
