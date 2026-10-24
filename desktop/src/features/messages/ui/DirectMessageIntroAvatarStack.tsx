import { getDmParticipantPreview } from "@/features/channels/lib/dmParticipantDisplay";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { cn } from "@/shared/lib/cn";

export type DirectMessageIntroParticipant = {
  avatarUrl: string | null;
  displayName: string;
  isAgent?: boolean;
  pubkey: string;
};

export function DirectMessageIntroAvatarStack({
  participants,
}: {
  participants: DirectMessageIntroParticipant[];
}) {
  const { hiddenCount, visibleParticipants } =
    getDmParticipantPreview(participants);
  const stackItemCount = visibleParticipants.length + (hiddenCount > 0 ? 1 : 0);

  return (
    <div
      className="flex shrink-0 items-center"
      data-testid="message-dm-intro-avatar-stack"
    >
      {visibleParticipants.map((participant, index) => (
        <UserProfilePopover
          key={participant.pubkey}
          pubkey={participant.pubkey}
          triggerAriaLabel={`Open profile for ${participant.displayName}`}
          triggerElement="span"
          role={participant.isAgent ? "bot" : undefined}
        >
          <span
            className={index > 0 ? "-ml-3 mt-[3px]" : ""}
            data-testid="message-dm-intro-avatar-stack-participant"
            style={{ zIndex: index + 1 }}
          >
            <ProfileAvatar
              avatarUrl={participant.avatarUrl}
              className={cn(
                participant.isAgent
                  ? "size-[calc(64*var(--colony-px))] text-2xl"
                  : "size-[calc(58*var(--colony-px))] text-xl",
                index > 0 && "ring-[3px] ring-colony-surface",
              )}
              label={participant.displayName}
              shape={participant.isAgent ? "squircle" : "circle"}
            />
          </span>
        </UserProfilePopover>
      ))}
      {hiddenCount > 0 ? (
        <div
          className={visibleParticipants.length > 0 ? "-ml-3" : ""}
          data-testid="message-dm-intro-avatar-stack-more"
          style={{ zIndex: stackItemCount }}
        >
          <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground shadow-xs">
            <span className="text-lg leading-none">+{hiddenCount}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The start of a direct message: who it is with and where it begins. */
export function DirectMessageIntroBlock({
  className,
  displayName,
  participants,
}: {
  className?: string;
  displayName: string;
  participants: DirectMessageIntroParticipant[];
}) {
  return (
    <section
      aria-label="Start of conversation"
      className={cn(
        "flex w-full flex-col items-start gap-3 text-left",
        className,
      )}
      data-testid="message-dm-intro"
    >
      <DirectMessageIntroAvatarStack participants={participants} />
      <h2 className="c3c-dm-intro-title max-w-full truncate">{displayName}</h2>
      <p className="c3c-dm-intro-text max-w-full">
        This is the beginning of your direct message with {displayName}.
      </p>
    </section>
  );
}
