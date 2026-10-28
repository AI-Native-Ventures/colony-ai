type FencePosition = {
  start: { column: number; line: number };
  end: { column: number; line: number };
};

export type MessageFenceNode = {
  lang?: string | null;
  meta?: string | null;
  position?: FencePosition;
  value: string;
};

export type ParsedMessageFence =
  | {
      kind: "document";
      body: string;
      markdown: string;
      title: string;
      wordCount: number;
    }
  | { kind: "code" }
  | { kind: "plain" };

function countMarkdownWords(markdown: string): number {
  const visibleText = markdown
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^ {0,3}#{1,6}\s+/gm, " ")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gm, " ")
    .replace(/[*_~`]/g, " ");
  return (
    visibleText.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0
  );
}

function documentContents(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const titleLine = lines.findIndex((line) => /^ {0,3}# (.+?)\s*$/.test(line));
  const title =
    titleLine >= 0
      ? (lines[titleLine]?.match(/^ {0,3}# (.+?)\s*$/)?.[1]?.trim() ?? "Draft")
      : "Draft";

  if (titleLine >= 0) lines.splice(titleLine, 1);

  return {
    body: lines.join("\n").trim(),
    title,
    wordCount: countMarkdownWords(markdown),
  };
}

function isClosedDocFence(node: MessageFenceNode, source: string): boolean {
  const position = node.position;
  if (!position || node.lang !== "doc" || (node.meta ?? "").trim() !== "") {
    return false;
  }

  const lines = source.split(/\r?\n/);
  const openingLine = lines[position.start.line - 1] ?? "";
  const closingLine = lines[position.end.line - 1] ?? "";
  const columnOffset = Math.max(0, position.start.column - 1);
  const opening = openingLine.slice(columnOffset).match(/^(`{3,}|~{3,})(.*)$/);
  const closing = closingLine
    .slice(columnOffset)
    .match(/^(`{3,}|~{3,})[ \t]*$/);

  return Boolean(
    opening &&
      opening[2].trim() === "doc" &&
      closing &&
      closing[1][0] === opening[1][0] &&
      closing[1].length >= opening[1].length,
  );
}

export function parseMessageFence(
  node: MessageFenceNode,
  source: string,
): ParsedMessageFence {
  if (node.lang !== "doc" || (node.meta ?? "").trim() !== "") {
    return { kind: "code" };
  }
  if (!isClosedDocFence(node, source)) return { kind: "plain" };

  const contents = documentContents(node.value);
  return {
    kind: "document",
    body: contents.body,
    markdown: node.value,
    title: contents.title,
    wordCount: contents.wordCount,
  };
}

type MarkdownNode = {
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
  lang?: string | null;
  meta?: string | null;
  position?: FencePosition;
  type: string;
  value?: string;
};

type MarkdownFile = { value?: unknown };

function transformNode(node: MarkdownNode, source: string) {
  if (node.type === "code" && typeof node.value === "string") {
    const parsed = parseMessageFence(node as MessageFenceNode, source);
    if (parsed.kind === "document") {
      node.type = "paragraph";
      node.children = [];
      node.data = {
        ...node.data,
        hName: "message-document-card",
        hProperties: {
          body: parsed.body,
          markdown: parsed.markdown,
          title: parsed.title,
          wordCount: parsed.wordCount,
        },
      };
      delete node.value;
      delete node.lang;
      delete node.meta;
      return;
    }
  }

  for (const child of node.children ?? []) transformNode(child, source);
}

/** Turns only complete `doc` fences into the message document-card node. */
export default function remarkMessageFences() {
  return (tree: MarkdownNode, file: MarkdownFile) => {
    transformNode(tree, typeof file.value === "string" ? file.value : "");
  };
}
