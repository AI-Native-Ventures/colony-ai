import * as React from "react";
import { UploadCloud } from "lucide-react";

import { AvatarCustomColorPanel } from "@/features/profile/ui/AvatarCustomColorPanel";
import {
  hexToHsv,
  hsvToHex,
  normalizeHue,
} from "@/features/profile/ui/ProfileAvatarEditor.utils";
import { useAvatarUpload } from "@/features/profile/useAvatarUpload";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  AGENT_ANT_PRESETS,
  agentAntAvatarDataUrl,
  agentAntBackground,
  type AgentAntColor,
  type AgentFunction,
} from "./agentAntAvatar";

export function AgentAntPictureControl({
  avatarUrl,
  disabled,
  functionName,
  label,
  onUploadPendingChange,
  onSelect,
}: {
  avatarUrl: string;
  disabled?: boolean;
  functionName: AgentFunction;
  label: string;
  onUploadPendingChange?: (pending: boolean) => void;
  onSelect: (url: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="grid h-28 w-28 place-items-center overflow-hidden rounded-2xl bg-muted">
        <img
          alt={`${label} ant`}
          className="h-full w-full object-contain"
          src={avatarUrl}
        />
      </span>
      <AgentAntPicturePicker
        avatarUrl={avatarUrl}
        disabled={disabled}
        functionName={functionName}
        onUploadPendingChange={onUploadPendingChange}
        onSelect={onSelect}
      />
    </div>
  );
}

export function AgentAntPicturePicker({
  avatarUrl,
  disabled,
  functionName,
  onUploadPendingChange,
  onSelect,
}: {
  avatarUrl: string;
  disabled?: boolean;
  functionName: AgentFunction;
  onUploadPendingChange?: (pending: boolean) => void;
  onSelect: (url: string) => void;
}) {
  const defaultColor =
    AGENT_ANT_PRESETS.find((preset) => preset.id === "green")?.id ?? "green";
  const [selectedColor, setSelectedColor] = React.useState<
    AgentAntColor | string
  >(defaultColor);
  const [customHex, setCustomHex] = React.useState("#7C5CFF");
  const [customColorOpen, setCustomColorOpen] = React.useState(false);
  const customHsv = hexToHsv(customHex);
  const upload = useAvatarUpload({
    fallbackErrorMessage: "Could not use that photo.",
    onUploadSuccess: (url) => onSelect(url),
  });
  React.useEffect(() => {
    onUploadPendingChange?.(upload.isUploading);
    return () => onUploadPendingChange?.(false);
  }, [onUploadPendingChange, upload.isUploading]);

  const selectPreset = (color: AgentAntColor) => {
    setSelectedColor(color);
    onSelect(agentAntAvatarDataUrl(functionName, color));
  };
  const selectCustom = (hex: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const normalized = hex.toUpperCase();
    setSelectedColor(normalized);
    setCustomHex(normalized);
    onSelect(agentAntAvatarDataUrl(functionName, normalized));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          disabled={disabled || upload.isUploading}
          type="button"
          variant="outline"
        >
          Change picture
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(34rem,calc(100vw-2rem))] p-4"
        data-testid="agent-picture-picker"
      >
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <span
              className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl"
              style={{ backgroundColor: agentAntBackground(selectedColor) }}
            >
              <img
                alt=""
                className="h-full w-full object-contain"
                src={avatarUrl}
              />
            </span>
            <div className="grid gap-1">
              <strong className="text-sm">Choose a picture</strong>
              <span className="text-xs text-muted-foreground">
                Pick a colour for this ant or use a photo.
              </span>
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">Colour</legend>
            <div className="grid grid-cols-5 gap-2">
              {AGENT_ANT_PRESETS.map((preset) => (
                <button
                  aria-label={`${preset.label} ant colour`}
                  aria-pressed={selectedColor === preset.id}
                  className="grid min-h-14 place-items-center rounded-xl border border-border p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`agent-ant-color-${preset.id}`}
                  key={preset.id}
                  onClick={() => selectPreset(preset.id)}
                  type="button"
                >
                  <span
                    className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg"
                    style={{ backgroundColor: agentAntBackground(preset.id) }}
                  >
                    <img
                      alt=""
                      className="h-full w-full object-contain"
                      src={agentAntAvatarDataUrl(functionName, preset.id)}
                    />
                  </span>
                  <span className="text-3xs font-medium">{preset.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2 rounded-xl border border-border p-3">
            <label
              className="text-sm font-semibold"
              htmlFor="agent-ant-custom-color"
            >
              Custom colour
            </label>
            <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
              <input
                aria-label="Custom ant colour"
                className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent"
                data-testid="agent-ant-color-field"
                id="agent-ant-custom-color"
                onChange={(event) => selectCustom(event.target.value)}
                type="color"
                value={customHex}
              />
              <label className="grid gap-1 text-xs text-muted-foreground">
                Hue
                <input
                  aria-label="Custom ant colour hue"
                  className="h-5 w-full accent-primary"
                  data-testid="agent-ant-hue"
                  max={360}
                  min={0}
                  onChange={(event) => {
                    const hue = normalizeHue(Number(event.target.value));
                    selectCustom(
                      hsvToHex(hue, customHsv.saturation, customHsv.value),
                    );
                  }}
                  type="range"
                  value={customHsv.hue}
                />
              </label>
            </div>
            <Button
              onClick={() => setCustomColorOpen((open) => !open)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {customColorOpen ? "Close colour picker" : "Open colour picker"}
            </Button>
            <div className="relative h-40 overflow-hidden rounded-xl">
              <AvatarCustomColorPanel
                colorDraft={customHex}
                compact
                hue={customHsv.hue}
                onCommit={() => setCustomColorOpen(false)}
                onHueChange={(hue) =>
                  selectCustom(
                    hsvToHex(hue, customHsv.saturation, customHsv.value),
                  )
                }
                onSaturationValueChange={(saturation, value) =>
                  selectCustom(hsvToHex(customHsv.hue, saturation, value))
                }
                saturation={customHsv.saturation}
                testIdPrefix="agent-ant"
                value={customHsv.value}
                visible={customColorOpen}
              />
            </div>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Hex
              <input
                aria-label="Custom ant colour hex"
                className="h-9 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground"
                data-testid="agent-ant-hex"
                maxLength={7}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomHex(value);
                  if (/^#[0-9a-f]{6}$/i.test(value)) selectCustom(value);
                }}
                type="text"
                value={customHex}
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border p-3">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-lg bg-muted"
            >
              <UploadCloud className="h-5 w-5" />
            </span>
            <span className="grid flex-1 gap-1">
              <strong className="text-sm">Use a photo instead</strong>
              <span className="text-xs text-muted-foreground">
                PNG or JPG from this Mac.
              </span>
              {upload.errorMessage ? (
                <span role="alert" className="text-xs text-destructive">
                  {upload.errorMessage}
                </span>
              ) : null}
            </span>
            <Button
              disabled={disabled || upload.isUploading}
              onClick={upload.openPicker}
              size="sm"
              type="button"
              variant="outline"
            >
              {upload.isUploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
          <input
            accept="image/gif,image/jpeg,image/png,image/webp"
            aria-label="Upload agent photo"
            className="sr-only"
            onChange={upload.handleFileChange}
            ref={upload.inputRef}
            type="file"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
