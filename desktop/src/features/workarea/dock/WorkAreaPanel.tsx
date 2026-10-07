import { X } from "lucide-react";

import { isBrowserHostAvailable } from "@/shared/api/browserHost";

import {
  getWorkAreaTabDefinition,
  listOpenableWorkAreaTabs,
} from "./workAreaTabRegistry";
import {
  workAreaPanelDomId,
  workAreaTabDomId,
  WorkAreaTabStrip,
} from "./WorkAreaTabStrip";
import type { WorkAreaTab, WorkAreaTabKind } from "./workAreaTypes";

export const WORK_AREA_PANEL_ID = "colony-work-area-panel";

type WorkAreaPanelProps = {
  channelId: string;
  tabs: readonly WorkAreaTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenKind: (kind: WorkAreaTabKind) => void;
  onClose: () => void;
};

/** The dock itself: header (tabs and actions) over the active tab's panel. */
export function WorkAreaPanel({
  channelId,
  tabs,
  activeTabId,
  onSelect,
  onCloseTab,
  onOpenKind,
  onClose,
}: WorkAreaPanelProps) {
  const onHeaderKeyDown = (event: React.KeyboardEvent) => {
    // Escape from the header closes the dock. It is deliberately not handled
    // in the content: a terminal or an editor in a tab owns its own Escape.
    if (
      event.key === "Escape" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.defaultPrevented &&
      !(event.target as HTMLElement).closest('[role="menu"]')
    ) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <aside
      aria-label="Work area"
      className="colony-work-area-panel"
      data-testid="work-area-panel"
      id={WORK_AREA_PANEL_ID}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: forwards Escape from the header's own controls. */}
      <header className="colony-work-area-head" onKeyDown={onHeaderKeyDown}>
        <WorkAreaTabStrip
          activeTabId={activeTabId}
          onClose={onCloseTab}
          onOpenKind={onOpenKind}
          onSelect={onSelect}
          tabs={tabs}
        />
        <div className="colony-work-area-actions">
          <button
            aria-label="Close work area"
            className="colony-work-area-icon-button"
            data-testid="work-area-close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="colony-work-area-body">
        {tabs.length === 0 ? (
          <div className="colony-work-area-empty" data-testid="work-area-empty">
            <h2>Keep the work beside the conversation.</h2>
            <p>
              {isBrowserHostAvailable()
                ? "Open a page, inspect a file, or open a terminal."
                : "Open a terminal or inspect a file."}
            </p>
            <div className="colony-work-area-choices">
              {listOpenableWorkAreaTabs().map((definition) => {
                const Icon = definition.icon;
                return (
                  <button
                    className="colony-work-area-choice"
                    data-testid={`work-area-open-${definition.kind}`}
                    key={definition.kind}
                    onClick={() => onOpenKind(definition.kind)}
                    type="button"
                  >
                    <Icon aria-hidden="true" />
                    {definition.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {tabs.map((tab) => {
          const definition = getWorkAreaTabDefinition(tab.kind);
          const active = tab.id === activeTabId;
          return (
            <section
              aria-labelledby={workAreaTabDomId(tab.id)}
              className="colony-work-area-tabpanel"
              hidden={!active}
              id={workAreaPanelDomId(tab.id)}
              key={tab.id}
              role="tabpanel"
            >
              <definition.Panel active={active} channelId={channelId} />
            </section>
          );
        })}
      </div>
    </aside>
  );
}
