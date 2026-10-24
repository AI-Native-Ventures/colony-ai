import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { FirstRunButton, FirstRunError } from "./firstRunControls";
import "./firstRun.css";

/** Take a still photo with the camera, square, and hand it back as a file. */
export function PhotoCaptureDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [ready, setReady] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setReady(false);
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem(
        "This computer has no camera Colony can use. Upload a photo instead.",
      );
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (!live) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        setReady(true);
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
      })
      .catch(() => {
        if (live)
          setProblem(
            "Colony couldn’t open the camera. Check camera access, or upload a photo instead.",
          );
      });
    return () => {
      live = false;
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, [open]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready || video.videoWidth === 0) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
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
      if (!blob) {
        setProblem(
          "The photo wasn’t taken. Try again, or upload a photo instead.",
        );
        return;
      }
      onCapture(new File([blob], "profile-photo.png", { type: "image/png" }));
    }, "image/png");
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3fr-dialog c3fr-camera max-w-[26rem]"
        data-testid="photo-capture-dialog"
      >
        <DialogTitle>Take a photo</DialogTitle>
        <DialogDescription>
          Your face, centred in the square. You can retake it or upload a photo
          instead.
        </DialogDescription>
        {problem ? (
          <FirstRunError>{problem}</FirstRunError>
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: a live camera preview has no audio track.
          <video
            className="c3fr-camera-video"
            muted
            playsInline
            ref={videoRef}
          />
        )}
        <div className="c3fr-actions">
          <FirstRunButton onClick={() => onOpenChange(false)}>
            Cancel
          </FirstRunButton>
          <FirstRunButton
            data-testid="photo-capture-take"
            disabled={!ready}
            kind="primary"
            onClick={capture}
          >
            Take photo
          </FirstRunButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
