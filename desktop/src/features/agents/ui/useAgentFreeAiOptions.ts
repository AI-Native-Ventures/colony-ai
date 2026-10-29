import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { readConfiguredFreeAiModels } from "@/features/credits/creditsGateway";
import type { PersonaModelOption } from "./agentConfigOptions";

export function useAgentFreeAiModels({
  agentPubkey,
  open,
  runtimeId,
  provider,
  model,
  setModel,
}: {
  agentPubkey: string;
  open: boolean;
  runtimeId: string;
  provider: string;
  model: string;
  setModel: React.Dispatch<React.SetStateAction<string>>;
}) {
  const isColonyFreeAi = provider.trim() === "colony-credits";
  const freeModelsQuery = useQuery({
    queryKey: ["credits-gateway-free-models", agentPubkey],
    queryFn: () => readConfiguredFreeAiModels(),
    enabled: open && runtimeId === "buzz-agent",
    retry: false,
    staleTime: 30_000,
  });
  const freeModels = freeModelsQuery.data ?? [];

  React.useEffect(() => {
    if (
      isColonyFreeAi &&
      freeModels.length > 0 &&
      !freeModels.includes(model.trim())
    ) {
      setModel(freeModels[0]);
    }
  }, [freeModels, isColonyFreeAi, model, setModel]);

  return { freeModels, freeModelsQuery, isColonyFreeAi };
}

export function providerOptionsWithFreeAi(
  options: readonly PersonaModelOption[],
  runtimeId: string,
  freeModels: readonly string[],
): readonly PersonaModelOption[] {
  if (
    runtimeId !== "buzz-agent" ||
    freeModels.length === 0 ||
    options.some((option) => option.id === "colony-credits")
  ) {
    return options;
  }
  return [...options, { id: "colony-credits", label: "Colony free AI" }];
}
