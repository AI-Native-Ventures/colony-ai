import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS =
  /\.(md|markdown|txt|csv|json|yaml|yml|js|jsx|ts|tsx|py|rs|html|css|log)$/i;

/** Recognize a possible file reference without accepting URLs or shell commands. */
export function workspaceFileCandidate(value) {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    value.trim() !== value ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  const cleaned = value.replace(/:\d+(?::\d+)?$/, "");
  if (
    !cleaned ||
    cleaned.includes(":") ||
    cleaned.includes("\\") ||
    !/[/.]/.test(cleaned)
  )
    return null;
  return cleaned;
}

function protectedPath(relative) {
  return relative
    .split(path.sep)
    .some(
      (segment) =>
        segment.startsWith(".") ||
        /(?:secret|credential|private[_-]?key|managed-agents|auth[-_.]|token)/i.test(
          segment,
        ),
    );
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Only existing, bounded text files within the authoritative native root are linkable. */
export function createWorkspaceFileService({ invoke }) {
  async function checked(args) {
    const candidate = workspaceFileCandidate(args?.path);
    if (!candidate || !TEXT_EXTENSIONS.test(candidate))
      throw new Error("File is unavailable");
    const rawRoot = await invoke("get_agent_workspace_root", {
      agentPubkey: args.agentPubkey,
      expectedRelayUrl: args.expectedRelayUrl,
    });
    if (typeof rawRoot !== "string" || !path.isAbsolute(rawRoot))
      throw new Error("File is unavailable");
    const rootInfo = await lstat(rawRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error("File is unavailable");
    const root = await realpath(rawRoot);
    const lexical = path.resolve(root, candidate);
    if (!inside(root, lexical)) throw new Error("File is unavailable");
    if (
      candidate.split("/").includes("..") ||
      protectedPath(path.relative(root, lexical))
    )
      throw new Error("File is unavailable");
    const target = await realpath(lexical);
    if (!inside(root, target) || protectedPath(path.relative(root, target)))
      throw new Error("File is unavailable");
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_WORKSPACE_FILE_BYTES)
      throw new Error("File is unavailable");
    return { root, target, info, name: path.relative(root, target) };
  }
  return {
    async resolve(args) {
      try {
        const file = await checked(args);
        return { path: file.name };
      } catch {
        return null;
      }
    },
    async read(args) {
      let handle;
      try {
        const file = await checked(args);
        handle = await open(
          file.target,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.size > MAX_WORKSPACE_FILE_BYTES ||
          info.ino !== file.info.ino ||
          info.dev !== file.info.dev
        )
          throw new Error("File is unavailable");
        // Recheck the pathname after opening, before any content leaves the host.
        if ((await realpath(file.target)) !== file.target)
          throw new Error("File is unavailable");
        const bytes = Buffer.alloc(MAX_WORKSPACE_FILE_BYTES + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (
          bytesRead > MAX_WORKSPACE_FILE_BYTES ||
          bytes.subarray(0, bytesRead).includes(0)
        )
          throw new Error("File is unavailable");
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, bytesRead),
        );
        // Scope may change while the filesystem read is in flight.
        const currentRoot = await invoke("get_agent_workspace_root", {
          agentPubkey: args.agentPubkey,
          expectedRelayUrl: args.expectedRelayUrl,
        });
        if (
          currentRoot !== file.root &&
          (await realpath(currentRoot)) !== file.root
        )
          throw new Error("File is unavailable");
        return { path: file.name, content };
      } catch {
        throw new Error(
          "This file is no longer available in the agent's workspace.",
        );
      } finally {
        await handle?.close();
      }
    },
  };
}
