import { BookOpen, Folder, Globe } from "lucide-react";
import type * as React from "react";

import { isBrowserHostAvailable } from "@/shared/api/browserHost";

import {
  browserTabLabels,
  closeBrowserTab,
  newBrowserTabId,
} from "../browser/browserTabKind";
import {
  CanvasTabIcon,
  FileTabIcon,
  TerminalTabIcon,
  type WorkAreaTabIcon,
} from "./workAreaIcons";
import { workAreaFileName } from "./workAreaFileTab";
import { WorkAreaBrowserTab } from "./tabs/WorkAreaBrowserTab";
import { WorkAreaCanvasTab } from "./tabs/WorkAreaCanvasTab";
import { WorkAreaFileTab } from "./tabs/WorkAreaFileTab";
import { WorkAreaFilesTab } from "./tabs/WorkAreaFilesTab";
import { WorkAreaKnowledgeTab } from "./tabs/WorkAreaKnowledgeTab";
import { WorkAreaTerminalTab } from "./tabs/WorkAreaTerminalTab";
import type { WorkAreaTab, WorkAreaTabKind } from "./workAreaTypes";

export type WorkAreaTabPanelProps = {
  channelId: string;
  /** This tab's id: the kind for a singleton, `kind:<key>` for a kind opened often. */
  tabId: string;
  /** True while this tab is the one on screen. Panels stay mounted when not. */
  active: boolean;
};

export type WorkAreaTabDefinition = {
  kind: WorkAreaTabKind;
  /** Shown on the tab, in the add menu and as the panel's accessible name. */
  label: string;
  icon: WorkAreaTabIcon;
  /**
   * Offered by the add menu and the empty state, and shown if remembered. False
   * when the tab cannot work in this runtime (the browser needs the desktop
   * host, and is off under its kill switch).
   */
  readonly available: boolean;
  /**
   * Kinds that may be open several times in one channel (browser pages). The
   * add menu always offers them, and `newTabId` mints each one's id.
   */
  readonly multiple?: boolean;
  /** Prepare a new tab of a `multiple` kind and return its id; null if it cannot be made. */
  readonly newTabId?: (channelId: string) => string | null;
  /** The person closed one of these tabs: release what it held. */
  readonly onTabClosed?: (channelId: string, tab: WorkAreaTab) => void;
  /**
   * Left out of the add menu and the empty state: the tab is only ever opened
   * by what it shows (a file tab opens from a file link or the Files list).
   */
  readonly hiddenFromMenu?: boolean;
  /** A small count after the label (the Work tab's open work), read live. */
  readonly Badge?: React.ComponentType<{ channelId: string; id?: string }>;
  /** A tab's own label (a page's title) instead of the kind's `label`. */
  readonly tabLabels?: {
    subscribe: (listener: () => void) => () => void;
    get: (tab: WorkAreaTab) => string;
  };
  Panel: React.ComponentType<WorkAreaTabPanelProps>;
};

/**
 * The typed registry. `Record<WorkAreaTabKind, ...>` makes the compiler demand
 * a definition for every kind in `workAreaTypes.ts`. Object order is the order
 * of the add menu and the empty state, as in the r15 reference (Browser first).
 */
const DEFINITIONS: Record<WorkAreaTabKind, WorkAreaTabDefinition> = {
  browser: {
    kind: "browser",
    label: "Browser",
    icon: Globe,
    get available() {
      return isBrowserHostAvailable();
    },
    multiple: true,
    newTabId: newBrowserTabId,
    onTabClosed: closeBrowserTab,
    tabLabels: browserTabLabels,
    Panel: WorkAreaBrowserTab,
  },
  terminal: {
    kind: "terminal",
    label: "Terminal",
    icon: TerminalTabIcon,
    available: true,
    Panel: WorkAreaTerminalTab,
  },
  files: {
    kind: "files",
    label: "Files",
    icon: Folder,
    available: true,
    Panel: WorkAreaFilesTab,
  },
  file: {
    kind: "file",
    label: "File",
    icon: FileTabIcon,
    available: true,
    hiddenFromMenu: true,
    tabLabels: {
      subscribe: () => () => {},
      get: (tab) => (tab.file ? workAreaFileName(tab.file.path) : "File"),
    },
    Panel: WorkAreaFileTab,
  },
  canvas: {
    kind: "canvas",
    label: "Canvas",
    icon: CanvasTabIcon,
    available: true,
    Panel: WorkAreaCanvasTab,
  },
  knowledge: {
    kind: "knowledge",
    label: "Knowledge",
    icon: BookOpen,
    available: true,
    Panel: WorkAreaKnowledgeTab,
  },
};

export function getWorkAreaTabDefinition(
  kind: WorkAreaTabKind,
): WorkAreaTabDefinition {
  return DEFINITIONS[kind];
}

/** Definitions the user can open, in menu order. */
export function listOpenableWorkAreaTabs(): WorkAreaTabDefinition[] {
  return Object.values(DEFINITIONS).filter(
    (definition) => definition.available && !definition.hiddenFromMenu,
  );
}
