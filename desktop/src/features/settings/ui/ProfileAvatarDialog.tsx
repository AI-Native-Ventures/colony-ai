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
import {
  CameraIcon,
  DiamondGlyph,
  FlowerGlyph,
  LeafGlyph,
  MonitorIcon,
  StarGlyph,
  SunGlyph,
  UploadIcon,
} from "@/features/profile/ui/profileIcons";
import { uploadMediaFile } from "@/shared/api/tauriMedia";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ProfileAvatarProblem } from "./ProfileAvatarProblem";
import "@/features/profile/ui/ProfileMenus.css";

/** What each preset saves, and the glyph the board draws on its button. */
const AVATAR_OPTIONS = [
  { label: "Star", emoji: "\u2726", color: "#FFFFFF", Glyph: StarGlyph },
  { label: "Leaf", emoji: "\uD83C\uDF3F", color: "#e4ede5", Glyph: LeafGlyph },
  { label: "Diamond", emoji: "\u25C8", color: "#FFFFFF", Glyph: DiamondGlyph },
  { label: "Sun", emoji: "\u2600", color: "#FFF4CC", Glyph: SunGlyph },
  { label: "Flower", emoji: "\uD83C\uDF38", color: "#f5dce9", Glyph: FlowerGlyph },
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

  /** The avatar the highlighted preset would save, or null with none chosen. */
  function chosenPresetAvatar(): string | null {
    if (selectedChoice === "initials" || (selectedChoice === null && !avatarUrl)) {
      return emojiAvatarDataUrl(initials(displayName), "#796782");
    }
    const option = AVATAR_OPTIONS.find((entry) => entry.label === selectedChoice);
    return option ? emojiAvatarDataUrl(option.emoji, option.color) : null;
  }

  async function retrySave() {
    if (stage === "choose") {
      const avatar = canRetryPreset
        ? lastPresetRef.current
        : chosenPresetAvatar();
      if (avatar) await savePreset(avatar);
      return;
    }
    await saveCrop();
  }

  const isSaving = stage === "saving";
  const isCropStage = stage === "crop" || stage === "failed";
  const canRetryPreset =
    stage === "choose" && problem !== null && lastPresetRef.current !== null;
  const narrow = stage === "camera" || stage === "saving";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="pa-dialog"
        data-stage={stage}
        data-testid="profile-avatar-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef.current;
          returnFocusRef.current = null;
          if (target?.isConnected) target.focus();
        }}
        showCloseButton={false}
        surface="none"
      >
        <div className="pa-head" data-hidden={isSaving ? "true" : undefined}>
          <DialogTitle className="pa-title">Edit avatar</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a picture for your profile.
          </DialogDescription>
          <DialogClose aria-label="Close" className="pa-close">
            <CloseIcon size={narrow ? 15 : 17} strokeWidth={2.4} />
          </DialogClose>
        </div>

        <div className="pa-body">
          {stage === "choose" ? (
            <>
              {problem ? (
                <ProfileAvatarProblem
                  problem={problem}
                  testId="avatar-save-error"
                />
              ) : null}
              <div className="pa-options" data-testid="avatar-options">
                <button
                  aria-label={`Choose ${initials(displayName)} avatar`}
                  aria-pressed={
                    selectedChoice === "initials" ||
                    (!avatarUrl && selectedChoice === null)
                  }
                  className="pa-option pa-option-initials"
                  data-testid="avatar-option-initials"
                  onClick={() => {
                    setProblem(null);
                    setSelectedChoice("initials");
                  }}
                  type="button"
                >
                  {initials(displayName)}
                </button>
                {AVATAR_OPTIONS.map((option) => (
                  <button
                    aria-label={`Choose ${option.label} avatar`}
                    aria-pressed={selectedChoice === option.label}
                    className="pa-option"
                    data-testid={`avatar-option-${option.label.toLowerCase()}`}
                    key={option.label}
                    onClick={() => {
                      setProblem(null);
                      setSelectedChoice(option.label);
                    }}
                    type="button"
                  >
                    <option.Glyph size={26} />
                  </button>
                ))}
              </div>
              <div className="pa-actions">
                <button
                  className="pa-upload"
                  data-testid="avatar-upload-open"
                  onClick={() => {
                    setProblem(null);
                    setStage("upload");
                  }}
                  type="button"
                >
                  <UploadIcon size={16} strokeWidth={2.3} />
                  Upload image
                </button>
                <button
                  className="pa-outline"
                  data-testid="avatar-camera-open"
                  onClick={() => {
                    setProblem(null);
                    setStage("camera");
                  }}
                  type="button"
                >
                  <CameraIcon size={16} strokeWidth={2.1} />
                  Use camera
                </button>
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
                className="pa-drop"
                data-testid="avatar-file-drop-zone"
              >
                <UploadIcon size={20} />
                <strong>Choose an image</strong>
                <span>
                  {AVATAR_ACCEPTED_LABEL}, up to {AVATAR_MAX_SOURCE_LABEL}
                </span>
                <input
                  accept={AVATAR_ACCEPT_ATTRIBUTE}
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
              <p className="pa-note">
                <strong>Camera permission</strong>
                Use your camera to take a profile photo. Nothing is captured
                until you choose Take photo.
              </p>
              <div className="pa-camera">
                <video
                  aria-label="Camera preview"
                  autoPlay
                  data-testid="avatar-camera-preview"
                  muted
                  playsInline
                  ref={cameraVideoRef}
                />
                {!isCameraReady ? (
                  <div className="pa-camera-empty">
                    <MonitorIcon size={20} />
                    <span>Camera preview</span>
                  </div>
                ) : null}
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
                className="pa-crop"
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
                <div className="pa-crop-guide">
                  {previewUrl ? (
                    <img
                      alt="Avatar crop preview"
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
                <label className="pa-zoom" htmlFor="avatar-crop-zoom">
                  <span>Zoom</span>
                  <input
                    data-testid="avatar-crop-zoom"
                    id="avatar-crop-zoom"
                    max="3"
                    min="1"
                    onChange={(event) => setZoom(Number(event.target.value))}
                    step="0.05"
                    type="range"
                    value={zoom}
                  />
                </label>
              ) : null}
              {stage === "crop" ? (
                <p className="pa-hint">
                  Drag to position; use arrow keys when the crop is focused.
                </p>
              ) : null}
            </>
          ) : null}

          {stage === "saving" ? (
            <div
              className="pa-saving"
              data-testid="avatar-saving"
              role="status"
            >
              <span aria-hidden="true" className="pa-spinner" />
              <h2>Saving your avatar…</h2>
              <p>
                Your current avatar stays visible until this completes. You can
                cancel at any time.
              </p>
            </div>
          ) : null}
        </div>

        <div className="pa-foot">
          <DialogClose asChild>
            <button
              className="pa-cancel"
              data-testid="avatar-cancel"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
          </DialogClose>
          {stage === "choose" ? (
            <button
              className="pa-save"
              data-testid={canRetryPreset ? "avatar-retry" : "avatar-save"}
              disabled={
                isSaving ||
                (!canRetryPreset && chosenPresetAvatar() === null)
              }
              onClick={() => void retrySave()}
              ref={recoveryButtonRef}
              type="button"
            >
              {canRetryPreset ? "Try again" : "Save avatar"}
            </button>
          ) : null}
          {stage === "crop" || stage === "failed" ? (
            <button
              className="pa-save"
              data-testid={stage === "failed" ? "avatar-retry" : "avatar-save"}
              disabled={isSaving}
              onClick={() => void retrySave()}
              ref={recoveryButtonRef}
              type="button"
            >
              {stage === "failed" ? "Try again" : "Save avatar"}
            </button>
          ) : null}
          {stage === "invalid" ? (
            <button
              className="pa-save"
              data-testid="avatar-choose-another"
              onClick={() => fileInputRef.current?.click()}
              ref={recoveryButtonRef}
              type="button"
            >
              Choose another image
            </button>
          ) : null}
          {stage === "camera" ? (
            <>
              {problem ? (
                <button
                  className="pa-save"
                  data-testid="avatar-camera-use-upload"
                  onClick={() => {
                    setProblem(null);
                    setStage("upload");
                  }}
                  ref={recoveryButtonRef}
                  type="button"
                >
                  Upload an image instead
                </button>
              ) : null}
              <button
                className="pa-dark"
                data-testid="avatar-camera-capture"
                disabled={!isCameraReady}
                onClick={takePhoto}
                type="button"
              >
                <i aria-hidden="true" />
                Take photo
              </button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
