import { ChevronLeft } from "lucide-react";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/shared/ui/button";

import {
  readWorkspaceFile,
  type WorkspaceFile,
  type WorkspaceFileReference,
} from "../../workspaceFiles";
import {
  setWorkAreaFileReference,
  showWorkAreaFileList,
} from "../workAreaFilesStore";

/** A read-only file reader. No document HTML or external images are executed. */
export function WorkspaceFileReader({
  channelId,
  reference,
}: {
  channelId: string;
  reference: WorkspaceFileReference;
}) {
  const [loaded, setLoaded] = React.useState<{
    reference: WorkspaceFileReference;
    file: WorkspaceFile;
  } | null>(null);
  const file = loaded?.reference === reference ? loaded.file : null;
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let current = true;
    setLoaded(null);
    setError(false);
    void readWorkspaceFile(reference)
      .then((next) => {
        if (current) setLoaded({ reference, file: next });
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [reference]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="work-area-files">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          data-testid="work-area-files-back"
          onClick={() => showWorkAreaFileList(channelId)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" />
          Files
        </Button>
        <p className="min-w-0 break-all text-sm font-medium">
          {reference.path}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!file && !error ? (
          <p role="status" className="text-sm text-muted-foreground">
            Opening file...
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="space-y-3 text-sm">
            <p>This file is no longer available in the agent's workspace.</p>
            <Button
              variant="outline"
              onClick={() =>
                setWorkAreaFileReference(channelId, { ...reference })
              }
            >
              Try again
            </Button>
          </div>
        ) : null}
        {file ? (
          /\.(md|markdown)$/i.test(file.path) ? (
            <article
              data-testid="work-area-markdown"
              className="space-y-3 break-words text-sm [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:font-mono [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ alt }) => <span>{alt || "Image"}</span>,
                  a: ({ children }) => <span>{children}</span>,
                }}
              >
                {file.content}
              </ReactMarkdown>
            </article>
          ) : (
            <pre
              data-testid="work-area-text"
              className="whitespace-pre-wrap break-words font-mono text-sm"
            >
              {file.content}
            </pre>
          )
        ) : null}
      </div>
    </div>
  );
}
