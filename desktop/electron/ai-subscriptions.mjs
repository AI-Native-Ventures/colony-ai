import { spawn } from "node:child_process";
import { access, open, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 512 * 1024;
const DEADLINE_MS = 15_000;
const PLAN_NAMES = new Map([
  ["free", "Free"],
  ["plus", "Plus"],
  ["pro", "Pro"],
  ["max", "Max"],
  ["team", "Team"],
  ["business", "Business"],
  ["enterprise", "Enterprise"],
  ["edu", "Edu"],
]);
const unavailable = (id, message, extra = {}) => ({
  id,
  signedIn: null,
  plan: null,
  source: "unavailable",
  windows: [],
  message,
  ...extra,
});
const clean = (value) =>
  typeof value === "string"
    ? value
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove provider-controlled invisible characters from display text.
        .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
        .slice(0, 80)
    : null;

/** Read bounded credential files in the main process. Never return their contents to a renderer. */
async function readJson(file) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_BYTES) return null;
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) return null;
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function nodeVersionDirs(home) {
  try {
    return (
      await readdir(path.join(home, ".nvm", "versions", "node"), {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isDirectory() && /^v[0-9.]+$/.test(entry.name))
      .sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { numeric: true }),
      )
      .slice(0, 32)
      .map((entry) =>
        path.join(home, ".nvm", "versions", "node", entry.name, "bin"),
      );
  } catch {
    return [];
  }
}

