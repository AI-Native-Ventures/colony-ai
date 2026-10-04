import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";

/** Explicit, cancel-by-default permission gate. Automatic subscription scans never call this. */
export async function requestClaudeCredential({
  confirm,
  alive = () => true,
  platform = process.platform,
  env = process.env,
  run = execFile,
}) {
  if (platform !== "darwin" || !alive()) return null;
  const result = await confirm({
    type: "question",
    title: "Check Claude subscription",
    message: "Allow Colony to read your Claude Code sign-in?",
    detail:
      "macOS may ask for keychain permission. Colony uses the credential only to read your plan and allowance from Claude. It will not store it, show it, or send a message.",
    buttons: ["Cancel", "Check subscription"],
    defaultId: 0,
    cancelId: 0,
  });
  if (result.response !== 1 || !alive()) return null;
  // Claude Code 2.1 uses this service name and a hash for a custom config directory.
  const config = env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR;
  const suffix = config
    ? `-${createHash("sha256").update(config.normalize("NFC")).digest("hex").slice(0, 8)}`
    : "";
  const account = env.USER || os.userInfo().username;
  return new Promise((resolve) => {
    run(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        account,
        "-w",
        "-s",
        `Claude Code${suffix}`,
      ],
      { timeout: 15_000, maxBuffer: 512 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      },
    );
  });
}
