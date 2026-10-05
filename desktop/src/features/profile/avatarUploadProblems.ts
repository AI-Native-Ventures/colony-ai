/**
 * What the profile avatar dialog accepts, and the plain wording for every way
 * choosing or saving a photo can fail.
 *
 * One source of truth for three layers that must agree:
 * - the file chooser (`AVATAR_ACCEPT_ATTRIBUTE`),
 * - the in-dialog check (`checkAvatarFile`),
 * - the relay media endpoint, which stores JPEG, PNG, GIF and WebP images up to
 *   50 MiB by default (`BUZZ_MAX_IMAGE_BYTES`). The dialog never uploads the
 *   chosen file itself: it uploads a 512 px PNG crop, which is far below that
 *   cap, so every file this module lets through is accepted by the relay. The
 *   source cap below only protects the renderer from decoding very large files.
 *   GIF is left out on purpose: the crop is static and would drop the animation.
 */

export const AVATAR_ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const AVATAR_ACCEPT_ATTRIBUTE = AVATAR_ACCEPTED_TYPES.join(",");

export const AVATAR_ACCEPTED_LABEL = "JPEG, PNG or WebP";

export const AVATAR_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export const AVATAR_MAX_SOURCE_LABEL = "20 MB";

const EXTENSION_TYPES: Record<string, (typeof AVATAR_ACCEPTED_TYPES)[number]> =
  {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };

export type AvatarProblemKind =
  | "unsupported-type"
  | "too-large"
  | "unreadable"
  | "network"
  | "rate-limited"
  | "refused"
  | "camera"
  | "unknown";

export type AvatarProblem = {
  kind: AvatarProblemKind;
  message: string;
  title: string;
};

const ACCEPTED_SENTENCE = `Choose a ${AVATAR_ACCEPTED_LABEL} image up to ${AVATAR_MAX_SOURCE_LABEL}.`;

function isAcceptedType(file: { name: string; type: string }) {
  if (file.type) {
    return (AVATAR_ACCEPTED_TYPES as readonly string[]).includes(file.type);
  }
  // Some systems report no type for a valid file. Fall back to the extension;
  // the decoder rejects anything that is not really an image.
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return extension in EXTENSION_TYPES;
}

/** Returns the problem with a chosen file, or null when it can be cropped. */
export function checkAvatarFile(file: {
  name: string;
  size: number;
  type: string;
}): AvatarProblem | null {
  if (!isAcceptedType(file)) {
    return {
      kind: "unsupported-type",
      title: "That file is not a supported image",
      message: ACCEPTED_SENTENCE,
    };
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    return {
      kind: "too-large",
      title: "That image is too large",
      message: ACCEPTED_SENTENCE,
    };
  }
  if (file.size === 0) {
    return {
      kind: "unreadable",
      title: "That file is empty",
      message: ACCEPTED_SENTENCE,
    };
  }
  return null;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

type AvatarFailureContext = {
  /** True when a cropped image is still held, so a retry keeps it. */
  hasCrop: boolean;
  /** Which step failed: reading the image, uploading it, or updating the profile. */
  phase: "prepare" | "upload" | "publish";
};

/** Plain Colony wording for a failed save. Never exposes raw error text. */
export function describeAvatarFailure(
  error: unknown,
  { hasCrop, phase }: AvatarFailureContext,
): AvatarProblem {
  const text = errorText(error).toLowerCase();
  const kept = hasCrop ? "The crop is kept. " : "";

  if (phase === "prepare") {
    return {
      kind: "unreadable",
      title: "Colony could not read that image",
      message:
        "The file may be damaged. Choose another image, or retry with this one.",
    };
  }
  if (/rate-limited|\b429\b|too many/.test(text)) {
    return {
      kind: "rate-limited",
      title: "Too many uploads right now",
      message: `${kept}Wait a minute, then retry.`,
    };
  }
  if (
    /\b413\b|too large|payload too large|decoding limits|size limit/.test(text)
  ) {
    return {
      kind: "too-large",
      title: "Your community could not take that image",
      message: `It is too large. ${ACCEPTED_SENTENCE.replace("Choose", "Choose another")}`,
    };
  }
  if (
    /\b415\b|unsupported (file|media)|disallowed content type|unknown content type|must be an image|invalid image/.test(
      text,
    )
  ) {
    return {
      kind: "unsupported-type",
      title: "That file is not a supported image",
      message: ACCEPTED_SENTENCE,
    };
  }
  if (
    /\b40[13]\b|unauthori[sz]ed|forbidden|not a member|membership|permission|denied|refus/.test(
      text,
    )
  ) {
    return {
      kind: "refused",
      title: "Your community did not accept the photo",
      message: `${kept}You may not have permission to upload here. Ask a community admin, then retry.`,
    };
  }
  if (
    /unreachable|network|offline|timed out|timeout|connect|dns|failed to fetch|error sending request/.test(
      text,
    )
  ) {
    return {
      kind: "network",
      title: "Your avatar wasn’t saved",
      message: `${kept}Check your connection and try again.`,
    };
  }
  return {
    kind: "unknown",
    title: "Your avatar wasn’t saved",
    message:
      phase === "publish" && hasCrop
        ? "The photo uploaded but your profile was not updated. Retry to finish."
        : `${kept}Something went wrong on our side. Try again.`,
  };
}

/** Plain wording for a camera that cannot start or capture. */
export function describeCameraProblem(error: unknown): AvatarProblem {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      kind: "camera",
      title: "Colony cannot use your camera",
      message:
        "Allow camera access for Colony in your system settings, or upload an image instead.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      kind: "camera",
      title: "No camera found",
      message: "Connect a camera, or upload an image instead.",
    };
  }
  return {
    kind: "camera",
    title: "The camera did not start",
    message:
      "Close other apps that use the camera, or upload an image instead.",
  };
}