/** Locate the real Codex CLI without assuming a packaged app inherits a login-shell PATH. */
export async function findCodex({
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
} = {}) {
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".codex", "packages", "standalone", "current", "bin"),
    ...(env.PATH ?? "").split(path.delimiter),
    ...(platform === "darwin"
      ? [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/Applications/Codex.app/Contents/Resources",
        ]
      : []),
    ...[
      ".bun/bin",
      ".volta/bin",
      ".npm-global/bin",
      ".local/share/pnpm",
      ".asdf/shims",
      ".local/share/mise/shims",
    ].map((rel) => path.join(home, ...rel.split("/"))),
  ];
  dirs.push(...(await nodeVersionDirs(home)));
  if (env.NPM_CONFIG_PREFIX && path.isAbsolute(env.NPM_CONFIG_PREFIX))
    dirs.push(
      platform === "win32"
        ? env.NPM_CONFIG_PREFIX
        : path.join(env.NPM_CONFIG_PREFIX, "bin"),
    );
  for (const value of [env.PNPM_HOME, env.NVM_BIN])
    if (value && path.isAbsolute(value)) dirs.push(value);
  if (platform === "win32") {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
    if (env.LOCALAPPDATA)
      dirs.push(path.join(env.LOCALAPPDATA, "Programs", "Codex", "resources"));
  }
  // Windows npm shims are scripts, not executable app-server binaries. The
  // standalone executable is preferred; unsupported shims yield a useful state.
  for (const dir of dirs.filter((dir) => dir && path.isAbsolute(dir))) {
    const file = path.join(dir, platform === "win32" ? "codex.exe" : "codex");
    try {
      await access(file, constants.X_OK);
      return file;
    } catch {
      /* next location */
    }
  }
  const target = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${platform === "win32" ? "pc-windows-msvc" : platform === "darwin" ? "apple-darwin" : "unknown-linux-musl"}`;
  const packagePlatform = `${platform}-${process.arch}`;
  for (const dir of dirs.filter((dir) => dir && path.isAbsolute(dir))) {
    const root = platform === "win32" ? dir : path.dirname(dir);
    for (const modules of [
      path.join(root, "node_modules"),
      path.join(root, "lib", "node_modules"),
    ]) {
      for (const name of ["codex", `codex-${packagePlatform}`]) {
        const file = path.join(
          modules,
          "@openai",
          name,
          "vendor",
          target,
          "codex",
          platform === "win32" ? "codex.exe" : "codex",
        );
        try {
          await access(file, constants.X_OK);
          return file;
        } catch {
          /* next package */
        }
      }
    }
  }
  return null;
}

/** Close the isolated probe tree before reporting its result. */
export async function closeCodexProbe(
  child,
  { platform = process.platform, spawnProcess = spawn } = {},
) {
  if (!child.pid) {
    child.kill();
    return;
  }
  if (platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH")
        throw new Error("Codex check could not be closed safely.");
    }
    return;
  }
  await new Promise((resolve, reject) => {
    const killer = spawnProcess(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    const timer = setTimeout(() => {
      killer.kill();
      reject(new Error("Codex check could not be closed safely."));
    }, 3000);
    const failed = () => {
      clearTimeout(timer);
      reject(new Error("Codex check could not be closed safely."));
    };
    killer.once("error", failed);
    killer.once("exit", (code) => {
      clearTimeout(timer);
      // 128 means the tree already exited. Other errors must not report success.
      if (code === 0 || code === 128) resolve();
      else failed();
    });
  });
}

/** A bounded, read-only app-server exchange. File storage explicitly prevents keychain access. */
export function readCodexAccount(
  binary,
  { spawnProcess = spawn, deadlineMs = DEADLINE_MS, env = process.env } = {},
) {
  return new Promise((resolve, reject) => {
    const safeEnv = { ...env };
    delete safeEnv.OPENAI_API_KEY;
    delete safeEnv.CODEX_API_KEY;
    // npm CLI entry points need Node even in a GUI process with a minimal PATH.
    safeEnv.PATH = [
      path.dirname(binary),
      env.PATH,
      ...(process.platform === "darwin"
        ? ["/opt/homebrew/bin", "/usr/local/bin"]
        : []),
      ...(process.platform !== "win32" ? ["/usr/bin", "/bin"] : []),
    ]
      .filter(Boolean)
      .join(path.delimiter);
    const child = spawnProcess(
      binary,
      ["-c", 'cli_auth_credentials_store="file"', "app-server"],
      {
        env: safeEnv,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        detached: process.platform !== "win32",
      },
    );
    let settled = false;
    let buffer = "";
    let bytes = 0;
    let account;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy();
      void closeCodexProbe(child).then(
        () => {
          if (error) reject(new Error(error));
          else resolve(value);
        },
        () => reject(new Error("Codex check could not be closed safely.")),
      );
    };
    const send = (method, id, params) =>
      child.stdin.write(
        `${JSON.stringify({ method, ...(id === undefined ? {} : { id }), ...(params === undefined ? {} : { params }) })}\n`,
      );
    timer = setTimeout(
      () => finish("Codex sign-in status unavailable: the check timed out."),
      deadlineMs,
    );
    child.on("error", () =>
      finish("Codex could not be started. Update Codex and try again."),
    );
    child.stdin.on("error", () =>
      finish("Codex closed the connection. Update Codex and try again."),
    );
    child.on("exit", () =>
      finish("Codex closed the connection. Update Codex and try again."),
    );
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES)
        return finish("Codex returned too much data. Try again.");
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n") && !settled) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let response;
        try {
          response = JSON.parse(line);
        } catch {
          continue;
        }
        if (response.id === 0) {
          if (response.error)
            return finish("Codex needs an update to check subscriptions.");
          send("initialized");
          send("account/read", 1, { refreshToken: false });
        } else if (response.id === 1) {
          if (response.error)
            return finish("Codex sign-in status unavailable. Try again.");
          account = response.result?.account;
          if (account?.type !== "chatgpt")
            return finish(null, { account, limits: null });
          send("account/rateLimits/read", 2);
        } else if (response.id === 2) {
          return finish(null, {
            account,
            limits: response.error ? null : response.result,
          });
        }
      }
    });
    send("initialize", 0, {
      clientInfo: { name: "colony", title: "Colony", version: "1.0.3" },
    });
  });
}

function windowUsage(label, used, resetsAt) {
  if (!Number.isFinite(used) || used < 0) return null;
  const reset =
    typeof resetsAt === "number" ? resetsAt * 1000 : Date.parse(resetsAt);
  return {
    label,
    remainingPercent: Math.round(Math.max(0, 100 - used)),
    resetsAt: Number.isFinite(new Date(reset).getTime()) ? reset : null,
  };
}

/** Reduce provider responses to safe display fields only, never emails or credentials. */
export function codexSubscription({ account, limits }) {
  if (!account)
    return unavailable(
      "codex",
      "Sign in to Codex to check your subscription.",
      { signedIn: false, source: "live" },
    );
  if (account.type !== "chatgpt")
    return unavailable(
      "codex",
      "Codex is using an API connection, not a ChatGPT subscription.",
      { signedIn: true, source: "live" },
    );
  const bucket = limits?.rateLimitsByLimitId?.codex ?? limits?.rateLimits;
  const windows = [bucket?.primary, bucket?.secondary]
    .filter(Boolean)
    .map((window) => {
      const minutes = window.windowDurationMins;
      const label =
        minutes === 300
          ? "5-hour allowance"
          : minutes === 10080
            ? "Weekly allowance"
            : Number.isFinite(minutes) && minutes > 0
              ? `${minutes}-minute allowance`
              : "Allowance";
      return windowUsage(label, window.usedPercent, window.resetsAt);
    })
    .filter(Boolean);
  const plan = PLAN_NAMES.get(clean(account.planType ?? bucket?.planType));
  return {
    id: "codex",
    signedIn: true,
    plan: plan ? `ChatGPT ${plan}` : null,
    source: "live",
    windows,
    message: windows.length
      ? null
      : "Signed in. Codex did not return allowance data.",
  };
}

/** Parse Claude's own usage response, retaining only bounded percentages and resets. */
export function claudeSubscription(credential, usage) {
  const type = clean(credential.subscriptionType);
  const tier = clean(credential.rateLimitTier);
  const plan =
    type === "max"
      ? tier?.includes("20x")
        ? "Max 20x"
        : tier?.includes("5x")
          ? "Max 5x"
          : "Max"
      : (PLAN_NAMES.get(type) ?? null);
  const windows = [
    ["5-hour allowance", usage?.five_hour],
    ["Weekly allowance", usage?.seven_day],
  ]
    .map(([label, window]) =>
      windowUsage(label, window?.utilization, window?.resets_at),
    )
    .filter(Boolean);
  return {
    id: "claude",
    signedIn: true,
    plan,
    source: "live",
    windows,
    message: windows.length
      ? null
      : "Signed in. Claude did not return allowance data.",
  };
}

/** Main-process subscription reader. Keychain access is deliberately not part of automatic scanning. */
export function createSubscriptionService({
  home = os.homedir(),
  env = process.env,
  fetchUsage = fetch,
  find = findCodex,
  readAccount = readCodexAccount,
  requestClaudeCredential,
  platform = process.platform,
} = {}) {
  let readInFlight;
  let explicitInFlight;
  let lastExplicitClaude;
  async function claude(explicit = false) {
    const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
    const stored = await readJson(path.join(configDir, ".credentials.json"));
    let credential = stored?.claudeAiOauth;
    if (!credential?.accessToken && explicit && requestClaudeCredential) {
      try {
        credential = (await requestClaudeCredential())?.claudeAiOauth;
      } catch {
        /* Safe failure below. */
      }
    }
    if (!credential?.accessToken) {
      if (!explicit && lastExplicitClaude)
        return {
          ...lastExplicitClaude,
          source: "cached",
          signedIn: null,
          message:
            "These are your last checked allowances. Check Claude subscription to refresh them.",
        };
      const profile = await readJson(
        env.CLAUDE_CONFIG_DIR
          ? path.join(configDir, ".claude.json")
          : path.join(home, ".claude.json"),
      );
      const tier = profile?.oauthAccount?.organizationRateLimitTier;
      const type = profile?.oauthAccount?.organizationType;
      const cachedPlan =
        type === "claude_max"
          ? tier?.includes("20x")
            ? "Max 20x"
            : tier?.includes("5x")
              ? "Max 5x"
              : "Max"
          : type === "claude_pro"
            ? "Pro"
            : null;
      return unavailable(
        "claude",
        platform === "darwin"
          ? "Allow access to Claude sign-in to read your allowance. macOS may ask permission. Used only with Claude, never saved by Colony."
          : "Sign in to Claude Code, then check again. No readable subscription credential was found.",
        { plan: cachedPlan, source: cachedPlan ? "cached" : "unavailable" },
      );
    }
    if (credential.expiresAt && credential.expiresAt <= Date.now())
      return unavailable(
        "claude",
        "Your Claude sign-in has expired. Sign in to Claude Code, then check again.",
        { signedIn: false },
      );
    try {
      const response = await fetchUsage(
        "https://api.anthropic.com/api/oauth/usage",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${credential.accessToken}`,
            "anthropic-beta": "oauth-2025-04-20",
          },
          redirect: "error",
          signal: AbortSignal.timeout(DEADLINE_MS),
        },
      );
      if (!response.ok)
        return unavailable(
          "claude",
          response.status === 401 || response.status === 403
            ? "Claude could not confirm your sign-in. Sign in to Claude Code, then check again."
            : "Claude allowance could not be checked. Try again.",
          { signedIn: response.status === 401 ? false : null },
        );
      let text = "";
      for await (const chunk of response.body) {
        text += Buffer.from(chunk).toString("utf8");
        if (Buffer.byteLength(text) > MAX_BYTES)
          throw new Error("Response too large");
      }
      return {
        ...claudeSubscription(credential, JSON.parse(text)),
        observedAt: Date.now(),
      };
    } catch {
      return unavailable(
        "claude",
        "Claude allowance could not be checked. Try again.",
      );
    }
  }
  async function codex() {
    const binary = await find({ home, env });
    if (!binary)
      return unavailable("codex", "Install Codex to check your subscription.", {
        signedIn: false,
      });
    // Do not cause Codex to fall through to its keychain store on this machine.
    if (
      !(await readJson(
        path.join(env.CODEX_HOME || path.join(home, ".codex"), "auth.json"),
      ))
    )
      return unavailable(
        "codex",
        "No file-based Codex sign-in found. Sign in to Codex with file credential storage, then check again.",
      );
    try {
      return {
        ...codexSubscription(await readAccount(binary, { env })),
        observedAt: Date.now(),
      };
    } catch {
      return unavailable(
        "codex",
        "Codex sign-in status unavailable. Update Codex or check again.",
      );
    }
  }
  return {
    read: () => {
      readInFlight ??= Promise.all([claude(), codex()]).finally(() => {
        readInFlight = null;
      });
      return readInFlight;
    },
    readClaude: () => {
      explicitInFlight ??= claude(true)
        .then((snapshot) => {
          lastExplicitClaude = snapshot.source === "live" ? snapshot : null;
          return snapshot;
        })
        .finally(() => {
          explicitInFlight = null;
        });
      return explicitInFlight;
    },
  };
}
