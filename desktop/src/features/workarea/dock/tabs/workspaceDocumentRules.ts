/**
 * The two conventions that give an agent's plain Markdown the work area's look
 * (see `workspaceDocument.tsx`): an "Open questions" section is a callout, and
 * inline code in a heading is a status chip whose colour comes from its word.
 */

export type MdNode = {
  type: string;
  depth?: number;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

export function plainText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

const CALLOUT_HEADING = /^open questions:?$/i;

/** Wraps an "Open questions" heading and what follows it, up to the next heading of its level. */
export function remarkCallouts() {
  return (tree: MdNode) => {
    const children = tree.children ?? [];
    const next: MdNode[] = [];
    for (let index = 0; index < children.length; index += 1) {
      const node = children[index];
      if (
        node.type === "heading" &&
        CALLOUT_HEADING.test(plainText(node).trim())
      ) {
        const section: MdNode[] = [node];
        let end = index + 1;
        while (
          end < children.length &&
          !(
            children[end].type === "heading" &&
            (children[end].depth ?? 6) <= (node.depth ?? 6)
          )
        ) {
          section.push(children[end]);
          end += 1;
        }
        next.push({
          type: "colonyCallout",
          children: section,
          data: {
            hName: "aside",
            hProperties: {
              className: ["colony-doc-callout"],
              "data-testid": "work-area-callout",
            },
          },
        });
        index = end - 1;
      } else {
        next.push(node);
      }
    }
    tree.children = next;
  };
}

export type ChipTone = "ok" | "need" | "bad" | "neutral";

export function chipTone(word: string): ChipTone {
  const value = word.trim().toLowerCase();
  if (/^(lead|approved|done|ready|final|live|won)$/.test(value)) return "ok";
  if (/^(draft|review|pending|waiting|todo|open|needs .*)$/.test(value))
    return "need";
  if (/^(blocked|rejected|stopped|cancelled|canceled|lost|failed)$/.test(value))
    return "bad";
  return "neutral";
}
