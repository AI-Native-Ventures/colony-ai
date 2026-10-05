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
  className = "mb-[18px]",
  problem,
  testId,
}: ProfileAvatarProblemProps) {
  return (
    <div
      className={`${className} rounded-[7px] border border-[#edd8dd] bg-[#fcf2f4] px-[18px] py-[15px] text-xs leading-[1.65] text-[#925369] dark:border-[#63414e] dark:bg-[#402b34] dark:text-[#dcacb8]`}
      data-error-kind={problem.kind}
      data-testid={testId}
      role="alert"
    >
      <p className="font-medium">{problem.title}</p>
      <p>{problem.message}</p>
    </div>
  );
}
