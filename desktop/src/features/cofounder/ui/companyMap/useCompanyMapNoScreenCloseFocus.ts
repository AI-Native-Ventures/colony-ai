import { useEffect, useRef } from "react";

import type { FunctionId } from "@/features/cofounder/cofounderRecords";
import {
  companyMapJobKey,
  isCompanyMapNoScreenWindowJob,
  type CompanyMapWindowJob,
} from "@/features/cofounder/companyMapJobRoutes";

type PendingFocus = { functionId: FunctionId; jobKey: string };

/** Restores a no-screen card's origin job after the persistent map window closes. */
export function useCompanyMapNoScreenCloseFocus({
  activePart,
  clearOpenPart,
  focusPart,
  mapWindowJob,
}: {
  activePart: FunctionId | null;
  clearOpenPart: () => void;
  focusPart: (functionId: FunctionId) => void;
  mapWindowJob: CompanyMapWindowJob | null;
}) {
  const previousMapWindowJob = useRef(mapWindowJob);
  const pendingFocus = useRef<PendingFocus | null>(null);

  useEffect(() => {
    const previousJob = previousMapWindowJob.current;
    previousMapWindowJob.current = mapWindowJob;
    if (!previousJob || mapWindowJob) return;
    if (!isCompanyMapNoScreenWindowJob(previousJob)) {
      clearOpenPart();
      return;
    }
    pendingFocus.current = {
      functionId: previousJob.functionId,
      jobKey: companyMapJobKey(previousJob.functionId, previousJob.jobName),
    };
    focusPart(previousJob.functionId);
  }, [clearOpenPart, focusPart, mapWindowJob]);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || mapWindowJob || activePart !== pending.functionId) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-job="${pending.jobKey}"]`)
        ?.focus();
      pendingFocus.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePart, mapWindowJob]);
}
