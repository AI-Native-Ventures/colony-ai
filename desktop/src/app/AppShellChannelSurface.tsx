import type * as React from "react";
import * as BuzzTheme from "@/app/BuzzThemeSurfaces";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import { chromeCssVarDefaults } from "@/shared/layout/chromeLayout";
import { SidebarInset } from "@/shared/ui/sidebar";

type AppShellChannelSurfaceProps = {
  children: React.ReactNode;
  hasCommunityRail: boolean;
  mainInsetRef: React.RefObject<HTMLElement | null>;
  terminal?: React.ReactNode;
  topChrome?: React.ReactNode;
};

export function AppShellChannelSurface({
  children,
  mainInsetRef,
  terminal,
  topChrome,
}: AppShellChannelSurfaceProps) {
  return (
    <MainInsetProvider mainInsetRef={mainInsetRef}>
      <SidebarInset
        ref={mainInsetRef}
        className="isolate z-0 min-h-0 min-w-0 overflow-hidden bg-background"
        data-buzz-glass-inset
        data-buzz-shadow-viewport
        style={chromeCssVarDefaults as React.CSSProperties}
      >
        <BuzzTheme.ContentSurface terminal={terminal} topChrome={topChrome}>
          {children}
        </BuzzTheme.ContentSurface>
      </SidebarInset>
    </MainInsetProvider>
  );
}
