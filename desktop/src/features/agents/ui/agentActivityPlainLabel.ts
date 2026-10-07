import type {
  AgentActivityDescriptor,
  AgentActivityTone,
} from "./agentSessionTypes";
import {
  findBuzzToolName,
  normalizeToolNameText,
} from "./agentSessionToolCatalog";
import {
  classifyTool,
  parseBuzzCliCommand,
} from "./agentSessionToolClassifier";
import { getToolString } from "./agentSessionUtils";

/**
 * Plain, brand-safe wording for agent tool calls.
 *
 * The raw tool call (a shell line such as `<cli> channels list 2>&1 | head`)
 * is an implementation detail. People see the short label by default; the raw
 * text only travels as `detail`, for an explicit opt-in "Show details"
 * disclosure.
 */

export const PLAIN_UNKNOWN_TOOL_LABEL = "Ran a tool";
export const PLAIN_FAILED_TOOL_LABEL = "A tool call failed";
export const PLAIN_COMMAND_LABEL = "Running a command";

/** Longest raw text carried into the details disclosure. */
export const MAX_ACTIVITY_DETAIL_LENGTH = 2000;

export type PlainActivityInput = {
  title?: string | null;
  toolName?: string | null;
  buzzToolName?: string | null;
  args?: Record<string, unknown> | null;
  result?: string | null;
  isError?: boolean;
  descriptor?: AgentActivityDescriptor | null;
};

export type PlainActivityLabel = {
  /** Short human wording. Never contains raw command text. */
  label: string;
  /** Raw command or path for the opt-in disclosure, or null. */
  detail: string | null;
  /** True when the call carried a shell command (raw text must stay hidden). */
  hasRawCommand: boolean;
};

type GroupLabels = { read: string; write: string };

const CLI_GROUP_LABELS: Record<string, GroupLabels> = {
  channels: { read: "Checking channels", write: "Updating a channel" },
  dms: { read: "Checking direct messages", write: "Sending a message" },
  reactions: { read: "Checking reactions", write: "Reacting to a message" },
  canvas: { read: "Reading the canvas", write: "Updating the canvas" },
  feed: { read: "Checking the feed", write: "Updating the feed" },
  users: { read: "Looking up people", write: "Updating a profile" },
  workflows: { read: "Checking workflows", write: "Updating a workflow" },
  social: { read: "Checking posts", write: "Sharing a post" },
  repos: { read: "Checking code", write: "Updating code" },
  pr: { read: "Checking code", write: "Updating code" },
  issues: { read: "Checking code", write: "Updating code" },
  patches: { read: "Checking code", write: "Updating code" },
  upload: { read: "Uploading a file", write: "Uploading a file" },
  mem: { read: "Checking notes", write: "Saving a note" },
  notes: { read: "Checking notes", write: "Saving a note" },
  emoji: { read: "Checking emoji", write: "Updating emoji" },
  pack: { read: "Checking emoji", write: "Updating emoji" },
};

const SEND_TOOLS = new Set(["send_message", "send_diff_message"]);
const CONVERSATION_TOOLS = new Set([
  "get_messages",
  "get_channel_history",
  "get_thread",
]);
const CHANNEL_TOOLS = new Set([
  "list_channels",
  "get_channel",
  "list_channel_members",
]);

const SHELL_TOOL_NAMES = new Set([
  "shell",
  "bash",
  "execute",
  "run_command",
  "terminal",
  "exec",
  "exec_command",
]);
const READ_FILE_TOOL_NAMES = new Set(["read", "read_file", "view"]);
const WRITE_FILE_TOOL_NAMES = new Set([
  "write",
  "write_file",
  "edit",
  "edit_file",
  "multi_edit",
  "str_replace",
  "apply_patch",
]);
const SEARCH_TOOL_NAMES = new Set(["grep", "glob", "search", "web_search"]);

function labelForCli(
  group: string,
  verb: string,
  tone: AgentActivityTone | undefined,
): string | null {
  if (verb === "search") return "Searching";
  const isRead = tone === "read";
  if (group === "messages") {
    if (verb === "send") return "Sending a message";
    return isRead ? "Reading the conversation" : "Updating a message";
  }
  const labels = CLI_GROUP_LABELS[group];
  return labels ? (isRead ? labels.read : labels.write) : null;
}

