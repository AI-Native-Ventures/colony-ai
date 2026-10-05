import { File as FileIcon, Monitor, X } from "lucide-react";
import * as React from "react";

import {
  AVATAR_ACCEPT_ATTRIBUTE,
  AVATAR_ACCEPTED_LABEL,
  AVATAR_MAX_SOURCE_LABEL,
  type AvatarProblem,
  checkAvatarFile,
  describeAvatarFailure,
  describeCameraProblem,
} from "@/features/profile/avatarUploadProblems";
import { emojiAvatarDataUrl } from "@/features/profile/ui/ProfileAvatarEditor.utils";
import { uploadMediaFile } from "@/shared/api/tauriMedia";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ProfileAvatarProblem } from "./ProfileAvatarProblem";

const AVATAR_OPTIONS = [
  { label: "Star", emoji: "✦", color: "#FFFFFF", background: "#ece5ed" },
  { label: "Leaf", emoji: "🌿", color: "#e4ede5", background: "#ece5ed" },
  { label: "Diamond", emoji: "◈", color: "#FFFFFF", background: "#ece5ed" },
  { label: "Sun", emoji: "☀", color: "#FFF4CC", background: "#ece5ed" },
  { label: "Flower", emoji: "🌸", color: "#f5dce9", background: "#ece5ed" },
] as const;

type AvatarStage =
  | "choose"
  | "upload"
  | "camera"
  | "crop"
  | "saving"
  | "failed"
  | "invalid";

type ProfileAvatarDialogProps = {
  avatarUrl: string;
  displayName: string;
  onOpenChange: (open: boolean) => void;
  onSave: (avatarUrl: string) => Promise<void>;
  open: boolean;
};

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase() ?? "")
      .join("") || "?"
  );
}

