import * as React from "react";
import { ChevronDown, Mic, Play, Trash2, Upload, Volume2 } from "lucide-react";

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

export function VoiceSettingsCard() {
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
        <section className="min-w-0" data-testid="settings-voice">
          <div
            className="flex items-start justify-between gap-4"
            data-testid="voice-library"
          >
            <h2 className="text-xl font-semibold tracking-tight">
              Voice library
            </h2>
            <span className="text-xs text-muted-foreground">This device</span>
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
            <div className="mt-8 border-t border-border/60">
              <h3 className="py-4 text-sm font-semibold">Saved voices</h3>
              {localVoices.map((voice) => (
                <div
                  className="flex min-h-20 items-center gap-4 border-b border-border/60 py-4"
                  data-testid={`voice-library-row-${voice.key}`}
                  key={voice.key}
                >
                  <Mic
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{voice.displayName}</p>
                    <p className="text-sm text-muted-foreground">
                      {voice.referenceFile ?? "Local file"} · Local file
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      data-testid={`voice-library-preview-${voice.key}`}
                      disabled={previewing || busy}
                      onClick={() => void previewVoice(voice.key)}
                      size="sm"
                      variant="outline"
                    >
                      <Play className="h-4 w-4" />
                      {previewingVoiceKey === voice.key ? "Playing" : "Preview"}
                    </Button>
                    <Button
                      data-testid={`voice-library-remove-${voice.key}`}
                      disabled={busy}
                      onClick={() => setDeleteCandidate(voice)}
                      size="sm"
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
            className="mt-5 bg-[#315fae] text-white hover:bg-[#284f94]"
            data-testid="voice-library-import"
            disabled={busy || !hasLoaded}
            onClick={() => void importPocketVoice()}
            size="sm"
          >
            <Upload className="h-4 w-4" />
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
        title="Voice"
        description="Choose whether Buzz reads new agent responses aloud during an active huddle."
      />

      <SettingsOptionGroupList>
        <SettingsOptionGroup title="Playback">
          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="agent-text-to-speech-switch"
              >
                Agent text to speech
              </label>
              <p
                className="text-sm text-muted-foreground/70"
                data-settings-subcopy
              >
                Read new agent messages aloud in the order they arrive.
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
        </SettingsOptionGroup>

        <div
          aria-disabled={!enabled}
          className={cn(
            "transition-opacity",
            !enabled && "pointer-events-none opacity-45",
          )}
          data-testid="pocket-voice-controls"
        >
          <SettingsOptionGroup title="Voice">
            <SettingsOptionRow>
              <div className="min-w-0">
                <p className="text-sm font-medium">Pocket TTS voice</p>
                <p
                  className="text-sm text-muted-foreground/70"
                  data-settings-subcopy
                >
                  Voice files stay private on this device.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={`Pocket TTS voice: ${selectedVoice?.displayName ?? "Mary"}`}
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
          </SettingsOptionGroup>
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
