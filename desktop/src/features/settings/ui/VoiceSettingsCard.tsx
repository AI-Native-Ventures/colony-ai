import * as React from "react";
import { ChevronDown, Mic, Play, Trash2, Upload, Volume2 } from "lucide-react";

import { useHuddle } from "@/features/huddle/HuddleContext";
import { invokeTauri } from "@/shared/api/tauri";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Switch } from "@/shared/ui/switch";
import {
  SettingsOptionGroup,
  SettingsOptionGroupList,
  SettingsOptionRow,
} from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import {
  selectedVoiceForBackend,
  type VoiceRegistryEntry,
  voiceOptionLabel,
  voicesForBackend,
} from "./voiceSettingsLogic";

export type TtsSettings = {
  version: number;
  agentTextToSpeech: boolean;
  voicePreferences: string[];
};

type TtsVoiceMutation = {
  settings: TtsSettings;
  registry: VoiceRegistryEntry[];
};

export function VoiceSettingsCard({
  onSectionChange,
}: {
  onSectionChange?: (section: "notifications" | "voice") => void;
}) {
  const {
    audioDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    outputDevices,
    selectedOutputDevice,
    setSelectedOutputDevice,
  } = useHuddle();
  const [settings, setSettings] = React.useState<TtsSettings | null>(null);
  const [registry, setRegistry] = React.useState<VoiceRegistryEntry[]>([]);
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [showLibrary, setShowLibrary] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewingVoiceKey, setPreviewingVoiceKey] = React.useState<
    string | null
  >(null);
  const [deleteCandidate, setDeleteCandidate] =
    React.useState<VoiceRegistryEntry | null>(null);
  const [importFailure, setImportFailure] = React.useState<
    "invalid" | "failed" | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    Promise.all([
      invokeTauri<TtsSettings>("get_tts_settings"),
      invokeTauri<VoiceRegistryEntry[]>("list_voice_registry"),
    ])
      .then(([nextSettings, nextRegistry]) => {
        if (!disposed) {
          setSettings(nextSettings);
          setRegistry(nextRegistry);
          setHasLoaded(true);
        }
      })
      .catch((loadError) => {
        if (!disposed) {
          setHasLoaded(true);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Voice settings could not be loaded.",
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const saveEnabled = React.useCallback(async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await invokeTauri<TtsSettings>("set_tts_enabled", {
        enabled,
      });
      setSettings(saved);
    } catch (saveError) {
      try {
        const state = await invokeTauri<{ tts_enabled: boolean }>(
          "get_huddle_state",
        );
        setSettings((current) =>
          current
            ? { ...current, agentTextToSpeech: state.tts_enabled }
            : current,
        );
      } catch {
        // Keep the last confirmed state when native reconciliation is
        // unavailable; the visible save error makes the failure explicit.
      }
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Voice settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const savePocketVoice = React.useCallback(async (voiceKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await invokeTauri<TtsSettings>("set_pocket_voice", {
        voiceKey,
      });
      setSettings(saved);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Voice settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const importPocketVoice = React.useCallback(async () => {
    setBusy(true);
    setImportFailure(null);
    setError(null);
    try {
      const result = await invokeTauri<TtsVoiceMutation | null>(
        "import_pocket_voice",
      );
      if (result) {
        setSettings(result.settings);
        setRegistry(result.registry);
      }
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : "Voice could not be imported.";
      if (showLibrary) {
        setImportFailure(
          /unsupported|pcm|wav|format/i.test(message) ? "invalid" : "failed",
        );
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }, [showLibrary]);

  const deletePocketVoice = React.useCallback(async (voiceKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await invokeTauri<TtsVoiceMutation>(
        "delete_pocket_voice",
        { voiceKey },
      );
      setSettings(result.settings);
      setRegistry(result.registry);
      setDeleteCandidate(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Voice could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const voices = voicesForBackend(registry, "pocket");
  const localVoices = registry.filter((voice) =>
    voice.key.startsWith("pocket:imported:"),
  );
  const selectedVoice = selectedVoiceForBackend(
    settings?.voicePreferences ?? [],
    voices,
  );
  const enabled = settings?.agentTextToSpeech ?? true;
  const controlsDisabled = !settings || busy || !enabled;

  const previewVoice = React.useCallback(async (voiceKey: string) => {
    setPreviewing(true);
    setPreviewingVoiceKey(voiceKey);
    setError(null);
    try {
      await invokeTauri<void>("preview_pocket_voice", { voiceKey });
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Voice preview could not be played.",
      );
    } finally {
      setPreviewing(false);
      setPreviewingVoiceKey(null);
    }
  }, []);

  const deleteDialog = (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) setDeleteCandidate(null);
      }}
      open={deleteCandidate !== null}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this voice?</AlertDialogTitle>
          <AlertDialogDescription>
            {deleteCandidate
              ? `Remove ${deleteCandidate.displayName} from the library. The original file is not deleted. Existing generated audio is unchanged.`
              : "Remove this voice from the library. The original file is not deleted. Existing generated audio is unchanged."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="confirm-pocket-voice-delete"
            disabled={busy || !deleteCandidate}
            onClick={(event) => {
              event.preventDefault();
              if (deleteCandidate) {
                void deletePocketVoice(deleteCandidate.key);
              }
            }}
          >
            Remove from library
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const importDialog = (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setImportFailure(null);
          setError(null);
        }
      }}
      open={showLibrary && importFailure !== null}
    >
      <AlertDialogContent data-testid="voice-import-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Import voice file</AlertDialogTitle>
          <AlertDialogDescription>
            <span
              className="block rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {importFailure === "invalid" ? (
                <>
                  <span className="block font-medium">
                    This is not a supported voice file
                  </span>
                  <span>
                    Choose a file supported by the voice provider. Your existing
                    library is unchanged.
                  </span>
                </>
              ) : (
                <>
                  <span className="block font-medium">
                    The voice file couldn’t be imported
                  </span>
                  <span>
                    The file could not be read. Choose another file or try
                    again.
                  </span>
                </>
              )}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="voice-import-retry"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void importPocketVoice();
            }}
          >
            Import
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (showLibrary) {
    return (
      <>
        <section
          className="min-w-0"
          data-testid="settings-voice"
          data-voice-library-route
        >
          <div data-testid="voice-library-route">
            <SettingsSectionHeader
              action={
                <span className="text-xs text-muted-foreground">
                  This device
                </span>
              }
              title={<span data-testid="voice-library">Voice library</span>}
            />
            <div
              aria-label="Voice library sections"
              className="w20-inner-tabs w20-voice-library-tabs"
              role="tablist"
            >
              <button
                aria-selected="true"
                className="w20-inner-tab is-active"
                data-testid="voice-library-tab-audio"
                onClick={() => setShowLibrary(false)}
                role="tab"
                type="button"
              >
                Voice &amp; audio
              </button>
              <button
                aria-selected="false"
                className="w20-inner-tab"
                data-testid="voice-library-tab-notifications"
                onClick={() => onSectionChange?.("notifications")}
                role="tab"
                type="button"
              >
                Notifications
              </button>
            </div>
          </div>

          {error && !importFailure ? (
            <p
              className="mt-5 text-sm text-destructive"
              data-testid="voice-settings-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {hasLoaded && !error && localVoices.length === 0 ? (
            <div
              className="mt-8 flex min-h-48 flex-col items-center justify-center gap-2 border-t border-border/60 px-4 text-center"
              data-testid="voice-library-empty"
            >
              <Mic
                aria-hidden="true"
                className="h-5 w-5 text-muted-foreground"
              />
              <p className="text-sm font-medium">Your voice library is empty</p>
              <p className="text-sm text-muted-foreground">
                Import a voice file to make it available to compatible voice
                tools.
              </p>
            </div>
          ) : null}

          {localVoices.length > 0 ? (
            <div className="mt-6 mb-[26px] border-b border-border/60 pb-[26px] voice-library-list">
              <h3 className="mb-3 text-sm font-semibold leading-[1.5]">
                Saved voices
              </h3>
              {localVoices.map((voice) => (
                <div
                  className="flex items-center gap-[15px] py-[18px]"
                  data-testid={`voice-library-row-${voice.key}`}
                  key={voice.key}
                >
                  <span className="grid size-10 shrink-0 place-items-center">
                    <Mic
                      aria-hidden="true"
                      className="h-4 w-4 text-muted-foreground"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-[1.5]">
                      {voice.displayName}
                    </p>
                    <p className="mt-1 text-xs leading-[1.65] text-[#79747f] dark:text-[#a39aa9]">
                      {voice.referenceFile ?? "Local file"} · Local file
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <Button
                      className="rounded-[6px] px-[13.5px] text-xs"
                      data-testid={`voice-library-preview-${voice.key}`}
                      disabled={previewing || busy}
                      onClick={() => void previewVoice(voice.key)}
                      size="default"
                      variant="outline"
                    >
                      {previewingVoiceKey === voice.key ? "Playing" : "Preview"}
                    </Button>
                    <Button
                      className="rounded-[6px] px-[13.5px] text-xs"
                      data-testid={`voice-library-remove-${voice.key}`}
                      disabled={busy}
                      onClick={() => setDeleteCandidate(voice)}
                      size="default"
                      variant="outline"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <Button
            className="h-9 min-w-[120px] rounded-[6px] bg-[#315fae] px-3 text-xs text-white hover:bg-[#284f94]"
            data-testid="voice-library-import"
            disabled={busy || !hasLoaded}
            onClick={() => void importPocketVoice()}
            size="default"
          >
            Import voice file
          </Button>
        </section>
        {deleteDialog}
        {importDialog}
      </>
    );
  }

  return (
    <section className="min-w-0" data-testid="settings-voice">
      <SettingsSectionHeader
        title="Voice & audio"
        description="Your input, playback and agent voices on this device."
      />

      <SettingsOptionGroupList>
        <SettingsOptionGroup title="Audio devices">
          <SettingsOptionRow>
            <label className="text-sm font-medium" htmlFor="voice-microphone">
              Microphone
            </label>
            <select
              className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs"
              data-testid="voice-microphone-select"
              id="voice-microphone"
              onChange={(event) => {
                setSelectedDeviceId(
                  event.currentTarget.value === "system-default"
                    ? ""
                    : event.currentTarget.value,
                );
              }}
              value={
                audioDevices.some(
                  (device) => device.deviceId === selectedDeviceId,
                )
                  ? selectedDeviceId
                  : "system-default"
              }
            >
              <option value="system-default">System default</option>
              {audioDevices
                .filter(
                  (device) => device.deviceId && device.deviceId !== "default",
                )
                .map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Mic ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
            </select>
          </SettingsOptionRow>
          <SettingsOptionRow>
            <label className="text-sm font-medium" htmlFor="voice-output">
              Output
            </label>
            <select
              className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs"
              data-testid="voice-output-select"
              id="voice-output"
              onChange={(event) => {
                setSelectedOutputDevice(
                  event.currentTarget.value === "system-default"
                    ? ""
                    : event.currentTarget.value,
                );
              }}
              value={
                (outputDevices ?? []).some(
                  (device) => device.name === selectedOutputDevice,
                )
                  ? selectedOutputDevice
                  : "system-default"
              }
            >
              <option value="system-default">System default</option>
              {(outputDevices ?? [])
                .filter((device) => device.name)
                .map((device) => (
                  <option key={device.name} value={device.name}>
                    {device.name}
                  </option>
                ))}
            </select>
          </SettingsOptionRow>
        </SettingsOptionGroup>

        <SettingsOptionGroup title="Agent voice">
          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="agent-text-to-speech-switch"
              >
                Read agent replies aloud
              </label>
              <p
                className="text-sm text-muted-foreground/70"
                data-settings-subcopy
              >
                During an active huddle.
              </p>
            </div>
            <Switch
              checked={enabled}
              data-testid="agent-text-to-speech-toggle"
              disabled={!settings || busy}
              id="agent-text-to-speech-switch"
              onCheckedChange={(checked) => {
                if (settings) void saveEnabled(checked);
              }}
            />
          </SettingsOptionRow>
          <div
            aria-disabled={!enabled}
            className={cn(
              "transition-opacity",
              !enabled && "pointer-events-none opacity-45",
            )}
            data-testid="pocket-voice-controls"
          >
            <SettingsOptionRow>
              <div className="min-w-0">
                <p className="text-sm font-medium">Voice</p>
                <p
                  className="text-sm text-muted-foreground/70"
                  data-settings-subcopy
                >
                  Local Pocket TTS voice library.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={`Voice: ${selectedVoice?.displayName ?? "Mary"}`}
                      className="min-w-32 justify-between"
                      data-testid="pocket-voice-selector"
                      disabled={controlsDisabled}
                      variant="outline"
                    >
                      {selectedVoice
                        ? voiceOptionLabel(selectedVoice, voices)
                        : "Mary"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-80 overflow-y-auto"
                  >
                    <DropdownMenuRadioGroup
                      onValueChange={(voiceKey) => {
                        if (settings) void savePocketVoice(voiceKey);
                      }}
                      value={selectedVoice?.key}
                    >
                      {voices.map((voice) => (
                        <DropdownMenuRadioItem
                          key={voice.key}
                          value={voice.key}
                        >
                          {voiceOptionLabel(voice, voices)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  aria-label={`Preview ${selectedVoice?.displayName ?? "Mary"}`}
                  data-testid="pocket-voice-preview"
                  disabled={controlsDisabled || previewing || !selectedVoice}
                  onClick={() => {
                    if (!selectedVoice) return;
                    void previewVoice(selectedVoice.key);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {previewing ? (
                    <Volume2 className="h-4 w-4 animate-pulse" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Preview
                </Button>
                <Button
                  data-testid="pocket-voice-import"
                  disabled={controlsDisabled}
                  onClick={() => void importPocketVoice()}
                  size="sm"
                  variant="outline"
                >
                  <Upload className="h-4 w-4" />
                  Add voice
                </Button>
                {selectedVoice?.key.startsWith("pocket:imported:") && (
                  <Button
                    aria-label={`Delete ${selectedVoice.displayName}`}
                    data-testid="pocket-voice-delete"
                    disabled={controlsDisabled}
                    onClick={() => setDeleteCandidate(selectedVoice)}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </SettingsOptionRow>
          </div>
          <Button
            className="mt-3"
            data-testid="voice-library-open"
            onClick={() => setShowLibrary(true)}
            size="sm"
            variant="outline"
          >
            Preview voice library
          </Button>
        </SettingsOptionGroup>
      </SettingsOptionGroupList>
      {error && (
        <p
          className="mt-4 text-sm text-destructive"
          data-testid="voice-settings-error"
          role="alert"
        >
          {error}
        </p>
      )}
      {deleteDialog}
    </section>
  );
}