export function ProfileAvatarDialog({
  avatarUrl,
  displayName,
  onOpenChange,
  onSave,
  open,
}: ProfileAvatarDialogProps) {
  const [stage, setStage] = React.useState<AvatarStage>("choose");
  const [selectedChoice, setSelectedChoice] = React.useState<string | null>(
    null,
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [cropPoint, setCropPoint] = React.useState({ x: 0.5, y: 0.5 });
  const [isCameraReady, setIsCameraReady] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraVideoRef = React.useRef<HTMLVideoElement>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const cropRef = React.useRef<HTMLDivElement>(null);
  const pointerStartRef = React.useRef<{
    x: number;
    y: number;
    cropX: number;
    cropY: number;
  } | null>(null);
  const uploadedUrlRef = React.useRef<string | null>(null);
  const [problem, setProblem] = React.useState<AvatarProblem | null>(null);
  const recoveryButtonRef = React.useRef<HTMLButtonElement>(null);
  const lastPresetRef = React.useRef<string | null>(null);
  // Bumped whenever the dialog closes or a new save starts, so a save that was
  // cancelled or superseded cannot write its result into a newer dialog state.
  const attemptRef = React.useRef(0);
  const isOpenRef = React.useRef(open);
  isOpenRef.current = open;
  // Radix returns focus only to a DialogTrigger, and this dialog is opened by
  // controlled state from several places. Remember who opened it so closing
  // hands focus back to that control (keyboard-only people would otherwise
  // land on the page body).
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  React.useEffect(() => {
    if (open) return;
    attemptRef.current += 1;
    lastPresetRef.current = null;
    setProblem(null);
    setStage("choose");
    setSelectedChoice(null);
    setFile(null);
    setPreviewUrl(null);
    setZoom(1);
    setCropPoint({ x: 0.5, y: 0.5 });
    setIsCameraReady(false);
    uploadedUrlRef.current = null;
  }, [open]);

  React.useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // A failure replaces the control the person just used, so move focus to the
  // recovery action instead of dropping it to the page.
  React.useEffect(() => {
    if (problem) recoveryButtonRef.current?.focus();
  }, [problem]);

  React.useEffect(() => {
    if (!open || stage !== "camera") return;

    let live = true;
    setIsCameraReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem(describeCameraProblem(null));
      return;
    }

    void navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (!live || !isOpenRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        cameraStreamRef.current = stream;
        setIsCameraReady(true);
        const video = cameraVideoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (!live) return;
        setIsCameraReady(false);
        setProblem(describeCameraProblem(error));
      });

    return () => {
      live = false;
      const stream = cameraStreamRef.current;
      cameraStreamRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, [open, stage]);

  function setImageFile(nextFile: File | undefined) {
    if (!nextFile) return;
    const fileProblem = checkAvatarFile(nextFile);
    if (fileProblem) {
      setFile(null);
      setProblem(fileProblem);
      setStage("invalid");
      return;
    }

    setProblem(null);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setFile(nextFile);
    setZoom(1);
    setCropPoint({ x: 0.5, y: 0.5 });
    uploadedUrlRef.current = null;
    setStage("crop");
  }

  function moveCropPoint(key: string) {
    const step = 0.04;
    setCropPoint((point) => ({
      x: Math.max(
        0,
        Math.min(
          1,
          point.x +
            (key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          1,
          point.y +
            (key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0),
        ),
      ),
    }));
  }

  function handleCropPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      cropX: cropPoint.x,
      cropY: cropPoint.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCropPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    const bounds = cropRef.current?.getBoundingClientRect();
    if (!start || !bounds) return;
    setCropPoint({
      x: Math.max(
        0,
        Math.min(
          1,
          start.cropX - (event.clientX - start.x) / bounds.width / zoom,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          1,
          start.cropY - (event.clientY - start.y) / bounds.height / zoom,
        ),
      ),
    });
  }

  async function renderCroppedImage() {
    if (!file || !previewUrl) throw new Error("Choose an image before saving.");
    const source = new Image();
    source.src = previewUrl;
    await source.decode();

    const cropSize = Math.min(source.naturalWidth, source.naturalHeight) / zoom;
    const sourceX = (source.naturalWidth - cropSize) * cropPoint.x;
    const sourceY = (source.naturalHeight - cropSize) * cropPoint.y;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this image.");
    context.drawImage(
      source,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      512,
      512,
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Could not prepare this image.")),
        "image/png",
      );
    });
    return new File([blob], "profile-avatar.png", { type: "image/png" });
  }

  async function savePreset(avatar: string) {
    const attempt = ++attemptRef.current;
    lastPresetRef.current = avatar;
    setProblem(null);
    setStage("saving");
    try {
      await onSave(avatar);
      if (attempt !== attemptRef.current) return;
      onOpenChange(false);
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setSelectedChoice(null);
      setProblem(
        describeAvatarFailure(error, { hasCrop: false, phase: "publish" }),
      );
      setStage("choose");
    }
  }

  async function saveCrop() {
    if (!file && !uploadedUrlRef.current) return;
    const attempt = ++attemptRef.current;
    setProblem(null);
    setStage("saving");
    let phase: "prepare" | "upload" | "publish" = "prepare";
    try {
      if (!uploadedUrlRef.current) {
        const cropped = await renderCroppedImage();
        phase = "upload";
        const descriptor = await uploadMediaFile(cropped);
        // Cancelled while uploading: keep the profile unchanged.
        if (attempt !== attemptRef.current) return;
        uploadedUrlRef.current = descriptor.url;
      }
      phase = "publish";
      await onSave(uploadedUrlRef.current);
      if (attempt !== attemptRef.current) return;
      onOpenChange(false);
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setProblem(describeAvatarFailure(error, { hasCrop: true, phase }));
      setStage("failed");
    }
  }

  function takePhoto() {
    const video = cameraVideoRef.current;
    if (!video || !isCameraReady || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(
      video,
      (video.videoWidth - size) / 2,
      (video.videoHeight - size) / 2,
      size,
      size,
      0,
      0,
      size,
      size,
    );
    canvas.toBlob((blob) => {
      if (!isOpenRef.current) return;
      if (!blob) {
        setProblem({
          kind: "camera",
          title: "The photo was not taken",
          message: "Try Take photo again, or upload an image instead.",
        });
        return;
      }
      const photo = new File([blob], "profile-photo.png", {
        type: "image/png",
      });
      setImageFile(photo);
    }, "image/png");
  }

  async function chooseAvatar(option: (typeof AVATAR_OPTIONS)[number]) {
    setSelectedChoice(option.label);
    await savePreset(emojiAvatarDataUrl(option.emoji, option.color));
  }

  async function retrySave() {
    if (stage === "choose" && lastPresetRef.current) {
      await savePreset(lastPresetRef.current);
      return;
    }
    await saveCrop();
  }

  const isSaving = stage === "saving";
  const isCropStage = stage === "crop" || stage === "failed";
  const canRetryPreset =
    stage === "choose" && problem !== null && lastPresetRef.current !== null;
  const dialogHeight = {
    choose: problem ? "h-[27.5rem]" : "h-[20.125rem]",
    upload: "h-[24.625rem]",
    camera: problem ? "h-[43rem]" : "h-[39.25rem]",
    crop: "h-[38.0625rem]",
    saving: "h-[24.1875rem]",
    invalid: "h-[31.6875rem]",
    failed: "h-[35.75rem]",
  }[stage];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef.current;
          returnFocusRef.current = null;
          if (target?.isConnected) target.focus();
        }}
        className={`flex max-h-[calc(100vh-2rem)] max-w-[540px] flex-col gap-0 overflow-hidden border-border/80 bg-card p-0 dark:bg-[#26232d] ${dialogHeight}`}
        data-testid="profile-avatar-dialog"
        showCloseButton={false}
      >
        <DialogHeader className="h-20 shrink-0 flex-row items-center justify-between gap-4 border-b border-border/70 px-[25px] py-5">
          <DialogTitle className="text-base font-semibold tracking-tight">
            Edit avatar
          </DialogTitle>
          <DialogClose
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-[25px] py-6">
          {stage === "choose" ? (
            <>
              {problem ? (
                <ProfileAvatarProblem
                  problem={problem}
                  testId="avatar-save-error"
                />
              ) : null}
              <div
                className="flex flex-wrap gap-3"
                data-testid="avatar-options"
              >
                <button
                  aria-label={`Choose ${initials(displayName)} avatar`}
                  aria-pressed={
                    selectedChoice === "initials" ||
                    (!avatarUrl && selectedChoice === null)
                  }
                  className="grid h-[60px] w-[60px] place-items-center rounded-lg bg-[#ece5ed] text-2xl font-semibold text-[#796782] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                  data-testid="avatar-option-initials"
                  onClick={() => {
                    setSelectedChoice("initials");
                    void savePreset(
                      emojiAvatarDataUrl(initials(displayName), "#796782"),
                    );
                  }}
                  type="button"
                >
                  {initials(displayName)}
                </button>
                {AVATAR_OPTIONS.map((option) => (
                  <button
                    aria-label={`Choose ${option.label} avatar`}
                    aria-pressed={selectedChoice === option.label}
                    className="grid h-[60px] w-[60px] place-items-center rounded-lg text-2xl text-[#796782] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`avatar-option-${option.label.toLowerCase()}`}
                    key={option.label}
                    onClick={() => void chooseAvatar(option)}
                    style={{ backgroundColor: option.background }}
                    type="button"
                  >
                    {option.emoji}
                  </button>
                ))}
              </div>
              <div className="mt-[22px] flex flex-wrap items-center gap-[10px]">
                <Button
                  className="rounded-md bg-[#2655a0] text-xs text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
                  data-testid="avatar-upload-open"
                  onClick={() => {
                    setProblem(null);
                    setStage("upload");
                  }}
                  type="button"
                >
                  Upload image
                </Button>
                <Button
                  className="rounded-md text-xs"
                  data-testid="avatar-camera-open"
                  onClick={() => {
                    setProblem(null);
                    setStage("camera");
                  }}
                  type="button"
                  variant="outline"
                >
                  Use camera
                </Button>
              </div>
            </>
          ) : null}

          {stage === "upload" || stage === "invalid" ? (
            <>
              {stage === "invalid" && problem ? (
                <ProfileAvatarProblem
                  problem={problem}
                  testId="avatar-invalid"
                />
              ) : null}
              <label
                className="flex min-h-[190px] w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-input bg-transparent px-6 py-6 text-sm text-muted-foreground"
                data-testid="avatar-file-drop-zone"
              >
                <FileIcon aria-hidden="true" className="h-4 w-4" />
                <strong className="font-semibold text-foreground">
                  Choose an image
                </strong>
                <span>
                  {AVATAR_ACCEPTED_LABEL}, up to {AVATAR_MAX_SOURCE_LABEL}
                </span>
                <input
                  accept={AVATAR_ACCEPT_ATTRIBUTE}
                  className="mt-2 w-full text-xs file:mr-2 file:rounded-[3px] file:border file:border-[#c4c4c4] file:bg-[#efefef] file:px-1 file:py-0 file:text-2xs file:text-[#282532] dark:file:border-[#5a5264] dark:file:bg-[#3a3243] dark:file:text-[#e6e1ec]"
                  data-testid="avatar-file-input"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0];
                    event.target.value = "";
                    setImageFile(nextFile);
                  }}
                  ref={fileInputRef}
                  type="file"
                />
              </label>
            </>
          ) : null}

          {stage === "camera" ? (
            <>
              {problem ? (
                <ProfileAvatarProblem
                  problem={problem}
                  testId="avatar-camera-error"
                />
              ) : null}
              <p className="mb-[18px] rounded-[7px] border border-[#dce5ef] bg-[#f1f6fc] px-[18px] py-[15px] text-xs leading-[1.65] text-[#48637f] dark:border-[#43516a] dark:bg-[#293445] dark:text-[#b4c6e0]">
                <strong className="mb-1 block font-medium">
                  Camera permission
                </strong>
                Use your camera to take a profile photo. Nothing is captured
                until you choose Take photo.
              </p>
              <div className="relative grid h-[275px] place-content-center overflow-hidden rounded-lg border border-[#eae7eb] bg-[#f8f7f8] dark:border-[#3c3544] dark:bg-[#302b36]">
                <video
                  aria-label="Camera preview"
                  autoPlay
                  className="h-full max-h-[275px] w-full object-cover"
                  data-testid="avatar-camera-preview"
                  muted
                  playsInline
                  ref={cameraVideoRef}
                />
                {!isCameraReady ? (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Monitor aria-hidden="true" className="h-4 w-4" />
                    <p>Camera preview</p>
                  </div>
                ) : null}
              </div>
              <div className="flex justify-start">
                <Button
                  className="rounded-md bg-[#2655a0] text-xs text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
                  data-testid="avatar-camera-capture"
                  disabled={!isCameraReady}
                  onClick={takePhoto}
                  type="button"
                >
                  Take photo
                </Button>
              </div>
            </>
          ) : null}

          {isCropStage ? (
            <>
              {stage === "failed" && problem ? (
                <ProfileAvatarProblem
                  problem={problem}
                  testId="avatar-save-error"
                />
              ) : null}
              <div
                aria-label="Avatar crop position"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(cropPoint.x * 100)}
                aria-valuetext={`Horizontal ${Math.round(cropPoint.x * 100)} percent, vertical ${Math.round(cropPoint.y * 100)} percent`}
                className="relative mx-auto h-[275px] w-full touch-none overflow-hidden rounded-lg border border-[#eae7eb] bg-[#f8f7f8] focus-visible:outline-ring dark:border-[#3c3544] dark:bg-[#302b36]"
                data-testid="avatar-crop-preview"
                onKeyDown={(event) => {
                  if (
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  moveCropPoint(event.key);
                }}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={() => {
                  pointerStartRef.current = null;
                }}
                ref={cropRef}
                role="slider"
                tabIndex={0}
              >
                <div className="absolute left-1/2 top-1/2 grid size-[180px] -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full bg-[#ebe5ef] text-[4rem] text-[#9f87ac] outline outline-2 outline-white shadow-[0_0_0_100px_#0002]">
                  {previewUrl ? (
                    <img
                      alt="Avatar crop preview"
                      className="h-full w-full select-none object-cover"
                      draggable={false}
                      src={previewUrl}
                      style={{
                        objectPosition: `${cropPoint.x * 100}% ${cropPoint.y * 100}%`,
                        transform: `scale(${zoom})`,
                      }}
                    />
                  ) : (
                    initials(displayName)
                  )}
                </div>
              </div>
              {stage === "crop" ? (
                <label
                  className="my-[19px] flex flex-col gap-6 text-xs leading-[1.5]"
                  htmlFor="avatar-crop-zoom"
                >
                  <span>Zoom</span>
                  <input
                    className="w-full p-0 accent-[#2655a0] dark:accent-[#a9bee8]"
                    data-testid="avatar-crop-zoom"
                    id="avatar-crop-zoom"
                    max="2"
                    min="1"
                    onChange={(event) => setZoom(Number(event.target.value))}
                    step="0.1"
                    type="range"
                    value={zoom}
                  />
                </label>
              ) : null}
              {stage === "crop" ? (
                <p className="mt-[30px] text-xs text-muted-foreground">
                  Drag to position; use arrow keys when the crop is focused.
                </p>
              ) : null}
            </>
          ) : null}

          {stage === "saving" ? (
            <div
              className="flex min-h-[190px] flex-col items-center justify-center gap-3 text-center"
              data-testid="avatar-saving"
            >
              <span
                aria-hidden="true"
                className="size-6 animate-spin rounded-full border-2 border-[#eae7eb] border-t-[#2655a0] dark:border-[#3c3544] dark:border-t-[#a9bee8]"
              />
              <p className="text-base font-medium">Saving your avatar…</p>
              <p className="text-sm text-muted-foreground">
                Your current avatar stays visible until this completes. You can
                cancel at any time.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-end gap-[10px] border-t border-border/70 px-[25px] py-[18px]">
          <DialogClose asChild>
            <Button
              className="rounded-md bg-card text-xs"
              data-testid="avatar-cancel"
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </DialogClose>
          {stage === "crop" || stage === "failed" || canRetryPreset ? (
            <Button
              className="rounded-md bg-[#2655a0] text-xs text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
              data-testid={
                stage === "failed" || canRetryPreset
                  ? "avatar-retry"
                  : "avatar-save"
              }
              disabled={isSaving}
              onClick={() => void retrySave()}
              ref={recoveryButtonRef}
              type="button"
            >
              {stage === "failed" || canRetryPreset
                ? "Try again"
                : "Save avatar"}
            </Button>
          ) : null}
          {stage === "invalid" ? (
            <Button
              className="rounded-md bg-[#2655a0] text-xs text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
              data-testid="avatar-choose-another"
              onClick={() => fileInputRef.current?.click()}
              ref={recoveryButtonRef}
              type="button"
            >
              Choose another image
            </Button>
          ) : null}
          {stage === "camera" && problem ? (
            <Button
              className="rounded-md bg-[#2655a0] text-xs text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
              data-testid="avatar-camera-use-upload"
              onClick={() => {
                setProblem(null);
                setStage("upload");
              }}
              ref={recoveryButtonRef}
              type="button"
            >
              Upload an image instead
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
