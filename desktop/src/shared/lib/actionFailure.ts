/** A safe, compact diagnosis for a user action that did not complete. */
export type ActionFailure = {
  action: string;
  stage: string;
  failureClass: "signing" | "connection" | "server" | "unknown";
  title: string;
  message: string;
  details: string;
  status: number | null;
  code: string | null;
};

type ActionFailureInput = {
  action: string;
  stage: string;
  error: unknown;
  status?: number | null;
  code?: string | null;
};

const SAFE_VALUE = /^[a-z0-9][a-z0-9_.-]{0,79}$/iu;

function safeValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SAFE_VALUE.test(normalized) ? normalized : null;
}

function safeCode(value: unknown): string | null {
  const code = safeValue(value);
  if (!code) return null;
  // A native or provider exception can attach arbitrary structured fields.
  // Treat credential-shaped values as untrusted even when they happen to fit
  // the compact machine-code grammar.
  return /nsec|secret|token|password|credential|bearer/iu.test(code)
    ? null
    : code;
}

function structuredValue(error: unknown, name: "code" | "status"): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as Record<string, unknown>)[name];
}

function statusValue(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
}

function knownFailure(error: unknown): ActionFailure | null {
  if (error instanceof ActionFailureError) return error.actionFailure;
  if (typeof error !== "object" || error === null) return null;
  const candidate = (error as { actionFailure?: unknown }).actionFailure;
  return isActionFailure(candidate) ? candidate : null;
}

function isActionFailure(value: unknown): value is ActionFailure {
  if (typeof value !== "object" || value === null) return false;
  const failure = value as Partial<ActionFailure>;
  const action = safeValue(failure.action);
  const stage = safeValue(failure.stage);
  const failureClass = failure.failureClass;
  if (
    !action ||
    !stage ||
    (failureClass !== "signing" &&
      failureClass !== "connection" &&
      failureClass !== "server" &&
      failureClass !== "unknown")
  ) {
    return false;
  }
  const status = statusValue(failure.status);
  if (failure.status !== status) return false;
  const code = failure.code === null ? null : safeCode(failure.code);
  if (failure.code !== code) return false;
  const copy = description({ action, failureClass, status, code });
  const details = [
    `action=${action}`,
    `stage=${stage}`,
    `class=${failureClass}`,
    `status=${status ?? "none"}`,
    `code=${code ?? "none"}`,
  ].join("\n");
  return (
    failure.title === copy.title &&
    failure.message === copy.message &&
    failure.details === details
  );
}

function failureCode(
  failureClass: ActionFailure["failureClass"],
  message: string,
  suppliedCode: string | null,
): string | null {
  if (suppliedCode) return suppliedCode;
  if (failureClass === "signing") {
    if (/keyring|locked/iu.test(message)) return "identity_keyring_locked";
    if (/recovery|lost|identity/iu.test(message)) return "identity_recovery";
    return "signing_unavailable";
  }
  if (failureClass === "connection" && /timeout|timed out/iu.test(message)) {
    return "request_timeout";
  }
  if (failureClass === "connection") return "connection_unavailable";
  return null;
}

function description(input: {
  action: string;
  failureClass: ActionFailure["failureClass"];
  status: number | null;
  code: string | null;
}): Pick<ActionFailure, "title" | "message"> {
  if (input.action === "prospect-search") {
    if (input.code === "discovery_not_configured") {
      return {
        title: "Prospect search is not set up",
        message:
          "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.",
      };
    }
    if (input.code === "sales_channel_not_allowed") {
      return {
        title: "Sales channel not set up",
        message:
          "The private Sales channel is not set up yet. An owner or admin of this business sets it up by opening Leads once. Ask one of them, then retry.",
      };
    }
  }
  const label = input.action.replaceAll("-", " ");
  if (input.failureClass === "signing") {
    return {
      title: "Signing failed",
      message: `Colony could not sign the ${label}. Restore or unlock your identity, then relaunch.`,
    };
  }
  if (input.failureClass === "connection") {
    return {
      title: "Connection failed",
      message: `Colony could not reach the relay for the ${label}. Check your connection and retry.`,
    };
  }
  if (input.failureClass === "server") {
    const status =
      input.status === null ? "an unknown status" : `HTTP ${input.status}`;
    const code = input.code ? `, code ${input.code}` : "";
    return {
      title: "Server request failed",
      message: `The relay returned ${status}${code} for the ${label}.`,
    };
  }
  return {
    title: "Action failed",
    message: `Colony could not complete the ${label}. Retry after checking the details.`,
  };
}

/**
 * Maps an arbitrary thrown value to a display-safe and log-safe diagnosis.
 * Raw thrown text is used only to determine the class and is never copied into
 * the returned message or details, because native failures can contain private
 * path or credential context.
 */
export function actionFailureFromError(
  input: ActionFailureInput,
): ActionFailure {
  const previous = knownFailure(input.error);
  if (previous) return previous;

  const message = errorMessage(input.error);
  const status =
    statusValue(input.status) ??
    statusValue(structuredValue(input.error, "status"));
  const suppliedCode =
    safeCode(input.code) ?? safeCode(structuredValue(input.error, "code"));
  const signing =
    input.stage.includes("sign") ||
    /identity.*(?:recovery|lost|locked)|event signing|keyring|\bnsec\b/iu.test(
      message,
    );
  const connection =
    suppliedCode === "network" ||
    suppliedCode?.includes("timeout") ||
    /network|connect(?:ion)?|offline|timeout|timed out|socket|relay unavailable/iu.test(
      message,
    );
  const failureClass: ActionFailure["failureClass"] = signing
    ? "signing"
    : status !== null
      ? "server"
      : connection
        ? "connection"
        : "unknown";
  const code = failureCode(failureClass, message, suppliedCode);
  const action = safeValue(input.action) ?? "unknown-action";
  const stage = safeValue(input.stage) ?? "unknown-stage";
  const copy = description({ action, failureClass, status, code });
  const details = [
    `action=${action}`,
    `stage=${stage}`,
    `class=${failureClass}`,
    `status=${status ?? "none"}`,
    `code=${code ?? "none"}`,
  ].join("\n");
  return { action, stage, failureClass, status, code, details, ...copy };
}

/** Wraps a safe action failure so callers cannot accidentally discard it. */
export class ActionFailureError extends Error {
  readonly actionFailure: ActionFailure;

  constructor(actionFailure: ActionFailure) {
    super(actionFailure.message);
    this.name = "ActionFailureError";
    this.actionFailure = actionFailure;
  }
}

/** Writes only structured, non-secret diagnostics to the desktop renderer log. */
export function logActionFailure(failure: ActionFailure): void {
  console.warn(
    `[colony-action-failure] ${failure.details.replaceAll("\n", " ")}`,
  );
}
