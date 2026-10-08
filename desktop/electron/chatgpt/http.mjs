import { ChatGptError, TERMINAL_REFRESH_ERRORS } from "./policy.mjs";

const ERROR_CODES = new Set([
  ...TERMINAL_REFRESH_ERRORS,
  "invalid_client",
  "invalid_request",
  "invalid_scope",
  "unauthorized_client",
  "access_denied",
  "temporarily_unavailable",
  "server_error",
]);

/** Bounded, non-redirecting JSON/form HTTP transport for the main process. */
export function createChatGptHttp({
  timeoutMs = 15_000,
  fetchImpl = fetch,
} = {}) {
  return async function request(url, { form, signal, empty = false } = {}) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    try {
      const response = await fetchImpl(url, {
        method: form ? "POST" : "GET",
        redirect: "error",
        signal: combined,
        headers: form
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : { Accept: "application/json" },
        ...(form ? { body: new URLSearchParams(form).toString() } : {}),
      });
      let size = 0;
      const chunks = [];
      if (response.body) {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > 1024 * 1024) throw new ChatGptError("response_too_large");
          chunks.push(chunk);
        }
      }
      if (empty && response.status === 200) return null;
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new ChatGptError("invalid_response", response.status);
      }
      if (!response.ok) {
        const code =
          typeof data?.error === "string" ? data.error : data?.error?.code;
        // Never forward error_description or other server-controlled text.
        const safe = ERROR_CODES.has(code) ? code : "http_error";
        throw new ChatGptError(safe, response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof ChatGptError) throw error;
      if (signal?.aborted) throw new ChatGptError("cancelled");
      throw new ChatGptError(
        deadline.aborted ? "request_timeout" : "network_error",
      );
    }
  };
}
