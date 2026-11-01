import { UserAvatar } from "@/shared/ui/UserAvatar";
import { useManagedAgentAvatarUrl } from "@/features/agents/useKnownAgentPubkeys";
import { employeeAvatarSource } from "../employeePresentation";

/** Employee artwork with the frozen Scout ant as the built-in identity fallback. */
export function EmployeeAvatar({
  name,
  pubkey,
  profile,
  instance,
  definition,
  role,
  personaId,
  className,
  testId,
}: {
  name: string;
  pubkey?: string | null;
  profile?: string | null;
  instance?: string | null;
  definition?: string | null;
  role?: string | null;
  personaId?: string | null;
  className?: string;
  testId?: string;
}) {
  const managedAgentAvatarUrl = useManagedAgentAvatarUrl(pubkey);
  return (
    <UserAvatar
      avatarUrl={employeeAvatarSource({
        name,
        profile,
        instance,
        managedAgent: managedAgentAvatarUrl,
        definition,
        personaId,
        role,
      })}
      displayName={name}
      pubkey={pubkey}
      className={className}
      testId={testId}
      shape="squircle"
      fallbackVariant="muted"
    />
  );
}
