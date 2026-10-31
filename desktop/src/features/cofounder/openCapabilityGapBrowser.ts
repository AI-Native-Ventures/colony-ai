import { toast } from "sonner";

import { browserTabId } from "@/features/workarea/browser/browserTabId";
import { createBrowserPage } from "@/features/workarea/browser/browserTabsStore";
import { openWorkArea } from "@/features/workarea/dock/workAreaStore";

export function openCapabilityGapBrowser(url: string, channelId: string) {
  const page = createBrowserPage(channelId, { address: url });
  if (!page.ok) {
    toast.error(page.message);
    return false;
  }
  openWorkArea(channelId, "browser", browserTabId(page.key));
  return true;
}
