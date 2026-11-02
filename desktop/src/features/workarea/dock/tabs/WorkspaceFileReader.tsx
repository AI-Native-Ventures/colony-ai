import { ChevronLeft } from "lucide-react";
import * as React from "react";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";

import {
  readWorkspaceFile,
  type WorkspaceFile,
  type WorkspaceFileReference,
} from "../../workspaceFiles";
import { parentDirectory, showWorkAreaFileList } from "../workAreaFilesStore";
import { openWorkArea } from "../workAreaStore";
import { WorkspaceDocument } from "./workspaceDocument";

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** "13:57" for today, "3 Oct, 13:57" for another day. */
function formatWritten(modifiedAt: number, now = Date.now()): string {
  const written = new Date(modifiedAt);
  const today = new Date(now);
  const sameDay =
    written.getFullYear() === today.getFullYear() &&
    written.getMonth() === today.getMonth() &&
    written.getDate() === today.getDate();
  return sameDay
    ? CLOCK.format(written)
    : `${DAY.format(written)}, ${CLOCK.format(written)}`;
}

/** A read-only file reader. No document HTML or external images are executed. */
export function WorkspaceFileReader({
  channelId,
  reference,
}: {
  channelId: string;
  reference: WorkspaceFileReference;
}) {
  const [attempt, setAttempt] = React.useState(0);
  const [loaded, setLoaded] = React.useState<{
    reference: WorkspaceFileReference;
    attempt: number;
    file: WorkspaceFile;
  } | null>(null);
  const file =
    loaded?.reference === reference && loaded.attempt === attempt
      ? loaded.file
      : null;
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let current = true;
    setLoaded(null);
    setError(false);
    void readWorkspaceFile(reference)
      .then((next) => {
        if (current) setLoaded({ reference, attempt, file: next });
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [reference, attempt]);

  const authorQuery = useUsersBatchQuery([reference.agentPubkey]);
  const profile =
    authorQuery.data?.profiles?.[normalizePubkey(reference.agentPubkey)];
  const authorName = resolveUserLabel({
    pubkey: reference.agentPubkey,
    profiles: authorQuery.data?.profiles,
  });
  const segments = reference.path.split("/");
  const trail = ["Workspace", ...segments].join(" / ");

  return (
    <div className="colony-doc-reader" data-testid="work-area-files">
      <div className="colony-doc-head">
        <button
          className="colony-doc-back"
          data-testid="work-area-files-back"
          onClick={() => {
            showWorkAreaFileList(channelId, parentDirectory(reference.path));
            openWorkArea(channelId, "files");
          }}
          type="button"
        >
          <ChevronLeft aria-hidden="true" strokeWidth={2.4} />
          Files
        </button>
        <p className="colony-doc-path" data-testid="work-area-file-path">
          {trail}
        </p>
        <p className="colony-doc-author" data-testid="work-area-file-author">
          <ProfileAvatar
            avatarUrl={profile?.avatarUrl ?? null}
            className="h-[1.375rem] w-[1.375rem] text-3xs"
            label={authorName}
            pubkey={reference.agentPubkey}
            shape="squircle"
          />
          <span>
            Written by {authorName}
            {file?.modifiedAt !== undefined
              ? ` · ${formatWritten(file.modifiedAt)}`
              : ""}
          </span>
        </p>
      </div>
      <div className="colony-doc-scroll">
        {!file && !error ? (
          <p className="colony-doc-status" role="status">
            Opening file...
          </p>
        ) : null}
        {error ? (
          <div className="colony-doc-status" role="alert">
            <p>This file is no longer available in the agent's workspace.</p>
            <Button
              onClick={() => setAttempt((count) => count + 1)}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : null}
        {file ? (
          /\.(md|markdown)$/i.test(file.path) ? (
            <WorkspaceDocument source={file.content} />
          ) : (
            <pre className="colony-doc-text" data-testid="work-area-text">
              {file.content}
            </pre>
          )
        ) : null}
      </div>
    </div>
  );
}
