import { useLayoutEffect } from "react";

/** Root attribute that scopes the office restyle stylesheets. */
export const OFFICE_SHELL_ATTRIBUTE = "data-colony-office";

/**
 * Marks the document while the workspace shell (channels or Settings) is
 * mounted, so `shared/styles/globals/office-*.css` applies after onboarding
 * only. One attribute on the root keeps those rules free of `:has()` lookups;
 * onboarding and the gate screens never mount the shell, so they keep their
 * own look.
 */
export function useOfficeShellMarker() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute(OFFICE_SHELL_ATTRIBUTE, "");
    return () => root.removeAttribute(OFFICE_SHELL_ATTRIBUTE);
  }, []);
}
