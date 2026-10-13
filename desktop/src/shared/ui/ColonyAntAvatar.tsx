import type * as React from "react";

import { cn } from "@/shared/lib/cn";

const STARTER_ANTS = ["scout", "maya", "naledi", "sipho", "leo", "grace"];

function portraitIndex(name: string) {
  const starterIndex = STARTER_ANTS.indexOf(name.trim().toLowerCase());
  if (starterIndex >= 0) return starterIndex;
  let hash = 0;
  for (const character of name)
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash % STARTER_ANTS.length;
}

/** Employee identities use the approved ant portraits throughout the canary. */
export function ColonyAntAvatar({
  name,
  className,
  decorative = false,
  testId,
}: {
  name: string;
  className?: string;
  decorative?: boolean;
  testId?: string;
}) {
  const index = portraitIndex(name);
  const style: React.CSSProperties = {
    backgroundImage: 'url("/assets/colony-ant-portraits.png")',
    backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 100}%`,
    backgroundSize: "300% 200%",
  };
  return (
    <span
      aria-hidden={decorative ? true : undefined}
      aria-label={`${name}, ant portrait`}
      className={cn(
        "inline-block size-9 shrink-0 rounded-lg bg-muted",
        className,
      )}
      data-ant-portrait={name}
      data-testid={testId}
      role="img"
      style={style}
    />
  );
}
