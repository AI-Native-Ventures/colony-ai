import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;
/**
 * Renderer commands answered by the main process (never forwarded to the
 * native host), and the service method behind each one.
 */
export const WORKSPACE_FILE_COMMANDS = new Map([
  ["resolve_agent_workspace_file", "resolve"],
  ["read_agent_workspace_file", "read"],
  ["list_agent_workspace_files", "list"],
]);
/** One directory listing returns at most this many entries. */
export const MAX_WORKSPACE_LIST_ENTRIES = 500;
/** A listing never walks more than this many directory entries. */
const MAX_WORKSPACE_LIST_SCANNED = 5000;
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

/**
 * A directory path relative to the workspace root: "" for the root itself,
 * otherwise slash-separated plain segments. Anything that could leave the root
 * or name a platform path (dot segments, backslashes, drive colons, control
 * characters, absolute paths) is rejected before the filesystem is touched.
 */
export function workspaceDirectoryCandidate(value) {
  if (value === undefined || value === null || value === "" || value === ".")
    return "";
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    value.trim() !== value ||
    value.includes("\\") ||
    value.includes(":") ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    return null;
  return parts.join("/");
}

/** Only existing, bounded text files within the authoritative native root are linkable. */
export function createWorkspaceFileService({ invoke }) {
  /** The authoritative native root for this author and community, symlinks resolved. */
  async function scopedRoot(args) {
    const rawRoot = await invoke("get_agent_workspace_root", {
      agentPubkey: args?.agentPubkey,
      expectedRelayUrl: args?.expectedRelayUrl,
    });
    if (typeof rawRoot !== "string" || !path.isAbsolute(rawRoot))
      throw new Error("File is unavailable");
    const rootInfo = await lstat(rawRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error("File is unavailable");
    return realpath(rawRoot);
  }
  async function checked(args) {
    const candidate = workspaceFileCandidate(args?.path);
    if (!candidate || !TEXT_EXTENSIONS.test(candidate))
      throw new Error("File is unavailable");
    const root = await scopedRoot(args);
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
    /**
     * Read-only directory listing for the Files tab. Returns names and sizes
     * only, never content, and applies the same rules as `read`: the native
     * root is authoritative, nothing resolves outside it, hidden and
     * credential-looking names are omitted, symlinks are listed only when
     * their real target is also inside the root, and only folders and
     * readable text files are shown. The result is bounded.
     */
    async list(args) {
      try {
        const root = await scopedRoot(args);
        const relative = workspaceDirectoryCandidate(args?.path);
        if (relative === null) throw new Error("Folder is unavailable");
        const lexical = path.resolve(root, relative);
        if (relative !== "" && !inside(root, lexical))
          throw new Error("Folder is unavailable");
        if (protectedPath(relative)) throw new Error("Folder is unavailable");
        const target = await realpath(lexical);
        if (
          target !== root &&
          (!inside(root, target) || protectedPath(path.relative(root, target)))
        )
          throw new Error("Folder is unavailable");
        const info = await stat(target);
        if (!info.isDirectory()) throw new Error("Folder is unavailable");
        const entries = [];
        let scanned = 0;
        let truncated = false;
        for await (const dirent of await opendir(target)) {
          scanned += 1;
          if (scanned > MAX_WORKSPACE_LIST_SCANNED) {
            truncated = true;
            break;
          }
          if (protectedPath(dirent.name)) continue;
          const child = path.join(target, dirent.name);
          let real;
          let childInfo;
          try {
            real = await realpath(child);
            childInfo = await stat(real);
          } catch {
            continue;
          }
          if (!inside(root, real) || protectedPath(path.relative(root, real)))
            continue;
          const childPath = path
            .relative(root, child)
            .split(path.sep)
            .join("/");
          if (childInfo.isDirectory()) {
            entries.push({ name: dirent.name, path: childPath, kind: "dir" });
          } else if (
            childInfo.isFile() &&
            TEXT_EXTENSIONS.test(dirent.name) &&
            childInfo.size <= MAX_WORKSPACE_FILE_BYTES
          ) {
            entries.push({
              name: dirent.name,
              path: childPath,
              kind: "file",
              size: childInfo.size,
            });
          }
          if (entries.length >= MAX_WORKSPACE_LIST_ENTRIES) {
            truncated = true;
            break;
          }
        }
        entries.sort(
          (a, b) =>
            (a.kind === b.kind ? 0 : a.kind === "dir" ? -1 : 1) ||
            a.name.localeCompare(b.name, "en", { numeric: true }),
        );
        // Scope may change while the filesystem is being walked.
        const currentRoot = await invoke("get_agent_workspace_root", {
          agentPubkey: args.agentPubkey,
          expectedRelayUrl: args.expectedRelayUrl,
        });
        if (
          currentRoot !== root &&
          (typeof currentRoot !== "string" ||
            (await realpath(currentRoot)) !== root)
        )
          throw new Error("Folder is unavailable");
        return { path: relative, entries, truncated };
      } catch {
        throw new Error(
          "This folder is no longer available in the agent's workspace.",
        );
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
