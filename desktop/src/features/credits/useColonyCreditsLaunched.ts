import { useQuery } from "@tanstack/react-query";
import { readColonyCreditsLaunched } from "./creditsGateway";

/**
 * True only once the native launch flag answered on. Loading and a failed read
 * both stay false, so onboarding and checkout never offer credits by accident.
 * Settings keeps its own Coming soon card and does not use this.
 */
export function useColonyCreditsLaunched() {
  const query = useQuery({
    queryKey: ["colony-credits-launched"],
    queryFn: () => readColonyCreditsLaunched(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return query.data === true;
}
