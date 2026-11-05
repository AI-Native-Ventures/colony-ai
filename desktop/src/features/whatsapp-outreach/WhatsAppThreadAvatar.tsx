import { UserRound } from "lucide-react";

import { BusinessLogoMark } from "@/features/discovery/BusinessLogoMark";
import type { resolveOutreachContactIdentity } from "./outreachDeskUtils";
import { whatsappInitials } from "./WhatsAppThreadMessage";

export function WhatsAppThreadAvatar({
  identity,
  isAnonymous,
}: {
  identity: ReturnType<typeof resolveOutreachContactIdentity> | null;
  isAnonymous: boolean;
}) {
  return (
    <span aria-hidden="true" className="c3wa-thread-avatar">
      {identity?.isLinked ? (
        <BusinessLogoMark
          className="c3wa-desk-logo-mark"
          logoUrl={identity.logoUrl}
          name={identity.displayName}
          placePhotoUrl={identity.placePhotoUrl}
          website={identity.website}
        />
      ) : isAnonymous ? (
        <UserRound aria-hidden="true" size={18} strokeWidth={1.8} />
      ) : (
        whatsappInitials(identity?.displayName ?? "WhatsApp")
      )}
    </span>
  );
}
