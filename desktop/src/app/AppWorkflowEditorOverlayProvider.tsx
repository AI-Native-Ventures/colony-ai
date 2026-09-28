import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { WorkflowEditorOverlayProvider } from "@/shared/context/WorkflowEditorOverlayContext";
import type { Workflow } from "@/shared/api/types";

/** Routes every workflow entry point through the versioned Workflows screens. */
export function AppWorkflowEditorOverlayProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { goNewPlainWorkflow, goNewWorkflowForChannel, goWorkflow } =
    useAppNavigation();

  const openNewWorkflow = React.useCallback(
    (channelId?: string) => {
      if (channelId) void goNewWorkflowForChannel(channelId);
      else void goNewPlainWorkflow();
    },
    [goNewPlainWorkflow, goNewWorkflowForChannel],
  );

  const openWorkflow = React.useCallback(
    (workflowId: string, _workflow?: Workflow) => {
      void goWorkflow(workflowId);
    },
    [goWorkflow],
  );

  return (
    <WorkflowEditorOverlayProvider
      onOpenNewWorkflow={openNewWorkflow}
      onOpenWorkflow={openWorkflow}
    >
      {children}
    </WorkflowEditorOverlayProvider>
  );
}
