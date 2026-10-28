import * as React from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { copyCodeBlockToClipboard } from "@/shared/lib/codeBlockClipboard";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";

export type DocumentCardProps = {
  children: React.ReactNode;
  markdown: string;
  title: string;
  wordCount: number;
};

export function DocumentCard({
  children,
  markdown,
  title,
  wordCount,
}: DocumentCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [hasOverflow, setHasOverflow] = React.useState(false);
  const [isCopying, setIsCopying] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  const contentId = React.useId();

  React.useEffect(() => {
    if (isExpanded) return;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measureOverflow = () => {
      setHasOverflow(viewport.scrollHeight > viewport.clientHeight + 1);
    };

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [isExpanded]);

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsCopying(true);

      try {
        await copyCodeBlockToClipboard(markdown);
        toast.success("Copied markdown to clipboard");
      } catch (error) {
        console.error("Failed to copy document markdown", error);
        toast.error("Failed to copy markdown");
      } finally {
        setIsCopying(false);
      }
    },
    [markdown],
  );

  return (
    <Card asChild className="overflow-hidden p-0" data-document-card="">
      <article aria-labelledby={titleId}>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b border-colony-border p-4">
          <div className="min-w-0">
            <h3
              className="truncate text-base font-semibold text-colony-fg"
              id={titleId}
            >
              {title}
            </h3>
            <p className="mt-1 text-xs text-colony-fg-secondary">
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={isCopying}
            onClick={handleCopy}
            size="xs"
            type="button"
            variant="ghost"
          >
            <Copy aria-hidden="true" />
            Copy
          </Button>
        </CardHeader>

        <CardContent className="min-w-0 p-4">
          <div
            className={
              isExpanded ? "overflow-visible" : "max-h-36 overflow-hidden"
            }
            data-document-content=""
            id={contentId}
            ref={viewportRef}
          >
            <div ref={contentRef}>{children}</div>
          </div>
          {hasOverflow ? (
            <div className="mt-2 flex justify-center">
              <Button
                aria-controls={contentId}
                aria-expanded={isExpanded}
                className="min-w-24"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsExpanded((expanded) => !expanded);
                }}
                size="xs"
                type="button"
                variant="ghost"
              >
                {isExpanded ? "Show less" : "Show all"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </article>
    </Card>
  );
}
