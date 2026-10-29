import { UserAvatar } from "@/shared/ui/UserAvatar";
import { employeeAvatarSource } from "../employeePresentation";

/** Employee artwork with the frozen Scout ant as the built-in identity fallback. */
export function EmployeeAvatar({
  name,
  profile,
  instance,
  definition,
  role,
  personaId,
  className,
  testId,
}: {
  name: string;
  profile?: string | null;
  instance?: string | null;
  definition?: string | null;
  role?: string | null;
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
        role,
      })}
      displayName={name}
      className={className}
      testId={testId}
      shape="squircle"
      fallbackVariant="muted"
    />
  );
}
