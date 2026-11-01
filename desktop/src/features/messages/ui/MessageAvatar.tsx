import { AlertTriangle } from "lucide-react";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { cn } from "@/shared/lib/cn";

/**
 * The picture beside a message: people are round (40), agents keep their own
 * squircle picture (42), as the Colony 3.0 conversation boards size them. An
 * agent that anyone, or selected people, can instruct carries a small badge.
 */
export function MessageAvatar({
  author,
  avatarUrl,
  pubkey,
  hideAgentAccessBadge = false,
  isAgent,
  isThreadReply = false,
  respondTo,
  sizePx,
}: {
  author: string;
  avatarUrl: string | null;
  pubkey?: string;
  hideAgentAccessBadge?: boolean;
  isAgent: boolean;
  isThreadReply?: boolean;
  respondTo?: "anyone" | "allowlist" | "owner-only" | string | null;
  /** Fixed size in design pixels (thread replies); default is 40 or 42. */
  sizePx?: number;
}) {
  const showRespondToIndicator =
    respondTo === "anyone" || respondTo === "allowlist";
  const label =
    respondTo === "anyone"
      ? "Anyone can send instructions to this agent"
      : "Selected people can send instructions to this agent";
  return (
    <div className="relative shrink-0">
      <ProfileAvatar
        avatarUrl={avatarUrl}
        pubkey={pubkey}
        className={cn(
          "c3c-avatar",
          sizePx === undefined &&
            (isAgent ? "c3c-avatar--agent" : "c3c-avatar--person"),
        )}
        style={
          sizePx === undefined
            ? undefined
            : {
                fontSize: `calc(${Math.round(sizePx * 0.37)} * var(--colony-px))`,
                height: `calc(${sizePx} * var(--colony-px))`,
                width: `calc(${sizePx} * var(--colony-px))`,
              }
        }
        label={author}
        shape={isAgent ? "squircle" : "circle"}
        testId="message-avatar"
      />
      {showRespondToIndicator && !hideAgentAccessBadge && !isThreadReply ? (
        <span
          aria-label={label}
          className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-background"
          role="img"
          title={label}
        >
          {respondTo === "anyone" ? (
            <AlertTriangle
              aria-hidden="true"
              className="h-2.5 w-2.5 fill-background text-amber-500"
            />
          ) : (
            <span className="h-2 w-2 rounded-full bg-blue-500" />
          )}
        </span>
      ) : null}
    </div>
  );
}
