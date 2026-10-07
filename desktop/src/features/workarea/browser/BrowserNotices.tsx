import { Download, TriangleAlert, X } from "lucide-react";

import {
  dismissBrowserNotice,
  revealBrowserDownload,
  type BrowserNotice,
} from "./browserTabsStore";

type BrowserNoticesProps = {
  pageKey: string;
  notices: readonly BrowserNotice[];
};

/**
 * What happened that the person did not type: a download that started,
 * finished or failed (with a way to show the file), or an address or download
 * the browser refused. Announced politely, never stealing focus, and each can
 * be dismissed.
 */
export function BrowserNotices({ pageKey, notices }: BrowserNoticesProps) {
  return (
    <div
      aria-live="polite"
      className="colony-browser-notices"
      data-testid="browser-notices"
      role="status"
    >
      {notices.map((notice) => {
        const Icon = notice.kind === "download" ? Download : TriangleAlert;
        const subject = notice.fileName ?? "message";
        return (
          <div
            className="colony-browser-notice"
            data-kind={notice.kind}
            data-state={notice.state}
            data-testid={`browser-notice-${notice.kind}`}
            key={notice.id}
          >
            <Icon aria-hidden="true" />
            <span className="colony-browser-notice-text">{notice.message}</span>
            {notice.kind === "download" &&
            notice.state === "completed" &&
            notice.downloadId ? (
              <button
                className="colony-browser-notice-action"
                data-testid="browser-notice-reveal"
                onClick={() =>
                  revealBrowserDownload(pageKey, notice.downloadId as string)
                }
                type="button"
              >
                Show in folder
              </button>
            ) : null}
            <button
              aria-label={`Dismiss ${subject}`}
              className="colony-work-area-icon-button"
              data-testid="browser-notice-dismiss"
              onClick={() => dismissBrowserNotice(pageKey, notice.id)}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
