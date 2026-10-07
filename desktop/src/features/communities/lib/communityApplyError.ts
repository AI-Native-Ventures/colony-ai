import {
  isTechnicalRelayError,
  plainRelayErrorMessage,
} from "@/shared/lib/relayError";
import { relayMembershipDenialDetail } from "@/shared/lib/relayMembershipDenied";

const MEMBERSHIP_ERROR_PATTERN =
  /not a member|not a relay member|must be a relay member|relay_membership_required|membership.?(required|denied)/i;

export type CommunityApplyErrorCopy = {
  /** Plain Colony wording shown to the person. */
  message: string;
  /**
   * The relay's own reason in plain words, for a small details line. Raw
   * transport text never lands here; it stays in the console.
   */
  detail: string | null;
  isMembershipError: boolean;
};

/**
 * Turn the raw error from applying a community into plain copy. Known
 * membership failures get a sentence that says what to do next. Relay wrapper
 * text ("relay returned 500 ...") becomes one plain sentence; other text keeps
 * its original wording so nothing is hidden. Both the first view and every
 * Retry come through here, so they always read the same.
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
    return {
      message: isTechnicalRelayError(error)
        ? plainRelayErrorMessage(error)
        : error,
      detail: null,
      isMembershipError: false,
    };
  }
  const name = communityName?.trim() || "this community";
  return {
    message: hasOtherCommunities
      ? `This sign-in is not a member of ${name}. Switch to another community or remove this one.`
      : `This sign-in is not a member of ${name}. Remove it from this device, or ask for an invitation.`,
    detail: relayMembershipDenialDetail(error),
    isMembershipError: true,
  };
}
