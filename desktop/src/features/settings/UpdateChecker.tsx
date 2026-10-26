import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as React from "react";

import { useUpdaterContext } from "./hooks/UpdaterProvider";
import { CheckSmallIcon } from "./ui/settingsIcons";

/** What the Updates card says and offers for each state of the updater. */
export function UpdateChecker() {
  const { status, checkForUpdate, installAndRelaunch } = useUpdaterContext();
  const [version, setVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        // The version line simply omits the number when it cannot be read.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  let line: React.ReactNode = "Check if a new version is available.";
  let tone: "ok" | "bad" | undefined;
  let action: { label: string; onClick: () => void } | null = {
    label: "Check for updates",
    onClick: checkForUpdate,
  };
  let secondaryAction: { label: string; onClick: () => void } | null = null;

  switch (status.state) {
    case "checking":
      line = "Checking for updates...";
      action = null;
      break;
    case "up-to-date":
      line = (
        <>
          <CheckSmallIcon size={14} strokeWidth={3} />
          Colony is up to date{version ? ` · version ${version}` : ""}
        </>
      );
      tone = "ok";
      break;
    case "unavailable":
      line =
        "Automatic updates aren't available on this build. Download the latest release manually.";
      break;
    case "manual-required":
      line = `Update available · v${status.version}. Colony can't update itself from here. Download the new version from colony.global.`;
      action = {
        label: "Download update",
        onClick: () => void openUrl(status.releaseUrl),
      };
      break;
    case "available":
      line = "Preparing update...";
      action = null;
      break;
    case "downloading":
      line =
        typeof status.percent === "number"
          ? `Downloading update... ${status.percent}%`
          : "Downloading update...";
      action = null;
      break;
    case "installing":
      line = "Installing update...";
      action = null;
      break;
    case "ready":
      line = status.version
        ? `Update v${status.version} is ready. Colony will restart to apply it.`
        : "Update downloaded. Click to apply.";
      action = { label: "Update now", onClick: installAndRelaunch };
      break;
    case "error":
      line = `Update failed: ${status.message}`;
      tone = "bad";
      action = { label: "Retry", onClick: checkForUpdate };
      if (status.releaseUrl) {
        const { releaseUrl } = status;
        secondaryAction = {
          label: "Download update",
          onClick: () => void openUrl(releaseUrl),
        };
      }
      break;
    default:
      break;
  }

  return (
    <section
      aria-labelledby="updates-title"
      className="cs-card cs-updates"
      data-testid="settings-updates"
    >
      <div className="cs-updates-copy">
        <h2 className="cs-card-subtitle" id="updates-title">
          Updates
        </h2>
        <span className="cs-updates-line" data-tone={tone}>
          {line}
        </span>
      </div>
      {action ? (
        <button
          className="cs-button"
          data-testid="updates-action"
          onClick={action.onClick}
          type="button"
        >
          {action.label}
        </button>
      ) : null}
      {secondaryAction ? (
        <button
          className="cs-button"
          data-testid="updates-secondary-action"
          onClick={secondaryAction.onClick}
          type="button"
        >
          {secondaryAction.label}
        </button>
      ) : null}
    </section>
  );
}
