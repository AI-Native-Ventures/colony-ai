import { AuthApiError } from "@/features/auth/authApi";
import type { AccountAuthRecord } from "@/features/onboarding/accountAuthClient";

const RETRY_DELAYS = [1_000, 4_000, 10_000] as const;

/** Retry passive account reads without covering the workspace or looping forever. */
export function startAccountClaimLookup({
  read,
  onAccount,
  onFailure,
  schedule = (callback: () => void, delay: number) =>
    setTimeout(callback, delay),
  clear = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}: {
  read: () => Promise<AccountAuthRecord | null>;
  onAccount: (account: AccountAuthRecord | null) => void;
  onFailure: (code: string, contractFailure: boolean) => void;
  schedule?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clear?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let current = true;
  let inFlight = false;
  let failed = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelTimer = () => {
    if (timer !== undefined) clear(timer);
    timer = undefined;
  };
  const run = async () => {
    if (!current || inFlight) return;
    cancelTimer();
    inFlight = true;
    try {
      const account = await read();
      if (!current) return;
      failed = false;
      onAccount(account);
    } catch (error) {
      if (!current) return;
      failed = true;
      const code = error instanceof AuthApiError ? error.code : "network_error";
      const contractFailure =
        code === "invalid_response" || code.startsWith("identity_");
      onFailure(code, contractFailure);
      if (!contractFailure && retries < RETRY_DELAYS.length) {
        const delay = Math.max(
          RETRY_DELAYS[retries++],
          Math.min(
            60_000,
            error instanceof AuthApiError
              ? (error.retryAfterSecs ?? 0) * 1_000
              : 0,
          ),
        );
        timer = schedule(() => {
          void run();
        }, delay);
      }
    } finally {
      inFlight = false;
    }
  };
  void run();
  return {
    retryOnFocus() {
      if (!failed || inFlight || !current) return;
      retries = 0;
      void run();
    },
    cancel() {
      current = false;
      cancelTimer();
    },
  };
}
