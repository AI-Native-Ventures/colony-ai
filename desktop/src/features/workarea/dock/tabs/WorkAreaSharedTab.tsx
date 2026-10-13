import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  Image,
  Link2,
  MessageSquare,
  Plus,
} from "lucide-react";
import * as React from "react";

import {
  browserPageKeyOf,
  browserTabId,
} from "@/features/workarea/browser/browserTabId";
import {
  createBrowserPage,
  getBrowserPageLabel,
} from "@/features/workarea/browser/browserTabsStore";
import { isBrowserHostAvailable } from "@/shared/api/browserHost";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useMediaProxyPort } from "@/shared/lib/useMediaProxyPort";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

import { useWorkAreaConversation } from "../workAreaConversationContext";
import { requestNewWorkAreaTab } from "../workAreaRequests";
import {
  getWorkAreaState,
  MAX_TABS_PER_CHANNEL,
  openWorkArea,
} from "../workAreaStore";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { useWorkAreaDock } from "../useWorkAreaDock";
import {
  conversationSharedItems,
  type ConversationSharedItem,
} from "./conversationSharedItems";
import { WorkAreaTabNotice } from "./WorkAreaTabNotice";

type Section = "media" | "file" | "link" | "browser";

/** Conversation-level recent assets, always read from the live message window. */
export function WorkAreaSharedTab({ channelId }: WorkAreaTabPanelProps) {
  const conversation = useWorkAreaConversation();
  const [section, setSection] = React.useState<Section>("media");
  const [browserError, setBrowserError] = React.useState<string | null>(null);
  const browserTabs = useWorkAreaDock(channelId).tabs.filter(
    (tab) => tab.kind === "browser",
  );
  const items = React.useMemo(
    () => conversationSharedItems(conversation?.messages ?? []),
    [conversation?.messages],
  );
  const rootIds = React.useMemo(
    () => new Set(conversation?.messages.map((message) => message.id) ?? []),
    [conversation?.messages],
  );
  useMediaProxyPort();

  if (!conversation) {
    return (
      <WorkAreaTabNotice
        state="unlisted"
        testId="colony-shared-state"
        title="Open a conversation to see its workspace"
      />
    );
  }
  const openLink = (url: string) => {
    setBrowserError(null);
    if (getWorkAreaState(channelId).tabs.length >= MAX_TABS_PER_CHANNEL) {
      setBrowserError("Close a work area tab before opening another page.");
      return;
    }
    const created = createBrowserPage(channelId, { address: url });
    if (!created.ok) {
      setBrowserError(created.message);
      return;
    }
    openWorkArea(channelId, "browser", browserTabId(created.key));
  };

  return (
    <div className="colony-canary-shared" data-testid="colony-shared-workspace">
      <div className="colony-canary-shared-heading">
        <div>
          <h2>Workspace</h2>
          <p>Media, files and links from this conversation.</p>
        </div>
      </div>
      <Tabs
        onValueChange={(value) => setSection(value as Section)}
        value={section}
      >
        <TabsList
          aria-label="Conversation workspace"
          className="colony-canary-shared-tabs"
        >
          <TabsTrigger value="media">
            <Image aria-hidden="true" /> Media
          </TabsTrigger>
          <TabsTrigger value="file">
            <FileText aria-hidden="true" /> Files
          </TabsTrigger>
          <TabsTrigger value="link">
            <Link2 aria-hidden="true" /> Links
          </TabsTrigger>
          <TabsTrigger value="browser">
            <Globe aria-hidden="true" /> Browser
          </TabsTrigger>
        </TabsList>
        {(["media", "file", "link"] as const).map((kind) => (
          <TabsContent
            className="colony-canary-shared-content"
            key={kind}
            value={kind}
          >
            {conversation.loading && items.length === 0 ? (
              <WorkAreaTabNotice
                state="loading"
                testId="colony-shared-state"
                title="Loading shared items"
              />
            ) : conversation.failed ? (
              <WorkAreaTabNotice
                state="failed"
                testId="colony-shared-state"
                title="Shared items could not be loaded"
                body="The conversation could not be read. Try again."
                onRetry={conversation.onRetry}
              />
            ) : items.some((item) => item.kind === kind) ? (
              <ul
                aria-label={`Recent shared ${kind === "file" ? "files" : `${kind} items`}`}
                className="colony-canary-shared-list"
              >
                {items
                  .filter((item) => item.kind === kind)
                  .map((item) => (
                    <SharedItem
                      canDiscuss={rootIds.has(item.threadRootId)}
                      item={item}
                      key={item.key}
                      onDiscuss={() =>
                        conversation.onDiscuss(item.threadRootId)
                      }
                      onOpenLink={() => openLink(item.url)}
                    />
                  ))}
              </ul>
            ) : (
              <WorkAreaTabNotice
                state="empty"
                testId="colony-shared-state"
                title={`No recent ${kind === "file" ? "files" : `${kind} items`}`}
                body="Items shared in the conversation appear here as messages load."
              />
            )}
          </TabsContent>
        ))}
        <TabsContent className="colony-canary-shared-content" value="browser">
          <div className="colony-canary-shared-browser">
            <Globe aria-hidden="true" />
            <h3>Browse beside this conversation</h3>
            <p>
              Open pages beside this conversation. Browser pages stay on this
              device; web addresses shared in messages appear under Links.
            </p>
            {browserTabs.length > 0 ? (
              <ul
                aria-label="Browser pages for this conversation"
                className="colony-canary-shared-browser-pages"
              >
                {browserTabs.map((tab) => (
                  <li key={tab.id}>
                    <button
                      onClick={() => openWorkArea(channelId, "browser", tab.id)}
                      type="button"
                    >
                      <Globe aria-hidden="true" />{" "}
                      {getBrowserPageLabel(browserPageKeyOf(tab.id))}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {isBrowserHostAvailable() ? (
              <Button
                onClick={() => requestNewWorkAreaTab("browser")}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" /> Open browser
              </Button>
            ) : (
              <p>The browser opens in the desktop app.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
      {browserError ? (
        <p className="colony-canary-shared-error" role="alert">
          {browserError}
        </p>
      ) : null}
      <p className="colony-canary-shared-scope">
        Recent messages shown here
        {conversation.hasOlderMessages
          ? ". Scroll up in the conversation to load older items."
          : "."}
      </p>
    </div>
  );
}

function SharedItem({
  item,
  canDiscuss,
  onDiscuss,
  onOpenLink,
}: {
  item: ConversationSharedItem;
  canDiscuss: boolean;
  onDiscuss: () => void;
  onOpenLink: () => void;
}) {
  const canOpenBrowser = item.kind === "link" && isBrowserHostAvailable();
  const [mediaIndex, setMediaIndex] = React.useState(0);
  const mediaCount = item.media?.length ?? 0;
  const shownIndex = mediaCount > 0 ? mediaIndex % mediaCount : 0;
  const media = item.media?.[shownIndex];
  const previewSource = media?.previewUrl ?? item.previewUrl;
  const previewUrl = previewSource ? rewriteRelayUrl(previewSource) : null;
  return (
    <li
      className="colony-canary-shared-item"
      data-testid={`colony-shared-${item.kind}`}
    >
      <SharedPreview
        key={previewUrl ?? "none"}
        kind={item.kind}
        url={previewUrl}
      />
      <div className="colony-canary-shared-item-main">
        <strong>{item.title}</strong>
        {mediaCount > 1 ? (
          <fieldset className="colony-canary-shared-carousel">
            <legend className="sr-only">Media carousel</legend>
            <button
              aria-label="Previous media"
              onClick={() =>
                setMediaIndex((index) => (index + mediaCount - 1) % mediaCount)
              }
              type="button"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <span>
              {shownIndex + 1} of {mediaCount}
            </span>
            <button
              aria-label="Next media"
              onClick={() => setMediaIndex((index) => (index + 1) % mediaCount)}
              type="button"
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </fieldset>
        ) : null}
        <p>
          {item.kind === "media" && item.count > 1
            ? `${item.count} attachments · `
            : ""}
          {item.author} · {new Date(item.createdAt * 1000).toLocaleDateString()}
        </p>
        {item.kind === "link" ? (
          <span className="colony-canary-shared-url">{item.url}</span>
        ) : null}
        <div className="colony-canary-shared-item-actions">
          {canDiscuss ? (
            <button onClick={onDiscuss} type="button">
              <MessageSquare aria-hidden="true" /> Discuss in thread
            </button>
          ) : null}
          {canOpenBrowser ? (
            <button onClick={onOpenLink} type="button">
              <Globe aria-hidden="true" /> Open in browser
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function SharedPreview({
  kind,
  url,
}: {
  kind: ConversationSharedItem["kind"];
  url: string | null;
}) {
  const [failed, setFailed] = React.useState(false);
  const Icon = kind === "media" ? Image : kind === "file" ? FileText : Link2;
  return (
    <span className="colony-canary-shared-preview" aria-hidden="true">
      {url && !failed ? (
        <img alt="" onError={() => setFailed(true)} src={url} />
      ) : (
        <Icon />
      )}
    </span>
  );
}
