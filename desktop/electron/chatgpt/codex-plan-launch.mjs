import { createHash } from "node:crypto";
import path from "node:path";
import { codexPlanConfig, PLAN_PROVIDER } from "./inference-policy.mjs";
import { ChatGptError } from "./policy.mjs";
import { createChatGptStore } from "./store.mjs";

const REMOVED = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "ACCESS_TOKEN",
  "CODEX_ACCESS_TOKEN",
  "CODEX_AUTH_TOKEN",
  "DEFAULT_AUTH_REQUEST",
  "OPENAI_BASE_URL",
  "CHATGPT_BASE_URL",
  "CODEX_CONFIG",
  "MODEL_PROVIDER",
  "CODEX_HOME",
  "CODEX_PATH",
  "APP_SERVER_LOGS",
  "COLONY_CHATGPT_AUTH_ORIGIN",
  "COLONY_CHATGPT_API_ORIGIN",
];

function toml(config) {
  const encode = (value) =>
    typeof value === "string" ? JSON.stringify(value) : String(value);
  const { model_providers, ...top } = config;
  return (
    `${Object.entries(top)
      .map(([key, value]) => `${key} = ${encode(value)}`)
      .join("\n")}\n\n` +
    `[model_providers.${PLAN_PROVIDER}]\n` +
    `${Object.entries(model_providers[PLAN_PROVIDER])
      .map(([key, value]) => `${key} = ${encode(value)}`)
      .join("\n")}\n`
  );
}

/** Prepare a local adapter launch without starting a process or exposing a plan token. */
export async function prepareCodexPlanLaunch({
  service,
  relay,
  userData,
  backend,
  communityId,
  agentId,
  accountId,
  model,
  appVersion,
  env = {},
  codexPath,
}) {
  if (!service.policy.enabled) throw new ChatGptError("feature_disabled");
  if (backend !== "local") throw new ChatGptError("remote_plan_disallowed");
  if (
    !path.isAbsolute(userData) ||
    (codexPath !== undefined && !path.isAbsolute(codexPath)) ||
    typeof appVersion !== "string" ||
    !/^[A-Za-z0-9.+-]{1,100}$/.test(appVersion)
  )
    throw new ChatGptError("invalid_plan_launch");
  const grant = await relay.grant({ backend, communityId, agentId, accountId });
  try {
    const config = codexPlanConfig({ baseUrl: grant.baseUrl, model });
    // Stable per community, agent and account so a resumed rollout retains its
    // own local history. Other communities and account selections cannot share it.
    const scope = createHash("sha256")
      .update(JSON.stringify([communityId, agentId, accountId]))
      .digest("hex");
    const home = createChatGptStore(path.join(userData, "codex-plan", scope));
    await home.locked(() => home.saveCodexConfig(toml(config)));
    const childEnv = { ...env };
    for (const key of REMOVED) delete childEnv[key];
    Object.assign(childEnv, {
      CODEX_HOME: home.root,
      MODEL_PROVIDER: PLAN_PROVIDER,
      CODEX_CONFIG: JSON.stringify(config),
      COLONY_CHATGPT_RELAY_KEY: grant.key,
      NO_BROWSER: "1",
    });
    if (codexPath) childEnv.CODEX_PATH = codexPath;
    return {
      env: childEnv,
      clientInfo: { name: "Colony", title: "Colony", version: appVersion },
      config,
      dispose: grant.revoke,
    };
  } catch (error) {
    grant.revoke();
    throw error;
  }
}
