import type * as React from "react";

/**
 * The composer's reference slot: the place in the toolbar, right after the
 * formatting button and before "Raise an ask", where a "Reference lead" button
 * goes. Goals are cut, so the slot is empty today. C3-BIZ-LEADS adds the lead
 * reference control here; keep it a single child so the toolbar spacing holds.
 */
export function ComposerReferenceSlot({
  children = null,
}: {
  children?: React.ReactNode;
}) {
  return children;
}
