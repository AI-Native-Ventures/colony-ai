import { useFactoryRunRecordQuery } from "@/features/factory/lib/factoryRunRecords";
import type { FactoryRun } from "@/shared/api/factoryRuntime";
import { FactoryPreviewPane } from "./FactoryPreviewPane";
import { FactoryReviewPane } from "./FactoryReviewPane";

export type FactoryRunTool = "agent" | "preview" | "review";

export function FactoryRunToolPane({
  onOpenAgent,
  run,
  tool,
}: {
  onOpenAgent: () => void;
  run: FactoryRun;
  tool: Exclude<FactoryRunTool, "agent">;
}) {
  const recordQuery = useFactoryRunRecordQuery(run.id);

  if (recordQuery.isPending) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading Factory run details"
        className="fx-run-tool-loading"
        role="status"
      />
    );
  }
  if (recordQuery.error) {
    return (
      <div className="fx-run-tool-surface fx-run-tool-error" role="alert">
        <span>{recordQuery.error.message}</span>
        <button
          className="fx-button"
          onClick={() => void recordQuery.refetch()}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  return tool === "preview" ? (
    <FactoryPreviewPane record={recordQuery.data} run={run} />
  ) : (
    <FactoryReviewPane
      onOpenAgent={onOpenAgent}
      record={recordQuery.data}
      run={run}
    />
  );
}
