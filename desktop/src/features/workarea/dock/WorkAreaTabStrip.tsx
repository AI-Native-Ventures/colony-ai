import { Plus, X } from "lucide-react";
import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import {
  getWorkAreaTabDefinition,
  listOpenableWorkAreaTabs,
} from "./workAreaTabRegistry";
import type { WorkAreaTab } from "./workAreaTypes";

type WorkAreaTabStripProps = {
  tabs: readonly WorkAreaTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOpenKind: (kind: WorkAreaTab["kind"]) => void;
};

export const workAreaTabDomId = (tabId: string) => `work-area-tab-${tabId}`;
export const workAreaPanelDomId = (tabId: string) => `work-area-panel-${tabId}`;

/**
 * Tab strip with the WAI-ARIA tabs pattern: roving tabindex, Left/Right/Home/
 * End move and activate, Delete closes the focused tab. Each tab's close
 * control is a separate button with its own label, so no label has two owners.
 */
export function WorkAreaTabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onOpenKind,
}: WorkAreaTabStripProps) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>());
  const openTabIds = new Set(tabs.map((tab) => tab.id));
  const addable = listOpenableWorkAreaTabs().filter(
    (definition) => !openTabIds.has(definition.kind),
  );

  const moveTo = (tabId: string) => {
    onSelect(tabId);
    refs.current.get(tabId)?.focus();
  };

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let target: number | null = null;
    if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = tabs.length - 1;
    if (target !== null) {
      event.preventDefault();
      moveTo(tabs[target].id);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      const neighbour = tabs[index + 1] ?? tabs[index - 1];
      onClose(tabs[index].id);
      if (neighbour) {
        window.requestAnimationFrame(() =>
          refs.current.get(neighbour.id)?.focus(),
        );
      }
    }
  };

  return (
    <>
      <div
        aria-label="Work area tabs"
        className="colony-work-area-tabs"
        role="tablist"
      >
        {tabs.map((tab, index) => {
          const definition = getWorkAreaTabDefinition(tab.kind);
          const Icon = definition.icon;
          const selected = tab.id === activeTabId;
          return (
            <div
              className="colony-work-area-tab"
              data-selected={selected ? "true" : "false"}
              key={tab.id}
              role="presentation"
            >
              <button
                aria-controls={workAreaPanelDomId(tab.id)}
                aria-selected={selected}
                className="colony-work-area-tab-select"
                data-testid={`work-area-tab-${tab.id}`}
                id={workAreaTabDomId(tab.id)}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                ref={(element) => {
                  if (element) refs.current.set(tab.id, element);
                  else refs.current.delete(tab.id);
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <Icon aria-hidden="true" />
                <span>{definition.label}</span>
              </button>
              <button
                aria-label={`Close ${definition.label}`}
                className="colony-work-area-icon-button"
                data-testid={`work-area-close-tab-${tab.id}`}
                onClick={() => onClose(tab.id)}
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {addable.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Add work area tab"
              className="colony-work-area-icon-button"
              data-testid="work-area-add-tab"
              type="button"
            >
              <Plus aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {addable.map((definition) => {
              const Icon = definition.icon;
              return (
                <DropdownMenuItem
                  data-testid={`work-area-add-${definition.kind}`}
                  key={definition.kind}
                  onSelect={() => onOpenKind(definition.kind)}
                >
                  <Icon aria-hidden="true" />
                  {definition.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
