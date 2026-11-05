/**
 * What the Configure screen shows. It never renders nothing: every state has a
 * visible answer, and only `ready` shows the form.
 */
export type HireConfigureStatus =
  | "ready"
  | "loading"
  | "error"
  | "role-missing";

type QueryState = { isPending: boolean; isError: boolean };

/** How long Configure waits on the shared record before it says so. */
export const HIRE_CONFIGURE_TIMEOUT_MS = 15_000;

export function hireConfigureStatus(input: {
  personas: QueryState;
  runtimes: QueryState;
  channels: QueryState;
  team: QueryState;
  identity: QueryState;
  membership: QueryState;
  head: QueryState;
  hasRolePack: boolean;
  hasForm: boolean;
  /** Configure must re-read the role catalog once before declaring it missing. */
  freshRoleFetchComplete: boolean;
}): HireConfigureStatus {
  const {
    freshRoleFetchComplete,
    hasForm,
    hasRolePack,
    head,
    personas,
    ...others
  } = input;
  const required = [personas, ...Object.values(others)];
  if ([head, ...required].some((query) => query.isError)) return "error";
  // A create can resolve before its persisted list projection reaches this
  // screen. Re-read the catalog once before reporting a missing role so a
  // stale observer never turns a successful creation into a dead end.
  if (!hasRolePack && !personas.isPending && !head.isPending) {
    return freshRoleFetchComplete ? "role-missing" : "loading";
  }
  if (required.some((query) => query.isPending)) return "loading";
  return hasRolePack && hasForm ? "ready" : "loading";
}
