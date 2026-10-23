import * as React from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The read-only Markdown a file tab shows. Two conventions let an agent's
 * plain Markdown pick up the work area's look without any special syntax:
 *
 * - A section headed "Open questions" is drawn as a callout box.
 * - Inline code inside a heading is a small status chip (`Lead`, `Draft`).
 */

type MdNode = {
  type: string;
  depth?: number;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

function plainText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

const CALLOUT_HEADING = /^open questions:?$/i;

/** Wraps an "Open questions" heading and what follows it, up to the next heading of its level. */
function remarkCallouts() {
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

type ChipTone = "ok" | "need" | "bad" | "neutral";

function chipTone(word: string): ChipTone {
  const value = word.trim().toLowerCase();
  if (/^(lead|approved|done|ready|final|live|won)$/.test(value)) return "ok";
  if (/^(draft|review|pending|waiting|todo|open|needs .*)$/.test(value))
    return "need";
  if (/^(blocked|rejected|stopped|cancelled|canceled|lost|failed)$/.test(value))
    return "bad";
  return "neutral";
}

function withChips(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      if (child.type === "code") {
        const label = React.Children.toArray(child.props.children).join("");
        return (
          <span
            className="colony-doc-chip"
            data-testid="work-area-chip"
            data-tone={chipTone(label)}
          >
            {label}
          </span>
        );
      }
    }
    return child;
  });
}

const heading =
  (Tag: "h1" | "h2" | "h3" | "h4"): Components["h1"] =>
  ({ children }) => <Tag>{withChips(children)}</Tag>;

const COMPONENTS: Components = {
  h1: heading("h1"),
  h2: heading("h2"),
  h3: heading("h3"),
  h4: heading("h4"),
  img: ({ alt }) => <span>{alt || "Image"}</span>,
  a: ({ children }) => <span>{children}</span>,
};

const REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  remarkCallouts as unknown as NonNullable<Options["remarkPlugins"]>[number],
];

/** Document Markdown with no executed HTML, no remote images and no live links. */
export function WorkspaceDocument({ source }: { source: string }) {
  return (
    <article className="colony-doc" data-testid="work-area-markdown">
      <ReactMarkdown components={COMPONENTS} remarkPlugins={REMARK_PLUGINS}>
        {source}
      </ReactMarkdown>
    </article>
  );
}
