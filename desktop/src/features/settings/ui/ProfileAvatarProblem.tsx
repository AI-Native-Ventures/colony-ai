import type { AvatarProblem } from "@/features/profile/avatarUploadProblems";

type ProfileAvatarProblemProps = {
  className?: string;
  problem: AvatarProblem;
  testId: string;
};

/**
 * Inline failure notice for the avatar dialog. It is announced as an alert and
 * stays on screen until the person retries, chooses another image or cancels.
 */
export function ProfileAvatarProblem({
  className,
  problem,
  testId,
}: ProfileAvatarProblemProps) {
  return (
    <div
      className={className ? `pa-problem ${className}` : "pa-problem"}
      data-error-kind={problem.kind}
      data-testid={testId}
      role="alert"
    >
      <p className="pa-problem-title">{problem.title}</p>
      <p>{problem.message}</p>
    </div>
  );
}
