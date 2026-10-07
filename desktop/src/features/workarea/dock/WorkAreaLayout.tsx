import * as React from "react";

import {
  commitTerminalPanelMode,
  registerTerminalPanelHost,
} from "@/features/terminal/terminalPanelStore";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";

import { listenForFilesTab, listenForWorkspaceFiles } from "../workspaceFiles";
import {
  closeWorkAreaRestoringFocus,
  closeWorkAreaTabRestoringFocus,
  openWorkAreaFrom,
  toggleWorkAreaFrom,
} from "./workAreaActions";
import { listenForWorkAreaTabRequests } from "./workAreaRequests";
import { setWorkAreaFileReference } from "./workAreaFilesStore";
import {
  type WorkAreaChannel,
  WorkAreaChannelContext,
} from "./workAreaChannelContext";
import { getWorkAreaTabDefinition } from "./workAreaTabRegistry";
import {
  openWorkArea,
  resetWorkAreaWidth,
  selectWorkAreaTab,
  setWorkAreaWidth,
} from "./workAreaStore";
import {
  WORK_AREA_OVERLAY_BREAKPOINT_PX,
  type WorkAreaTabKind,
} from "./workAreaTypes";
import { useWorkAreaDock } from "./useWorkAreaDock";
import { WorkAreaDivider } from "./WorkAreaDivider";
import { WorkAreaPanel } from "./WorkAreaPanel";

/** True while the layout is too narrow to fit conversation and dock side by side. */
function useOverlayMode(layoutRef: React.RefObject<HTMLDivElement | null>) {
  const [overlay, setOverlay] = React.useState(false);
  React.useLayoutEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const measure = () =>
      setOverlay(element.clientWidth < WORK_AREA_OVERLAY_BREAKPOINT_PX);
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [layoutRef]);
  return overlay;
}

/**
 * Wraps a channel's conversation and hosts the work area dock beside it.
 *
 * The conversation is always the first child of the same wrapper, whether the
 * dock is open, closed or an overlay. React therefore never unmounts or
 * re-parents it when the dock changes, which is what keeps the composer draft
 * and the timeline scroll position intact.
 */
export function WorkAreaLayout({
  channelId,
  channel,
  children,
}: {
  channelId: string | null;
  /** Facts about the channel that tabs need (canvas edit rights, archive state). */
  channel?: Omit<WorkAreaChannel, "channelId">;
  children: React.ReactNode;
}) {
  const state = useWorkAreaDock(channelId);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const overlay = useOverlayMode(layoutRef);
  const relayOrigin = useRelayOrigin();

  const tabs = React.useMemo(
    () =>
      state.tabs.filter((tab) => getWorkAreaTabDefinition(tab.kind).available),
    [state.tabs],
  );
  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : (tabs[0]?.id ?? null);
  const openChannelId = state.open ? channelId : null;
  const open = openChannelId !== null;
  const activeKind = tabs.find((tab) => tab.id === activeTabId)?.kind;
  const terminalVisible = open && activeKind === "terminal";

  // The terminal's visibility is derived from the dock and nothing else. A
  // layout effect, so the store is already correct when the terminal's own
  // effects run in the same commit (no PTY is spawned for a hidden tab).
  React.useLayoutEffect(() => {
    commitTerminalPanelMode(
      terminalVisible ? "docked" : "closed",
      terminalVisible ? channelId : null,
    );
  }, [terminalVisible, channelId]);
  const channelIdRef = React.useRef(channelId);
  channelIdRef.current = channelId;
  React.useEffect(() => {
    const unregister = registerTerminalPanelHost({
      request: (mode) => {
        const current = channelIdRef.current;
        if (!current) return;
        if (mode === "closed") closeWorkAreaRestoringFocus(current);
        else openWorkAreaFrom(current, "terminal", document.activeElement);
      },
    });
    return () => {
      unregister();
      commitTerminalPanelMode("closed");
    };
  }, []);

  // File links in messages and the channel's Files tab open the Files tab.
  React.useEffect(
    () =>
      listenForWorkspaceFiles((reference) => {
        if (!channelId || reference.expectedRelayUrl !== relayOrigin) return;
        setWorkAreaFileReference(channelId, reference);
        openWorkAreaFrom(channelId, "files", document.activeElement);
      }),
    [channelId, relayOrigin],
  );
  React.useEffect(
    () =>
      listenForFilesTab(() => {
        if (channelId) {
          openWorkAreaFrom(channelId, "files", document.activeElement);
        }
      }),
    [channelId],
  );

  // Controls outside the dock (the channel's Canvas label) ask for a tab.
  React.useEffect(
    () =>
      listenForWorkAreaTabRequests((kind) => {
        if (channelId) {
          openWorkAreaFrom(channelId, kind, document.activeElement);
        }
      }),
    [channelId],
  );

  // Cmd/Ctrl+\ toggles the dock. Shift, Alt and the other platform's modifier
  // are deliberately not this shortcut.
  React.useEffect(() => {
    if (!channelId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.shiftKey ||
        event.altKey ||
        !hasPrimaryShortcutModifier(event) ||
        !(event.key === "\\" || event.code === "Backslash")
      ) {
        return;
      }
      event.preventDefault();
      toggleWorkAreaFrom(channelId, document.activeElement);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [channelId]);

  // Opening a tab from inside the dock (menu, empty state) keeps focus where
  // the user's own action put it.
  const channelType = channel?.channelType;
  const isArchived = channel?.isArchived;
  const currentPubkey = channel?.currentPubkey;
  const channelContext = React.useMemo<WorkAreaChannel | null>(
    () =>
      channelId && channelType !== undefined
        ? {
            channelId,
            channelType,
            isArchived: isArchived ?? false,
            currentPubkey,
          }
        : null,
    [channelId, channelType, isArchived, currentPubkey],
  );
  const openKind = React.useCallback(
    (kind: WorkAreaTabKind) => {
      if (channelId) openWorkArea(channelId, kind);
    },
    [channelId],
  );

  return (
    <div
      className="colony-work-area-layout"
      data-open={open ? "true" : "false"}
      data-overlay={overlay ? "true" : "false"}
      data-testid="work-area-layout"
      ref={layoutRef}
      style={
        {
          "--colony-work-area-size": `${state.width}%`,
        } as React.CSSProperties
      }
    >
      <div
        className="colony-work-area-conversation"
        data-testid="work-area-conversation"
      >
        {children}
      </div>
      {openChannelId !== null && !overlay ? (
        <WorkAreaDivider
          layoutRef={layoutRef}
          onClose={() => closeWorkAreaRestoringFocus(openChannelId)}
          onReset={() => resetWorkAreaWidth(openChannelId)}
          onResize={(width) => setWorkAreaWidth(openChannelId, width)}
          width={state.width}
        />
      ) : null}
      {openChannelId !== null ? (
        <WorkAreaChannelContext.Provider value={channelContext}>
          <WorkAreaPanel
            activeTabId={activeTabId}
            channelId={openChannelId}
            onClose={() => closeWorkAreaRestoringFocus(openChannelId)}
            onCloseTab={(tabId) =>
              closeWorkAreaTabRestoringFocus(openChannelId, tabId)
            }
            onOpenKind={openKind}
            onSelect={(tabId) => selectWorkAreaTab(openChannelId, tabId)}
            tabs={tabs}
          />
        </WorkAreaChannelContext.Provider>
      ) : null}
    </div>
  );
}
