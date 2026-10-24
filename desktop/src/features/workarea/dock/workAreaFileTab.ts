import type { WorkAreaFileRef } from "./workAreaTypes";

/** Short stable hash (FNV-1a) so a file's tab id stays small whatever its path. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, "0");
}

/** One tab per file: the same file opened twice is the same tab. */
export function workAreaFileTabId(file: WorkAreaFileRef): string {
  return `file:${hash(`${file.agentPubkey.toLowerCase()}\n${file.path}`)}`;
}

/** The file's name, as its tab and the message card show it. */
export function workAreaFileName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}
