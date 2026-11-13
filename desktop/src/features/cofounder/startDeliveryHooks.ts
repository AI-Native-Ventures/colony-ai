import { useEffect, useMemo, useState } from "react";

import { usePlaybooksQuery } from "./playbookHooks";
import {
  eligibleStartDeliveryPlaybooks,
  hasRunningJobForClient,
} from "./startDelivery";

export function useStartDelivery(clientName: string, permitted: boolean) {
  const query = usePlaybooksQuery(permitted);
  const eligiblePlaybooks = useMemo(
    () => eligibleStartDeliveryPlaybooks(query.data?.playbooks ?? []),
    [query.data?.playbooks],
  );
  const alreadyRunning = useMemo(
    () => hasRunningJobForClient(query.data?.jobs ?? [], clientName),
    [clientName, query.data?.jobs],
  );
  const canOffer =
    permitted &&
    Boolean(clientName.trim()) &&
    query.isSuccess &&
    eligiblePlaybooks.length > 0 &&
    !alreadyRunning;
  const [isOpen, setIsOpen] = useState(false);
  const [promptAfterConversion, setPromptAfterConversion] = useState(false);

  useEffect(() => {
    if (!promptAfterConversion || query.isPending) return;
    setPromptAfterConversion(false);
    if (canOffer) setIsOpen(true);
  }, [canOffer, promptAfterConversion, query.isPending]);

  function requestAfterConversion() {
    if (permitted) setPromptAfterConversion(true);
  }

  return {
    canOffer,
    eligiblePlaybooks,
    isOpen,
    requestAfterConversion,
    setIsOpen,
  };
}
