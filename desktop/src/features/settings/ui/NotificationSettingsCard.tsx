import type {
  DesktopNotificationPermissionState,
  NotificationSettings,
} from "@/features/notifications/hooks";
import {
  COMING_SOON_SLOTS,
  playNotificationSound,
  RECOMMENDED_SOUND_BY_SLOT,
  SLOT_LABELS,
  SOUND_NAMES,
  SOUND_SLOTS,
  type SoundName,
  type SoundSlot,
} from "@/features/notifications/lib/sound";
import { LocalArchiveSwitch } from "@/features/local-archive/ui/LocalArchiveSwitch";
import { Switch } from "@/shared/ui/switch";
import { SettingsCard, SettingsRow, SettingsSwitchRow } from "./SettingsKit";

/** What each agent-job sound will be, once agents report jobs. */
const AGENT_JOB_LABELS = [
  "Job requested",
  "Job accepted",
  "Job result",
  "Job failed",
] as const;

const NO_SOUND = "none";

function soundsFor(slot: SoundSlot): SoundName[] {
  const recommended = RECOMMENDED_SOUND_BY_SLOT[slot];
  return [
    recommended,
    ...SOUND_NAMES.filter((name) => name !== recommended)
      .slice()
      .sort(),
  ];
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="0.875rem"
      viewBox="0 0 24 24"
      width="0.875rem"
    >
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  );
}

export function NotificationSettingsCard({
  isUpdatingDesktopNotifications,
  notificationErrorMessage,
  notificationPermission,
  notificationSettings,
  onSetDesktopNotificationsEnabled,
  onSetAllSlotAlertsEnabled,
  onSetHomeBadgeEnabled,
  onSetSlotAlertsEnabled,
  onSetNotifyWhileViewing,
  onSetSoundForSlot,
}: {
  isUpdatingDesktopNotifications: boolean;
  notificationErrorMessage: string | null;
  notificationPermission: DesktopNotificationPermissionState;
  notificationSettings: NotificationSettings;
  onSetDesktopNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  onSetAllSlotAlertsEnabled: (enabled: boolean) => void;
  onSetHomeBadgeEnabled: (enabled: boolean) => void;
  onSetSlotAlertsEnabled: (slot: SoundSlot, enabled: boolean) => void;
  onSetNotifyWhileViewing: (enabled: boolean) => void;
  onSetSoundForSlot: (slot: SoundSlot, name: SoundName) => void;
}) {
  const permissionBlocked =
    notificationPermission === "denied" ||
    notificationPermission === "unsupported";
  // The Sounds switch derives from its rows: on when any live event is on,
  // and toggling it sets every live row at once.
  const liveSlots = SOUND_SLOTS.filter((slot) => !COMING_SOON_SLOTS.has(slot));
  const anyAlertsOn = liveSlots.some(
    (slot) => notificationSettings.slotAlertsEnabled[slot],
  );

  function chooseSound(slot: SoundSlot, value: string) {
    if (value === NO_SOUND) {
      onSetSlotAlertsEnabled(slot, false);
      return;
    }
    onSetSoundForSlot(slot, value as SoundName);
    if (!notificationSettings.slotAlertsEnabled[slot]) {
      onSetSlotAlertsEnabled(slot, true);
    }
  }

  return (
    <div className="cs-stack" data-testid="settings-notifications">
      <span className="sr-only" data-testid="notifications-desktop-state">
        {notificationPermission === "unsupported"
          ? "Unavailable"
          : notificationPermission === "denied"
            ? "Blocked"
            : notificationSettings.desktopEnabled
              ? "On"
              : "Off"}
      </span>

      <SettingsCard title="Notifications" titleId="notifications-title">
        <SettingsSwitchRow
          checked={notificationSettings.desktopEnabled}
          disabled={isUpdatingDesktopNotifications}
          help="Show a notification when someone mentions you, messages you or needs a decision."
          id="desktop-alerts-switch"
          label={
            isUpdatingDesktopNotifications ? "Requesting..." : "Desktop alerts"
          }
          onCheckedChange={(checked) => {
            void onSetDesktopNotificationsEnabled(checked);
          }}
          testId="notifications-desktop-toggle"
        />
        <SettingsSwitchRow
          checked={
            notificationSettings.desktopEnabled &&
            notificationSettings.notifyWhileViewing
          }
          disabled={!notificationSettings.desktopEnabled}
          help="Also alert you about the conversation you have open."
          id="notify-while-viewing-switch"
          label="Notify while viewing"
          onCheckedChange={onSetNotifyWhileViewing}
          testId="notifications-notify-while-viewing-toggle"
        />
        <SettingsSwitchRow
          checked={notificationSettings.homeBadgeEnabled}
          help="Show your Activity count on the app icon."
          id="home-badge-switch"
          label="Home badge"
          onCheckedChange={onSetHomeBadgeEnabled}
          testId="notifications-home-badge-toggle"
        />
      </SettingsCard>

      <section aria-labelledby="sounds-title" className="cs-card">
        <div className="cs-row cs-sounds-head" data-switch="true">
          <label className="cs-row-copy" htmlFor="notification-sound-switch">
            <span className="cs-card-subtitle" id="sounds-title">
              Sounds
            </span>
            <span className="cs-row-help">
              Pick a sound for each kind of message.
            </span>
          </label>
          <Switch
            checked={anyAlertsOn}
            data-testid="notifications-sound-toggle"
            id="notification-sound-switch"
            onCheckedChange={onSetAllSlotAlertsEnabled}
          />
        </div>
        {liveSlots.map((slot) => {
          const alertsOn = notificationSettings.slotAlertsEnabled[slot];
          const selectId = `sound-select-${slot}`;
          const value = alertsOn ? notificationSettings.sounds[slot] : NO_SOUND;
          return (
            <SettingsRow
              className="cs-sound-row"
              htmlFor={selectId}
              key={slot}
              label={SLOT_LABELS[slot]}
            >
              <span className="cs-sound-controls">
                <select
                  className="cs-select cs-select-sound"
                  data-testid={`notifications-sound-select-${slot}`}
                  id={selectId}
                  onChange={(event) => chooseSound(slot, event.target.value)}
                  value={value}
                >
                  {soundsFor(slot).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value={NO_SOUND}>No sound</option>
                </select>
                <button
                  aria-label={`Play ${SLOT_LABELS[slot]} sound`}
                  className="cs-icon-button"
                  data-testid={`notifications-sound-play-${slot}`}
                  disabled={!alertsOn}
                  onClick={() =>
                    playNotificationSound(notificationSettings.sounds[slot])
                  }
                  type="button"
                >
                  <PlayIcon />
                </button>
              </span>
            </SettingsRow>
          );
        })}
        <div className="cs-agent-jobs">
          <div className="cs-agent-jobs-head">
            <span className="cs-eyebrow">Agent jobs</span>
            <span className="cs-badge" data-size="small">
              Coming soon
            </span>
          </div>
          <div className="cs-agent-jobs-grid">
            {AGENT_JOB_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      </section>

      <LocalArchiveSwitch />

      {permissionBlocked && (
        <p className="cs-notice" data-tone="bad" role="alert">
          {notificationPermission === "unsupported"
            ? "Desktop notifications are not supported in this environment."
            : "Desktop notifications are blocked. Enable them in your system settings."}
        </p>
      )}

      {notificationErrorMessage ? (
        <p className="cs-notice" data-tone="bad" role="alert">
          {notificationErrorMessage}
        </p>
      ) : null}
    </div>
  );
}
