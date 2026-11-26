import { openUrl } from "@tauri-apps/plugin-opener";

import { useUpdaterContext } from "@/features/settings/hooks/UpdaterProvider";
import { shouldShowSidebarUpdateCard } from "@/features/settings/sidebarUpdateCardVisibility";

/**
 * The update prompt of the Map layout.
 *
 * The Map layout has no sidebar, so the sidebar update card never shows there
 * and a downloaded update would wait unseen until someone opened Settings.
 * This button shows in the top bar for the same states as that card: an update
 * that is ready installs on one click, and an update Colony cannot install by
 * itself opens the download page.
 */
export function MapShellUpdateButton() {
  const { installAndRelaunch, status } = useUpdaterContext();

  if (!shouldShowSidebarUpdateCard(status)) {
    return null;
  }

  if (status.state === "manual-required" || status.state === "error") {
    const releaseUrl = status.releaseUrl;
    if (!releaseUrl) return null;
    const refused = status.state === "error";
    return (
      <button
        className="map-shell-update-button"
        data-state={status.state}
        data-testid="map-shell-update"
        onClick={() => void openUrl(releaseUrl)}
        title={
          refused
            ? status.message
            : `Version ${status.version} is available. Download it from colony.global.`
        }
        type="button"
      >
        {refused ? "Update not installed" : "Update available"}
      </button>
    );
  }

  const installing = status.state === "installing";
  return (
    <button
      aria-busy={installing || undefined}
      className="map-shell-update-button"
      data-state={status.state}
      data-testid="map-shell-update"
      disabled={installing}
      onClick={() => void installAndRelaunch()}
      title={
        installing
          ? "Colony restarts when the update is installed."
          : "The update is downloaded. Colony restarts to apply it."
      }
      type="button"
    >
      {installing ? "Updating..." : "Update now"}
    </button>
  );
}
