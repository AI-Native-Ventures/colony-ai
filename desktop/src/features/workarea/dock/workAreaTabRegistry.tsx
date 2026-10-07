import {
  FileText,
  Pencil,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type * as React from "react";

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
  /** Offered by the add menu and the empty state. False until its content ships. */
  available: boolean;
  Panel: React.ComponentType<WorkAreaTabPanelProps>;
};

/**
 * The typed registry. `Record<WorkAreaTabKind, ...>` makes the compiler demand
 * a definition for every kind in `workAreaTypes.ts`.
 *
 * EXTENSION POINT (phase 3, browser tab): add the kind in `workAreaTypes.ts`,
 * add its definition here, and nothing else in the dock changes.
 */
const DEFINITIONS: Record<WorkAreaTabKind, WorkAreaTabDefinition> = {
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
