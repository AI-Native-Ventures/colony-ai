import * as React from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

import { chipTone, remarkCallouts } from "./workspaceDocumentRules";

/**
 * The read-only Markdown a file tab shows. Two conventions let an agent's
 * plain Markdown pick up the work area's look without any special syntax:
 *
 * - A section headed "Open questions" is drawn as a callout box.
 * - Inline code inside a heading is a small status chip (`Lead`, `Draft`).
 */

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
