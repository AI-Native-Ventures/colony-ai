import type * as React from "react";
import type { Components } from "react-markdown";
import { cn } from "@/shared/lib/cn";
import { INLINE_CODE_CHIP_CLASS } from "@/shared/ui/mentionChip";
import { WorkspaceFileCode } from "@/features/workarea/WorkspaceFileCode";
import { isWorkspaceFileReference } from "@/features/workarea/workspaceFiles";
import { useMarkdownRuntime } from "./runtimeContext";
import {
  CODE_BLOCK_CLASS,
  extractLanguage,
  SyntaxHighlightedCode,
} from "./CodeBlock";

/** Stable Markdown code renderer retaining fenced blocks and workspace file navigation. */
export function createMarkdownCode(interactive: boolean): Components["code"] {
  return function MarkdownCode({
    children,
    className,
    node: _node,
    ...props
  }: React.ComponentProps<"code"> & { node?: unknown }) {
    const { workspaceAgentPubkey } = useMarkdownRuntime();
    const rawCode = String(children);
    const code = rawCode.replace(/\n$/, "");
    const isFencedCodeBlock =
      typeof className === "string" && className.includes("language-");

    if (isFencedCodeBlock || rawCode.endsWith("\n") || code.includes("\n")) {
      const language = extractLanguage(className);

      if (language) {
        return (
          <SyntaxHighlightedCode code={code} language={language} {...props} />
        );
      }

      const lines = code.split("\n");
      return (
        <code {...props} className={CODE_BLOCK_CLASS}>
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <span key={i} data-line="">
              {line}
            </span>
          ))}
        </code>
      );
    }

    if (interactive && workspaceAgentPubkey && isWorkspaceFileReference(code)) {
      return <WorkspaceFileCode value={code} />;
    }
    return (
      <code {...props} className={cn(INLINE_CODE_CHIP_CLASS, className)}>
        {children}
      </code>
    );
  };
}
