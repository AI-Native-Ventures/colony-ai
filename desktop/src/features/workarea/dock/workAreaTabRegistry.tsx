import {
  FileText,
  Globe,
  Pencil,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type * as React from "react";

import { isBrowserHostAvailable } from "@/shared/api/browserHost";

import { WorkAreaBrowserTab } from "./tabs/WorkAreaBrowserTab";
import { WorkAreaCanvasTab } from "./tabs/WorkAreaCanvasTab";
import { WorkAreaFilesTab } from "./tabs/WorkAreaFilesTab";
import { WorkAreaTerminalTab } from "./tabs/WorkAreaTerminalTab";
import type { WorkAreaTabKind } from "./workAreaTypes";

export type WorkAreaTabPanelProps = {
  channelId: string;
  /** True while this tab is the one on screen. Panels stay mounted when not. */
  active: boolean;
};

export type WorkAreaTabDefinition = {
  kind: WorkAreaTabKind;
  /** Shown on the tab, in the add menu and as the panel's accessible name. */
  label: string;
  icon: LucideIcon;
  /**
   * Offered by the add menu and the empty state, and shown if remembered. False
   * when the tab cannot work in this runtime (the browser needs the desktop
   * host, and is off under its kill switch).
   */
  readonly available: boolean;
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
    Panel: WorkAreaBrowserTab,
  },
  terminal: {
    kind: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
    available: true,
    Panel: WorkAreaTerminalTab,
  },
  files: {
    kind: "files",
    label: "Files",
    icon: FileText,
    available: true,
    Panel: WorkAreaFilesTab,
  },
  canvas: {
    kind: "canvas",
    label: "Canvas",
    icon: Pencil,
    available: true,
    Panel: WorkAreaCanvasTab,
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
    (definition) => definition.available,
  );
}
