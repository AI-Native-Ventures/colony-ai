import { ChatGptError } from "./policy.mjs";

export const PLAN_PROVIDER = "colony_chatgpt_plan";
export const PLAN_LIMIT_MESSAGE =
  "This app has reached its ChatGPT plan usage limit. Check Usage in ChatGPT settings, then try again.";
const PREVIEW_HEADER = "x-openai-chatpass-test";
const PREVIEW_VALUE = "codex-direct";
const FORBIDDEN = new Set(
  "background conversation max_output_tokens max_tool_calls metadata moderation multi_agent prompt prompt_cache_retention safety_identifier temperature top_logprobs top_p truncation user previous_response_id".split(
    " ",
  ),
);
const BLOCKED_TOOLS = new Set([
  "image_generation",
  "file_search",
  "code_interpreter",
  "computer",
  "computer_use_preview",
  "mcp",
  "tool_search",
  "programmatic_tool_calling",
]);

/** One removable preview compatibility setting, not an official protocol claim. */
export function planPreviewHeaders(env = {}) {
  const value = env.COLONY_CHATGPT_PREVIEW_HEADER ?? PREVIEW_VALUE;
  if (value === "off") return {};
  if (value !== PREVIEW_VALUE) throw new ChatGptError("invalid_preview_header");
  return { [PREVIEW_HEADER]: value };
}

/** Fail before forwarding a body that the public preview contract forbids. */
export function validatePlanRequest(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.store !== false ||
    body.stream !== true ||
    !Array.isArray(body.input) ||
    typeof body.model !== "string" ||
    body.model.length > 200
  )
    throw new ChatGptError("unsupported_plan_request", 400);
  if (
    Object.keys(body).some((key) => FORBIDDEN.has(key)) ||
    body.input.some((item) => item?.role === "system")
  )
    throw new ChatGptError("unsupported_plan_request", 400);
  const inspectTool = (tool, grouped) => {
    if (!tool || typeof tool !== "object" || BLOCKED_TOOLS.has(tool.type))
      throw new ChatGptError("unsupported_plan_tool", 400);
    if (tool.type === "namespace") {
      if (!Array.isArray(tool.tools))
        throw new ChatGptError("unsupported_plan_tool", 400);
      for (const child of tool.tools) {
        if (child?.type === "namespace")
          throw new ChatGptError("unsupported_plan_tool", 400);
        inspectTool(child, true);
      }
    } else if (["function", "custom"].includes(tool.type)) {
      if (!grouped) throw new ChatGptError("unsupported_plan_tool", 400);
    } else if (!["web_search", "web_search_preview"].includes(tool.type))
      throw new ChatGptError("unsupported_plan_tool", 400);
  };
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools))
      throw new ChatGptError("unsupported_plan_tool", 400);
    for (const tool of body.tools) inspectTool(tool, false);
  }
  for (const item of body.input)
    if (item?.type === "additional_tools") {
      if (!Array.isArray(item.tools))
        throw new ChatGptError("unsupported_plan_tool", 400);
      for (const tool of item.tools) inspectTool(tool, true);
    }
  return body;
}

/** Resolve a private local capability into startup and session configuration. */
export function codexPlanConfig({ baseUrl, model }) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ChatGptError("invalid_relay_url");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_-]{43}\/v1$/.test(url.pathname)
  )
    throw new ChatGptError("invalid_relay_url");
  if (typeof model !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(model))
    throw new ChatGptError("invalid_model");
  const provider = {
    name: "ChatGPT plan",
    base_url: baseUrl,
    env_key: "COLONY_CHATGPT_RELAY_KEY",
    wire_api: "responses",
    requires_openai_auth: false,
    supports_websockets: false,
    request_max_retries: 0,
    stream_max_retries: 0,
  };
  return {
    model,
    model_provider: PLAN_PROVIDER,
    cli_auth_credentials_store: "file",
    model_providers: { [PLAN_PROVIDER]: provider },
  };
}
