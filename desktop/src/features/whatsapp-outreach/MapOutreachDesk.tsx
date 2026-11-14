import * as React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";

import { UpdateIndicator } from "@/features/settings/UpdateIndicator";
import { useMapShellEnabled } from "@/features/map-shell/useMapShellEnabled";
import { useMediaBreakpoint } from "@/shared/hooks/use-mobile";
import {
  useWhatsAppContactsQuery,
  useWhatsAppDraftsQuery,
  useWhatsAppPendingBatchDetailsQuery,
  useWhatsAppStatusQuery,
} from "./whatsappOutreachQueries";
import { getWhatsAppNeedsYouItems } from "./whatsappOutreachStages";
import { Button } from "@/shared/ui/button";
import { WorkAreaChannelContext } from "@/features/workarea/dock/workAreaChannelContext";
import { WorkAreaCanvasTab } from "@/features/workarea/dock/tabs/WorkAreaCanvasTab";
import { WorkAreaFilesTab } from "@/features/workarea/dock/tabs/WorkAreaFilesTab";
import { WorkAreaKnowledgeTab } from "@/features/workarea/dock/tabs/WorkAreaKnowledgeTab";
import type { WorkAreaChannel } from "@/features/workarea/dock/workAreaChannelContext";
import type { WorkAreaTab } from "@/features/workarea/dock/workAreaTypes";

import "../discovery/colony3-leads.css";
import "./MapOutreachDesk.css";

export type MapOutreachDeskView =
  | "needs-you"
  | "leads"
  | "lists"
  | "pipeline"
  | "chats"
  | "discussion"
  | "knowledge"
  | "canvas"
  | "files";

type MapOutreachDeskContextValue = {
  outlet: HTMLDivElement | null;
  setOutlet: (node: HTMLDivElement | null) => void;
};

const MapOutreachDeskContext =
  React.createContext<MapOutreachDeskContextValue | null>(null);

const MORE_VIEWS: readonly Extract<
  MapOutreachDeskView,
  "discussion" | "knowledge" | "canvas" | "files"
>[] = ["discussion", "knowledge", "canvas", "files"];

function mapOutreachDeskHref(
  view: MapOutreachDeskView,
  outreachChannelId: string | null | undefined,
): string {
  if (view === "leads") return "#/leads";
  if (view === "lists") return "#/lists";

  const tab = MORE_VIEWS.includes(view as (typeof MORE_VIEWS)[number])
    ? "discussion"
    : view;
  const workArea =
    view === "knowledge" || view === "canvas" || view === "files" ? view : null;
  const search = new URLSearchParams({ whatsappDeskTab: tab });
  if (workArea) search.set("outreachWorkArea", workArea);

  if (outreachChannelId) {
    return `#/channels/${encodeURIComponent(outreachChannelId)}?${search}`;
  }

  search.delete("whatsappDeskTab");
  search.set("outreachDeskTab", tab);
  return `#/leads?${search}`;
}

function MapOutreachDeskActionOutlet() {
  const context = React.useContext(MapOutreachDeskContext);
  if (!context) return null;
  return (
    <div className="map-outreach-desk-action-outlet" ref={context.setOutlet} />
  );
}

