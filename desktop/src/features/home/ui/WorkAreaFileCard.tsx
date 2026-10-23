import { useQuery } from "@tanstack/react-query";

import {
  isWorkspaceFileReference,
  openWorkspaceFile,
  resolveWorkspaceFile,
} from "@/features/workarea/workspaceFiles";
import { getWorkspaceFileAuthorPubkey } from "@/features/workarea/workspaceFileAuthor";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { FileIcon } from "./homeIcons";

const INLINE_CODE = /`([^`\n]{1,1024})`/g;

/** The first path-like inline code in a message: the file an agent wrote. */
function firstFileReference(content: string): string | null {
  for (const match of content.matchAll(INLINE_CODE)) {
    const value = match[1];
    if (isWorkspaceFileReference(value) && /\.[A-Za-z0-9]{1,8}$/.test(value)) {
      return value;
    }
  }
  return null;
}

/**
 * A card under an agent's message naming a file it wrote, which opens in the
 * work area. It shows only for a managed agent's own message, and only after
 * the trusted host confirms the file exists, like the inline file links do.
 */
export function WorkAreaFileCard({
  authorPubkey,
  content,
  isKnownAgentPubkey,
}: {
  authorPubkey: string;
  content: string;
  isKnownAgentPubkey: (pubkey: string) => boolean;
}) {
  const relayOrigin = useRelayOrigin();
  const agentPubkey = getWorkspaceFileAuthorPubkey(
    { signerPubkey: authorPubkey },
    isKnownAgentPubkey,
  );
  const reference = firstFileReference(content);
  const enabled = Boolean(agentPubkey && relayOrigin && reference);
  const resolved = useQuery({
    queryKey: ["work-area-file-card", agentPubkey, relayOrigin, reference],
    queryFn: () =>
      resolveWorkspaceFile({
        agentPubkey: agentPubkey ?? "",
        expectedRelayUrl: relayOrigin ?? "",
        path: reference ?? "",
      }),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  const file = resolved.data;
  if (!enabled || !file || !agentPubkey || !relayOrigin) return null;

  return (
    <button
      className="ca-file-card"
      data-testid="work-area-file-card"
      onClick={() =>
        openWorkspaceFile({
          agentPubkey,
          expectedRelayUrl: relayOrigin,
          path: file.path,
        })
      }
      type="button"
    >
      <span aria-hidden="true" className="ca-file-card-tile">
        <FileIcon size={19} />
      </span>
      <span className="ca-file-card-copy">
        <strong>{file.path.split("/").pop() ?? file.path}</strong>
        <small>Opens in the work area</small>
      </span>
    </button>
  );
}
