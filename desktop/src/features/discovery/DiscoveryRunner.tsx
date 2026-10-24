import * as React from "react";

import { useIdentityQuery } from "@/shared/api/hooks";
import { useProfileQuery, useUsersBatchQuery } from "@/features/profile/hooks";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import type { DiscoveryRunner } from "./discoveryProvider";

/** What the relay knows about whoever ran a search. */
export function useRunnerProfile(runner: DiscoveryRunner | null | undefined) {
  const pubkey = runner?.pubkey ?? null;
  const batch = useUsersBatchQuery(pubkey ? [pubkey] : [], {
    enabled: Boolean(pubkey),
  });
  const profile = pubkey ? batch.data?.profiles[pubkey.toLowerCase()] : null;
  return {
    avatarUrl: profile?.avatarUrl ?? null,
    isAgent: profile?.isAgent === true,
  };
}

/**
 * Round for a person, the agent's own squircle picture for an agent: agents
 * are not hexagons in Colony 3.0 (owner decision A2). `size` is in design
 * pixels.
 */
export function RunnerAvatar({
  runner,
  size,
}: {
  runner: DiscoveryRunner;
  size: number;
}) {
  const profile = useRunnerProfile(runner);
  const length = `${size / 16}rem`;
  return (
    <span
      className="c3d-avatar"
      data-testid="discovery-runner-avatar"
      style={{ width: length, height: length }}
    >
      <UserAvatar
        avatarUrl={profile.avatarUrl}
        className="h-full w-full"
        displayName={runner.name}
        shape={profile.isAgent ? "squircle" : "circle"}
      />
    </span>
  );
}

/** The signed-in person, as the runner of a search they are about to start. */
export function useCurrentRunner(): DiscoveryRunner | null {
  const identity = useIdentityQuery();
  const profile = useProfileQuery();
  return React.useMemo(() => {
    const pubkey = identity.data?.pubkey ?? null;
    const name = profile.data?.displayName?.trim();
    if (!name) return null;
    return { name, pubkey };
  }, [identity.data?.pubkey, profile.data?.displayName]);
}

/** A name's first word, for "Discuss with Aya" style labels. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
