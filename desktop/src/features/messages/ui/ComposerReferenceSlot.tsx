import type * as React from "react";

/**
 * The composer's reference slot: the place in the toolbar, right after the
 * formatting button and before "Raise an ask", where the "Reference lead"
 * button goes (C3-BIZ-LEADS). Goals are cut. Keep it a single child so the
 * toolbar spacing holds.
 */
export function ComposerReferenceSlot({
  children = null,
}: {
  children?: React.ReactNode;
}) {
  return children;
}
