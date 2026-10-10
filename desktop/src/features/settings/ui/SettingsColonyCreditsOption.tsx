import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAcpRuntimesQueryForced } from "@/features/agents/acpRuntimesQuery";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { ColonyCreditsOption } from "@/features/onboarding/ui/ColonyCreditsOption";
import {
  runOnboardingConnectionTest,
  cancelOnboardingConnectionTest,
} from "@/features/onboarding/ui/onboardingConnectionTest";
import { resolveAgentPrerequisiteReadiness } from "@/features/onboarding/ui/agentReadiness";
import { useGitBashPrerequisiteQuery } from "@/features/agents/hooks";

/** A settings selection is a real bounded proof followed by one atomic save. */
export function SettingsColonyCreditsOption({
  communityId,
  selected,
  onSaved,
}: {
  communityId: string;
  selected: boolean;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const runtimes = useAcpRuntimesQueryForced();
  const prerequisite = useGitBashPrerequisiteQuery();
  const generation = React.useRef(0);
  const [confirmed, setConfirmed] = React.useState(false);
  React.useEffect(
    () => () => {
      generation.current += 1;
      void cancelOnboardingConnectionTest().catch(console.warn);
    },
    [],
  );
  const bundled = runtimes.data?.find((runtime) => runtime.id === "buzz-agent");
  const ready =
    bundled?.availability === "available" &&
    !!bundled.command &&
    !!bundled.binaryPath &&
    resolveAgentPrerequisiteReadiness(
      "buzz-agent",
      prerequisite.isError ? undefined : prerequisite.data,
    ).ready;
  return (
    <div className="colony-credits-settings">
      <ColonyCreditsOption
        communityId={communityId}
        selected={selected}
        canSelect={ready}
        onSelect={async (candidate) => {
          const attempt = ++generation.current;
          setConfirmed(false);
          const result = await runOnboardingConnectionTest(
            candidate,
            () => generation.current === attempt,
          );
          if (generation.current !== attempt) return;
          client.setQueryData(globalAgentConfigQueryKey, result.config);
          setConfirmed(true);
          onSaved();
        }}
      />
      {confirmed && selected ? (
        <p className="mt-2 text-sm" role="status">
          Colony Agent replied. Colony credits saved as your connection.
        </p>
      ) : null}
    </div>
  );
}
