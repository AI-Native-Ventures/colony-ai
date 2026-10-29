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
}): HireConfigureStatus {
  const { hasForm, hasRolePack, head, personas, ...others } = input;
  const required = [personas, ...Object.values(others)];
  if ([head, ...required].some((query) => query.isError)) return "error";
  // The persona list and the saved hire have both answered and neither names a
  // usable role pack: more waiting cannot change that.
  if (!hasRolePack && !personas.isPending && !head.isPending) {
    return "role-missing";
  }
  if (required.some((query) => query.isPending)) return "loading";
  return hasRolePack && hasForm ? "ready" : "loading";
}