function MapOutreachDeskLink({
  active,
  children,
  onClick,
  outreachChannelId,
  view,
}: {
  active: MapOutreachDeskView;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  outreachChannelId: string | null | undefined;
  view: MapOutreachDeskView;
}) {
  return (
    <a
      aria-current={active === view ? "page" : undefined}
      data-map-canvas-same-desk="true"
      data-testid={`map-outreach-tab-${view}`}
      href={mapOutreachDeskHref(view, outreachChannelId)}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

/** Provides the shared map-only header action outlet to desk content. */
export function MapOutreachDeskProvider({
  children,
  enabled,
}: {
  children: React.ReactNode;
  enabled: boolean;
}) {
  const [outlet, setOutlet] = React.useState<HTMLDivElement | null>(null);
  const setOutletRef = React.useCallback((node: HTMLDivElement | null) => {
    setOutlet(node);
  }, []);
  const value = React.useMemo(
    () => (enabled ? { outlet, setOutlet: setOutletRef } : null),
    [enabled, outlet, setOutletRef],
  );

  return (
    <MapOutreachDeskContext.Provider value={value}>
      {children}
    </MapOutreachDeskContext.Provider>
  );
}

/** Renders a desk-specific control in the single shared map header. */
export function MapOutreachDeskHeaderAction({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = React.useContext(MapOutreachDeskContext);
  return context?.outlet ? createPortal(children, context.outlet) : null;
}

/** The one map-only title and pill navigation bar shared by the Outreach desk. */
export function MapOutreachDeskHeader({
  actions,
  active,
  chromeWrapperRef,
  outreachChannelId,
}: {
  actions?: React.ReactNode;
  active: MapOutreachDeskView;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  outreachChannelId?: string | null;
}) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const { href } = useLocation();
  const previousHref = React.useRef(href);
  const contactsQuery = useWhatsAppContactsQuery();
  const draftsQuery = useWhatsAppDraftsQuery();
  const batchesQuery = useWhatsAppPendingBatchDetailsQuery();
  const needsYouCount =
    getWhatsAppNeedsYouItems(contactsQuery.data ?? [], draftsQuery.data ?? [])
      .length + (batchesQuery.data?.length ?? 0);
  const chatsNeedingReplyCount = new Set([
    ...(contactsQuery.data ?? [])
      .filter((contact) => contact.unanswered)
      .map((contact) => contact.waId),
    ...(draftsQuery.data ?? []).map((draft) => draft.waId),
  ]).size;
  const moreCurrent = MORE_VIEWS.includes(
    active as (typeof MORE_VIEWS)[number],
  );

  React.useEffect(() => {
    if (previousHref.current !== href) {
      previousHref.current = href;
      setMoreOpen(false);
    }
  }, [href]);

  return (
    <div className="map-outreach-desk-header-chrome" ref={chromeWrapperRef}>
      <header
        className="map-outreach-desk-header"
        data-tauri-drag-region
        data-testid="map-outreach-desk-header"
      >
        <div className="map-outreach-desk-primary-row">
          <h1 className="map-outreach-desk-title">Outreach</h1>
          <div className="map-outreach-desk-actions">
            <UpdateIndicator />
            {actions}
            <MapOutreachDeskActionOutlet />
          </div>
        </div>
        <nav
          aria-label="Outreach views"
          className="c3l-tabs map-outreach-desk-tabs"
          data-testid="map-outreach-desk-tabs"
        >
          <MapOutreachDeskLink
            active={active}
            outreachChannelId={outreachChannelId}
            view="needs-you"
          >
            Needs you
            <span
              aria-hidden="true"
              className="map-outreach-desk-count"
              data-testid="map-outreach-needs-you-count"
            >
              {needsYouCount}
            </span>
          </MapOutreachDeskLink>
          <MapOutreachDeskLink
            active={active}
            outreachChannelId={outreachChannelId}
            view="leads"
          >
            Leads
          </MapOutreachDeskLink>
          <MapOutreachDeskLink
            active={active}
            outreachChannelId={outreachChannelId}
            view="lists"
          >
            Lists
          </MapOutreachDeskLink>
          <MapOutreachDeskLink
            active={active}
            outreachChannelId={outreachChannelId}
            view="pipeline"
          >
            Pipeline
          </MapOutreachDeskLink>
          <MapOutreachDeskLink
            active={active}
            outreachChannelId={outreachChannelId}
            view="chats"
          >
            Chats
            <span
              aria-hidden="true"
              className="map-outreach-desk-count"
              data-testid="map-outreach-chats-count"
            >
              {chatsNeedingReplyCount}
            </span>
          </MapOutreachDeskLink>
          <div className="map-outreach-desk-more">
            <button
              aria-current={moreCurrent ? "page" : undefined}
              aria-controls="map-outreach-more-menu"
              aria-expanded={moreOpen}
              data-testid="map-outreach-tab-more"
              onClick={() => setMoreOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                setMoreOpen(false);
              }}
              type="button"
            >
              More <ChevronDown aria-hidden="true" size={15} />
            </button>
            {moreOpen ? (
              <nav
                aria-label="More Outreach views"
                className="map-outreach-desk-more-menu"
                id="map-outreach-more-menu"
              >
                {MORE_VIEWS.map((view) => (
                  <MapOutreachDeskLink
                    active={active}
                    key={view}
                    onClick={() => setMoreOpen(false)}
                    outreachChannelId={outreachChannelId}
                    view={view}
                  >
                    {view.slice(0, 1).toUpperCase() + view.slice(1)}
                  </MapOutreachDeskLink>
                ))}
              </nav>
            ) : null}
          </div>
        </nav>
      </header>
    </div>
  );
}

/** Existing WhatsApp setup recovery, kept below the shared map header. */
export function MapOutreachDeskSetupState({
  connected = false,
}: {
  connected?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <main className="map-outreach-desk-setup" data-testid="map-outreach-setup">
      <h2>
        {connected ? "Outreach is not ready" : "WhatsApp is not connected"}
      </h2>
      <p>
        {connected
          ? "Set up the Outreach channel in WhatsApp settings to open Needs you, Pipeline, and Chats."
          : "Connect your WhatsApp number in Settings to open Needs you, Pipeline, and Chats."}
      </p>
      <Button
        onClick={() =>
          void navigate({ to: "/settings", search: { section: "whatsapp" } })
        }
        type="button"
      >
        Open WhatsApp settings
      </Button>
    </main>
  );
}

/**
 * Renders the More views in the desk body instead of opening the channel's
 * side dock. The map desk keeps its single window and shared header geometry
 * while still reusing the existing channel-owned view implementations.
 */
export function MapOutreachDeskWorkArea({
  channelId,
  currentPubkey,
  isArchived,
  view,
}: {
  channelId: string;
  currentPubkey: string | undefined;
  isArchived: boolean;
  view: Extract<MapOutreachDeskView, "knowledge" | "canvas" | "files">;
}) {
  const channel = React.useMemo<WorkAreaChannel>(
    () => ({
      channelId,
      channelType: "stream",
      currentPubkey,
      isArchived,
    }),
    [channelId, currentPubkey, isArchived],
  );
  const tab = React.useMemo<WorkAreaTab>(
    () => ({ id: view, kind: view }),
    [view],
  );
  const Panel =
    view === "knowledge"
      ? WorkAreaKnowledgeTab
      : view === "canvas"
        ? WorkAreaCanvasTab
        : WorkAreaFilesTab;

  return (
    <WorkAreaChannelContext.Provider value={channel}>
      <main
        className="map-outreach-desk-work-area"
        data-testid="map-outreach-work-area"
      >
        <Panel active channelId={channelId} tab={tab} tabId={tab.id} />
      </main>
    </WorkAreaChannelContext.Provider>
  );
}

/**
 * Keeps the retired business Pipeline route out of the map shell while
 * preserving its legacy-shell implementation and its established deep link.
 */
export function MapOutreachDeskPipelineRoute({
  legacy,
}: {
  legacy: React.ReactNode;
}) {
  const mapShellEnabled = useMapShellEnabled();
  const isMapCanvasNarrow = useMediaBreakpoint(701);
  if (!mapShellEnabled || isMapCanvasNarrow) return legacy;
  return <MapOutreachDeskPipelineRedirect />;
}

function MapOutreachDeskPipelineRedirect() {
  const navigate = useNavigate();
  const status = useWhatsAppStatusQuery();

  React.useEffect(() => {
    if (!status.isSuccess) return;
    const channelId = status.data.outreachChannelId;
    if (channelId) {
      void navigate({
        to: "/channels/$channelId",
        params: { channelId },
        search: { whatsappDeskTab: "pipeline" },
        replace: true,
      });
      return;
    }
    void navigate({
      to: "/leads",
      search: { outreachDeskTab: "pipeline" },
      replace: true,
    });
  }, [navigate, status.data?.outreachChannelId, status.isSuccess]);

  return (
    <main className="c3l-page map-outreach-desk-page">
      <MapOutreachDeskHeader
        active="pipeline"
        outreachChannelId={status.data?.outreachChannelId}
      />
      {status.isSuccess ? (
        <MapOutreachDeskSetupState connected={status.data.connected} />
      ) : (
        <section aria-busy="true" className="map-outreach-desk-setup">
          <h2>Loading Outreach</h2>
        </section>
      )}
    </main>
  );
}
