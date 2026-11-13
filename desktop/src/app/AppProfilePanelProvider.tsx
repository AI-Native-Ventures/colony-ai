import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMapShellEnabled } from "@/features/map-shell/useMapShellEnabled";
import { ProfilePanelProvider } from "@/shared/context/ProfilePanelContext";

export function AppProfilePanelProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { goActivityProfile, goProfile } = useAppNavigation();
  const mapShellEnabled = useMapShellEnabled();
  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string) => {
      void (mapShellEnabled ? goActivityProfile(pubkey) : goProfile(pubkey));
    },
    [goActivityProfile, goProfile, mapShellEnabled],
  );

  return (
    <ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}>
      {children}
    </ProfilePanelProvider>
  );
}
