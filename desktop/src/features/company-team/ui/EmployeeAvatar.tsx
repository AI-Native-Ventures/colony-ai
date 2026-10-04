import scoutArt from "@/features/onboarding/assets/scout.svg";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { employeeAvatarSource } from "../employeePresentation";

/** Employee artwork with the frozen Scout ant as the built-in identity fallback. */
export function EmployeeAvatar({
  name,
  profile,
  instance,
  definition,
  personaId,
  className,
  testId,
}: {
  name: string;
  profile?: string | null;
  instance?: string | null;
  definition?: string | null;
  personaId?: string | null;
  className?: string;
  testId?: string;
}) {
  return (
    <UserAvatar
      avatarUrl={employeeAvatarSource({
        name,
        profile,
        instance,
        definition,
        personaId,
        scoutArt,
      })}
      displayName={name}
      className={className}
      testId={testId}
      shape="squircle"
      fallbackVariant="muted"
    />
  );
}