function labelForToolName(name: string): string | null {
  if (SHELL_TOOL_NAMES.has(name)) return PLAIN_COMMAND_LABEL;
  if (READ_FILE_TOOL_NAMES.has(name)) return "Reading a file";
  if (WRITE_FILE_TOOL_NAMES.has(name)) return "Writing a file";
  if (SEARCH_TOOL_NAMES.has(name)) return "Searching";
  return null;
}

function labelForRelayTool(name: string): string | null {
  if (SEND_TOOLS.has(name)) return "Sending a message";
  if (CONVERSATION_TOOLS.has(name)) return "Reading the conversation";
  if (name === "search") return "Searching";
  if (CHANNEL_TOOLS.has(name)) return "Checking channels";
  return null;
}

function labelForDescriptor(
  descriptor: AgentActivityDescriptor,
): string | null {
  switch (descriptor.renderClass) {
    case "file-read":
      return "Reading a file";
    case "file-edit":
      return "Writing a file";
    case "skill-read":
      return "Reading instructions";
    case "image":
      return "Viewing an image";
    case "shell":
      return PLAIN_COMMAND_LABEL;
    case "plan":
      return "Updating the plan";
    case "status":
      return "Working";
    default:
      return null;
  }
}

function truncateDetail(value: string): string {
  return value.length > MAX_ACTIVITY_DETAIL_LENGTH
    ? `${value.slice(0, MAX_ACTIVITY_DETAIL_LENGTH)}…`
    : value;
}

function resolveLabel(
  input: PlainActivityInput,
  command: string | null,
): string {
  // Any call that carries a shell command is described by what it does, never
  // by the line itself, whatever the harness called the tool.
  if (command) {
    const cli = parseBuzzCliCommand(command);
    if (cli?.operation) {
      const [group, verb] = cli.operation.split(".");
      const label = labelForCli(group ?? "", verb ?? "", cli.tone);
      if (label) return label;
    }
    return PLAIN_COMMAND_LABEL;
  }

  const names = [input.buzzToolName, input.toolName, input.title]
    .filter((value): value is string => Boolean(value))
    .map(normalizeToolNameText);
  for (const name of names) {
    const relay = labelForRelayTool(findBuzzToolName(name, true) ?? name);
    if (relay) return relay;
  }

  const descriptor =
    input.descriptor ??
    classifyTool({
      title: input.title ?? "",
      toolName: input.toolName ?? "",
      buzzToolName: input.buzzToolName ?? null,
      args: input.args ?? {},
      result: input.result ?? "",
      isError: Boolean(input.isError),
    });
  const fromDescriptor = labelForDescriptor(descriptor);
  if (fromDescriptor) return fromDescriptor;

  for (const name of names) {
    const base = name.replace(/^buzz_dev_mcp_/, "");
    const fromName = labelForToolName(base);
    if (fromName) return fromName;
  }

  if (descriptor.renderClass === "message") return "Sending a message";
  if (descriptor.renderClass === "relay-op") {
    // Relay read tools about people carry an "admin" tone, so only an
    // explicit write tone means a change.
    return descriptor.tone === "write"
      ? "Making an update"
      : "Looking something up";
  }

  return PLAIN_UNKNOWN_TOOL_LABEL;
}

/** Map a tool call to plain wording plus its opt-in raw detail. */
export function plainActivityLabel(
  input: PlainActivityInput,
): PlainActivityLabel {
  const args = input.args ?? {};
  const command = getToolString(args, ["command", "cmd"]);
  const path = getToolString(args, ["path", "file_path", "filePath"]);
  const label = resolveLabel(input, command);
  const failed =
    Boolean(input.isError) || input.descriptor?.renderClass === "error";
  const rawDetail = command ?? path;
  return {
    label: failed
      ? label === PLAIN_UNKNOWN_TOOL_LABEL
        ? PLAIN_FAILED_TOOL_LABEL
        : `${label} failed`
      : label,
    detail: rawDetail ? truncateDetail(rawDetail) : null,
    hasRawCommand: command !== null,
  };
}
