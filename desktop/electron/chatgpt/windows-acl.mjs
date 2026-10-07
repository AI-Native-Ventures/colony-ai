import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatGptError } from "./policy.mjs";

const PRINCIPALS = new Map([
  ["WD", "Everyone (S-1-1-0)"],
  ["S-1-1-0", "Everyone (S-1-1-0)"],
  ["AU", "Authenticated Users (S-1-5-11)"],
  ["S-1-5-11", "Authenticated Users (S-1-5-11)"],
  ["BU", "Users / BUILTIN\\Users (S-1-5-32-545)"],
  ["S-1-5-32-545", "Users / BUILTIN\\Users (S-1-5-32-545)"],
]);
const ALLOW = new Set(["A", "OA", "XA", "ZA"]);
const DENY = new Set(["D", "OD", "XD", "ZD"]);
const MAX_ACL_BYTES = 16 * 1024;

/** Inspect numeric SDDL trustees, independent of Windows display language. */
export function broadWindowsPrincipals(savedAcl) {
  const descriptors = savedAcl
    .split(/\r?\n/)
    .filter((line) => line.startsWith("D:"));
  if (descriptors.length !== 1) throw new ChatGptError("windows_acl_invalid");
  const dacl = descriptors[0];
  // Reject conditional/unrecognized syntax instead of treating it as private.
  const entries = [...dacl.matchAll(/\(([^()]*)\)/g)];
  if (
    entries.length === 0 ||
    !/^D:[A-Z]*$/.test(dacl.replace(/\([^()]*\)/g, ""))
  )
    throw new ChatGptError("windows_acl_invalid");
  const found = new Set();
  for (const entry of entries) {
    const fields = entry[1].split(";");
    if (fields.length !== 6 || (!ALLOW.has(fields[0]) && !DENY.has(fields[0])))
      throw new ChatGptError("windows_acl_invalid");
    const [type, , rights, , , sid] = fields;
    const principal = PRINCIPALS.get(sid);
    if (principal && ALLOW.has(type) && rights && !/^0x0+$/i.test(rights))
      found.add(principal);
  }
  return [...found];
}

/** Read one file or folder DACL with a 30 second deadline and one timeout retry. */
export function inspectWindowsAcl(target, { execute = execFileSync } = {}) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "colony-chatgpt-acl-"));
  const output = path.join(scratch, "acl.txt");
  const executable = path.win32.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "icacls.exe",
  );
  let failure;
  let found;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        execute(executable, [target, "/save", output, "/q"], {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: MAX_ACL_BYTES,
          stdio: ["ignore", "pipe", "pipe"],
        });
        break;
      } catch (error) {
        if (error.code !== "ETIMEDOUT" || attempt === 1)
          throw new ChatGptError("windows_acl_inspection_failed");
      }
    }
    if (statSync(output).size > MAX_ACL_BYTES)
      throw new ChatGptError("windows_acl_invalid");
    const bytes = readFileSync(output);
    const text =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? bytes.subarray(2).toString("utf16le")
        : bytes[1] === 0
          ? bytes.toString("utf16le")
          : bytes.toString("utf8").replace(/^\uFEFF/, "");
    found = broadWindowsPrincipals(text);
  } catch (error) {
    failure =
      error instanceof ChatGptError
        ? error
        : new ChatGptError("windows_acl_inspection_failed");
  } finally {
    try {
      rmSync(scratch, { recursive: true });
    } catch {
      failure ??= new ChatGptError("storage_cleanup_failed");
    }
  }
  if (failure) throw failure;
  return found;
}
