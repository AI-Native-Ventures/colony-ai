/**
 * Ending a person's browser profiles: the cookies, logins and storage that the
 * visible browser tab keeps per community.
 *
 * The profile of a community must not outlive that community on this device,
 * and no profile may outlive a sign-out or an account delete. The Electron host
 * can refuse (a download is still stopping, the host is busy) or may not be
 * there at all (kill switch, plain browser). A refusal is never swallowed: it
 * leaves a durable record in `localStorage` and `retryPendingBrowserForgets`
 * finishes the job at the next start. The record is bounded: past
 * `MAX_PENDING_BUSINESSES` ids it collapses into one "forget everything".
 */
import { browserHost, isBrowserHostAvailable } from "./browserHost";

const PENDING_KEY = "colony-browser-forget-pending.v1";
const MAX_PENDING_BUSINESSES = 64;
/** A cancelled download needs a moment to stop before its profile can go. */
const SETTLE_ATTEMPTS = 3;
const SETTLE_DELAY_MS = 300;

type Pending = { all: boolean; businessIds: string[] };

export type ForgetOutcome = "forgotten" | "deferred";

export type ForgetHost = Pick<
  typeof browserHost,
  "closeBusiness" | "forgetBusiness" | "forgetAll"
>;

export type ForgetStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ForgetDependencies = {
  host: () => ForgetHost | null;
  storage: () => ForgetStorage | null;
  delay: (ms: number) => Promise<void>;
};

function parsePending(raw: string | null): Pending {
  if (!raw) return { all: false, businessIds: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null)
      return { all: false, businessIds: [] };
    const record = value as { all?: unknown; businessIds?: unknown };
    const ids = Array.isArray(record.businessIds)
      ? record.businessIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];
    return {
      all: record.all === true,
      businessIds: [...new Set(ids)].slice(0, MAX_PENDING_BUSINESSES),
    };
  } catch {
    return { all: false, businessIds: [] };
  }
}

export function createBrowserProfileForgetter(deps: ForgetDependencies) {
  let retrying: Promise<void> | null = null;

  function readPending(): Pending {
    try {
      return parsePending(deps.storage()?.getItem(PENDING_KEY) ?? null);
    } catch {
      return { all: false, businessIds: [] };
    }
  }

  function writePending(pending: Pending): boolean {
    try {
      const storage = deps.storage();
      if (!storage) return false;
      if (!pending.all && pending.businessIds.length === 0)
        storage.removeItem(PENDING_KEY);
      else storage.setItem(PENDING_KEY, JSON.stringify(pending));
      return true;
    } catch {
      return false;
    }
  }

  /** Keep the work to do. Too many ids become one "forget everything". */
  function remember(change: { businessId?: string; all?: true }): void {
    const current = readPending();
    const all = current.all || change.all === true;
    const ids = new Set(current.businessIds);
    if (change.businessId) ids.add(change.businessId);
    const next: Pending =
      all || ids.size > MAX_PENDING_BUSINESSES
        ? { all: true, businessIds: [] }
        : { all: false, businessIds: [...ids] };
    if (!writePending(next))
      console.warn("Could not record a browser profile cleanup to retry");
  }

  function settle(businessId: string) {
    const current = readPending();
    writePending({
      all: current.all,
      businessIds: current.businessIds.filter((id) => id !== businessId),
    });
  }

  async function attempt(run: () => Promise<unknown>): Promise<void> {
    let failure: unknown;
    for (let tries = 0; tries < SETTLE_ATTEMPTS; tries += 1) {
      if (tries > 0) await deps.delay(SETTLE_DELAY_MS);
      try {
        await run();
        return;
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }

  /** End one community's browser profile. Never throws; says if it must retry. */
  async function forgetBusiness(businessId: string): Promise<ForgetOutcome> {
    const host = deps.host();
    if (!host) {
      remember({ businessId });
      return "deferred";
    }
    try {
      await attempt(async () => {
        await host.closeBusiness(businessId);
        await host.forgetBusiness(businessId);
      });
      settle(businessId);
      return "forgotten";
    } catch (error) {
      console.warn("Could not forget a community's browser profile", error);
      remember({ businessId });
      return "deferred";
    }
  }

  /** End every browser profile (sign out, account delete). Never throws. */
  async function forgetAll(): Promise<ForgetOutcome> {
    const host = deps.host();
    if (!host) {
      remember({ all: true });
      return "deferred";
    }
    try {
      await attempt(() => host.forgetAll());
      writePending({ all: false, businessIds: [] });
      return "forgotten";
    } catch (error) {
      console.warn("Could not forget the browser profiles", error);
      remember({ all: true });
      return "deferred";
    }
  }

  /** Finish what an earlier run could not. Safe to call at every start. */
  function retryPending(): Promise<void> {
    if (retrying) return retrying;
    retrying = (async () => {
      const pending = readPending();
      if (!pending.all && pending.businessIds.length === 0) return;
      if (!deps.host()) return;
      if (pending.all) {
        await forgetAll();
        return;
      }
      for (const businessId of pending.businessIds)
        await forgetBusiness(businessId);
    })().finally(() => {
      retrying = null;
    });
    return retrying;
  }

  return { forgetBusiness, forgetAll, retryPending };
}

function browserStorage(): ForgetStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const forgetter = createBrowserProfileForgetter({
  host: () => (isBrowserHostAvailable() ? browserHost : null),
  storage: browserStorage,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/** A community leaves this device: its browser logins and cookies go with it. */
export const forgetBrowserBusiness = forgetter.forgetBusiness;
/** Sign out or account delete: no browser profile stays on this device. */
export const forgetAllBrowserProfiles = forgetter.forgetAll;
/** At start: finish a cleanup that could not finish before. */
export const retryPendingBrowserForgets = forgetter.retryPending;
