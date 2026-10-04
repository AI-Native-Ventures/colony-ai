import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/shared/ui/sheet";
import {
  listenForWorkspaceFiles,
  listenForFilesTab,
  readWorkspaceFile,
  type WorkspaceFile,
  type WorkspaceFileReference,
} from "./workspaceFiles";

/** A read-only Files surface. No document HTML or external images are executed. */
export function WorkAreaFiles() {
  const relayOrigin = useRelayOrigin();
  const [isOpen, setIsOpen] = React.useState(false);
  const [reference, setReference] =
    React.useState<WorkspaceFileReference | null>(null);
  const [loaded, setLoaded] = React.useState<{
    reference: WorkspaceFileReference;
    file: WorkspaceFile;
  } | null>(null);
  const file = loaded?.reference === reference ? loaded.file : null;
  const [error, setError] = React.useState(false);
  React.useEffect(
    () =>
      listenForWorkspaceFiles((next) => {
        if (next.expectedRelayUrl === relayOrigin) {
          setReference(next);
          setIsOpen(true);
        }
      }),
    [relayOrigin],
  );
  React.useEffect(() => listenForFilesTab(() => setIsOpen(true)), []);
  React.useEffect(() => {
    if (reference && reference.expectedRelayUrl !== relayOrigin) {
      setIsOpen(false);
      setReference(null);
    }
  }, [reference, relayOrigin]);
  React.useEffect(() => {
    let current = true;
    setLoaded(null);
    setError(false);
    if (reference && reference.expectedRelayUrl === relayOrigin) {
      void readWorkspaceFile(reference)
        .then((next) => {
          if (current) setLoaded({ reference, file: next });
        })
        .catch(() => {
          if (current) setError(true);
        });
    }
    return () => {
      current = false;
    };
  }, [reference, relayOrigin]);
  return (
    <Sheet
      open={
        isOpen && (!reference || reference.expectedRelayUrl === relayOrigin)
      }
      onOpenChange={(open) => {
        setIsOpen(open);
      }}
    >
      <SheetContent
        className="flex w-full flex-col sm:max-w-2xl"
        aria-label="Work area"
      >
        <SheetTitle>Work area</SheetTitle>
        <SheetDescription>
          Read-only files from this agent's workspace.
        </SheetDescription>
        <div
          role="tablist"
          aria-label="Work area views"
          className="border-b pb-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="work-area-file"
            id="work-area-files-tab"
            className="text-sm font-medium"
          >
            Files
          </button>
        </div>
        <section
          role="tabpanel"
          id="work-area-file"
          aria-labelledby="work-area-files-tab"
          className="min-h-0 flex-1 overflow-auto"
        >
          <p className="mb-4 break-all text-sm font-medium">
            {reference?.path}
          </p>
          {!reference ? (
            <p className="text-sm text-muted-foreground">
              Choose a file link in an agent's message to read it here.
            </p>
          ) : null}
          {reference && !file && !error ? (
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
                  setReference((value) => (value ? { ...value } : null))
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
        </section>
      </SheetContent>
    </Sheet>
  );
}
