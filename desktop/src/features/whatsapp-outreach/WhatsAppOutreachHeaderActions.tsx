import { Settings } from "lucide-react";

import { MapOutreachDeskHeaderAction } from "./MapOutreachDesk";
import { WhatsAppResumeAndRetryAction } from "./WhatsAppRetryActions";
import type { WhatsAppStatus } from "./whatsappOutreachModels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/** Places the existing WhatsApp controls in the shared map desk header when needed. */
export function WhatsAppOutreachHeaderActions({
  canManage,
  mapDesk,
  onOpenSettings,
  status,
}: {
  canManage: boolean;
  mapDesk: boolean;
  onOpenSettings: () => void;
  status: WhatsAppStatus;
}) {
  const actions = (
    <>
      {canManage && status.accountRetryCount > 0 && !status.sendHealth ? (
        <WhatsAppResumeAndRetryAction count={status.accountRetryCount} />
      ) : null}
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <button
            aria-label="WhatsApp settings"
            className="c3wa-icon-button c3wa-settings-button"
            data-testid="whatsapp-settings-trigger"
            onClick={onOpenSettings}
            title="WhatsApp settings"
            type="button"
          >
            <Settings aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </TooltipTrigger>
        <TooltipContent>WhatsApp settings</TooltipContent>
      </Tooltip>
    </>
  );

  return mapDesk ? (
    <MapOutreachDeskHeaderAction>{actions}</MapOutreachDeskHeaderAction>
  ) : (
    actions
  );
}
