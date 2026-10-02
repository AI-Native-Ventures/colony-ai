import { Search } from "lucide-react";

import type { PulseTab } from "@/features/pulse/ui/PulseView";
import type { RelayAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

type PulseTabBarProps = {
  activeTab: PulseTab;
  getPanelId: (tab: PulseTab) => string;
  getTabId: (tab: PulseTab) => string;
  layout: "legacy" | "today-updates";
  relayAgents: RelayAgent[];
  onTabChange: (tab: PulseTab) => void;
};

const tabButtonClassName =
  "h-7 rounded-full border border-transparent px-1.5 text-2xs font-medium text-muted-foreground data-[active=true]:border-border/70 data-[active=true]:bg-background/80 data-[active=true]:text-foreground data-[active=true]:shadow-xs data-[active=true]:backdrop-blur-sm";

export function PulseTabBar({
  activeTab,
  getPanelId,
  getTabId,
  layout,
  relayAgents,
  onTabChange,
}: PulseTabBarProps) {
  return (
    <div
      className={`relative z-40 shrink-0 ${layout === "today-updates" ? "px-0 pt-0" : "px-4 pt-4 sm:px-6"}`}
      data-pulse-tab-layout={layout}
    >
      <div
        className={`relative mx-auto flex w-full items-center ${layout === "today-updates" ? "max-w-none justify-start" : "max-w-2xl justify-center"}`}
      >
        <div className="min-w-0 max-w-full">
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div
              aria-label="Pulse sections"
              className="flex items-center gap-1"
              role="tablist"
            >
              {layout === "today-updates" ? (
                (
                  [
                    ["everyone", "All"],
                    ["people", "Following"],
                    ["people-only", "People"],
                    ["agents", "Agents"],
                  ] as const
                ).map(([tab, label]) => (
                  <Button
                    aria-controls={getPanelId(tab)}
                    aria-selected={activeTab === tab}
                    className={tabButtonClassName}
                    data-active={activeTab === tab}
                    id={getTabId(tab)}
                    key={tab}
                    onClick={() => onTabChange(tab)}
                    role="tab"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {label}
                  </Button>
                ))
              ) : (
                <>
                  <Button
                    aria-controls={getPanelId("search")}
                    aria-label="Search Pulse"
                    aria-selected={activeTab === "search"}
                    className="h-7 w-7 shrink-0 rounded-full border border-transparent p-0 text-muted-foreground data-[active=true]:border-border/70 data-[active=true]:bg-background/80 data-[active=true]:text-foreground data-[active=true]:shadow-xs data-[active=true]:backdrop-blur-sm"
                    data-active={activeTab === "search"}
                    id={getTabId("search")}
                    onClick={() => onTabChange("search")}
                    role="tab"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-controls={getPanelId("everyone")}
                    aria-selected={activeTab === "everyone"}
                    className={tabButtonClassName}
                    data-active={activeTab === "everyone"}
                    id={getTabId("everyone")}
                    onClick={() => onTabChange("everyone")}
                    role="tab"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Everyone
                  </Button>
                  <Button
                    aria-controls={getPanelId("people")}
                    aria-selected={activeTab === "people"}
                    className={tabButtonClassName}
                    data-active={activeTab === "people"}
                    id={getTabId("people")}
                    onClick={() => onTabChange("people")}
                    role="tab"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Following
                  </Button>
                  <Button
                    aria-controls={getPanelId("liked")}
                    aria-selected={activeTab === "liked"}
                    className={tabButtonClassName}
                    data-active={activeTab === "liked"}
                    id={getTabId("liked")}
                    onClick={() => onTabChange("liked")}
                    role="tab"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Liked
                  </Button>
                  <Button
                    aria-controls={getPanelId("agents")}
                    aria-selected={activeTab === "agents"}
                    className={tabButtonClassName}
                    data-active={activeTab === "agents"}
                    id={getTabId("agents")}
                    onClick={() => onTabChange("agents")}
                    role="tab"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Agents
                    {relayAgents.length > 0 ? (
                      <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-2xs font-medium text-muted-foreground">
                        {relayAgents.length}
                      </span>
                    ) : null}
                  </Button>
                  <Button
                    aria-controls={getPanelId("mine")}
                    aria-selected={activeTab === "mine"}
                    className={tabButtonClassName}
                    data-active={activeTab === "mine"}
                    id={getTabId("mine")}
                    onClick={() => onTabChange("mine")}
                    role="tab"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Mine
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
