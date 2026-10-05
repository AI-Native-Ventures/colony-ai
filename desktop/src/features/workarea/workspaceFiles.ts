import { invoke } from "@tauri-apps/api/core";

export type WorkspaceFileReference = {
  agentPubkey: string;
  expectedRelayUrl: string;
  path: string;
};
export type WorkspaceFile = { path: string; content: string };
const OPEN_FILE_EVENT = "colony:open-workspace-file";

/** Path-like inline code stays plain until a native existence check succeeds. */
export function isWorkspaceFileReference(value: string): boolean {
  return (
    value.length <= 1024 &&
    !(
      value.trim() !== value ||
      [...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    ) &&
    /[/.]/.test(value)
  );
}

/** Ask the trusted native host whether an author-scoped file exists. */
export function resolveWorkspaceFile(reference: WorkspaceFileReference) {
  return invoke<{ path: string } | null>(
    "resolve_agent_workspace_file",
    reference,
  );
}
export type WorkspaceDirectoryReference = {
  agentPubkey: string;
  expectedRelayUrl: string;
  /** Folder relative to the workspace root; empty for the root itself. */
  path: string;
};
export type WorkspaceEntry = {
  name: string;
  /** Slash-separated path from the workspace root; accepted by read. */
  path: string;
  kind: "dir" | "file";
  size?: number;
};
export type WorkspaceListing = {
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
};

/**
 * List one folder of the author's workspace. The trusted native host repeats
 * the scope and path checks; the renderer only ever sees names and sizes.
 */
export function listWorkspaceDirectory(reference: WorkspaceDirectoryReference) {
  return invoke<WorkspaceListing>("list_agent_workspace_files", reference);
}

/** Read bounded UTF-8 content after repeating native scope and path checks. */
export function readWorkspaceFile(reference: WorkspaceFileReference) {
  return invoke<WorkspaceFile>("read_agent_workspace_file", reference);
}
/** Open a resolved file in the mounted Work area Files reader. */
export function openWorkspaceFile(reference: WorkspaceFileReference) {
  window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: reference }));
}
/** Subscribe for this mount only; the caller must check its current relay. */
export function listenForWorkspaceFiles(
  listener: (reference: WorkspaceFileReference) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<WorkspaceFileReference>).detail);
  window.addEventListener(OPEN_FILE_EVENT, handler);
  return () => window.removeEventListener(OPEN_FILE_EVENT, handler);
}

/** Open Files without granting a workspace or guessing a file path. */
export function showWorkspaceFiles() {
  window.dispatchEvent(new Event("colony:show-workspace-files"));
}
/** Subscribe to the channel Files control without keeping a global file cache. */
export function listenForFilesTab(listener: () => void) {
  window.addEventListener("colony:show-workspace-files", listener);
  return () =>
    window.removeEventListener("colony:show-workspace-files", listener);
}
