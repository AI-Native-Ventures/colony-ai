import { ColonyAntAvatar } from "@/shared/ui/ColonyAntAvatar";

/** Keep every employee visibly an ant in the approved Colony UI. */
export function EmployeeAvatar({
  name,
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
  return <ColonyAntAvatar className={className} name={name} testId={testId} />;
}
