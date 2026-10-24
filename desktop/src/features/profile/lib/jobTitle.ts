import type { UserProfileSummary } from "@/shared/api/types";

/** Shown for the community owner until they publish a job title of their own. */
export const OWNER_JOB_TITLE = "Founder";

/** Longest job title a person can publish. */
export const JOB_TITLE_MAX_LENGTH = 80;

/** Trim a job title; blank means none. */
export function normalizeJobTitle(value: string | null | undefined): string {
  return value?.trim().slice(0, JOB_TITLE_MAX_LENGTH) ?? "";
}

/**
 * The job title to show beside a person's name.
 *
 * The title a person published on their own profile (the kind:0 `job_title`
 * field, `UserProfileSummary.jobTitle`) wins, so every client agrees. Without
 * one, an employee falls back to the title on their company position, and the
 * community owner to "Founder". Returns an empty string when there is none.
 */
export function resolveJobTitle(input: {
  profile?: Pick<UserProfileSummary, "jobTitle"> | null;
  positionTitle?: string | null;
  isOwner?: boolean;
}): string {
  return (
    normalizeJobTitle(input.profile?.jobTitle) ||
    normalizeJobTitle(input.positionTitle) ||
    (input.isOwner ? OWNER_JOB_TITLE : "")
  );
}
