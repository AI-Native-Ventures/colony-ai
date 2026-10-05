const MEMBERSHIP_ERROR_PATTERN =
  /not a member|not a relay member|must be a relay member|relay_membership_required|membership.?(required|denied)/i;

export type CommunityApplyErrorCopy = {
  /** Plain Colony wording shown to the person. */
  message: string;
  /** Raw error text kept in a small details line so support can read it. */
  detail: string | null;
  isMembershipError: boolean;
};

/**
 * Turn the raw error from applying a community into plain copy. Known
 * membership failures get a sentence that says what to do next; anything else
 * keeps its original text as the message so nothing is hidden.
 */
export function describeCommunityApplyError({
  communityName,
  error,
  hasOtherCommunities,
}: {
  communityName: string | null;
  error: string;
  hasOtherCommunities: boolean;
}): CommunityApplyErrorCopy {
  if (!MEMBERSHIP_ERROR_PATTERN.test(error)) {
    return { message: error, detail: null, isMembershipError: false };
  }
  const name = communityName?.trim() || "this community";
  return {
    message: hasOtherCommunities
      ? `This sign-in is not a member of ${name}. Switch to another community or remove this one.`
      : `This sign-in is not a member of ${name}. Remove it from this device, or ask for an invitation.`,
    detail: error,
    isMembershipError: true,
  };
}
