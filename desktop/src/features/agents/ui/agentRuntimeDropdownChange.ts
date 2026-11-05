import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import {
  runtimeDropdownAction,
  type RuntimeDropdownAction,
} from "./addCustomHarness";
import { runtimeSupportsLlmProviderSelection } from "./agentConfigOptions";
import {
  selectionOnRuntimeChange,
  type RuntimeModelProviderSelection,
} from "./runtimeModelProviderSelection";

/** Apply the edit dialog's harness selection and its provider/model reset. */
export function applyAgentRuntimeDropdownChange(
  nextValue: string,
  options: {
    applySelection: (selection: RuntimeModelProviderSelection) => void;
    effortTouched: MutableRefObject<boolean>;
    runtimes: AcpRuntimeCatalogEntry[];
    selectedRuntimeId: string;
    selection: RuntimeModelProviderSelection;
    setAgentArgs: Dispatch<SetStateAction<string>>;
    setAgentCommand: Dispatch<SetStateAction<string>>;
    setEffortLevel: Dispatch<SetStateAction<string | null>>;
    setInheritHarness: Dispatch<SetStateAction<boolean>>;
    setIsAddHarnessOpen: Dispatch<SetStateAction<boolean>>;
    setSelectedRuntimeId: Dispatch<SetStateAction<string>>;
    runtimeTouched: MutableRefObject<boolean>;
  },
) {
  const action: RuntimeDropdownAction = runtimeDropdownAction(nextValue);
  if (action.kind === "add-custom-harness") {
    options.setIsAddHarnessOpen(true);
    return;
  }

  const nextRuntimeId = action.runtimeId;
  const nextRuntime = options.runtimes.find(
    (runtime) => runtime.id === nextRuntimeId,
  );
  options.runtimeTouched.current = true;
  const resolvedRuntimeId = nextRuntimeId || "custom";
  options.setSelectedRuntimeId(resolvedRuntimeId);
  options.effortTouched.current = false;
  options.setEffortLevel(null);

  // An unavailable but installable catalog entry can supply its command after
  // setup, so selecting it must pin the harness and stop inheriting the persona.
  if (
    resolvedRuntimeId === "custom" ||
    nextRuntime?.command ||
    nextRuntime?.canAutoInstall
  ) {
    options.setInheritHarness(false);
  }

  if (nextRuntime?.command) {
    options.setAgentCommand(nextRuntime.command);
    options.setAgentArgs(nextRuntime.defaultArgs.join(","));
  }

  options.applySelection(
    selectionOnRuntimeChange(options.selection, {
      previousRuntime: options.selectedRuntimeId,
      nextRuntime: nextRuntime?.id ?? nextRuntimeId,
      nextRuntimeCanChooseProvider: runtimeSupportsLlmProviderSelection(
        nextRuntime?.id ?? nextRuntimeId,
      ),
      lockedRuntimeReset: "full",
    }),
  );
}
