import { ChatGptError } from "./policy.mjs";

export const CHATGPT_COMMANDS = new Set([
  "get_chatgpt_plan",
  "connect_chatgpt_plan",
  "cancel_chatgpt_plan",
  "select_chatgpt_account",
  "disconnect_chatgpt_plan",
  "refresh_chatgpt_plan",
]);

/** Main-window-only command adapter. No token-bearing method is reachable. */
export async function dispatchChatGpt(
  service,
  command,
  args = {},
  main = true,
) {
  if (!main) throw new ChatGptError("main_window_required");
  if (!CHATGPT_COMMANDS.has(command))
    throw new ChatGptError("unsupported_command");
  if (command === "get_chatgpt_plan") return service.status();
  if (!service.policy.enabled) throw new ChatGptError("feature_disabled");
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new ChatGptError("invalid_arguments");
  const allowed =
    command === "connect_chatgpt_plan"
      ? ["accountId", "registrationId", "consent"]
      : ["accountId"];
  if (Object.keys(args).some((key) => !allowed.includes(key)))
    throw new ChatGptError("invalid_arguments");
  for (const key of ["accountId", "registrationId"]) {
    if (
      args[key] !== undefined &&
      (typeof args[key] !== "string" || !/^[a-f0-9]{64}$/.test(args[key]))
    )
      throw new ChatGptError("invalid_arguments");
  }
  if (args.consent !== undefined && typeof args.consent !== "boolean")
    throw new ChatGptError("invalid_arguments");
  if (args.accountId && args.registrationId)
    throw new ChatGptError("invalid_arguments");
  switch (command) {
    case "connect_chatgpt_plan":
      return service.connect(args);
    case "cancel_chatgpt_plan":
      return service.cancel();
    case "select_chatgpt_account":
      if (!args.accountId) throw new ChatGptError("invalid_arguments");
      return service.select(args.accountId);
    case "disconnect_chatgpt_plan":
      if (!args.accountId) throw new ChatGptError("invalid_arguments");
      return service.disconnect(args.accountId);
    case "refresh_chatgpt_plan":
      return service.retry();
  }
}
